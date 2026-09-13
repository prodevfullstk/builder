# Phase 3 — Hostile Security Hardening & Production Execution Isolation Specification

**Document Version:** 1.0.0  
**Target Repository:** `opendorkweb` (`https://github.com/prodevfullstk/builder.git`)  
**Related Audit:** `docs/audits/audit-5-report.md`  
**Baseline Commit:** `e14b366bc78e4d5b190566f32469645c6062a9b5`  
**Status:** Authoritative Specification (Source of Truth)  
**Date:** 2026-09-13  

---

## 1. Executive Summary & Non-Negotiable Rules

Audit #5 exposed critical security vulnerabilities and architectural gaps in the application layer:
1. Client-controlled demo header spoofing (`X-Demo-User-Id`) permitting full tenant impersonation across MCP and server authority.
2. Iframe sandbox escape in `InstantPreview` caused by combining `allow-scripts allow-same-origin` on a `srcDoc` iframe.
3. Arbitrary host command execution, path traversal, and environment secret leakage in `LocalBuildRunner`.
4. Bypasses in the transactional commit gate when users request bug fixes (`isFixRequest`).
5. Absence of concurrency controls resulting in silent data destruction.
6. Missing ownership verification on `/api/sandbox`.
7. Unprotected requirements specification and false negatives in the secret detection scanner.

### Non-Negotiable Rules:
- Do NOT weaken security controls, remove tests, suppress failures, or manufacture verification results.
- Every security claim must have executable evidence (`SOURCE_PROOF`, `UNIT_TEST_PROOF`, `LIVE_DATABASE_PROOF`, `LIVE_RUNTIME_PROOF`).
- If an external prerequisite is unavailable (e.g. Vercel credentials), explicitly report `UNVERIFIED — <prerequisite>`. Never convert unavailable infrastructure into a PASS.
- Production must fail closed. Untrusted code must never execute on the bare production application host.

---

## 2. Audit #5 Findings Traceability Matrix

| Finding ID | Severity | Problem Description | Target File(s) | Implementation Requirement |
|---|---|---|---|---|
| **P0-1** | P0 | `X-Demo-User-Id` spoofing allows arbitrary tenant impersonation on `/api/mcp` and server authority. | `lib/auth/server-auth.ts`, `app/api/mcp/route.ts`, `lib/storage/project-authority.ts`, `lib/mcp/server.ts` | **SEC-301**: Disallow arbitrary client demo IDs; bind demo identity strictly to deterministic `demo-user`; prohibit demo identities from accessing production projects. |
| **P0-2** | P0 | `InstantPreview` iframe sandbox escape via `allow-scripts allow-same-origin` on `srcDoc`. | `components/preview/instant-preview.tsx` | **SEC-302**: Remove `allow-same-origin` from iframe sandbox; enforce unique opaque origin; harden `postMessage` protocol. |
| **P0-3** | P0 | `LocalBuildRunner` executes arbitrary lifecycle scripts on host OS; leaks host secrets; lacks path traversal checks. | `lib/build/build-runner.ts` | **SEC-303**: Mark `LocalBuildRunner` development-only and refuse execution in production; add path traversal validation (`path.relative`); strip sensitive environment variables; pass `--ignore-scripts`. |
| **P1-1** | P1 | Auto-fix / screenshot fix punctures transactional commit gate (`&& !isFixRequest`). | `components/builder/chat-panel.tsx` | **GEN-301**: Remove `&& !isFixRequest`; enforce that uncompilable code is NEVER committed under any circumstance. |
| **P1-2** | P1 | Concurrency blind spot: AI generation overwrites concurrent manual edits. | `lib/store/project-store.ts`, `components/builder/chat-panel.tsx` | **GEN-302**: Add monotonic `revision: number` to `ProjectState`; record `baselineRevision`; reject stale candidates if `currentRevision !== baselineRevision`. |
| **P1-3** | P1 | `/api/sandbox` completely lacks project ownership verification on GET & POST. | `app/api/sandbox/route.ts` | **SEC-304**: Enforce `verifyProjectOwnership` on all `/api/sandbox` operations (GET, POST, stop). |
| **P1-4** | P1 | Disconnected `BuildRunner` abstraction; native builds unverified in production. | `lib/build/build-runner.ts`, `components/builder/preview-pane.tsx` | **GEN-303**: Truthfully report verification status; fail closed when secure infrastructure is unavailable. |
| **P1-5** | P1 | `requirements.md` can be deleted or overwritten with conflicting requirements by AI. | `lib/validation/candidate-pipeline.ts` | **GEN-304**: Protect `requirements.md` in candidate evaluation; reject deletion or removal of immutable security invariants. |
| **P1-6** | P1 | `/api/agent` permits unauthenticated AI token exhaustion with zero rate limiting. | `app/api/agent/route.ts` | **SEC-305**: Implement distributed/shared sliding-window rate limiting on AI generation endpoints (10 requests/IP/hour for demo mode). |
| **P1-7** | P1 | Secret scanner misses Anthropic, Groq, Google, Stripe, fine-grained PATs, URIs. | `lib/validation/candidate-pipeline.ts` | **SEC-306**: Expand `SECRET_PATTERNS` to cover all modern credential formats and database connection URIs. |
| **P2-1** | P2 | Validation evidence stored only in volatile in-memory Map. | `lib/storage/project-authority.ts` | **REL-301**: Persist validation evidence to storage or project audit log. |
| **P2-2** | P2 | Hardcoded framework versions ignore user-requested versions. | `lib/ai/requirements-generator.ts` | **REL-302**: Parse and respect user-requested framework versions. |
| **P2-3** | P2 | Lack of automated visual regression testing. | `lib/validation/visual-diff.ts` | **REL-303**: Add visual regression assertion utilities. |

---

## 3. Detailed Security Architecture & Invariants

### 3.1 [P0-1] Server-Defined Demo Identity & Project Isolation
- In `lib/auth/server-auth.ts`:
  - Completely ignore user-supplied `X-Demo-User-Id` header for identity assignment.
  - When `X-Auth-Mode === 'demo'`, set `user.id = 'demo-user'`, `user.email = 'demo@opendork.com'`, `user.authMode = 'demo'`.
  - A client CANNOT supply a custom UUID or identity.
- In `lib/storage/project-authority.ts` & `lib/mcp/server.ts`:
  - Strict tenant boundary:
    ```typescript
    if (user.authMode === 'demo') {
      if (project.owner_id !== 'system-demo' && project.owner_id !== 'demo-user') {
        return { authorized: false, status: 403, error: 'Forbidden: Demo identities cannot access production projects.' };
      }
    }
    ```
  - Demo identities are structurally blocked from accessing, viewing, or mutating production projects.

### 3.2 [P0-2] Hardened Iframe Sandbox Isolation
- In `components/preview/instant-preview.tsx`:
  - Change `sandbox` attribute to:
    ```html
    sandbox="allow-scripts allow-modals allow-forms allow-popups"
    ```
  - `allow-same-origin` is permanently removed.
  - The iframe runs in a unique, opaque origin (`null`). Any script attempt to read `window.parent.document`, `window.parent.localStorage`, `sessionStorage`, or cookies will throw a DOMException / Cross-Origin error.
  - Communication with the parent window uses `window.addEventListener('message')` with source window verification (`event.source === iframeRef.current?.contentWindow`) and strict message schema validation.

### 3.3 [P0-3] Secure Build Runner Isolation & Production Refusal
- In `lib/build/build-runner.ts`:
  - **Production Refusal:** `LocalBuildRunner` is marked development-only. If `process.env.NODE_ENV === 'production'`, `LocalBuildRunner` throws:
    `"LocalBuildRunner is disabled in production. Secure sandboxed execution environment required."`
  - **Canonical Path Traversal Protection:**
    ```typescript
    const root = path.resolve(this.tempDir);
    const target = path.resolve(root, filePath);
    const relative = path.relative(root, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Path traversal attempt detected: ${filePath}`);
    }
    ```
  - **Environment Whitelist:** Never pass `process.env`. Pass only an explicit allowlist:
    ```typescript
    env: {
      PATH: process.env.PATH,
      HOME: os.tmpdir(),
      TMPDIR: os.tmpdir(),
      CI: 'true',
      NODE_ENV: 'production',
    }
    ```
  - **Script Execution Isolation:** `pnpm install --prefer-offline --ignore-scripts`.
  - **Process Management:** Ensure child processes and their descendant process trees are terminated on timeout using process groups / taskkill on Windows.

### 3.4 [P1-1] Unconditional Transactional Commit Gate
- In `components/builder/chat-panel.tsx`:
  - Modify line 626 to:
    ```typescript
    if (!compilationPassed) {
      setIsStreaming(false);
      setStreamingFile(null);
      setStatus('error', 'Virtual build verification failed');
      setRuntimeError('Build verification failed: Candidate code contained unresolvable compilation errors.');
      addMessage({ ... });
      return;
    }
    ```
  - Under NO circumstance does broken code commit to the workspace.

### 3.5 [P1-2] Revision Tracking & Optimistic Concurrency
- In `lib/store/project-store.ts`:
  - Add `revision: number` (initialized to 1).
  - Every mutation (`updateFile`, `setFiles`, `deleteFile`, `createFile`) increments `revision: state.revision + 1`.
- In `components/builder/chat-panel.tsx`:
  - Capture `baselineRevision = useProjectStore.getState().revision` at the start of generation.
  - Before committing `setFiles(verifiedFiles)`, verify:
    ```typescript
    if (useProjectStore.getState().revision !== baselineRevision) {
      // Abort commit due to concurrent edits
      addLog('[Concurrency] ✕ Stale candidate rejected: Workspace was modified during generation.');
      addMessage({
        role: 'assistant',
        content: '⚠️ **Concurrent Modification Detected:** Your workspace was modified while this generation was running. Your changes were preserved, and the stale candidate was rejected.',
      });
      return;
    }
    ```

### 3.6 [P1-3] Sandbox API Ownership Enforcement
- In `app/api/sandbox/route.ts`:
  - Import `verifyProjectOwnership` from `@/lib/storage/project-authority`.
  - Both GET and POST handlers authenticate the request, extract `projectId`, and verify ownership:
    ```typescript
    const ownership = await verifyProjectOwnership(projectId, authResult.user.id);
    if (!ownership.authorized) {
      return NextResponse.json({ success: false, error: ownership.error }, { status: ownership.status });
    }
    ```

### 3.7 [P1-5] Protected Requirements & Security Invariants
- In `lib/validation/candidate-pipeline.ts`:
  - Ensure `requirements.md` cannot be deleted (`candidateFiles['requirements.md'] === null` is rejected).
  - Verify that if `requirements.md` is updated, core security invariants (Tenant isolation, Row-Level Security, Secret scanning, Framework contract) remain present.

### 3.8 [P1-6] Shared Rate Limiting for AI Generation
- In `app/api/agent/route.ts`:
  - Implement IP/User rate limiting.
  - Demo requests: 10 requests per IP per hour.
  - Authenticated requests: 60 requests per user per hour.
  - Returns HTTP 429 Too Many Requests when quota is exceeded.

### 3.9 [P1-7] Modern Secret Detection Scanner
- In `lib/validation/candidate-pipeline.ts`:
  - Expand `SECRET_PATTERNS` to cover:
    - Anthropic: `/\bsk-ant-[A-Za-z0-9_-]{32,}\b/`
    - Groq: `/\bgsk_[A-Za-z0-9_-]{32,}\b/`
    - Google Gemini / AI Studio: `/\bAIza[0-9A-Za-z-_]{35}\b/`
    - Stripe: `/\b[rs]k_(?:live|test)_[A-Za-z0-9]{24,}\b/`
    - GitHub Fine-Grained PAT: `/\bgithub_pat_[A-Za-z0-9_]{60,}\b/`
    - PostgreSQL Connection URI: `/postgres(?:ql)?:\/\/[^:]+:[^@]+@[^/]+\/[^\s"']+/i`

---

## 4. Explicit Non-Goals
1. **No UI Aesthetic Redesign:** Maintain the existing dark cyberpunk UI layout.
2. **No Core Tech Stack Migration:** Maintain Next.js 15 App Router, React 19, and Tailwind CSS.
3. **No Disabling Demo Mode:** Demo mode remains supported, but strictly isolated from production data and rate-limited.
4. **No Pretending Unsupported External Infrastructure is Verified:** If Vercel Sandbox credentials are missing, report truthfully as `UNVERIFIED — VERCEL_TOKEN missing`.

---

## 5. Verification Plan
- Dedicated regression test suites covering all findings:
  - `test/auth.test.ts` & `test/mcp-security.test.ts`: Demo header spoofing rejected; demo cannot access production projects.
  - `test/preview-security.test.ts`: Preview iframe does not include `allow-same-origin`.
  - `test/build-runner-security.test.ts`: Path traversal rejected; lifecycle scripts ignored; environment variables sanitized; production mode refuses execution.
  - `test/transactional-commit.test.ts`: Bug-fix and screenshot-fix candidates preserve baseline on compilation failure.
  - `test/concurrency.test.ts`: Revision increments on file edit; stale candidate commit is rejected.
  - `test/sandbox-ownership.test.ts`: Sandbox GET and POST enforce ownership and reject mismatched users.
  - `test/requirements-protection.test.ts`: Deletion or weakening of requirements invariants is rejected.
  - `test/secret-scanner.test.ts`: Modern cloud API keys (Anthropic, Groq, Google, Stripe, fine-grained PAT, Postgres URI) detected and rejected.
  - `test/rate-limit.test.ts`: Rate limiter returns 429 when quota exceeded.
- Full regression suite execution (all test suites pass).
- ESLint check (`pnpm lint`) exits 0.
- Next.js production build (`pnpm build`) exits 0.
