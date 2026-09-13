# Antigravity Audit #7 — Hostile Production Certification Audit

**Audit Date:** September 13, 2026  
**Auditor:** Strict Independent Adversarial Security & Production Certification Auditor  
**Repository:** `opendorkweb`  
**Commit SHA:** `636b7c36308fe664e8232762538d8ceb5944371d`  
**Branch:** `main`  
**Working-Tree State:** Clean (Zero uncommitted changes)  
**Node.js Version:** `v24.18.1`  
**pnpm Version:** `11.18.0`  
**Declared Package Manager (`package.json`):** `pnpm@9.15.9` (Version mismatch: pnpm 11 in use vs pnpm 9 declared)  
**Next.js Version:** `15.5.25` (React `19.0.0`)  
**Supabase PostgreSQL Availability:** Live connection verified (`aws-0-ap-south-1.pooler.supabase.com:5432`)  
**Vercel Sandbox Infrastructure (`VERCEL_TOKEN`):** **UNAVAILABLE / NOT CONFIGURED**  

---

## 1. Executive Verdict

### **VERDICT: NOT PRODUCTION READY**

### Summary of Verdict Rationale:
Phase 4 made substantial progress by establishing canonical sandbox path containment (`assertContainedSandboxPath`), deploying atomic database CAS (`commit_project_revision_cas`), and creating a build validation route (`/api/validate/build`). However, hostile architectural and execution audit reveals critical disqualifying gaps:

1. **Native Build Verification Is Still Disconnected From Generation/Commit (P0 / GEN-701):**  
   While an HTTP endpoint `/api/validate/build` was created, it is **never called by the AI generation workflow, candidate pipeline, preview pane, or Monaco editor**. In production, generated code is still committed to the user's workspace based **solely on in-browser Babel and WebAssembly esbuild virtual syntax compilation**. Neither `next build`, `vite build`, nor `astro build` executes before candidate commitment. Real native framework verification has **never executed** for any generated project (`NATIVE BUILD UNVERIFIED`).
2. **Distributed Rate Limiter Fails Open to Per-Instance In-Memory Map (P0 / SEC-701):**  
   In `lib/auth/rate-limiter.ts`, if Supabase PostgreSQL is unreachable, times out, or throws an RPC error, the function silently catches the exception and falls back to `checkRateLimit(key, maxRequests, windowMs)` — an in-process Node.js `Map`. In a multi-instance serverless deployment, this converts distributed quotas into independent per-instance buckets, completely bypassing centralized rate limits when the database experiences load or network hiccups.
3. **`check_rate_limit_atomic` RPC Can Be Abused Directly (P1 / SEC-702):**  
   The database stored procedure `public.check_rate_limit_atomic` is granted to `anon` and `authenticated` roles with unrestricted execution permissions. Any client can invoke PostgREST `/rest/v1/rpc/check_rate_limit_atomic` directly with arbitrary `p_max = 999999999` or arbitrary `p_key` values, permitting denial-of-service against other users' rate-limit buckets or inflating their own quotas.
4. **Symlink Escape Unproven in Sandbox MicroVM (P1 / SEC-703):**  
   `assertContainedSandboxPath` relies entirely on lexical POSIX path math (`path.posix.resolve` and `path.posix.relative`). It does not and cannot inspect symlinks inside the container. If an uploaded archive or script creates `workspace/symlink -> /etc` or writes through a symlinked directory, lexical path checking allows write and read operations outside the application root.
5. **Monaco AI Inline Edit Bypasses Optimistic Concurrency Control (P1 / CONC-701):**  
   While `chat-panel.tsx` and `preview-pane.tsx` were hardened with baseline revision checks in Phase 4, `components/builder/code-editor.tsx` (`handleAskAI`) captures **no baseline revision**. It executes asynchronous AI generation, passes candidate changes to `evaluateCandidateChanges`, and then calls `updateFile` unconditionally. If a background chat generation commits new code while Monaco Ask AI is streaming, the inline edit blindly overwrites the file.
6. **Supabase Client Fallback Bypasses CAS on Error (P1 / CONC-702):**  
   In `lib/auth/supabase-auth.ts`, `saveProject` invokes the CAS RPC `commit_project_revision_cas`. If that RPC fails (for instance due to a network glitch, timeout, or 500 error), it falls back to a raw `POST` to `/rest/v1/projects` with `Prefer: resolution=merge-duplicates`, reverting to dangerous last-write-wins behavior.

---

## 2. Claim-vs-Evidence Matrix

| Phase 4 Claim | Actual Evidence | Evidence Class | Independent Verdict |
| ------------- | --------------- | -------------- | ------------------- |
| **“Native BuildRunner connected”** | `/api/validate/build` exists and instantiates `VercelSandboxRunner`, but is **never invoked** by `chat-panel.tsx`, `candidate-pipeline.ts`, or any generation/commit path. `VERCEL_TOKEN` is not configured; endpoint returns `status: unavailable`. | **HTTP VERIFIED** (Endpoint exists) / **UNVERIFIED** (In production workflow) | **FAILED (GEN-701)** |
| **“Production execution isolated”** | `LocalBuildRunner` asserts `process.env.NODE_ENV !== 'production'` and is disconnected. No host process execution is reachable from web routes. | **CODE VERIFIED & INTEGRATION VERIFIED** | **PASS** |
| **“Database CAS verified”** | `commit_project_revision_cas` installed in PostgreSQL, verified with live row locking, rejects stale revisions. However, `supabase-auth.ts` falls back to `merge-duplicates` on failure, and `code-editor.tsx` lacks client CAS checks. | **DATABASE VERIFIED** (RPC) / **PARTIALLY VERIFIED** (Application layer) | **CONDITIONAL PASS (CONC-701/702)** |
| **“Preview auto-fix concurrency verified”** | `preview-pane.tsx` captures `baselineRevision` and aborts if `currentRevision !== baselineRevision`. Tested in `test/phase4-hardening.test.ts`. | **INTEGRATION VERIFIED** | **PASS** |
| **“Sandbox containment verified”** | `assertContainedSandboxPath` strictly rejects `../`, absolute paths, drive letters, UNC, and null bytes. Lexical boundary confirmed. Symlink boundary remains unverified. | **UNIT & HTTP VERIFIED** (Lexical only) | **CONDITIONAL PASS (SEC-703)** |
| **“Distributed rate limiting verified”** | PostgreSQL `rate_limits` table and RPC active. However, application falls back to in-memory `Map` on error (fail-open), and RPC allows arbitrary caller parameters. | **DATABASE VERIFIED** / **ARCHITECTURE DEFICIENT** | **FAILED (SEC-701/702)** |

---

## 3. Findings

---

### Finding [P0-1] — Disconnected BuildRunner in Production Generation Workflow
* **Finding ID:** `GEN-701`
* **Severity:** **P0 (Critical Architectural Disconnect)**
* **Evidence:**
  1. `app/api/validate/build/route.ts` was created in Phase 4.
  2. Global grep confirms `/api/validate/build` is referenced **only** in `test/phase4-hardening.test.ts` and documentation files.
  3. `components/builder/chat-panel.tsx` (lines 480–666) commits generated files using `evaluateCandidateChanges` and `bundleProjectWithEsbuild`. It never issues a request to `/api/validate/build`.
  4. `candidate-pipeline.ts` evaluates candidate files using static regex / AST checks and assigns `STATIC_VALIDATED`.
  5. `VERCEL_TOKEN` is missing in `.env.local`. When tested, `/api/validate/build` returns:
     ```json
     {
       "success": true,
       "verificationLevel": "VERIFICATION_UNAVAILABLE",
       "nativeBuild": { "attempted": false, "status": "unavailable", "environment": "none" }
     }
     ```
* **Why it matters:**
  The system claims native framework build verification, but no Next.js, Vite, or Astro compiler (`next build`, `vite build`, `astro build`) ever executes during project generation. Candidates with fatal routing, SSR, or build configuration errors are accepted into user workspaces because in-browser esbuild only checks client-side syntax.
* **Reproduction:**
  1. Generate code in `chat-panel.tsx`.
  2. Inspect network tab during generation.
  3. Notice zero HTTP requests to `/api/validate/build`. The candidate is committed to Zustand and local storage immediately after in-browser esbuild finishes.
* **Expected behavior:**
  Generation and commit workflows must invoke isolated container compilation, or truthfully inform the user that native compilation has not occurred (`NATIVE BUILD UNVERIFIED`).
* **Current behavior:**
  The endpoint is an isolated stub called only by test fixtures. Generation commits based purely on virtual browser simulation.
* **Recommended architecture:**
  Integrate `/api/validate/build` into `chat-panel.tsx` and `candidate-pipeline.ts` as an explicit pre-commit gate before `setFiles`.

---

### Finding [P0-2] — Distributed Rate Limiter Fails Open to Local In-Memory Store
* **Finding ID:** `SEC-701`
* **Severity:** **P0 (Security Bypass under Degradation)**
* **Evidence:**
  `lib/auth/rate-limiter.ts` lines 99–131:
  ```typescript
  if (supabaseUrl && serviceKey) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/check_rate_limit_atomic`, { ... });
      if (res.ok) {
        const data = await res.json();
        return { allowed: Boolean(data.allowed), ... };
      }
    } catch {
      // Graceful fallback to local in-memory store
    }
  }
  // Fallback to local in-memory rate limiter
  return checkRateLimit(key, maxRequests, windowMs);
  ```
* **Why it matters:**
  In expensive security-critical pathways (such as `/api/agent` which consumes LLM tokens and API credits), failing open to a per-instance memory store violates the distributed invariant. If an attacker floods the server or if Supabase experiences connection pool exhaustion, the system falls back to separate memory stores across serverless instances, multiplying the allowed request volume by the number of active server instances.
* **Reproduction:**
  1. Set invalid `DATABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` or block outbound DB network.
  2. Spin up two separate server processes.
  3. Each process allows 10 demo requests independently, permitting 20 total requests instead of the hard limit of 10.
* **Expected behavior:**
  Expensive AI routes must fail closed when distributed rate limiting infrastructure is unavailable (`HTTP 503 Service Unavailable: Rate limiting service degraded`).
* **Current behavior:**
  Silently falls back to local in-memory `Map`.
* **Recommended architecture:**
  Remove silent fallback for AI generation routes; throw or return an error indicating rate limiter backend failure.

---

### Finding [P1-1] — Unrestricted Parameters on `check_rate_limit_atomic` RPC
* **Finding ID:** `SEC-702`
* **Severity:** **P1 (High)**
* **Evidence:**
  1. Database introspection confirms:
     ```sql
     GRANT EXECUTE ON FUNCTION public.check_rate_limit_atomic TO anon, authenticated, service_role;
     ```
  2. Function definition:
     ```sql
     CREATE OR REPLACE FUNCTION public.check_rate_limit_atomic(
       p_key TEXT,
       p_max INT,
       p_window_seconds INT DEFAULT 3600
     ) RETURNS JSONB
     ```
  3. Direct HTTP call to `POST https://<supabase>/rest/v1/rpc/check_rate_limit_atomic` with `apikey: ANON_KEY`:
     ```json
     {
       "p_key": "user:my-victim-or-me",
       "p_max": 1000000,
       "p_window_seconds": 60
     }
     ```
     Succeeds and returns `{ "allowed": true, "remaining": 999999 }`.
* **Why it matters:**
  Any client holding the public anonymous Supabase key can invoke the RPC directly to artificially inflate their own quota (`p_max = 1000000`) or exhaust arbitrary keys belonging to other users.
* **Expected behavior:**
  `check_rate_limit_atomic` should only be callable by `service_role`, or the server application must sign/authenticate rate limit claims rather than delegating parameter choices to the caller.
* **Current behavior:**
  `anon` has direct EXECUTE permissions and chooses `p_max`.
* **Recommended architecture:**
  `REVOKE EXECUTE ON FUNCTION public.check_rate_limit_atomic FROM PUBLIC, anon, authenticated;`  
  `GRANT EXECUTE ON FUNCTION public.check_rate_limit_atomic TO service_role;`

---

### Finding [P1-2] — Monaco Ask AI Inline Edit Lacks Baseline Revision Check
* **Finding ID:** `CONC-701`
* **Severity:** **P1 (High)**
* **Evidence:**
  `components/builder/code-editor.tsx` lines 152–225:
  ```typescript
  const handleAskAI = async () => {
    if (!aiPrompt.trim() || !activeFile || aiLoading) return;
    setAiLoading(true);
    // ... streams response ...
    const evalResult = await evaluateCandidateChanges({ ... });
    if (!evalResult.accepted) return;
    updateFile(activeFile, proposedContent); // Blind commit without revision check!
  };
  ```
* **Why it matters:**
  If a user triggers an inline AI edit in Monaco on `app/page.tsx` and simultaneously a background chat generation or auto-fix completes, the Monaco AI edit will overwrite `app/page.tsx` even if the project revision has advanced.
* **Reproduction:**
  1. Open Monaco editor, start Ask AI on `app/page.tsx`.
  2. Before LLM responds, submit a prompt in chat panel that modifies `app/page.tsx`.
  3. Chat finishes, advancing project revision from 1 to 2.
  4. Monaco Ask AI finishes and calls `updateFile('app/page.tsx', proposedContent)`.
  5. The chat generation's work is silently destroyed.
* **Expected behavior:**
  Capture `baselineRevision = useProjectStore.getState().revision` at line 154, verify `currentRevision === baselineRevision` before calling `updateFile`, and abort on conflict.

---

### Finding [P1-3] — `supabase-auth.ts` Reverts to Last-Write-Wins on CAS Failure
* **Finding ID:** `CONC-702`
* **Severity:** **P1 (High)**
* **Evidence:**
  `lib/auth/supabase-auth.ts` lines 99–119:
  ```typescript
  if (!response.ok) {
    return fetch(`${SUPABASE_URL}/rest/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ ... }),
    });
  }
  ```
* **Why it matters:**
  If `commit_project_revision_cas` returns a non-200 response (or if there is a conflict or parameter issue), instead of propagating the error or 409 Conflict to the user, `saveProject` falls back to an upsert with `resolution=merge-duplicates`. This destroys concurrency guarantees by silently executing a last-write-wins overwrite.
* **Expected behavior:**
  When CAS fails or detects a conflict, return the conflict response directly to the caller.
* **Current behavior:**
  Falls back to unconditional upsert.

---

### Finding [P1-4] — Lexical Sandbox Containment Does Not Resolve Container Symlinks
* **Finding ID:** `SEC-703`
* **Severity:** **P1 (High)**
* **Evidence:**
  `lib/sandbox/sandbox-containment.ts` lines 18–33:
  ```typescript
  const normalized = rawPath.replace(/\\+/g, '/').replace(/^\/+/, '');
  const target = path.posix.resolve(rootDir, normalized);
  const relative = path.posix.relative(rootDir, target);
  ```
  `path.posix.resolve` does not interact with the filesystem and cannot know if `/vercel/app/static` is a symlink pointing to `/root` or `/etc`.
* **Why it matters:**
  If a malicious project payload includes a symlink (or creates one during installation), writes to `/vercel/app/static/evil.sh` would escape `/vercel/app` inside the container.
* **Expected behavior:**
  Symlink resolution or explicit realpath containment inside the sandbox container environment.
* **Current behavior:**
  Strictly lexical path math.

---

## 4. Execution Boundary Map

```text
Browser User Action (Prompt / Auto-Fix / Ask AI)
│
├──► /api/agent (Server-side LLM Orchestrator)
│    ├── Authenticate (Real Supabase Token or Demo Identity) [VERIFIED]
│    └── Rate Limiter (checkRateLimitDistributed)
│         ├── Primary: PostgreSQL RPC check_rate_limit_atomic [VERIFIED]
│         └── Fallback on Error: In-Memory Map (FAIL-OPEN DEFECT: SEC-701)
│
├──► Candidate Generation & Validation
│    ├── evaluateCandidateChanges [STATIC_VALIDATED]
│    │    ├── Secret Scanner [VERIFIED]
│    │    ├── Framework Structure & Protected Requirements [VERIFIED]
│    │    └── Requirements Security Invariants Check [VERIFIED]
│    └── bundleProjectWithEsbuild (In-Browser Wasm Bundler)
│
├──► [DISCONNECTED GAP: GEN-701]
│    ❌ /api/validate/build NEVER INVOKED BY WORKFLOW
│    ❌ Native compilers (next build, vite build) NEVER EXECUTE
│
├──► Concurrency Gate
│    ├── Chat Panel: baselineRevision check [VERIFIED]
│    ├── Preview Auto-Fix: baselineRevision check [VERIFIED]
│    ├── Monaco Ask AI: NO baselineRevision check (DEFECT: CONC-701)
│    └── Supabase saveProject: CAS RPC with merge-duplicates fallback (DEFECT: CONC-702)
│
└──► Client Display (InstantPreview)
     └── Iframe Sandbox: sandbox="allow-scripts allow-modals allow-forms allow-popups" [VERIFIED: no allow-same-origin]
```

---

## 5. Generated-Code Execution Inventory

| Caller | Command | Host/Sandbox | Environment | Network | Filesystem | Status |
| ------ | ------- | ------------ | ----------- | ------- | ---------- | ------ |
| `app/api/validate/build` | `VercelSandboxRunner` | Cloud MicroVM | Sanitized allowlist | Isolated | Container `/vercel/app` | **UNVERIFIED** (Credentials missing) |
| `app/api/sandbox` | `sandbox.writeFiles` / `runCommand` | Cloud MicroVM | Sanitized allowlist | Isolated | Container `/vercel/app` | **UNVERIFIED** (Credentials missing) |
| `LocalBuildRunner` | `pnpm build` / `install` | Host OS | Sanitized allowlist | Localhost | Host `/tmp` | **BLOCKED** (`NODE_ENV === 'production'`) |
| `InstantPreview` | `srcDoc` HTML in iframe | Browser WebWorker/DOM | Browser JS | Isolated | Memory | **VERIFIED** (`no allow-same-origin`) |

---

## 6. Mutation Inventory

| Mutation Path | Candidate Validation | Native Build Verification | Concurrency (CAS) | Status |
| ------------- | -------------------- | ------------------------- | ----------------- | ------ |
| **Chat Generation** | `evaluateCandidateChanges` | None (Virtual esbuild only) | Client revision check | **PARTIAL** |
| **Chat Auto-Heal** | `evaluateCandidateChanges` | None (Virtual esbuild only) | Client revision check | **PARTIAL** |
| **Preview Auto-Fix** | `evaluateCandidateChanges` | None (Virtual esbuild only) | `baselineRevision` check | **PARTIAL** |
| **Monaco Ask AI** | `evaluateCandidateChanges` | None | **MISSING (CONC-701)** | **DEFICIENT** |
| **Cloud Sync (`saveProject`)** | None (Post-commit sync) | None | Stale fallback to merge-duplicates | **DEFICIENT (CONC-702)** |
| **MCP `write_file` / `edit_file`** | None (Returns staged candidate diff only) | None | None (Client commits) | **SAFE** (Staged only) |

---

## 7. Authentication & Authorization Matrix

| Route | Auth Model | Demo Mode Support | Project Ownership Verified | Rate Limited | Risk Level |
| ----- | ---------- | ----------------- | -------------------------- | ------------ | ---------- |
| `/api/agent` | Supabase JWT / Demo Header | Yes (`demo-user`) | Per-project context | Yes (Distributed w/ Fallback) | Low |
| `/api/chat` | Forwards to `/api/agent` | Yes | Delegated | Delegated | Low |
| `/api/generate` | Forwards to `/api/agent` | Yes | Delegated | Delegated | Low |
| `/api/mcp` | JWT / Demo Header for project tools | Yes | `verifyProjectOwnership` | No route-level rate limit | Medium |
| `/api/sandbox` | JWT / Demo Header | Yes | `verifyProjectOwnership` | No route-level rate limit | Medium |
| `/api/validate/build` | JWT / Demo Header | Yes | `verifyProjectOwnership` | No route-level rate limit | Low |
| `/api/skills` | Public catalog | N/A | N/A | No | Informational |

---

## 8. Database Security Matrix

| Object | Type | Owner | Security Definer | `search_path` | Grants | Verdict |
| ------ | ---- | ----- | ---------------- | ------------- | ------ | ------- |
| `public.projects` | Table | `postgres` | N/A | N/A | RLS Enabled (4 policies) | **SECURE** |
| `public.rate_limits` | Table | `postgres` | N/A | N/A | RLS Enabled (`service_role` only) | **SECURE** |
| `commit_project_revision_cas` | Function | `postgres` | `SECURITY DEFINER` | `public` | `authenticated`, `anon`, `service_role` | **SECURE** (Forces `auth.uid()`) |
| `check_rate_limit_atomic` | Function | `postgres` | `SECURITY DEFINER` | unset (defaults to search path) | `anon`, `authenticated`, `service_role` | **INSECURE (SEC-702: arbitrary limits by anon)** |

---

## 9. Framework Verification Matrix

| Framework | Real Generated Build Executed? | Version Verified? | Runtime Smoke? | Evidence Class | Status |
| --------- | ------------------------------ | ----------------- | -------------- | -------------- | ------ |
| **Next.js** | No | No (Syntax check only) | No (Virtual DOM only) | STATIC_VALIDATED | **NATIVE BUILD UNVERIFIED** |
| **Vite** | No | No (Syntax check only) | No (Virtual DOM only) | STATIC_VALIDATED | **NATIVE BUILD UNVERIFIED** |
| **Astro** | No | No (Syntax check only) | No (Virtual DOM only) | STATIC_VALIDATED | **NATIVE BUILD UNVERIFIED** |

---

## 10. Rate-Limit Failure Matrix

| Condition | Expected Behavior | Actual Behavior | Secure? |
| --------- | ----------------- | --------------- | ------- |
| Database available | Atomically decrement counter | Decrements `public.rate_limits` | **YES** |
| Database unreachable | Fail closed (HTTP 503) | Falls back to in-memory `Map` | **NO (SEC-701)** |
| Database RPC error | Fail closed (HTTP 503) | Falls back to in-memory `Map` | **NO (SEC-701)** |
| Direct anonymous RPC call | Reject caller-supplied `p_max` | Accepts caller-supplied `p_max` | **NO (SEC-702)** |

---

## 11. Test Confidence Assessment

| Test Suite | What It Actually Tests | Production Boundary Exercised | False Confidence Risk |
| ---------- | ---------------------- | ----------------------------- | --------------------- |
| `phase4-hardening.test.ts` (CAS) | In-memory `updateServerProjectWithCas` | Calls `project-authority.ts` mock map | **HIGH**: Does not test live PostgreSQL function concurrency. |
| `phase4-hardening.test.ts` (Sandbox Path) | `assertContainedSandboxPath` unit function | Tested directly on POSIX path strings | **LOW**: Exact containment function used in production route. |
| `phase4-hardening.test.ts` (Rate Limit) | `checkRateLimitDistributed` with local mock store | Calls fallback branch in test environment | **HIGH**: Exercises in-memory fallback, masking DB failure behavior. |
| `phase4-hardening.test.ts` (Build Endpoint) | `POST /api/validate/build` with missing credentials | Hits endpoint handler directly | **LOW**: Proves endpoint handles missing credentials without crashing. |
| `build-runner.test.ts` | `LocalBuildRunner` execution in dev mode | Development-only runner | **N/A**: Runner is disabled in production. |

---

## 12. Final Release Decision

```text
RELEASE DECISION: NOT PRODUCTION READY
```

### Actionable Prerequisites for Production Readiness:
1. **Connect Native Build Verification**: Wire `/api/validate/build` directly into `candidate-pipeline.ts` or `chat-panel.tsx`, and truthfully mark projects `NATIVE BUILD UNVERIFIED` until isolated container infrastructure is configured.
2. **Fail Closed in Rate Limiter**: Remove the in-memory fallback in `lib/auth/rate-limiter.ts` for AI generation endpoints; reject requests if distributed rate-limit verification fails.
3. **Restrict `check_rate_limit_atomic` Grants**: Revoke `anon` and `authenticated` EXECUTE permissions on `public.check_rate_limit_atomic` so only the trusted backend (`service_role`) can invoke it.
4. **Enforce CAS in Monaco Ask AI**: Add `baselineRevision` tracking and stale rejection to `components/builder/code-editor.tsx`.
5. **Remove Stale Fallback in `supabase-auth.ts`**: Never fall back to `resolution=merge-duplicates` when CAS fails.
