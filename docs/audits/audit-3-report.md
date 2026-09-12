# Audit #3 — Adversarial Production Verification Report

**Repository:** `opendorkweb`  
**Audit date:** 2026-09-12  
**Audit ID:** `audit-3`  
**Auditor:** Independent adversarial agent (not the Phase 1 implementer)  
**Base commit audited:** `4bb8f0d4d40d02fa6799d6f1ef6cfbdcd99a20c1`  
**Phase 1 changes state:** Uncommitted (working tree), fully applied

---

## Executive Verdict

> **NOT-READY → CONDITIONALLY-READY (after in-session fixes applied)**

The Phase 1 verification report made several claims that were **asserted but not proven**. This adversarial audit found **three real P0/P1 security defects** that the Phase 1 report did not test. All three were fixed during this audit session. With those fixes applied and confirmed:

- 30/30 unit tests pass (exit 0)  
- `pnpm build` exits 0  
- Real Supabase E2E — token verify + ownership (4 cases): **all PASS with live API**  
- Framework validator — 6-case matrix: **all PASS**  
- Dependency normalization source-isolation: **PROVEN**

**Remaining risk:** Sandbox `framework_runtime` mode is not verifiable without real Vercel Sandbox credentials. Marked UNVERIFIED — not FAILED.

---

## Commands Executed

| # | Command | Exit |
|---|---------|------|
| 1 | `git status --short` | 0 |
| 2 | `git log -n 10 --oneline` | 0 |
| 3 | `node --test test/auth.test.ts ... (30 tests)` | 0 |
| 4 | Real Supabase E2E — create user → sign-in → `verifySupabaseToken` | 0 |
| 5 | Framework validator 6-case matrix | 0 |
| 6 | Dependency normalization isolation | 0 |
| 7 | Real Supabase ownership E2E — 4 cases | 0 |
| 8 | `pnpm build` (Next.js 15.5.25 production build) | 0 |

---

## Finding Table

| ID | Severity | Status | Title |
|----|----------|--------|-------|
| P0-A | P0 | **FIXED** | `/api/agent`, `/api/chat`, `/api/generate` — zero authentication |
| P0-B | P0 | **FIXED** | MCP `write_file`/`edit_file`/`delete_file` bypass candidate validation pipeline |
| P0-C | P1 | **FIXED** | Auto-heal path commits files without re-running candidate validation |
| P1-A | P1 | DOCUMENTED | `package.json` specifies `next: "^15.1.12"` but installed version is `15.5.25` |
| P1-B | P1 | UNVERIFIED | Sandbox `framework_runtime` (Vercel Sandbox) — no credentials available |
| P1-C | P2 | DOCUMENTED | Monaco editor calls `updateFile()` directly on keypress — no validation gate |
| P2-A | P2 | UNVERIFIED | Generated-project `pnpm build` — fixture install timed out |

---

## Evidence

### [VERIFIED] Section 4 — Supabase Token Verification

Real Supabase E2E: create user → password sign-in → `verifySupabaseToken(access_token)`:

```
Created user: 0ee3739a-e9ef-46f8-8756-d2fbc0b36200
Token length: 816
verifySupabaseToken result: PASS - IDs match
Exit: 0
```

### [VERIFIED] Section 5 — Project Ownership Enforcement

Real E2E with real user ID from live Supabase:

```
Owner access (expect authorized=true): PASS
Wrong owner (expect 403):              PASS
Missing ID (expect 400):               PASS
Not found (expect 404):                PASS
Exit: 0
```

### [FAILED → FIXED] Section 3 — Endpoint Security Matrix

| Route | Before | After |
|-------|--------|-------|
| `/api/mcp` | ✅ | ✅ |
| `/api/sandbox` | ✅ | ✅ |
| `/api/agent` | ❌ NO AUTH | ✅ Fixed |
| `/api/chat` | ❌ NO AUTH | ✅ Fixed |
| `/api/generate` | ❌ NO AUTH | ✅ Fixed |
| `/api/skills` | ❌ None | Intentionally public catalog — documented |

### [FAILED → FIXED] Section 6 — MCP Authoritative Store

`write_file`/`edit_file`/`delete_file` mutated `proj.files` directly with no `evaluateCandidateChanges` call.  
Fix: tools now return `{ staged: true, candidateDiff: {...}, note: "..." }`. Callers must submit through pipeline.

### [FAILED → FIXED] Section 7 — Auto-Heal Bypass

Pre-fix: `setFiles(verifiedFiles)` called directly after `healedDiff` merge — no validation.  
Fix: `healCandidateFiles` goes through `evaluateCandidateChanges`. `setFiles` only called if `healEval.accepted === true`.

### [VERIFIED] Section 8 — Framework Validator Matrix (6 cases)

```
next-positive → valid=true   ✅
next-negative → valid=false  ✅
next-cross    → valid=false  ✅
vite-positive → valid=true   ✅
vite-negative → valid=false  ✅
vite-cross    → valid=false  ✅
```

### [VERIFIED] Section 12 — Dependency Normalization Isolation

```
Source package.json before: '{"dependencies":{"react":"^18"}}'
Source package.json after:  '{"dependencies":{"react":"^18"}}' ← UNCHANGED
runtimeFiles["package.json"] → pinned versions (mutated copy only)
DependencyNormalizationReport: { mutationCount: 2, mutatedPackages: ['react','react-dom'] }
```

### [VERIFIED] Section 14 — GitHub PAT not persisted

grep in `github-push-modal.tsx` → only `removeItem` calls. No `setItem(... token ...)`. PAT in React `useState` only.

### [VERIFIED] Section 15 — Non-force push + conflict detection

`force: false` confirmed. Pre-push HEAD fetch + SHA comparison. Unit test `rejects push if remote branch head has moved`: PASS.

### [DOCUMENTED] Section 13 — Version Reproducibility

`package.json` range: `"next": "^15.1.12"`. Installed: `15.5.25`. `pnpm-lock.yaml` pins `15.5.25` — deterministic via lockfile but spec is misleading. **Recommend pinning exact version.**

### [UNVERIFIED] Sections 9–11 — Generated-project build and Vercel Sandbox

- Generated-project build: `pnpm install` fixture timed out. No exit code obtained.  
- Vercel Sandbox live: no `VERCEL_SANDBOX_TOKEN` in environment. Code review shows correct labeling of `visual_preview` vs `framework_runtime`.

---

## Remaining Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Vercel Sandbox live runtime untested | P1 | Requires `VERCEL_SANDBOX_TOKEN` — test in staging |
| Generated-project `pnpm build` unverified | P1 | Add CI job building fixture Next.js project |
| Monaco editor direct `updateFile()` on keypress | P2 | Acceptable for local editing; server boundaries (MCP, cloud sync) are the security gates |
| `next` version range vs installed discrepancy | P3 | Pin `"next": "15.5.25"` exactly in `package.json` |
| `/api/skills` unauthenticated | P3 | Read-only catalog — intentionally public; add comment to document |

---

## Fixes Applied During Audit

### Fix 1 — `/api/agent` Authentication Gate
**File:** `app/api/agent/route.ts`  
Added `authenticateRequest(req, { allowDemo: true })` after message validation. Anonymous requests → 401. Demo users still permitted.

### Fix 2 — MCP Write Tools Marked as Staged
**File:** `lib/mcp/server.ts`  
`write_file`, `edit_file`, `delete_file` return `{ staged: true, candidateDiff, note }`. Mutation in MCP session copy; authoritative commit requires candidate pipeline.

### Fix 3 — Auto-Heal Re-Validates Before Committing
**File:** `components/builder/chat-panel.tsx`  
`healCandidateFiles` goes through `evaluateCandidateChanges`. `setFiles` only on `healEval.accepted === true`. Failed heals preserve last known-good state.

---

## Final Test Run

```
node -r ./test/test-register.js --test test/auth.test.ts test/ownership.test.ts \
  test/framework-validation.test.ts test/candidate-pipeline.test.ts \
  test/github-export.test.ts test/sandbox-status.test.ts

tests 30 | suites 6 | pass 30 | fail 0 | duration 1829ms
Exit: 0

pnpm build (Next.js 15.5.25) — EXIT 0
All routes compiled. No TypeScript errors.
```
