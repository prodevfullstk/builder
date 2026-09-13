# Phase 3 — Hostile Security & Production Hardening Remediation Specification

**Document Version:** 1.0.0  
**Target Repository:** `opendorkweb` (`https://github.com/prodevfullstk/builder.git`)  
**Related Audit:** `docs/audits/audit-5-report.md`  
**Baseline Commit:** `e14b366bc78e4d5b190566f32469645c6062a9b5`  
**Date:** 2026-09-13  
**Status:** Authoritative Remediation Specification  

---

## 1. Executive Summary

Audit #5 evaluated the codebase under hostile adversarial conditions and identified 3 critical P0 security vulnerabilities, 7 high-risk P1 architectural defects, and 3 P2 reliability issues.

This document serves as the binding implementation specification for **Phase 3 Hardening**. Every remediation item in this specification directly addresses a verified defect from Audit #5.

---

## 2. Traceability Matrix & Requirements Mapping

| Finding ID | Severity | Problem Summary | Target File(s) | Remediation Requirement |
|---|---|---|---|---|
| **P0-1** | P0 | `X-Demo-User-Id` spoofing allows arbitrary tenant impersonation on `/api/mcp`. | `lib/auth/server-auth.ts`, `app/api/mcp/route.ts`, `lib/storage/project-authority.ts` | **SEC-301**: Sanitize demo identity; restrict demo users to `demo-user` ID only; disallow demo access to any project where `owner_id !== 'system-demo'`. |
| **P0-2** | P0 | InstantPreview iframe sandbox escape via same-origin `allow-scripts allow-same-origin`. | `components/preview/instant-preview.tsx` | **SEC-302**: Remove `allow-same-origin` from iframe sandbox attribute when using `srcDoc`, forcing a unique opaque origin. |
| **P0-3** | P0 | `LocalBuildRunner` executes arbitrary lifecycle scripts on host OS; leaks host secrets; path traversal. | `lib/build/build-runner.ts` | **SEC-303**: Sanitize file paths against directory traversal; add `--ignore-scripts` to package managers; sanitize environment variables. |
| **P1-1** | P1 | Auto-fix / screenshot fix punctures transactional commit gate (`&& !isFixRequest`). | `components/builder/chat-panel.tsx` | **GEN-301**: Remove `&& !isFixRequest`; ensure uncompilable code is NEVER committed. |
| **P1-2** | P1 | Concurrency blind spot: AI generation overwrites concurrent manual edits. | `lib/store/project-store.ts`, `components/builder/chat-panel.tsx` | **GEN-302**: Add revision tracking and optimistic concurrency; abort or warn on stale baseline. |
| **P1-3** | P1 | `/api/sandbox` completely lacks project ownership verification on GET & POST. | `app/api/sandbox/route.ts` | **SEC-304**: Enforce `verifyProjectOwnership` on all sandbox operations. |
| **P1-4** | P1 | Disconnected `BuildRunner` abstraction; native builds unverified in production. | `lib/build/build-runner.ts`, `components/builder/preview-pane.tsx` | **GEN-303**: Connect build runner to pre-export verification workflow. |
| **P1-5** | P1 | `requirements.md` can be deleted or overwritten with conflicting requirements by AI. | `lib/validation/candidate-pipeline.ts` | **GEN-304**: Protect `requirements.md` and enforce core invariants in candidate evaluation. |
| **P1-6** | P1 | `/api/agent` permits unauthenticated AI token exhaustion with zero rate limiting. | `app/api/agent/route.ts` | **SEC-305**: Implement rate limiting and turn quotas on demo mode AI generation. |
| **P1-7** | P1 | Secret scanner misses Anthropic, Groq, Google, Stripe, fine-grained PATs, URIs. | `lib/validation/candidate-pipeline.ts` | **SEC-306**: Expand `SECRET_PATTERNS` to cover all modern credential formats. |
| **P2-1** | P2 | Validation evidence stored only in volatile in-memory Map. | `lib/storage/project-authority.ts` | **REL-301**: Persist validation evidence to storage or project audit log. |
| **P2-2** | P2 | Hardcoded framework versions ignore requested versions. | `lib/ai/requirements-generator.ts` | **REL-302**: Parse and respect user-requested framework versions. |
| **P2-3** | P2 | Lack of automated visual regression testing. | `lib/validation/visual-diff.ts` | **REL-303**: Add visual regression assertion utilities. |

---

## 3. Detailed Security Requirements

### SEC-301: Strict Demo Identity Sandboxing [P0-1]
1. In `lib/auth/server-auth.ts`:
   - Disallow client-controlled `X-Demo-User-Id` from setting arbitrary user IDs.
   - If `X-Auth-Mode === 'demo'`, the returned user ID must be fixed to `'demo-user'` or prefixed with `'demo:'`.
   - Client headers must NEVER be able to inject a UUID or an ID belonging to another tenant.
2. In `lib/storage/project-authority.ts`:
   - Explicitly verify that if `user.authMode === 'demo'`, access is permitted ONLY if `project.owner_id === 'system-demo'` or `project.owner_id === 'demo-user'`.
   - Prohibit demo identities from reading, listing, or modifying any real production project.

### SEC-302: Iframe Sandbox Isolation Hardening [P0-2]
1. In `components/preview/instant-preview.tsx`:
   - Remove `allow-same-origin` from the `sandbox` attribute:
     ```html
     sandbox="allow-scripts allow-modals allow-forms allow-popups"
     ```
   - This ensures the iframe receives a unique opaque origin (`null`), completely blocking it from accessing `window.parent.document`, `window.parent.localStorage`, `sessionStorage`, or cookies.
2. Message communication between the iframe and the builder must strictly use `postMessage` with explicit message validation and origin checking.

### SEC-303: Build Runner Containment & Path Traversal Hardening [P0-3]
1. In `lib/build/build-runner.ts`:
   - Sanitize all file paths written in `prepare()`:
     ```typescript
     const targetPath = path.resolve(this.tempDir, filePath);
     if (!targetPath.startsWith(path.resolve(this.tempDir))) {
       throw new Error(`Path traversal attempt detected: ${filePath}`);
     }
     ```
   - In `install()`, add `--ignore-scripts` to all package manager invocations:
     ```typescript
     runCommand('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], this.tempDir, timeoutMs);
     ```
   - Strip all sensitive environment variables from child processes. Pass only minimal, sanitized environment variables:
     ```typescript
     env: {
       PATH: process.env.PATH,
       HOME: os.tmpdir(),
       TMPDIR: os.tmpdir(),
       CI: 'true',
       NODE_ENV: 'production',
     }
     ```
     Never leak `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, or `VERCEL_TOKEN` into the child process.

### SEC-304: Mandatory Ownership Verification in Sandbox API [P1-3]
1. In `app/api/sandbox/route.ts`:
   - Import `verifyProjectOwnership` from `@/lib/storage/project-authority`.
   - In `GET`: Extract `projectId`, verify `authResult.user.id` owns `projectId`. Return 403 Forbidden if not authorized, 404 if project not found, 400 if missing.
   - In `POST`: Verify `authResult.user.id` owns `projectId` before provisioning, starting, or stopping any sandbox instance.

### SEC-305: AI Rate Limiting & Demo Token Protection [P1-6]
1. In `app/api/agent/route.ts`:
   - Implement rate limiting based on client IP / authorization token.
   - Limit demo mode requests to a maximum of 10 generation requests per IP per hour.
   - Return HTTP 429 Too Many Requests when rate limits are exceeded.

### SEC-306: Comprehensive Secret Detection Patterns [P1-7]
1. In `lib/validation/candidate-pipeline.ts`:
   - Expand `SECRET_PATTERNS` to detect:
     - Anthropic API Keys: `/\bsk-ant-[A-Za-z0-9_-]{32,}\b/`
     - Groq API Keys: `/\bgsk_[A-Za-z0-9_-]{32,}\b/`
     - Google Gemini / AI Studio Keys: `/\bAIza[0-9A-Za-z-_]{35}\b/`
     - Stripe Secret Keys: `/\b[rs]k_(?:live|test)_[A-Za-z0-9]{24,}\b/`
     - GitHub Fine-Grained Tokens: `/\bgithub_pat_[A-Za-z0-9_]{60,}\b/`
     - PostgreSQL Connection URIs: `/postgres(?:ql)?:\/\/[^:]+:[^@]+@[^/]+\/[^\s"']+/i`

---

## 4. Generation Integrity & Concurrency Requirements

### GEN-301: Unconditional Transactional Commit Gate [P1-1]
1. In `components/builder/chat-panel.tsx`:
   - Remove `&& !isFixRequest` from line 626:
     ```typescript
     if (!compilationPassed) {
       setIsStreaming(false);
       setStreamingFile(null);
       setStatus('error', 'Virtual build verification failed');
       ...
       return;
     }
     ```
   - Under NO circumstance may broken, uncompilable code be committed to the authoritative workspace, even during bug fixes or auto-repair turns.

### GEN-302: Revision Control & Optimistic Concurrency [P1-2]
1. In `lib/store/project-store.ts`:
   - Add `revision: number` to `ProjectState` (defaults to 1, increments on every file mutation).
2. In `components/builder/chat-panel.tsx`:
   - Record `baselineRevision = revision` when generation begins.
   - When candidate verification succeeds, check `if (useProjectStore.getState().revision !== baselineRevision)`.
   - If the revision changed during generation (due to user typing in Monaco or file modifications), prevent silent overwriting and prompt the user to review or merge the changes.

### GEN-304: Protected Requirements Specification Invariant [P1-5]
1. In `lib/validation/candidate-pipeline.ts`:
   - Reject candidates that delete `requirements.md`.
   - Ensure modifications to `requirements.md` preserve declared security invariants (tenant isolation, secret scanning, RLS requirements).

---

## 5. Verification & Acceptance Criteria

- **AC-01 (MCP Demo Isolation):** Attempting to pass `X-Auth-Mode: demo` and `X-Demo-User-Id: <target>` to `/api/mcp` strictly fails to access any target project (403 Forbidden).
- **AC-02 (Iframe Sandbox Security):** InstantPreview iframe does not contain `allow-same-origin`. Script execution inside iframe cannot access `window.parent.document` or `window.parent.localStorage`.
- **AC-03 (Build Runner Isolation):** `LocalBuildRunner` rejects path traversal attempts. Lifecycle scripts in `package.json` are ignored (`--ignore-scripts`). Sensitive host environment variables are not present in child process `process.env`.
- **AC-04 (Transactional Fix Gate):** Triggering auto-fix on an uncompilable candidate that fails auto-heal preserves the baseline files byte-for-byte; `setFiles` is not called.
- **AC-05 (Sandbox Ownership):** Calling GET or POST on `/api/sandbox` with a mismatched `projectId` returns HTTP 403 Forbidden.
- **AC-06 (Secret Scanner Coverage):** Candidates containing Anthropic, Groq, Google, Stripe, or PostgreSQL connection strings are strictly rejected by `evaluateCandidateChanges`.
- **AC-07 (Regression & Build Cleanliness):** All existing and new test suites pass (100% passing). ESLint and `next build` exit with code 0.
