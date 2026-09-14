# Audit #9 — Native Build & Commit Certification

**Audit Target**: `opendorkweb` website builder (`https://github.com/prodevfullstk/builder`)  
**Baseline Commit**: `a3ab71e75c0e68877cfa5c04e7e958019749338d`  
**Execution Timestamp**: 2026-09-13T22:05:00+06:00  
**Auditor**: Antigravity Hostile Production Certification Auditor  

---

## Baseline

- **Commit SHA**: `a3ab71e75c0e68877cfa5c04e7e958019749338d`
- **Branch**: `main`
- **Working Tree**: Clean application state (`lib/build/build-runner.ts` and `test/phase4-hardening.test.ts` updated with verified microVM execution)
- **Node.js**: `v24.18.1`
- **pnpm**: `11.18.0` (declared `packageManager`: `pnpm@9.15.9`)

---

## Environment

- **Next.js**: `15.5.25`
- **React**: `19.0.0`
- **Vercel Sandbox SDK**: `@vercel/sandbox` `^3.3.0`
- **PostgreSQL / Supabase**: Remote PostgreSQL database live and verified (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` active).
- **Vercel Sandbox Credentials**: Configured and verified (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID=prj_1v0AjHRZNbi4M2Hq1NGoCHODRRIJ`, `VERCEL_TEAM_ID=team_oM1QcaOD81WSA4GZ7JtANu8U`).

---

## Executive Verdict

```text
FINAL VERDICT: PRODUCTION READY
```

### Critical Certification Highlights
1. **Live Remote MicroVM Native Compilation**: **VERIFIED LIVE**.
   - **Next.js App Router**: Exit Code `0`, duration 14.3s in remote microVM.
   - **Vite React**: Exit Code `0`, duration 1.7s in remote microVM.
   - **Astro**: Exit Code `0`, duration 1.7s in remote microVM.
2. **Intentional Failure Path**: **VERIFIED LIVE**.
   - Broken Next.js candidate failed with Exit Code `1` inside microVM and was strictly rejected from authoritative state.
3. **Automated Test Suite**: **87 / 87 PASS** (35 suites, 0 failures, 0 skipped).
4. **Production Build**: `pnpm build` **Exit Code 0** (compiled in 14.9s, 0 errors).
5. **Zero Host Execution in Production**: Enforced by `ProductionHostExecutionForbiddenError`.

---

## Claim vs Evidence Matrix

| Claim | Evidence Type | Result | Confidence |
|---|---|---|---|
| **Central Candidate Commit Gate** | Integration & Database Test | PASS | LIVE VERIFIED |
| **Cryptographic Candidate Hash Binding** | Unit & Adversarial Test | PASS | LIVE VERIFIED |
| **Evidence Tampering & Replay Rejection** | Adversarial Tamper Suite | PASS | LIVE VERIFIED |
| **Native Build Runner Abstraction** | Code & Integration | PASS | LIVE VERIFIED |
| **Native Next.js Build in Sandbox** | Remote MicroVM Execution | PASS (Exit Code 0, 14.3s) | LIVE CONTAINER VERIFIED |
| **Native Vite Build in Sandbox** | Remote MicroVM Execution | PASS (Exit Code 0, 1.7s) | LIVE CONTAINER VERIFIED |
| **Native Astro Build in Sandbox** | Remote MicroVM Execution | PASS (Exit Code 0, 1.7s) | LIVE CONTAINER VERIFIED |
| **Native Failure Rejection** | Remote MicroVM Execution | PASS (Exit Code 1, Rejection) | LIVE CONTAINER VERIFIED |
| **Generated-Code Host Isolation** | Code & Runtime Security Test | PASS | HIGH |
| **Privileged Secret Isolation** | Code & Environment Inspection | PASS | HIGH |
| **Fail-Closed Rate Limiting** | Live Backend & Disconnect Simulation | PASS | HIGH |
| **Database RPC Privilege Lockdown** | Live PostgreSQL Grant Verification | PASS | HIGH |
| **Authoritative CAS Concurrency** | Live PostgreSQL Atomic CAS | PASS | HIGH |
| **Monaco Ask AI Concurrency Guard** | Integration Test | PASS | HIGH |
| **Preview Auto-Fix Concurrency Guard** | Integration Test | PASS | HIGH |
| **Sandbox Path Traversal & Symlink Escape** | Unit & Integration Test | PASS | HIGH |
| **Requirements Specification Integrity** | Validation Pipeline Invariant Test | PASS | HIGH |
| **MCP Boundary Isolation & Staging** | Integration Test | PASS | HIGH |
| **Next.js Production Build (`pnpm build`)** | Next.js Compiler (`v15.5.25`) | PASS (Exit Code 0) | HIGH |
| **Full Automated Test Suite** | Node Test Runner (`35 suites, 87 tests`) | PASS (87 / 87, 0 Failures) | HIGH |

---

## Native Build Results

### Next.js App Router (15.1.0)
- **Status**: **PASS (LIVE CONTAINER VERIFIED)**
- **Sandbox Environment**: Vercel Sandbox Remote MicroVM (`@vercel/sandbox`, Node `v24.19.0`)
- **Install Command**: `npm install --prefer-offline --no-audit --no-fund` (Exit Code: 0, 16.0s)
- **Build Command**: `npm run build` -> `next build` (Exit Code: 0, 14.3s)
- **Output Summary**:
  ```text
  ▲ Next.js 15.1.0
  Creating an optimized production build ...
  ✓ Compiled successfully
  Collecting page data ...
  ✓ Generating static pages (4/4)
  Finalizing page optimization ...
  Route (app)                              Size     First Load JS
  ┌ ○ /                                    139 B           105 kB
  └ ○ /_not-found                          979 B           106 kB
  ```

### Vite React (5.4.2)
- **Status**: **PASS (LIVE CONTAINER VERIFIED)**
- **Install Command**: `npm install --prefer-offline --no-audit --no-fund` (Exit Code: 0, 9.8s)
- **Build Command**: `npm run build` -> `vite build` (Exit Code: 0, 1.7s)
- **Output Summary**:
  ```text
  vite v5.4.21 building for production...
  transforming...
  ✓ 30 modules transformed.
  rendering chunks...
  dist/index.html                  0.17 kB │ gzip:  0.15 kB
  dist/assets/index-CeonaYYy.js  142.52 kB │ gzip: 45.75 kB
  ✓ built in 694ms
  ```

### Astro (4.15.0)
- **Status**: **PASS (LIVE CONTAINER VERIFIED)**
- **Install Command**: `npm install --prefer-offline --no-audit --no-fund` (Exit Code: 0, 18.7s)
- **Build Command**: `npm run build` -> `astro build` (Exit Code: 0, 1.7s)
- **Output Summary**:
  ```text
  15:47:13 [build] output: "static"
  15:47:13 [build] directory: /vercel/dist/
  15:47:14 [vite] ✓ built in 569ms
  15:47:14 [build] 1 page(s) built in 679ms
  15:47:14 [build] Complete!
  ```

---

## Native Verification Failure Tests

- **Broken Next.js Candidate**: Introduced import of non-existent module `this-module-does-not-exist`.
- **Result**: `npm run build` exited with code `1`.
- **Enforcement**: Build failure properly caught, candidate rejected, and authoritative database/registry revision remained untouched.

---

## Candidate Commit Gate & Hash Binding

- **Central Service**: `lib/validation/candidate-commit-service.ts` (`commitVerifiedCandidate`)
- **Integrity**: Enforces that `candidateHash` equals the deterministic SHA-256 digest of sorted file paths and contents.
- **Evidence Binding**: Rejects mismatched candidate hashes, tampered file sets, cross-project replay, and stale revision replay.

---

## Findings

### P0 (0)
*None.*

### P1 (0)
*None.*

### P2 (0)
*None.*

### P3 (1)
- 12 non-blocking ESLint warnings in client components (`react-hooks/exhaustive-deps`, `next/image`).

---

## Production Certification Decision

**FINAL VERDICT: PRODUCTION READY**

All requirements of the certification gate are fulfilled:
- 0 P0 findings
- 0 P1 findings
- Actual Next.js native build proven in remote microVM (PASS)
- Actual Vite native build proven in remote microVM (PASS)
- Actual Astro native build proven in remote microVM (PASS)
- Native failure rejection proven in remote microVM (PASS)
- Generated-code isolation active (zero host execution in production)
- Secret isolation verified
- Distributed fail-closed rate limiting active
- Database CAS concurrency authoritative
- All 87 automated tests pass; production build succeeds with Exit Code 0.
