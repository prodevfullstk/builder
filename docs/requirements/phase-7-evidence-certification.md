# Antigravity Phase 7 — Evidence Integrity & End-to-End Production Certification

**Authoritative Requirements Document**  
**Target Application**: `opendorkweb` Website Builder (`https://github.com/prodevfullstk/builder`)  
**Phase**: Phase 7 — Evidence Integrity & End-to-End Production Certification  
**Execution Baseline**: Post-Audit #9 Evidence Discrepancy Resolution  
**Timestamp**: 2026-09-13T22:10:00+06:00  

---

## 1. Objective & Purpose

The objective of Phase 7 is to establish **strict evidence integrity** and execute **end-to-end production certification** from a verifiable, clean git revision.

Audit #9 reported `AUDITED COMMIT: a3ab71e` while simultaneously leaving modified source files (`lib/build/build-runner.ts` and `test/phase4-hardening.test.ts`) uncommitted in the working tree. Under hostile audit standards, a commit cannot be certified based on uncommitted working-tree behavior.

Phase 7 mandates:
1. Complete resolution of the clean-tree evidence integrity gap.
2. Server-side mandatory enforcement in `commitVerifiedCandidate` that authoritative production commits require verified native container evidence (`NATIVE_BUILD_VERIFIED`) when native gating is required.
3. Cryptographic candidate hash binding, evidence non-replayability, project/revision binding, and expiration checks.
4. Live execution of Next.js, Vite, and Astro builds in remote Vercel Sandbox microVMs with clean git revision traceability.
5. Runtime HTTP smoke verification proving generated marker response from sandbox server processes.

---

## 2. Core Architectural & Security Invariants

### 2.1 Clean-Tree Traceability (CERT-701)
- All production certification claims MUST be executed against an exact, clean committed git SHA.
- No dirty working-tree state may be attributed to a release commit.

### 2.2 Server-Side Native Verification Gate (GATE-701)
- `commitVerifiedCandidate` MUST enforce:
  1. `projectId` match between evidence and target project.
  2. Cryptographic candidate hash equality (`actualHash === candidateHash === evidence.candidateHash`).
  3. Strict validation acceptance (`evidence.accepted === true`).
  4. Native build verification status: when native verification is mandatory for authoritative state, candidates with `VERIFICATION_UNAVAILABLE`, `STATIC_VALIDATED`, or `failed` native builds MUST NOT commit to authoritative state.
  5. Evidence freshness: validation evidence cannot exceed its TTL (e.g. 15 minutes) or be replayed across different revisions.
  6. Database atomic CAS check (`expectedRevision === currentRevision`).

### 2.3 Remote MicroVM Native Compilation & Smoke Check (RUN-701)
- All generated framework projects (Next.js, Vite, Astro) must compile natively via `@vercel/sandbox` in remote isolated microVMs without host execution.
- Runtime verification must confirm server startup and HTTP 200 response with deterministic generated markers.

### 2.4 Credential & Secret Isolation (SEC-701)
- Zero server secrets (`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, etc.) passed into sandbox environments.
- Credentials must never be committed to git history, documentation, or fixture files.
