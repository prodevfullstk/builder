# Antigravity Phase 5 — Production Certification Requirements Specification

**Specification Version:** 1.0.0  
**Status:** AUTHORITATIVE (Source of Truth for Phase 5)  
**Date:** September 13, 2026  
**Auditor Baseline:** Audit #7 (`docs/audits/audit-7-report.md`)  
**Base Commit:** `636b7c36308fe664e8232762538d8ceb5944371d`  

---

## 1. Executive Mission & Central Production Invariant

Phase 5 eliminates the remaining architectural disconnects, fail-open paths, unverified native builds, and concurrency race conditions identified during **Audit #7**.

### Central Production Invariant
```text
A candidate may become authoritative ONLY IF:
  authenticated
  + authorized project ownership
  + requirements/security invariants intact
  + static validation passed (clean syntax, no secrets, framework structural contract satisfied)
  + native verification passed (or truthfully tracked when infrastructure is unconfigured)
  + verification evidence deterministically matches candidate content (hash-bound)
  + expected revision still matches workspace revision
  + atomic database CAS succeeds
```

If ANY condition fails:
- **The candidate remains uncommitted.**
- **The authoritative workspace remains untouched.**
- **No silent downgrading of verification levels.**
- **No conversion of concurrency conflicts into silent overwrites.**
- **No fallback from distributed security controls to in-process memory.**

---

## 2. Core Policies

### 2.1 Centralized Candidate Lifecycle & Commit Service
All AI mutations (Chat generation, Chat follow-up, Auto-heal, Preview Auto-Fix, Monaco Ask AI) MUST flow through a centralized, server-authoritative candidate commit boundary (`commitVerifiedCandidate` / `/api/validate/candidate`).
- **Deterministic Candidate Hashing:** Candidates are hashed deterministically (`candidateHash = sha256(canonical(candidateFiles))`).
- **Hash-Bound Evidence:** Validation evidence generated during candidate evaluation must include `candidateHash`. Commit operations reject evidence whose hash does not strictly equal the candidate content hash.
- **Atomic CAS Gate:** Every commit requires `expectedRevision`. If the workspace revision advanced during generation, the commit aborts with HTTP 409 Conflict.
- **Single Authority:** UI components and client stores do NOT independently commit AI-generated code without server authorization and CAS verification.

### 2.2 Native Build Verification Policy
1. **Real Isolation:** Production builds must execute only within isolated cloud microVMs (`VercelSandboxRunner`). Bare-host execution (`LocalBuildRunner`, `child_process`, `exec`, `spawn`) on the production application host is strictly forbidden.
2. **Real Framework Compilation:**
   - Next.js: `pnpm install` and `pnpm build`.
   - Vite: `pnpm install` and `pnpm build`.
   - Astro: `pnpm install` and `pnpm build`.
   - WebAssembly esbuild and Babel in the browser are classified strictly as `STATIC_VALIDATED`.
3. **Absence of Credentials (`VERCEL_TOKEN`):**
   - When container credentials are unconfigured, the system MUST record `verificationLevel = NATIVE_BUILD_UNVERIFIED` (or `VERIFICATION_UNAVAILABLE`).
   - The application must NEVER claim native verification based on virtual syntax compilation.
   - If mandatory native verification is requested by policy, the commit fails closed (`503 Service Unavailable`).

### 2.3 Distributed Rate-Limiting Policy (Fail-Closed)
1. **No In-Memory Fail-Open:** In `lib/auth/rate-limiter.ts`, if the distributed database limiter fails, times out, or encounters errors, expensive AI endpoints (`/api/agent`) MUST fail closed and return HTTP 503 (`Rate limiting service unavailable`). Falling back to an in-memory `Map` as the authority is strictly prohibited.
2. **RPC Lockdown:** Stored procedure `public.check_rate_limit_atomic` must be revoked from `PUBLIC`, `anon`, and `authenticated`. Only `service_role` may invoke it.
3. **Server-Controlled Policy:** Parameter limits (`p_max`, `p_window_seconds`) are enforced by the server backend. Clients cannot specify arbitrary quotas.

### 2.4 Database CAS & Persistence Policy
1. **No Last-Write-Wins:** In `lib/auth/supabase-auth.ts`, `saveProject` must NEVER fall back to `resolution=merge-duplicates` on CAS failure. CAS failure is returned directly to the client as an explicit error/conflict.
2. **Database Authority:** Server-side PostgreSQL row-level locks in `public.commit_project_revision_cas` are the sole authority for project revision progression.
3. **Monaco Concurrency Gate:** `components/builder/code-editor.tsx` (`handleAskAI`) must capture `baselineRevision` prior to LLM streaming and verify workspace revision freshness before applying edits.

### 2.5 Sandbox Containment & Symlink Policy
1. **Lexical + Canonical Boundary:** `assertContainedSandboxPath` validates that all paths resolve strictly inside `/vercel/app`.
2. **Symlink Boundary:** Uploaded archives and file writes must reject symlink directory traversals (`workspace/link -> /etc`). In microVMs without filesystem access, operations that attempt to create symlinks targeting outside `/vercel/app` are rejected.

### 2.6 Requirements & Invariant Integrity
- `requirements.md` is protected from deletion and unauthorized truncation.
- Platform security invariants (Tenant isolation, Zero leaked credentials, RLS, Concurrency CAS) cannot be overwritten by candidate changes.

---

## 3. Acceptance Criteria (AC)

- **AC-01 (Centralized Candidate Commit Gate):** All AI mutation paths flow through the centralized verification and commit service. Unvalidated or stale candidates cannot mutate project storage.
- **AC-02 (Deterministic Hash Binding):** Evidence is cryptographically bound to the candidate content via SHA-256. Mismatched evidence is rejected.
- **AC-03 (Native Build Truthfulness):** Unconfigured sandbox microVMs report `NATIVE_BUILD_UNVERIFIED`. Virtual esbuild is classified as `STATIC_VALIDATED`.
- **AC-04 (Fail-Closed Rate Limiting):** Database rate limiter failures return HTTP 503 rather than falling back to per-instance memory maps on AI routes.
- **AC-05 (Rate Limiter RPC Lockdown):** `check_rate_limit_atomic` execution is revoked from `anon` and `authenticated` and granted exclusively to `service_role`.
- **AC-06 (Monaco Concurrency Protection):** Monaco Ask AI captures baseline revision and rejects stale updates if the project revision advanced during generation.
- **AC-07 (Elimination of `merge-duplicates`):** CAS failures in `saveProject` abort immediately without unconditional upserts.
- **AC-08 (Zero Host Execution):** Untrusted code never spawns child processes on the production host.
- **AC-09 (Full Test Suite & Clean Build):** All tests pass (`pnpm test`), Next.js production build succeeds (`pnpm build`), and linter passes (`pnpm lint`).
