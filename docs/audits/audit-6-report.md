# Antigravity Audit #6 — Hostile Boundary & Production Execution Verification

**Audit Date:** September 13, 2026  
**Auditor:** Strict Independent Adversarial Security Auditor  
**Repository:** `opendorkweb`  
**Base Commit SHA:** `a826d525aa0f92b32d720817ae72e260e7768d89`  
**Branch:** `main`  
**Working-Tree State:** Clean (Zero uncommitted changes)  
**Node.js Version:** `v24.18.1`  
**pnpm Version:** `11.18.0`  
**Declared Package Manager (`package.json`):** `pnpm@9.15.9`  
**Framework Version:** Next.js `15.5.25`, React `19.0.0`  
**Relevant Environment Availability:**
* Supabase Auth & PostgreSQL Database: **AVAILABLE & VERIFIED**
* Vercel Sandbox Token (`VERCEL_TOKEN`): **UNAVAILABLE (FAILS CLOSED)**

---

## 1. Executive Verdict

### **VERDICT: NOT PRODUCTION READY**

### Summary of Verdict Rationale:
While Phase 3 successfully closed the critical **P0 bare-host execution vulnerability** (`LocalBuildRunner` is disabled in production, unreachable from production request handlers, and fails closed without host fallbacks), **significant architectural and boundary defects remain at the P1 level**:
1. **Disconnected BuildRunner Architecture (P1 / GEN-601):** Neither `LocalBuildRunner` nor `VercelSandboxRunner` is connected to the production AI candidate evaluation or commit gate. Candidate validation in production relies entirely on in-browser Babel/Wasm esbuild simulation. Native builds (`next build`, `vite build`, `astro build`) remain completely unverified before code is committed to user projects.
2. **Client-Only Concurrency Control & State Race Conditions (P1 / CONC-601):** The revision tracking implemented in Phase 3 exists **only** in the client-side Zustand in-memory store. The Supabase `public.projects` schema has no `revision` column, and `saveProject` blindly uses `resolution=merge-duplicates` without compare-and-swap (`WHERE revision = expected_revision`). Two distinct browser sessions will silently overwrite each other's project data.
3. **Concurrency Bypass in PreviewPane Auto-Fix (P1 / CONC-602):** While `chat-panel.tsx` captures `baselineRevision` to reject stale candidate changes, `preview-pane.tsx` (`handleAutoFix`) captures no baseline revision and does no optimistic concurrency check. An auto-fix completed while a user is actively typing in the Monaco code editor will silently blow away the user's manual edits.
4. **Missing Path Containment Validation on `/api/sandbox` File Uploads (P1 / SEC-601):** The `/api/sandbox` endpoint strips leading slashes but fails to perform canonical path containment checks on uploaded file paths (`path.relative('/vercel/app', target)`). Keys such as `../../etc/shadow` or `../../../root/.bashrc` are passed directly to `sandbox.writeFiles`, writing outside the application directory within the container.
5. **In-Memory Rate Limiting Ineffective in Serverless Multi-Instance Deployment (P1 / SEC-602):** The sliding-window rate limiter on `/api/agent` uses a module-level Node.js `Map`. In serverless hosting (Vercel Lambda / edge workers) or horizontally scaled containers, state is not shared across instances and resets on cold starts, allowing attackers to bypass rate limits.

---

## 2. Findings

---

### Finding [P1-1] — Disconnected BuildRunner Architecture & Unverified Native Builds
* **Finding ID:** `GEN-601`
* **Severity:** **P1 (High)**
* **Evidence:**
  Global grep across the repository confirms that `BuildRunner`, `LocalBuildRunner`, and `VercelSandboxRunner` are imported **only** in `test/phase3-security.test.ts` and `test/build-runner.test.ts`. Neither `app/builder/page.tsx`, `components/builder/chat-panel.tsx`, `lib/validation/candidate-pipeline.ts`, nor any API route imports or invokes a `BuildRunner`.
* **Why it matters:**
  The system claims "build verification" for Next.js, Vite, and Astro projects, but in reality, native framework compilers (`next build`, `vite build`, `astro build`) are never invoked during project generation. The application relies entirely on client-side WebAssembly esbuild (`bundleProjectWithEsbuild`) which only verifies basic TSX syntax and client imports. Projects with fatal Next.js server-component errors, invalid routing configurations, or broken Node runtime dependencies pass validation and are committed to user storage.
* **Reproduction:**
  1. Generate a Next.js project candidate that includes `import { headers } from 'next/headers'; headers();` inside an un-awaited client component or a syntax that passes esbuild but fails `next build`.
  2. The candidate validation pipeline accepts the candidate because `bundleProjectWithEsbuild` compiles the file without error.
  3. Attempt to run `next build` natively; it fails fatally.
* **Expected behavior:**
  Production generation verification must invoke an isolated containerized `BuildRunner` (e.g. `VercelSandboxRunner` or secure microVM) to execute the native framework build command before authoritative state commitment. If isolated runners are unavailable, the system must truthfully report `build_unverified` rather than claiming verified compilation.
* **Current behavior:**
  `BuildRunner` is a disconnected abstraction. Code commit occurs based purely on in-browser esbuild simulation.
* **Recommended architecture:**
  Wire `VercelSandboxRunner` into a server-side pre-commit validation API (`/api/validate/build`), requiring successful containerized native compilation before returning accepted status.

---

### Finding [P1-2] — Client-Only Concurrency Control (Lack of Database-Authoritative Compare-and-Swap)
* **Finding ID:** `CONC-601`
* **Severity:** **P1 (High)**
* **Evidence:**
  Inspection of `lib/auth/supabase-auth.ts` lines 74–93:
  ```typescript
  saveProject: async (accessToken: string, userId: string, project: any) => {
    return fetch(`${SUPABASE_URL}/rest/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: project.id,
        user_id: userId,
        name: project.name,
        framework: project.framework,
        files: project.files,
        messages: project.messages,
        updated_at: new Date(project.updatedAt || Date.now()).toISOString(),
      }),
    });
  }
  ```
  Inspection of `supabase/migrations/20260913_fix_tenant_isolation_rls.sql` confirms `public.projects` contains columns: `id`, `user_id`, `name`, `framework`, `files`, `messages`, `updated_at`. There is **no `revision` column**.
* **Why it matters:**
  Phase 3 introduced a monotonic `revision` number in `lib/store/project-store.ts`, but this counter is strictly client-side within a single browser tab's Zustand state. If a user opens the project in two browser tabs, or if two collaborators/MCP tools interact with the project simultaneously, both clients read revision 1. Client A saves changes; Client B subsequently saves changes and silently overwrites Client A's data without warning.
* **Reproduction:**
  1. Open tab A and tab B on the same project ID `proj_123`.
  2. In tab A, modify `app/page.tsx` and save.
  3. In tab B, modify `app/layout.tsx` and save.
  4. Query `GET /rest/v1/projects?id=eq.proj_123`. Tab A's modifications are completely lost; Tab B's payload overwrote the record with `resolution=merge-duplicates`.
* **Expected behavior:**
  Persistence must enforce atomic database compare-and-swap:
  `UPDATE public.projects SET files = ?, revision = revision + 1 WHERE id = ? AND revision = ?;`
  If 0 rows are updated, the server must return HTTP 409 Conflict.
* **Current behavior:**
  Zustand increments an in-memory counter; database persistence blindly performs last-write-wins upsert.
* **Recommended architecture:**
  Add `revision integer NOT NULL DEFAULT 1` to `public.projects`. Update `saveProject` to perform conditional updates with revision verification.

---

### Finding [P1-3] — Concurrency Gate Bypass in `preview-pane.tsx` Auto-Fix
* **Finding ID:** `CONC-602`
* **Severity:** **P1 (High)**
* **Evidence:**
  Inspection of `components/builder/preview-pane.tsx` lines 100–160:
  ```typescript
  // Lines 111-137: AI response received, candidateFiles assembled
  const evalResult = await evaluateCandidateChanges({ ... });
  // Lines 147-152: Virtual compilation verified
  // Line 155:
  setFiles(evalResult.committedFiles);
  ```
  Unlike `components/builder/chat-panel.tsx` (which captures `baselineRevision` before generation and asserts `useProjectStore.getState().revision === baselineRevision` before committing), `preview-pane.tsx` does not check `revision`.
* **Why it matters:**
  If a user triggers "Auto-Fix" from the preview pane, and while the LLM is streaming repairs the user edits code in the Monaco editor, `preview-pane.tsx` completes, calls `setFiles(evalResult.committedFiles)`, and instantly destroys all manual edits made by the user during the repair stream.
* **Reproduction:**
  1. Trigger Auto-Fix in `preview-pane.tsx`.
  2. While Auto-Fix is running, immediately open `code-editor.tsx` and type a new function in `app/page.tsx`.
  3. Auto-Fix completes virtual compilation and calls `setFiles()`.
  4. The code editor resets to the auto-fix candidate; the user's manual function is gone.
* **Expected behavior:**
  Auto-fix must capture `baselineRevision = useProjectStore.getState().revision` at launch, and abort with a conflict warning if `useProjectStore.getState().revision !== baselineRevision` before calling `setFiles`.
* **Current behavior:**
  `preview-pane.tsx` commits without revision verification.

---

### Finding [P1-4] — Missing Canonical Path Traversal Validation in `/api/sandbox`
* **Finding ID:** `SEC-601`
* **Severity:** **P1 (High)**
* **Evidence:**
  Inspection of `app/api/sandbox/route.ts` lines 148–162 and 287–294:
  ```typescript
  const filesToWrite: { path: string; content: string }[] = [];
  for (const [filePath, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;
    const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    filesToWrite.push({
      path: `/vercel/app/${cleanPath}`,
      content,
    });
  }
  await sandbox.writeFiles(filesToWrite);
  ```
* **Why it matters:**
  `cleanPath` only strips a single leading slash. If a malicious user supplies a project file with key `../../root/.bashrc` or `../../etc/crontab`, the resolved path passed to `@vercel/sandbox` is `/vercel/app/../../root/.bashrc`, which resolves to `/root/.bashrc`. This allows arbitrary file write outside `/vercel/app` across the container filesystem.
* **Reproduction:**
  Send `POST /api/sandbox` with payload:
  `{ "action": "start", "projectId": "test-traversal", "mode": "visual_preview", "files": { "../../etc/injected.conf": "malicious" } }`
  The route passes `path: "/vercel/app/../../etc/injected.conf"` directly to `sandbox.writeFiles()`.
* **Expected behavior:**
  Path containment must be enforced:
  ```typescript
  const target = path.posix.resolve('/vercel/app', cleanPath);
  if (!target.startsWith('/vercel/app/') || cleanPath.includes('\0')) {
    throw new Error('Path traversal attempt detected');
  }
  ```
* **Current behavior:**
  Only leading `/` is stripped; relative traversal segments are passed to the sandbox writer.

---

### Finding [P1-5] — In-Memory Sliding-Window Rate Limiting Ineffective Across Serverless Replicas
* **Finding ID:** `SEC-602`
* **Severity:** **P1 (Medium)**
* **Evidence:**
  Inspection of `lib/auth/rate-limiter.ts`:
  ```typescript
  const rateLimitStore = new Map<string, RateLimitRecord>();
  ```
  `app/api/agent/route.ts` calls `checkRateLimit(rateLimitKey, maxRequests, 3600_000)` against this in-memory Map.
* **Why it matters:**
  In production Next.js deployments (such as Vercel, AWS ECS, Kubernetes), API routes run across ephemeral serverless lambda functions or multiple container instances. Each instance has its own isolated memory space. An attacker can distribute requests across lambdas or trigger new lambda cold starts to easily bypass the 10 req/hr demo quota and exhaust LLM API credits.
* **Expected behavior:**
  Production rate limiting must be backed by a centralized distributed store (e.g. Upstash Redis, Supabase PostgreSQL sliding-window table).
* **Current behavior:**
  Process-local `Map` resets on process restart and is not shared across horizontal worker instances.

---

## 3. Security Boundary Map

```text
Browser (User Input / Chat / Monaco Editor)
  │
  ├─► [Boundary 1: Network Transport & Authentication]
  │     └─► /api/agent, /api/sandbox, /api/mcp
  │           ├─ Real Token: Verified via Supabase Auth (/auth/v1/user) [PASS]
  │           ├─ Demo Mode: Forced to deterministic 'demo-user' [PASS - SEC-301 Fixed]
  │           └─ In-Memory Rate Limiting: Bypassable via multi-instance [FAIL - SEC-602]
  │
  ├─► [Boundary 2: Project Authority & Ownership]
  │     └─► verifyProjectOwnership(projectId, userId, authMode)
  │           ├─ Rejects missing projectId (400) [PASS]
  │           ├─ Rejects cross-tenant access (403) [PASS]
  │           ├─ Blocks demo user accessing production projects (403) [PASS]
  │           └─ Enforced on MCP, Sandbox, and Project routes [PASS]
  │
  ├─► [Boundary 3: Candidate Validation Pipeline]
  │     └─► evaluateCandidateChanges()
  │           ├─ Non-empty workspace check [PASS]
  │           ├─ Requirements protection (prevents deletion & invariant weakening) [PASS]
  │           ├─ Secret Scanner (14 patterns: AWS, Stripe, Anthropic, Gemini, Groq, PAT) [PASS]
  │           └─ Framework Contract Validator (Deterministic file tree checks) [PASS]
  │
  ├─► [Boundary 4: Virtual Build Verification]
  │     └─► bundleProjectWithEsbuild()
  │           ├─ In-browser WebAssembly esbuild virtual memory [PASS - Safe from Host RCE]
  │           └─ Real Native Build (`next build`): DISCONNECTED [FAIL - GEN-601]
  │
  ├─► [Boundary 5: Host Execution Isolation]
  │     └─► LocalBuildRunner
  │           ├─ Production Gate: Throws if NODE_ENV === 'production' [PASS]
  │           ├─ Canonical Path Traversal Check in prepare() [PASS]
  │           ├─ Environment Stripping (getSafeChildEnvironment) [PASS]
  │           └─ Production Reachability: UNREACHABLE (Never imported by routes) [SAFE]
  │
  ├─► [Boundary 6: Remote Execution Isolation]
  │     └─► /api/sandbox (@vercel/sandbox)
  │           ├─ Missing credentials: Fails closed with 500 [PASS - No Host Fallback]
  │           ├─ Container File Traversal: Missing canonical check [FAIL - SEC-601]
  │           └─ Ownership check enforced on GET, POST, DELETE [PASS]
  │
  └─► [Boundary 7: State Persistence & Concurrency]
        ├─► Local Zustand Store: In-memory revision tracking [PASS - Tab only]
        ├─► PreviewPane Auto-Fix: Lacks revision check [FAIL - CONC-602]
        └─► Supabase Database: Lacks revision column, blind merge-duplicates [FAIL - CONC-601]
```

---

## 4. Mutation Inventory

Every code path capable of modifying project files was audited:

| Mutation Source | File / Location | Validation Pipeline Gated? | Virtual Build Gated? | Concurrency Checked? | Security Verdict |
|---|---|---|---|---|---|
| **Chat Generation (Build Mode)** | `components/builder/chat-panel.tsx:645` | **YES** (`evaluateCandidateChanges`) | **YES** (`bundleProjectWithEsbuild`) | **YES** (`baselineRevision` match) | **SECURE** |
| **Chat Follow-up (Chat Mode)** | `components/builder/chat-panel.tsx:300` | **YES** (`evaluateCandidateChanges`) | **NO** (Surgical diff) | **YES** (`baselineRevision` match) | **SECURE** |
| **Auto-Heal Pipeline** | `components/builder/chat-panel.tsx:592` | **YES** (`evaluateCandidateChanges`) | **YES** (`bundleProjectWithEsbuild`) | **YES** (Inherits build mode revision) | **SECURE** |
| **Preview Pane Auto-Fix** | `components/builder/preview-pane.tsx:131` | **YES** (`evaluateCandidateChanges`) | **YES** (`bundleProjectWithEsbuild`) | **NO** (No revision captured) | **RACE HAZARD (CONC-602)** |
| **Monaco Ask AI Edit** | `components/builder/code-editor.tsx:204` | **YES** (`evaluateCandidateChanges`) | **NO** (Surgical single file) | **NO** (Synchronous UI bar) | **ACCEPTABLE** |
| **Monaco Manual Typing** | `components/builder/code-editor.tsx:375` | **NO** (Direct user typing) | **NO** (Manual input) | Increments store revision | **INTENDED** |
| **MCP `write_file`** | `lib/mcp/server.ts:384` | Staged diff ONLY (`staged: true`) | Staged diff ONLY | N/A (Does not mutate store) | **SECURE** |
| **MCP `edit_file`** | `lib/mcp/server.ts:412` | Staged diff ONLY (`staged: true`) | Staged diff ONLY | N/A (Does not mutate store) | **SECURE** |
| **MCP `delete_file`** | `lib/mcp/server.ts:474` | Staged diff ONLY (`staged: true`) | Staged diff ONLY | N/A (Does not mutate store) | **SECURE** |

---

## 5. Build Execution Inventory

| Execution Boundary | Caller / Location | Command Executed | Environment | Filesystem | Isolation Mechanism | Production Reachable? | Host Safe? |
|---|---|---|---|---|---|---|---|
| **Virtual Bundler** | `components/builder/chat-panel.tsx`, `preview-pane.tsx` | In-browser Wasm esbuild | Browser JS | Virtual Memory | Browser Sandbox | **YES** | **YES (Zero Host Code Execution)** |
| **InstantPreview Iframe** | `components/preview/instant-preview.tsx` | Browser DOM / Babel evaluation | Browser DOM | None | `sandbox="allow-scripts ..."` (no same-origin) | **YES** | **YES (Parent window isolated)** |
| **LocalBuildRunner** | `lib/build/build-runner.ts` | `npm install --ignore-scripts`, `npm run build` | Sanitized allowlist | Temp dir (`path.relative` bounded) | Process tree termination; throws in prod | **NO (Tests only)** | **YES (Throws in prod)** |
| **Vercel Sandbox** | `app/api/sandbox/route.ts` | `npm install`, `npm run build`, `npm start` | Remote Vercel VM | Remote Container | Vercel Cloud MicroVM | **YES (If VERCEL_TOKEN set)** | **YES (Runs off-host)** |

---

## 6. Authentication & Route Matrix

| Route | Auth Required? | Demo Allowed? | Ownership Enforced? | Rate Limited? | Mutation Capability? | Status |
|---|---|---|---|---|---|---|
| `POST /api/agent` | **YES** (Supabase or Demo) | **YES** (`demo-user` locked) | N/A (Stateless LLM agent) | **YES** (10 demo / 60 auth) | No direct mutation | **PASS** |
| `POST /api/chat` | **YES** (Proxies to `/api/agent`) | **YES** | N/A | **YES** (Inherited) | No direct mutation | **PASS** |
| `POST /api/generate` | **YES** (Proxies to `/api/agent`) | **YES** | N/A | **YES** (Inherited) | No direct mutation | **PASS** |
| `POST /api/mcp` | **YES** (Per-tool gate) | **YES** (`demo-user` locked) | **YES** (`verifyProjectOwnership`) | **NO** (Standard MCP RPC) | Staged diffs only | **PASS** |
| `POST /api/sandbox` | **YES** | **YES** (`demo-user` locked) | **YES** (`verifyProjectOwnership`) | **NO** | Starts sandbox VM | **PASS** |
| `GET /api/sandbox` | **YES** | **YES** | **YES** (`verifyProjectOwnership`) | **NO** | Queries status | **PASS** |
| `DELETE /api/sandbox` | **YES** | **YES** | **YES** (`verifyProjectOwnership`) | **NO** | Stops sandbox VM | **PASS** |
| `GET /api/skills` | **NO** (Public catalog) | N/A | N/A | **NO** | Read-only static catalog | **PASS** |

---

## 7. Framework Verification Matrix

| Framework | Generated Project Real Build | Requested Version Honored? | Runtime Smoke Test | Verification Evidence |
|---|---|---|---|---|
| **Next.js** | **UNVERIFIED (Virtual esbuild only)** | **YES** (Regex parsed: `Next.js 14` -> `^14.0.0`) | **UNVERIFIED** | Static contract validation passes; real `next build` never executed in generation gate. |
| **Vite** | **UNVERIFIED (Virtual esbuild only)** | **YES** (Regex parsed: `Vite 4` -> `^4.0.0`) | **UNVERIFIED** | Static contract validation passes; real `vite build` never executed in generation gate. |
| **Astro** | **UNVERIFIED (esbuild cannot parse `.astro`)** | **YES** (Regex parsed: `Astro 3` -> `^3.0.0`) | **UNVERIFIED** | Static contract validation passes; real `astro build` never executed in generation gate. |
| **Node.js** | **UNVERIFIED (No backend execution)** | **YES** (Regex parsed: `Node 20` -> `^20.0.0`) | **UNVERIFIED** | Static contract validation passes; real `node server.js` never started in generation gate. |

---

## 8. Test Confidence Assessment

| Test Suite / Area | Declared Proof Level | Actual Verified Depth | False Confidence Risk |
|---|---|---|---|
| `test/auth.test.ts` | Unit Proof | Node.js mock Request object invoking `authenticateRequest()` | **Low**: Logic is deterministic and correctly enforces `demo-user`. |
| `test/phase3-security.test.ts` (P0-1) | Unit Proof | Direct function invocation of `authenticateRequest()` and `verifyProjectOwnership()` | **Low**: Directly tests the security boundary function. |
| `test/phase3-security.test.ts` (P0-2) | Source Text Proof | `fs.readFileSync` on `instant-preview.tsx` checking for absence of string `allow-same-origin` | **Medium**: Tests source code text, not actual browser DOM sandboxing. |
| `test/phase3-security.test.ts` (P0-3) | Unit Proof | Direct invocation of `new LocalBuildRunner().prepare()` asserting exception in `NODE_ENV=production` | **Medium**: Proves `LocalBuildRunner` throws on host, but conceals that `LocalBuildRunner` is never used in the actual application. |
| `test/phase3-security.test.ts` (P1-3) | Route Handler Proof | Constructing `NextRequest` and calling `sandboxPOST(req)` | **Low**: Accurately tests ownership verification logic in the Next.js API route. |
| `scratch/test_live_rls.js` | Live Database Proof | Real HTTP fetch requests against live Supabase REST and Auth endpoints | **Zero**: Real adversarial test against live PostgreSQL RLS policies with two separate JWTs. |

---

## 9. Claims vs. Evidence Matrix

| Phase 3 Claim | Independent Evidence Found | Audit #6 Verdict |
|---|---|---|
| "Demo Identity Spoofing Eliminated" | `lib/auth/server-auth.ts`: `id: 'demo-user'`, `X-Demo-User-Id` completely ignored. Verified by tests. | **CONFIRMED & VERIFIED** |
| "InstantPreview Iframe Sandboxed" | `components/preview/instant-preview.tsx`: `allow-same-origin` omitted. Source check verified. | **CONFIRMED & VERIFIED** |
| "LocalBuildRunner Host Isolation" | `lib/build/build-runner.ts`: Throws in `NODE_ENV=production`. Path traversal blocked. Secrets stripped. | **CONFIRMED & VERIFIED** |
| "Build Verification Gate Unconditional" | `components/builder/chat-panel.tsx`: `&& !isFixRequest` removed. Broken code is not committed. | **CONFIRMED & VERIFIED** |
| "Optimistic Concurrency Control" | `lib/store/project-store.ts`: `revision` counter added. Checked in chat panel. **BUT** omitted in preview auto-fix and omitted in Supabase database. | **PARTIALLY TRUE (CLIENT ONLY / INCOMPLETE)** |
| "Sandbox API Ownership Verification" | `app/api/sandbox/route.ts`: `verifyProjectOwnership` called on GET, POST, DELETE. | **CONFIRMED & VERIFIED** |
| "Requirements Protection" | `lib/validation/candidate-pipeline.ts`: Rejects deletion and invariant stripping. | **CONFIRMED & VERIFIED** |
| "Rate Limiting on AI Generation" | `lib/auth/rate-limiter.ts`: Sliding-window limiter on `/api/agent`. **BUT** in-memory Map only. | **PARTIALLY TRUE (PROCESS LOCAL ONLY)** |
| "Expanded Secret Scanner" | `lib/validation/candidate-pipeline.ts`: Detects Anthropic, Groq, Gemini, Stripe, PAT, Postgres. | **CONFIRMED & VERIFIED** |
| "Evidence Persistence to Disk" | `lib/storage/project-authority.ts`: Writes to `.opendork/evidence/<projectId>.json`. | **CONFIRMED & VERIFIED** |

---

## 10. Final Release Decision

### **RELEASE DECISION: BLOCKED (NOT PRODUCTION READY)**

### Blocking Defects Requiring Remediation:
1. **CONC-601 (Database Compare-and-Swap):** Implement server-authoritative concurrency control with a `revision` column in Supabase `public.projects` and conditional update queries to prevent silent overwrite of concurrent edits.
2. **CONC-602 (Preview Auto-Fix Concurrency):** Capture `baselineRevision` in `components/builder/preview-pane.tsx` and abort commit if the workspace revision changed during auto-fix generation.
3. **SEC-601 (Sandbox Path Containment):** Implement canonical relative path containment checking on all file keys received in `/api/sandbox` before writing to the container filesystem.
4. **GEN-601 (BuildRunner Wiring or Transparent Reporting):** Either wire containerized `VercelSandboxRunner` into the generation gate for genuine compilation verification, or update the UI and audit logs to truthfully state `virtual_syntax_check` instead of claiming full native framework compilation.
5. **SEC-602 (Distributed Rate Limiting):** Back rate limiting with a shared persistent key-value store (e.g. Redis or Supabase table) for multi-instance production deployments.
