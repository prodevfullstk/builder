# Antigravity Phase 4 — Production Verification, Concurrency & Sandbox Hardening Specification

**Specification Version:** 1.0.0  
**Status:** AUTHORITATIVE (Source of Truth for Phase 4)  
**Date:** September 13, 2026  
**Auditor Baseline:** Audit #6 (`docs/audits/audit-6-report.md`)  
**Base Commit:** `a826d525aa0f92b32d720817ae72e260e7768d89`  

---

## 1. Executive Mission & Security Invariants

Phase 4 eliminates all P1 architectural bypasses and verification gaps identified during **Audit #6**, establishing hardened, production-grade isolation, authoritative database concurrency, canonical sandbox containment, and distributed abuse prevention.

### Mandatory Security Invariants:
1. **Zero Host Execution (SEC-400):** Untrusted generated code must NEVER execute on the production application host under any condition. If containerized/microVM execution is unavailable, the system must fail closed or truthfully record verification as unavailable. Bare-host fallback is strictly forbidden.
2. **Canonical Sandbox Containment (SEC-401):** Every sandbox file operation must strictly resolve within the designated sandbox workspace (`/vercel/app`). File operations must be checked using canonical path resolution and `path.relative` containment, rejecting `../`, absolute paths, drive letters, UNC shares, and symlink escapes.
3. **Database-Authoritative Concurrency Control (CONC-401):** Concurrency control must be authoritative at the database/server persistence layer using monotonic revision tracking and atomic Compare-And-Swap (`WHERE id = ? AND revision = ?`). A stale candidate generated against an earlier revision must NEVER overwrite a newer project revision.
4. **Universal Concurrency Boundary (CONC-402):** Every mutation path (Chat build, Chat follow-up, Preview Auto-Fix, Monaco AI Edit, Auto-Heal) must capture a baseline revision at request initiation and verify that the workspace revision has not changed before committing.
5. **Truthful Build & Execution Verification (GEN-401):** The system must distinguish between `STATIC_VALIDATED`, `VIRTUAL_PREVIEW_VALIDATED`, `NATIVE_BUILD_VERIFIED`, `RUNTIME_SMOKE_VERIFIED`, `CONFLICT`, and `VERIFICATION_UNAVAILABLE`. The application must never claim native framework verification based solely on in-browser esbuild virtual syntax compilation.
6. **Distributed Multi-Instance Rate Limiting (SEC-402):** Production rate limiting must be shared across serverless/container instances using an atomic distributed store (PostgreSQL atomic quota counter or Redis). An in-process `Map` is prohibited as the production authority.

---

## 2. Detailed Technical Requirements

### 2.1 GEN-401 / GEN-601: Connect Native BuildRunner & Truthful Verification Pipeline
* **Problem:** In Phase 3, `BuildRunner` was a disconnected abstraction. Candidate evaluation in production only ran static checks (`evaluateCandidateChanges`) and in-browser WebAssembly esbuild (`bundleProjectWithEsbuild`). Real native builds (`next build`, `vite build`, `astro build`) were unverified.
* **Architecture:**
  1. Create a dedicated server-side verification endpoint `/api/validate/build`:
     * Accepts `projectId`, `framework`, `files`, `expectedRevision`.
     * Validates project ownership and authentication.
     * Checks if `VERCEL_TOKEN` / sandbox microVM infrastructure is available.
     * If available, invokes `VercelSandboxRunner` to execute native build and smoke test in isolated cloud microVM.
     * If unavailable, returns machine-readable status `verification_unavailable` (with reason: `VERCEL_TOKEN not configured`) and explicitly classifies the project as `VIRTUAL_PREVIEW_VALIDATED` (or fails closed if native build verification is configured as mandatory).
     * Strictly refuses execution on the application host.
  2. Extend `ValidationEvidence` schema in `lib/validation/types.ts`:
     ```typescript
     export type VerificationLevel =
       | 'STATIC_VALIDATED'
       | 'VIRTUAL_PREVIEW_VALIDATED'
       | 'NATIVE_BUILD_VERIFIED'
       | 'RUNTIME_SMOKE_VERIFIED'
       | 'REJECTED'
       | 'CONFLICT'
       | 'VERIFICATION_UNAVAILABLE';

     export interface NativeBuildRecord {
       attempted: boolean;
       status: 'passed' | 'failed' | 'unavailable';
       framework: string;
       runner: string;
       environment: 'vercel_sandbox' | 'none';
       command?: string;
       exitCode?: number;
       durationMs?: number;
       stdoutSummary?: string;
       stderrSummary?: string;
       smokeTestPassed?: boolean;
     }
     ```
  3. Wire UI and Chat Panel to display accurate verification level.

---

### 2.2 CONC-401 / CONC-601: Database-Authoritative Revision Control (CAS)
* **Problem:** Revision tracking existed only in the browser's Zustand state. The database schema lacked a `revision` column, and persistence used `resolution=merge-duplicates`, allowing concurrent browser tabs to silently overwrite each other's work.
* **Database Migration (`supabase/migrations/20260913_add_project_revision_cas.sql`):**
  1. Add column `revision integer NOT NULL DEFAULT 1` to `public.projects`.
  2. Create an atomic PostgreSQL function for Compare-And-Swap commits:
     ```sql
     CREATE OR REPLACE FUNCTION commit_project_revision_cas(
       p_project_id TEXT,
       p_expected_revision INTEGER,
       p_name TEXT,
       p_framework TEXT,
       p_files JSONB,
       p_messages JSONB
     ) RETURNS JSONB
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path = public
     AS $$
     DECLARE
       v_current_rev INTEGER;
       v_new_rev INTEGER;
       v_updated_row RECORD;
     BEGIN
       -- Check current revision
       SELECT revision INTO v_current_rev
       FROM public.projects
       WHERE id = p_project_id AND user_id = auth.uid()::text
       FOR UPDATE;

       IF NOT FOUND THEN
         -- Attempt insert if project is newly created
         INSERT INTO public.projects (id, user_id, name, framework, files, messages, revision, updated_at)
         VALUES (p_project_id, auth.uid()::text, p_name, p_framework, p_files, p_messages, 1, NOW())
         RETURNING * INTO v_updated_row;
         
         RETURN jsonb_build_object('success', true, 'revision', 1);
       END IF;

       IF v_current_rev <> p_expected_revision THEN
         RETURN jsonb_build_object(
           'success', false,
           'conflict', true,
           'current_revision', v_current_rev,
           'expected_revision', p_expected_revision,
           'error', 'Conflict: Project was modified concurrently. Generated changes were not committed.'
         );
       END IF;

       v_new_rev := v_current_rev + 1;

       UPDATE public.projects
       SET
         name = p_name,
         framework = p_framework,
         files = p_files,
         messages = p_messages,
         revision = v_new_rev,
         updated_at = NOW()
       WHERE id = p_project_id AND user_id = auth.uid()::text AND revision = p_expected_revision
       RETURNING * INTO v_updated_row;

       RETURN jsonb_build_object('success', true, 'revision', v_new_rev);
     END;
     $$;
     ```
  3. Update `lib/auth/supabase-auth.ts`:
     * `saveProject` calls `rpc/commit_project_revision_cas` passing `expectedRevision`.
     * On conflict, returns `{ success: false, conflict: true, status: 409, message: "Your project changed while this generation was running. The generated changes were not committed." }`.
  4. In `lib/storage/project-authority.ts`:
     * Add `revision` to `AuthoritativeProject`.
     * Add `updateServerProjectWithCas()` enforcing CAS on in-memory server registry.

---

### 2.3 CONC-402 / CONC-602: Preview Auto-Fix Concurrency Boundary
* **Problem:** `components/builder/preview-pane.tsx` (`handleAutoFix`) failed to capture `baselineRevision` before streaming repairs and did not verify revision before calling `setFiles()`, causing race conditions against manual user typing.
* **Requirements:**
  1. Capture `baselineRevision = useProjectStore.getState().revision || 1` immediately upon `handleAutoFix` launch.
  2. Prior to calling `setFiles(evalResult.committedFiles)`, verify:
     ```typescript
     const currentRevision = useProjectStore.getState().revision || 1;
     if (currentRevision !== baselineRevision) {
       addLog(`[Auto-Fix Conflict] Stale repair candidate rejected: workspace revision advanced from ${baselineRevision} to ${currentRevision}.`);
       setRuntimeError('Conflict: Your project changed while auto-fix was running. Repaired changes were not committed.');
       return;
     }
     ```
  3. Ensure `code-editor.tsx` and Monaco AI edit paths adhere to the same concurrency invariants.

---

### 2.4 SEC-401 / SEC-601: Sandbox Canonical Path Containment
* **Problem:** `app/api/sandbox/route.ts` only stripped leading `/`, allowing relative traversal paths (`../../etc/shadow`) to escape `/vercel/app` into the container filesystem.
* **Requirements:**
  1. Implement canonical relative containment in `app/api/sandbox/route.ts`:
     ```typescript
     export function assertContainedPath(rawPath: string, rootDir = '/vercel/app'): string {
       if (!rawPath || typeof rawPath !== 'string' || rawPath.includes('\0')) {
         throw new Error(`Security Violation: Invalid or null-byte path '${rawPath}'`);
       }
       // Strip Windows drive letter or leading separators
       const clean = rawPath.replace(/^[a-zA-Z]:/, '').replace(/^[\\/]+/, '');
       const posixClean = clean.split(/[\\/]/).filter(Boolean).join('/');
       const target = path.posix.resolve(rootDir, posixClean);
       const relative = path.posix.relative(rootDir, target);
       
       if (
         relative === '..' ||
         relative.startsWith('../') ||
         path.posix.isAbsolute(relative) ||
         target === rootDir
       ) {
         throw new Error(`Security Violation: Path traversal attempt outside sandbox workspace: '${rawPath}'`);
       }
       return target;
     }
     ```
  2. Apply `assertContainedPath` to every file key in Mode A and Mode B before writing to `sandbox.writeFiles()`.
  3. Return HTTP 400 Bad Request if any file path violates containment.

---

### 2.5 SEC-402 / SEC-602: Distributed Multi-Instance Rate Limiting
* **Problem:** In-process `Map` in `lib/auth/rate-limiter.ts` resets on cold restarts and does not synchronize state across serverless instances.
* **Requirements:**
  1. Implement atomic distributed rate limiting using Supabase PostgreSQL table or Upstash Redis:
     - Create SQL table `public.rate_limits` with `key text primary key, count int, reset_at timestamptz`.
     - Implement atomic check-and-increment stored procedure `check_rate_limit_atomic(p_key, p_max, p_window_seconds)`.
     - Fallback to local in-memory store if database is unreachable, with strict fail-closed behavior on excessive burst.
  2. Rate limit key format:
     - Demo: `demo:<ip>` (10 requests / hour)
     - Authenticated: `user:<userId>` (60 requests / hour)
     - Sandbox creation: `sandbox:<userId>` (20 creations / hour)
  3. Enforce rate limiting across `/api/agent`, `/api/chat`, `/api/generate`, `/api/sandbox`.
  4. Return HTTP 429 with standard `Retry-After` header.

---

## 3. Verification & Evidence Acceptance Criteria

| Finding | Remediation Area | Required Verification Proof |
|---|---|---|
| **GEN-401** | Connect Native BuildRunner | Test demonstrates native build runner execution in isolated environment; records truthful evidence; fails closed on missing credentials without host execution. |
| **CONC-401** | Database Revision CAS | Migration applied to live database; test proves concurrent updates on stale revision return conflict and 0 rows overwritten. |
| **CONC-402** | Preview Auto-Fix Concurrency | Test proves auto-fix aborts commit and displays conflict error if workspace revision changes during generation. |
| **SEC-401** | Sandbox Path Containment | Test verifies `../../etc/passwd`, absolute paths, drive letters, and UNC shares are blocked with 400 error. |
| **SEC-402** | Distributed Rate Limiting | Test proves multi-instance / atomic rate limiting blocks 11th request with 429 and Retry-After. |
