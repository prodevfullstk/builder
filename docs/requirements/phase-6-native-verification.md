# Antigravity Phase 6 — Native Verification & Production Certification Specification

**Authoritative Requirements Document**  
**Phase**: Phase 6 — Native Verification & Commit Certification  
**Target Application**: `opendorkweb` Website Builder (`https://github.com/prodevfullstk/builder`)  
**Baseline Commit**: `a3ab71e75c0e68877cfa5c04e7e958019749338d`  
**Execution Timestamp**: 2026-09-13T21:16:00+06:00  

---

## 1. Executive Mission & Purpose

The objective of Phase 6 is to enforce the definitive production certification standards for the `opendorkweb` website builder regarding **isolated native generated-project builds, runtime smoke verification, evidence-candidate hash binding, and authoritative commit gating**.

Previous audits established that while code-level abstractions (`VercelSandboxRunner`, `commitVerifiedCandidate`, `/api/validate/build`) exist and local security boundaries are fortified, **live native framework builds inside isolated microVMs remain unproven when container credentials are unavailable**.

Phase 6 defines:
1. The **strict separation** between `AUTHORITATIVE / PRODUCTION VERIFIED` commits and `DRAFT / UNVERIFIED` workspaces.
2. The **mandatory server-side native verification policy** when required by production invariants.
3. The cryptographic binding of evidence to candidate hash, project, revision, and framework.
4. The exact evidence classes and certification criteria required for final production certification.

---

## 2. Core Architectural Invariants

### 2.1 Native Build Execution & Isolation Boundary
- **SEC-601: Zero Host Execution**: Generated projects (Next.js, Vite, Astro, Node.js) MUST NEVER be compiled, installed, or executed on the application host server under production mode (`NODE_ENV === 'production'`). Any attempt to invoke `LocalBuildRunner` in production MUST throw `ProductionHostExecutionForbiddenError`.
- **GEN-601: Isolated Container MicroVM**: All native builds must execute exclusively inside isolated ephemeral microVMs (e.g., Vercel Sandbox / `@vercel/sandbox`).
- **SEC-602: Secret Sanitization**: Sandboxes and child environments MUST NOT receive application server secrets (`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, etc.). Only explicitly required build variables are passed.

### 2.2 Framework Fidelity & Toolchain Verification
- **FW-601: Real Toolchain Execution**: Native verification must execute the authentic framework CLI inside the sandbox:
  - **Next.js**: `pnpm build` / `npx next build`
  - **Vite React**: `pnpm build` / `npx vite build`
  - **Astro**: `pnpm build` / `npx astro build`
- **FW-602: Simulated vs Native Distinction**: Static AST parsing, regex scanning, and in-browser esbuild bundling are strictly classified as `STATIC_VALIDATED` or `VIRTUAL_SIMULATED`. They MUST NOT be reported or treated as `NATIVE_BUILD_VERIFIED`.

### 2.3 Runtime Smoke Verification
- **RUN-601: Production Server Execution & HTTP Smoke Check**: For supported runtime frameworks, native verification includes starting the production server, obtaining its listening port, issuing an HTTP request, validating the HTTP 200 response and generated marker, and cleanly terminating the process.

### 2.4 Cryptographic Candidate Hash & Evidence Binding
- **GATE-601: Deterministic SHA-256 Digest**: `candidateHash` is the deterministic SHA-256 digest of normalized, sorted `[relativePath, fileContent]` pairs.
- **GATE-602: Evidence Hash Binding**: `commitVerifiedCandidate` MUST verify:
  1. `actualCandidateHash === params.candidateHash`
  2. `actualCandidateHash === validationEvidence.candidateHash`
  3. `validationEvidence.accepted === true`
  4. `params.projectId === validationEvidence.projectId` (when present)
  5. `params.expectedRevision === currentRevision` (CAS atomic check)
- **GATE-603: Single-Use & Expiry Safeguards**: Evidence cannot be replayed across different projects, mismatched revisions, or modified file sets.

### 2.5 Truthful Verification & Missing Credentials Policy
- **TRUTH-601: Truthful Status Reporting**: When `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` are unconfigured:
  - If `mandatory === false` (Draft / Development mode): The system assigns `NATIVE_BUILD_UNVERIFIED` and `VERIFICATION_UNAVAILABLE`.
  - If `mandatory === true` (Production Authoritative mode): The system FAILS CLOSED with HTTP 503 `native_sandbox_unavailable` and blocks authoritative state mutation.
- **TRUTH-602: No Fake Passes**: The system MUST NEVER forge or mock a `NATIVE_BUILD_VERIFIED` record when actual container execution did not occur.

---

## 3. Evidence Classification Matrix

Every verification claim must be supported by its precise evidence class:

| Evidence Class | Definition |
|---|---|
| **IMPLEMENTED** | Abstraction and interface definitions exist in the codebase. |
| **INTEGRATED** | Routes and caller components invoke the abstraction in live control flow. |
| **TESTED** | Unit or integration tests exercise the code path with mocked boundaries. |
| **DATABASE VERIFIED** | Live PostgreSQL instance validates schema, RLS, grants, and atomic stored procedures. |
| **RUNTIME VERIFIED** | Code path executed live against local/remote runtime without host escape. |
| **LIVE CONTAINER VERIFIED** | Real generated Next.js / Vite / Astro project executed inside remote microVM container with exit code 0 and smoke test pass. |

---

## 4. Certification Acceptance Criteria

Production certification (`PRODUCTION READY`) requires:
1. 0 P0 / P1 security vulnerabilities.
2. Full test suite passing (87+ tests).
3. Production build (`pnpm build`) exit code 0.
4. Live container runtime proof for Next.js, Vite, and Astro generated projects.
5. In the absence of live container credentials, final status MUST be `CONDITIONALLY READY — NOT CERTIFIED`.
