# Antigravity Audit #8 — Hostile Production Certification & Runtime Proof Report

**Audit Type**: Hostile / Adversarial / Certification  
**Audit Target**: `opendorkweb` website builder (`https://github.com/prodevfullstk/builder`)  
**Audited Commit SHA**: `a3ab71e75c0e68877cfa5c04e7e958019749338d`  
**Base Commit**: `a3ab71e`  
**Branch**: `main`  
**Working Tree**: Clean (prior to audit report creation)  
**Execution Timestamp**: 2026-09-13T21:08:00+06:00  
**Auditor**: Antigravity Hostile Certification Auditor  

---

## 1. Executive Verdict & Certification Gate Summary

```text
FINAL VERDICT: CONDITIONALLY READY — NOT CERTIFIED
```

### Certification Gate Status

| Certification Criterion | Status | Evidence Class | Notes |
|---|---|---|---|
| **P0 Findings Count** | **0** | **AUDIT VERIFIED** | No P0 vulnerabilities identified. |
| **P1 Findings Count** | **0** | **AUDIT VERIFIED** | No P1 vulnerabilities identified. |
| **Native Build Runtime Proof** | **UNVERIFIED** | **RUNTIME VERIFIED** | `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` are absent in environment. System truthfully returns `VERIFICATION_UNAVAILABLE` / `NATIVE_BUILD_UNVERIFIED` and fails closed (HTTP 503) on mandatory requests without host execution. Cannot certify actual remote container compilation without live credentials. |
| **Generated-Code Isolation** | **PASS** | **CODE & RUNTIME VERIFIED** | `LocalBuildRunner` strictly throws `ProductionHostExecutionForbiddenError` when `NODE_ENV === 'production'`. Generated code is never executed on the host server. |
| **Candidate Gate Runtime Proof** | **PASS** | **INTEGRATION VERIFIED** | `commitVerifiedCandidate` strictly verifies authorization, cryptographic candidate hash binding, and CAS revision before state mutation. |
| **CAS Concurrency Proof** | **PASS** | **DATABASE & INTEGRATION VERIFIED** | `commit_project_revision_cas` atomically enforces optimistic concurrency on PostgreSQL. Last-write-wins fallback eliminated. |
| **Rate-Limit Security Proof** | **PASS** | **DATABASE & RUNTIME VERIFIED** | `checkRateLimitDistributed` fails closed (HTTP 503) on degraded database connection. Live PostgreSQL RPC `check_rate_limit_atomic` is locked to `service_role` only (anon/authenticated return 401/42501 permission denied). |
| **Sandbox Containment Proof** | **PASS** | **UNIT & INTEGRATION VERIFIED** | `assertContainedSandboxPath` strictly blocks directory traversal (`../`), Windows drive paths, UNC shares, null bytes, sibling prefixes, and symlink escape vectors. |
| **Mutation Boundary Proof** | **PASS** | **INTEGRATION VERIFIED** | Chat generation, Monaco AI, preview auto-fix, and MCP tools all route through validation boundaries with zero unverified disk/DB mutations. |
| **Authorization Proof** | **PASS** | **DATABASE & INTEGRATION VERIFIED** | Server-enforced token authentication, deterministic demo user binding (anti-spoofing), and project tenant ownership checks enforced across all `/api/*` endpoints. |

---

## 2. Baseline Environment

- **Operating System**: Windows 11 (win32 10.0.26100)
- **Node.js**: `v24.18.1`
- **pnpm**: `11.18.0`
- **Package Manager declared in `package.json`**: `pnpm@9.15.9`
- **Next.js**: `15.5.25`
- **React**: `19.0.0`
- **Live Supabase PostgreSQL Database**: Connected & Verified (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` present in `.env.local`)
- **Vercel Sandbox / Container Credentials**: `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` **NOT PRESENT** in environment.

---

## 3. Claim-vs-Evidence Matrix

| Phase 5 Claim | Evidence Obtained | Evidence Class | Result |
|---|---|---|---|
| **Central candidate gate** | `candidate-commit-service.ts` validates ownership, SHA-256 hash, and evidence before executing CAS registry commit. | **INTEGRATION VERIFIED** | **PASS** |
| **Candidate hash binding** | `computeCandidateHash` produces deterministic SHA-256 over sorted path/content pairs. Mismatched candidate hash strictly aborts commit. | **UNIT & INTEGRATION VERIFIED** | **PASS** |
| **Native build integration** | `/api/validate/build` endpoint reachable and called by `chat-panel.tsx` and `preview-pane.tsx`. Returns `VERIFICATION_UNAVAILABLE` truthfully when credentials missing. | **RUNTIME VERIFIED** | **PASS** |
| **Native Next.js build** | Remote Vercel Sandbox execution unconfigured due to missing credentials. | **UNVERIFIED** | **UNVERIFIED (INFRA)** |
| **Native Vite build** | Remote Vercel Sandbox execution unconfigured due to missing credentials. | **UNVERIFIED** | **UNVERIFIED (INFRA)** |
| **Native Astro build** | Remote Vercel Sandbox execution unconfigured due to missing credentials. | **UNVERIFIED** | **UNVERIFIED (INFRA)** |
| **Generated-code isolation** | Host runner forbidden in production (`ProductionHostExecutionForbiddenError`). Environment sanitized of all server secrets. | **CODE & RUNTIME VERIFIED** | **PASS** |
| **Fail-closed rate limiting** | Simulated DB disconnect returns `{ allowed: false, error: 'Distributed rate limiting unavailable' }`, triggering HTTP 503 on `/api/agent`. | **RUNTIME VERIFIED** | **PASS** |
| **RPC lockdown** | Live PostgreSQL query with anon key against `check_rate_limit_atomic` returns HTTP 401: `permission denied for function check_rate_limit_atomic` (SQLSTATE 42501). | **DATABASE VERIFIED** | **PASS** |
| **CAS authorization & revision** | `commit_project_revision_cas` rejects unauthenticated/wrong-tenant requests and rejects stale revisions with conflict. | **DATABASE VERIFIED** | **PASS** |
| **CAS concurrency** | Simultaneous requests targeting same revision result in exactly one success and one conflict. | **DATABASE & INTEGRATION VERIFIED** | **PASS** |
| **Monaco AI concurrency** | `code-editor.tsx` records `baselineRevision` and aborts inline edit if project revision changed during stream. | **INTEGRATION VERIFIED** | **PASS** |
| **Preview auto-fix concurrency** | `preview-pane.tsx` records `baselineRevision` and aborts auto-fix commit if project revision changed during repair. | **INTEGRATION VERIFIED** | **PASS** |
| **Sandbox containment** | Lexical and canonical path checks reject `../`, absolute paths, drive letters, UNC shares, and sibling prefixes. | **INTEGRATION VERIFIED** | **PASS** |
| **Symlink security** | `assertContainedSandboxPath` rejects symlink escape traversal patterns. | **UNIT VERIFIED** | **PASS** |
| **Requirements protection** | Candidate pipeline rejects any mutation that attempts to delete `requirements.md` or weaken security invariants. | **INTEGRATION VERIFIED** | **PASS** |
| **MCP authorization & staging** | MCP tool mutations produce candidate diffs only; unauthorized cross-tenant operations rejected. | **INTEGRATION VERIFIED** | **PASS** |
| **Secret isolation** | Server secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, etc.) stripped from child environment allowlist (`getSafeChildEnvironment`). | **CODE VERIFIED** | **PASS** |
| **Migration reproducibility** | `supabase/migrations/20260913_lockdown_rate_limit_rpc.sql` committed to repo matching live DB state. | **CODE & DATABASE VERIFIED** | **PASS** |
| **Package reproducibility** | Full test suite passes: 35 suites, 87 tests passed, 0 failures. `pnpm build` passes with Exit Code 0. | **BUILD VERIFIED** | **PASS** |

---

## 4. Adversarial Findings

### P0 Findings (0)
*None detected.*

### P1 Findings (0)
*None detected.*

### P2 / Informational Findings (2)

#### FINDING-801: Native Build Container Verification Infrastructure Unconfigured
- **Evidence**: `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` are absent from `.env.local`.
- **Why it matters**: In the absence of sandbox credentials, native microVM compilation of user-generated Next.js/Vite/Astro projects cannot be executed remotely.
- **Expected Behavior**: Remote microVM execution verifies buildability.
- **Actual Behavior**: System truthfully assigns `NATIVE_BUILD_UNVERIFIED` / `VERIFICATION_UNAVAILABLE` and allows candidate commitment under virtual validation, or fails closed (HTTP 503) if `mandatory: true` is requested.
- **Severity**: P2 (Deployment / Infrastructure Requirement)
- **Certification Impact**: Blocks unconditional `PRODUCTION READY` status; system is classified as `CONDITIONALLY READY — NOT CERTIFIED` until container runner credentials are provided in production.

#### FINDING-802: Non-blocking ESLint Warnings in Client Components
- **Evidence**: `pnpm lint` reports 12 warnings across client components (e.g. `react-hooks/exhaustive-deps` and `next/image`).
- **Severity**: P3 (Code Hygiene)
- **Certification Impact**: None (0 errors, build succeeds).

---

## 5. Live Runtime & Boundary Evidence

### 5.1 Live PostgreSQL RPC Privilege Lockdown Test
- Direct PostgREST invocation of `check_rate_limit_atomic` using `NEXT_PUBLIC_SUPABASE_ANON_KEY`:
  ```json
  Status: 401 Unauthorized
  Body: {
    "code": "42501",
    "details": null,
    "hint": null,
    "message": "permission denied for function check_rate_limit_atomic"
  }
  ```
  **Conclusion**: Direct RPC abuse by anonymous/unauthenticated actors is blocked at the database engine level.

### 5.2 Fail-Closed Rate Limiter Degradation Test
- Invocation of `checkRateLimitDistributed('test:audit8:fail', 5, 60, { failClosed: true })` with unreachable database backend:
  ```json
  {
    "allowed": false,
    "limit": 5,
    "remaining": 0,
    "resetSeconds": 1,
    "error": "Distributed rate limiting unavailable"
  }
  ```
  **Conclusion**: AI generation endpoints fail closed (HTTP 503) rather than falling back to unshared local memory.

### 5.3 Live PostgreSQL CAS Authorization Test
- Invocation of `commit_project_revision_cas` RPC against live Supabase PostgreSQL:
  ```json
  Status: 200 OK
  Body: {
    "error": "Unauthorized: Authentication required.",
    "success": false,
    "conflict": false
  }
  ```
  **Conclusion**: CAS stored procedure verifies caller authorization before attempting revision updates.

### 5.4 Test Suite & Production Build Verification
- **Test Suite**: `node -r ./test/test-register.js --test ...`
  - Suites: **35**
  - Tests: **87**
  - Passed: **87**
  - Failed: **0**
  - Skipped: **0**
- **Production Build**: `pnpm build`
  - Exit Code: **0**
  - Compiled successfully in 8.8s
  - All static and dynamic routes generated without TypeScript errors.

---

## 6. Final Certification Decision

The codebase demonstrates high security hygiene, database-authoritative concurrency controls, fail-closed rate limiting, deterministic candidate hashing, and strict host isolation. 

However, because isolated container credentials (`VERCEL_TOKEN` / `VERCEL_PROJECT_ID`) are absent in this environment, real remote native builds for Next.js, Vite, and Astro projects were **UNVERIFIED**. In strict adherence to the hostile audit standard, this claim cannot be certified as `PRODUCTION READY`.

**Final Certification Status**: **`CONDITIONALLY READY — NOT CERTIFIED`**  
*(Requires container runner credentials to be configured in production environment for full native verification certification).*
