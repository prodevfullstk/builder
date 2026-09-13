# Antigravity Audit #5 — Hostile Production Readiness & Bypass Audit

**Document Version:** 1.0.0  
**Target Repository:** `opendorkweb` (`https://github.com/prodevfullstk/builder.git`)  
**Audit Baseline Commit:** `e14b366bc78e4d5b190566f32469645c6062a9b5`  
**Auditor / Verification Agent:** Antigravity Adversarial Security & Reliability Team  
**Date:** 2026-09-13  
**Audit Classification:** Hostile, Independent Adversarial Audit  

---

## 1. Mandatory Audit Rules & Evidence Standards

In accordance with Audit #5 rules, no prior assertion in `phase-1-verification.md` or `phase-2-verification.md` was accepted without independent code tracing, runtime reproduction, or live database penetration testing.

All findings in this report are classified strictly by evidence standard:
- `LIVE_DATABASE_PROOF`: Verified by executing live queries and REST requests against the production Supabase PostgreSQL instance.
- `LIVE_RUNTIME_PROOF`: Verified by executing actual runtime exploits and Node test harnesses against the running code.
- `SOURCE_PROOF`: Verified by static source-code analysis of actual control flows and data paths in the repository.
- `UNVERIFIED`: Functionality or environment prerequisite is missing or mocked.

---

## 2. Exact Repository Baseline

- **Repository:** `prodevfullstk/builder` (`opendorkweb`)
- **Current HEAD SHA:** `e14b366bc78e4d5b190566f32469645c6062a9b5`
- **origin/main SHA:** `e14b366bc78e4d5b190566f32469645c6062a9b5`
- **Git Working Tree:** Clean (zero uncommitted changes)
- **Active Branch:** `main`
- **Node.js Runtime:** `v24.18.1`
- **Package Manager:** `pnpm@11.18.0` (declared `packageManager`: `pnpm@9.15.9`)
- **Next.js Version:** `15.5.25` (installed) / `^15.1.12` (declared)
- **React Version:** `19.0.0`
- **TypeScript Version:** `5.7.2`
- **Lockfile Format:** `pnpm-lock.yaml` (lockfileVersion: `9.0`)
- **Environment Prerequisites:**
  - `NEXT_PUBLIC_SUPABASE_URL`: PRESENT
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: PRESENT
  - `SUPABASE_SERVICE_ROLE_KEY`: PRESENT
  - `GROQ_API_KEY`: PRESENT
  - `VERCEL_TOKEN`: ABSENT
  - `VERCEL_SANDBOX_TOKEN`: ABSENT
  - `ANTHROPIC_API_KEY`: ABSENT
  - `OPENAI_API_KEY`: ABSENT
  - `GITHUB_TOKEN`: ABSENT

---

## 3. Previous Audit Traceability Matrix

| Finding ID (Audit #4) | Claimed Fix (Phase 2) | Current Implementation | Independent Audit #5 Verdict | Evidence Standard |
|---|---|---|---|---|
| **P0-A** (Supabase Database-Level Cross-Tenant Isolation) | Dropped open policy; added 4 strict RLS policies on `public.projects` checking `(auth.uid())::text = user_id`. | `supabase/migrations/20260913_fix_tenant_isolation_rls.sql` | **CONFIRMED FIXED (PostgreSQL Level)**. Live adversarial tests prove User B cannot SELECT, UPDATE, DELETE User A's rows, or spoof ownership on INSERT. | `LIVE_DATABASE_PROOF` |
| **P0-B** (Preview Auto-Fix Bypasses Candidate Validation) | Wrapped auto-fix in `evaluateCandidateChanges` and `bundleProjectWithEsbuild`. | `components/builder/preview-pane.tsx` lines 120–165 | **CONFIRMED FIXED**. Auto-fix candidate changes pass static validation and virtual compilation before `setFiles`. | `SOURCE_PROOF` & `UNIT_TEST_PROOF` |
| **P0-C** (Monaco Ask AI Bypasses Candidate Validation) | Wrapped Ask AI in `evaluateCandidateChanges`. | `components/builder/code-editor.tsx` lines 190–240 | **CONFIRMED FIXED**. Surgical AI edits pass static candidate validation before `updateFile`. | `SOURCE_PROOF` & `UNIT_TEST_PROOF` |
| **P0-D** (Unauthenticated MCP Endpoint with Wildcard CORS) | Added origin whitelist; added Bearer token auth check & tenant ownership checks; mutators return staged diffs. | `app/api/mcp/route.ts` & `lib/mcp/server.ts` | **NEW BYPASS DISCOVERED (P0-1)**. Wildcard CORS removed, but `X-Auth-Mode: demo` + `X-Demo-User-Id: <target>` allows full unauthenticated impersonation of ANY user ID on `/api/mcp`. | `LIVE_RUNTIME_PROOF` |
| **P1-A** (Transactional Commit in Chat Panel) | Snapshot baseline files; defer commit until validation and virtual compilation succeed. | `components/builder/chat-panel.tsx` line 626 | **NEW BYPASS DISCOVERED (P1-1)**. Line 626 has `&& !isFixRequest`. When user asks to fix an error or attaches a screenshot, broken uncompilable code STILL commits directly! | `SOURCE_PROOF` |
| **P1-B** (Uniform Build Runner Abstraction) | Created `BuildRunner` interface with `LocalBuildRunner` and `VercelSandboxRunner`. | `lib/build/build-runner.ts` | **NEW VULNERABILITIES DISCOVERED (P0-3, P1-4)**. `LocalBuildRunner` executes arbitrary lifecycle scripts (`preinstall`/`postinstall`) on host OS with all host environment variables; `prepare()` has path traversal; runner is never called in app runtime. | `SOURCE_PROOF` & `LIVE_RUNTIME_PROOF` |
| **P1-C** (Truthful Preview Badging & Diagnostics) | Added execution tier badge; exposed compilation errors. | `components/builder/preview-pane.tsx` & `components/preview/instant-preview.tsx` | **NEW CRITICAL FLAW (P0-2)**. Badge implemented, but `instant-preview.tsx` iframe combines `allow-scripts allow-same-origin` on `srcDoc`, allowing sandbox escape to parent window. | `SOURCE_PROOF` |
| **P1-D** (Requirements Spec Generator & Persistence) | Created `synthesizeProjectRequirements`; committed `requirements.md`. | `lib/ai/requirements-generator.ts` & `app/builder/page.tsx` | **PARTIALLY VERIFIED (P1-5)**. `requirements.md` is generated, but subsequent AI turns can silently overwrite or delete it because candidate validation does not protect it. | `SOURCE_PROOF` |

---

## 4. P0 — Complete Supabase Tenant-Isolation Audit

### 4.1 PostgreSQL Schema Deep Dive
Direct query of the live database (`information_schema` and `pg_catalog`) revealed:
1. **Tables:** Exactly one table exists in `public`: `public.projects`. No separate child tables exist (`messages`, `conversations`, `project_files`, and `deployments` are stored as JSONB attributes inside `public.projects`).
2. **Columns on `public.projects`:**
   - `id` (text, NOT NULL, PRIMARY KEY)
   - `user_id` (text, NULLABLE)
   - `name` (text, NOT NULL)
   - `framework` (text, NULLABLE)
   - `files` (jsonb, NOT NULL)
   - `messages` (jsonb, NOT NULL)
   - `created_at` (timestamptz, NOT NULL)
   - `updated_at` (timestamptz, NOT NULL)
3. **RLS Configuration:**
   - `relrowsecurity: true` (`ENABLE ROW LEVEL SECURITY`)
   - 4 active policies bound to role `{authenticated}`:
     - `SELECT`: `((auth.uid())::text = user_id)`
     - `INSERT`: `((auth.uid())::text = user_id)`
     - `UPDATE`: `((auth.uid())::text = user_id)` with `CHECK ((auth.uid())::text = user_id)`
     - `DELETE`: `((auth.uid())::text = user_id)`
4. **Storage & RPCs:**
   - Zero custom storage buckets exist in `storage.buckets`.
   - Zero custom SECURITY DEFINER RPCs exist in `public`.

### 4.2 Adversarial Test Execution Results
Live penetration tests executed using two real Supabase identities (Alice: `251622cf-...`, Bob: `fa9f6425-...`):
- **Test A.1 (Bob SELECT Alice's Project):** HTTP 200, returned `[]` (0 rows). **PASS (ISOLATED)**.
- **Test A.2 (Bob UPDATE Alice's Project):** HTTP 200, returned `[]` (0 rows modified). **PASS (BLOCKED)**.
- **Test A.3 (Bob DELETE Alice's Project):** HTTP 200, returned `[]` (0 rows deleted). **PASS (BLOCKED)**.
- **Test B.1 (Bob spoof INSERT claiming Alice's user_id):** HTTP 403, PostgreSQL Error Code `42501` (`new row violates row-level security policy for table "projects"`). **PASS (BLOCKED)**.
- **Test B.2 (Bob INSERT with NULL user_id):** HTTP 403, PostgreSQL Error Code `42501`. **PASS (BLOCKED)**.
- **Test F.1 (Anonymous SELECT):** HTTP 200, returned `[]` (0 rows). **PASS (DENIED)**.
- **Test F.2 (Anonymous INSERT):** HTTP 401 / 403, Error Code `42501`. **PASS (DENIED)**.
- **Test F.3 (Anonymous UPDATE):** HTTP 200, returned `[]` (0 rows modified). **PASS (DENIED)**.
- **Test F.4 (Anonymous DELETE):** HTTP 200, returned `[]` (0 rows deleted). **PASS (DENIED)**.
- **Test E (Alice legitimate access):** HTTP 200, returned exactly 1 row with confidential data intact. **PASS**.

**Tenant Isolation Verdict:** `public.projects` database-level RLS is **COMPLETELY VERIFIED**.

---

## 5. P0 — MCP Full Boundary Escape Audit

### 5.1 Critical Vulnerability Discovery: `X-Demo-User-Id` Identity Spoofing
While `app/api/mcp/route.ts` removed wildcard CORS and required authentication on project-scoped tools, a critical authentication and authorization bypass was discovered in the authentication bridge.

In `app/api/mcp/route.ts` (lines 98–105):
```typescript
const authHeader = req.headers.get("authorization");
const authModeHeader = req.headers.get("x-auth-mode");
if (authHeader || authModeHeader === "demo") {
  const authResult = await authenticateRequest(req, { allowDemo: true });
  if (authResult.user) {
    context = {
      userId: authResult.user.id,
      authMode: authResult.user.authMode,
    };
  }
}
```

In `lib/auth/server-auth.ts` (lines 111–124):
```typescript
const isDemoHeader = getHeader('X-Auth-Mode') === 'demo';
if (isDemoHeader) {
  if (options.allowDemo) {
    const demoId = getHeader('X-Demo-User-Id') || 'demo-user';
    return {
      user: {
        id: demoId,
        email: 'demo@opendork.com',
        name: 'Demo User',
        authMode: 'demo',
      },
    };
  }
}
```

### 5.2 Exploit Proof
An unauthenticated attacker sends an HTTP POST request to `/api/mcp` with:
```http
POST /api/mcp HTTP/1.1
Host: localhost:3000
Content-Type: application/json
X-Auth-Mode: demo
X-Demo-User-Id: real-user-alice-123

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_file",
    "arguments": {
      "projectId": "proj_alice_private_999",
      "path": "secret.env"
    }
  }
}
```

1. `authenticateRequest(req, { allowDemo: true })` accepts the request without verifying credentials and returns `user.id = "real-user-alice-123"`.
2. `handleMcpRequest` sets `context.userId = "real-user-alice-123"`.
3. `verifyProjectOwnership("proj_alice_private_999", "real-user-alice-123")` compares `project.owner_id === authenticatedUserId`. They match!
4. Alice's confidential files (`secret.env`) are returned in full JSON-RPC response to the unauthenticated attacker.

**Status:** **CONFIRMED P0 VULNERABILITY (P0-1)**.

---

## 6. P0 — Global Mutation-Boundary Audit

| Mutation Path | Calling Module | AI Controlled? | Passes Candidate Validation? | Passes Virtual Build? | Authoritative Commit Gate | Risk Level |
|---|---|---|---|---|---|---|
| **Chat Prompt Generation** | `components/builder/chat-panel.tsx` | Yes | Yes (`evaluateCandidateChanges`) | Yes (`bundleProjectWithEsbuild`) | `setFiles` deferred until validation passes | Low |
| **Chat Auto-Fix / Screenshot Fix** | `components/builder/chat-panel.tsx` line 626 | Yes | Yes (`evaluateCandidateChanges`) | Evaluated, but **BYPASSES COMMIT GATE** if failed | Calls `setFiles` even if compilation failed! | **P1 (P1-1)** |
| **Initial Project Setup** | `app/builder/page.tsx` line 230 | Yes | Yes (`evaluateCandidateChanges`) | **No (esbuild skipped)** | Calls `setFiles` directly | **P1** |
| **Preview Auto-Fix** | `components/builder/preview-pane.tsx` line 155 | Yes | Yes (`evaluateCandidateChanges`) | Yes (`bundleProjectWithEsbuild`) | Blocked if either fails | Low |
| **Monaco Ask AI Edit** | `components/builder/code-editor.tsx` line 220 | Yes | Yes (`evaluateCandidateChanges`) | No (Static contract check only) | Blocked if validation fails | Low |
| **Monaco Manual Typing** | `components/builder/code-editor.tsx` line 375 | No | No (Direct human edit) | No | Direct `updateFile` | Low (Human edit) |
| **FileTree Create/Rename/Delete** | `components/builder/file-tree.tsx` lines 163, 296 | No | No (Direct human edit) | No | Direct `createFile`/`deleteFile` | Low (Human edit) |
| **MCP File Operations** | `lib/mcp/server.ts` lines 405, 454, 493 | Yes/External | Staged candidate diffs ONLY | Deferred | Staged diffs only, no direct mutation | Low |

---

## 7. P0/P1 — Candidate Commit Integrity Audit

### 7.1 Defect in `chat-panel.tsx`: `isFixRequest` Bypasses Compilation Gate
In `components/builder/chat-panel.tsx`:
```typescript
// Line 340
const isFixRequest = isRuntimeFix || isScreenshotFix;

// Line 626
// ── TRANSACTIONAL COMMIT GATE ──
// If compilation failed and could not be healed, do NOT commit corrupt files to workspace
if (!compilationPassed && !isFixRequest) {
  setIsStreaming(false);
  setStreamingFile(null);
  setStatus('error', 'Virtual build verification failed');
  setRuntimeError('Build verification failed: Candidate code contained unresolvable compilation errors.');
  addMessage({ ... });
  return;
}

// Line 641
// Validation AND compilation passed: Atomically commit to authoritative project store
setFiles(verifiedFiles);
```

**Consequence:**
When a user attempts to fix a preview error or asks AI to repair a bug (`isFixRequest === true`), if the AI's candidate fix fails compilation and fails auto-healing (`compilationPassed === false`), the abort return is skipped!
Line 641 executes, committing broken, non-compilable code to the user's workspace.
**Status:** **CONFIRMED P1 DEFECT (P1-1)**.

---

## 8. P1 — Concurrency and Revision Control Audit

### 8.1 Complete Absence of Concurrency Primitives
Inspection of `lib/store/project-store.ts` and `components/builder/chat-panel.tsx` revealed:
- `project-store.ts` tracks no project revision counter, commit SHA, or generation timestamp.
- When AI generation begins in `chat-panel.tsx`:
  ```typescript
  const baselineFiles = { ...files };
  ```
  AI generation takes between 10 and 35 seconds to stream and validate.
- If during this window:
  - The user types changes in the Monaco code editor (`updateFile`).
  - The user creates, renames, or deletes files in the FileTree.
  - An MCP client stages a file change.
- When AI generation finishes:
  ```typescript
  setFiles(verifiedFiles);
  ```
  The entire workspace is overwritten with `verifiedFiles`, silently destroying all user edits and intermediate changes without conflict detection or warning.

**Status:** **CONFIRMED P1 DEFECT (P1-2)**.

---

## 9. P0/P1 — Build Runner Security Audit

### 9.1 Critical Vulnerability: Host Arbitrary Code Execution via npm/pnpm Lifecycle Scripts
Inspection of `lib/build/build-runner.ts` lines 42–60 and 142–150 revealed:
```typescript
function runCommand(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<BuildResult> {
  const isWindows = process.platform === 'win32';
  const child = spawn(cmd, args, {
    cwd,
    shell: isWindows,
    env: { ...process.env, CI: 'true' },
  });
  ...
}

export class LocalBuildRunner implements BuildRunner {
  async install(timeoutMs = 60000): Promise<BuildResult> {
    if (!this.tempDir) throw new Error('Runner not prepared. Call prepare() first.');
    return runCommand('pnpm', ['install', '--prefer-offline'], this.tempDir, timeoutMs);
  }
}
```

1. **Host Execution without Sandbox:** `LocalBuildRunner` executes `pnpm install` directly on the host server OS in `os.tmpdir()`. There is NO Docker container, microVM, chroot, or Linux namespace.
2. **Lifecycle Script Execution:** If untrusted or AI-generated `package.json` contains:
   ```json
   "scripts": {
     "preinstall": "node -e '...malicious payload...'"
   }
   ```
   `pnpm install` will execute `preinstall` with full host privileges.
3. **Host Environment Leakage:** `env: { ...process.env, CI: 'true' }` inherits ALL server environment variables (`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, etc.) directly into the child process. Untrusted scripts can exfiltrate server credentials.
4. **Path Traversal in `prepare()`:**
   ```typescript
   for (const [filePath, content] of Object.entries(files)) {
     const fullPath = path.join(this.tempDir, filePath);
     await fs.mkdir(path.dirname(fullPath), { recursive: true });
     await fs.writeFile(fullPath, content, 'utf-8');
   }
   ```
   `filePath` is not checked with `path.resolve(this.tempDir, filePath).startsWith(this.tempDir)`. Filenames containing `../../` can write outside `tempDir` to arbitrary server paths.
5. **Node.js Deprecation Warning `[DEP0190]`:** Spawning child processes with `shell: true` and concatenated arguments causes shell injection vulnerabilities on Windows.

**Status:** **CONFIRMED P0 VULNERABILITY (P0-3)**.

---

## 10. P1 — Real Generated-Project Build Verification

### 10.1 Disconnected BuildRunner Architecture
In Phase 2, `BuildRunner` was added as an abstraction in `lib/build/build-runner.ts` and tested with a 69-line unit test in `test/build-runner.test.ts`.
However:
- `BuildRunner` is **NEVER imported or invoked** in `app/builder/page.tsx`, `components/builder/chat-panel.tsx`, or `components/builder/preview-pane.tsx`.
- The application builder runtime **never executes native builds** (`next build`, `vite build`, `astro build`) for generated projects.
- When tested with a real Next.js fixture in `scratch/test_fixture_builds.js`, `pnpm install` required local caches, and on Windows, file locking in `node_modules` prevented `fs.rm` cleanup from completing cleanly.
- `VercelSandboxRunner` is unconfigured because `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` are absent from `.env.local`.

**Status:** **CONFIRMED P1 DEFECT (P1-4) / UNVERIFIED NATIVE RUNTIME**.

---

## 11. P1 — Framework Fidelity & Version Determinism

### 11.1 Contract Validation vs. Version Pinning
- **Framework Contract Validator (`lib/validation/framework-validator.ts`):** Strictly rejects Next.js projects missing root layouts or containing Vite configs, and rejects Vite projects containing Next.js dependencies. **PASS**.
- **Version Pinning Defect (`lib/ai/requirements-generator.ts`):** Framework versions are hardcoded to floating ranges (`^15.0.0`, `^5.0.0`, `^4.0.0`, `^20.0.0`). User requests specifying explicit versions (e.g., "Next.js 14" or "React 18") are ignored.

**Status:** **CONFIRMED P2 DEFECT (P2-2)**.

---

## 12. P1 — Requirements Specification Enforcement

### 12.1 Requirements Artifact Mutation Vulnerability
- Initial project creation generates `requirements.md` and commits it to workspace files.
- Subsequent generation prompts receive `requirements.md` at the head of the file summary.
- **Defect:** `evaluateCandidateChanges` does NOT protect `requirements.md`. If a user prompt or adversarial AI output replaces `requirements.md` with an empty file or removes all security constraints, the candidate pipeline allows the edit without rejection.

**Status:** **CONFIRMED P1 DEFECT (P1-5)**.

---

## 13. P1 — Authentication Coverage Audit

| Route | Method | Auth Enforced? | Ownership Enforced? | Demo Allowed? | Defect / Risk |
|---|---|---|---|---|---|
| `/api/mcp` | POST | Yes | Checked | Yes | **P0-1**: `X-Demo-User-Id` spoofing allows arbitrary tenant impersonation. |
| `/api/sandbox` | GET | Yes | **NO** | Yes | **P1-3**: Anyone can call GET with any `projectId` and kill any running sandbox! |
| `/api/sandbox` | POST | Yes | **NO** | Yes | **P1-3**: Does not verify whether `user.id` owns `projectId`. |
| `/api/agent` | POST | Yes | N/A | Yes | **P1-6**: Allows unauthenticated AI generation via `X-Auth-Mode: demo` with zero rate limiting. |
| `/api/chat` | POST | Forwards to agent | N/A | Yes | Inherits `/api/agent` rate-limit vulnerability. |
| `/api/generate` | POST | Forwards to agent | N/A | Yes | Inherits `/api/agent` rate-limit vulnerability. |
| `/api/skills` | GET | Public | N/A | Yes | Read-only catalog. Safe. |

---

## 14. P1 — Secret Detection Scanner False Negatives

`lib/validation/candidate-pipeline.ts` lines 14–22 define `SECRET_PATTERNS`.
Auditing these regular expressions against standard production credential formats:
- **Anthropic API Keys (`sk-ant-api03-...`):** FALSE NEGATIVE (Missed).
- **Groq API Keys (`gsk_...`):** FALSE NEGATIVE (Missed).
- **Google AI / Gemini Keys (`AIzaSy...`):** FALSE NEGATIVE (Missed).
- **Stripe Secret Keys (`sk_live_...`, `rk_live_...`):** FALSE NEGATIVE (Missed).
- **GitHub Fine-Grained Personal Access Tokens (`github_pat_...`):** FALSE NEGATIVE (Missed - only matches legacy `ghp_`).
- **PostgreSQL Database Connection URIs (`postgresql://user:pass@host/db`):** FALSE NEGATIVE (Missed).

**Status:** **CONFIRMED P1 DEFECT (P1-7)**.

---

## 15. P0 — InstantPreview Iframe Sandbox Escape

### 15.1 Critical Security Flaw in `components/preview/instant-preview.tsx`
Line 96 specifies:
```html
<iframe
  key={`${refreshNonce}-${esbuildHtml ? 'esbuild' : 'babel'}`}
  srcDoc={htmlContent}
  title="Instant App Preview"
  className={`w-full h-full border-none bg-white ${className}`}
  sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-popups"
/>
```

### 15.2 Security Risk
In web browser security architecture:
1. `srcDoc` iframes inherit the origin of their parent window (the builder application origin).
2. The W3C HTML specification and MDN documentation explicitly warn:
   > *"Setting both `allow-scripts` and `allow-same-origin` for an iframe running from the same origin is dangerous. It allows the iframe to access parent window DOM, access parent cookies, localStorage, and sessionStorage, or execute scripts that remove the sandbox attribute entirely."*
3. Because the builder renders **untrusted AI-generated code and user project files**, an embedded script can execute:
   ```javascript
   window.parent.localStorage.getItem('opendrok_auth_session');
   window.parent.document.cookie;
   ```
   and exfiltrate authenticated session tokens or manipulate the parent application state.

**Status:** **CONFIRMED P0 VULNERABILITY (P0-2)**.

---

## 16. Comprehensive Findings Log

### [P0-1] — Unrestricted Client-Controlled `X-Demo-User-Id` Header Allows Full MCP & Server Authority Impersonation
**Severity:** P0  
**Status:** CONFIRMED (LIVE_RUNTIME_PROOF)  
- **Finding:** `authenticateRequest` in `lib/auth/server-auth.ts` accepts `X-Demo-User-Id` from HTTP request headers without verification or namespacing. `app/api/mcp/route.ts` binds `context.userId` to this value. An attacker can set `X-Demo-User-Id: <victim_user_id>` with `X-Auth-Mode: demo` and read or stage edits to any victim project in `serverProjectRegistry`.
- **Reproduced:** Tested via `scratch/test_mcp_demo_spoof.js`. Successfully exfiltrated Alice's secret file `secret.env` with zero credentials.
- **Recommended Architecture:** Disallow arbitrary demo user IDs. When `authMode === 'demo'`, hardcode identity strictly to `demo-user` or a cryptographically signed random session ID with prefix `demo:`. Prohibit demo identities from accessing any project where `owner_id !== 'system-demo'` and `owner_id !== demoId`.

### [P0-2] — InstantPreview Iframe Sandbox Escape via Same-Origin `allow-scripts allow-same-origin`
**Severity:** P0  
**Status:** CONFIRMED (SOURCE_PROOF)  
- **Finding:** `components/preview/instant-preview.tsx` line 96 configures an iframe rendering `srcDoc={htmlContent}` with `sandbox="allow-scripts allow-same-origin ..."`. This combination allows untrusted AI code running inside the iframe to escape the sandbox, access parent window DOM, and steal authentication tokens from parent `localStorage`/`sessionStorage`.
- **Recommended Architecture:** Remove `allow-same-origin` from the preview iframe sandbox attribute, or host preview execution on an isolated untrusted subdomain (e.g. `preview.opendrok.com` or `null` origin sandbox).

### [P0-3] — LocalBuildRunner Host Arbitrary Code Execution via npm/pnpm Lifecycle Scripts
**Severity:** P0  
**Status:** CONFIRMED (SOURCE_PROOF & RUNTIME_PROOF)  
- **Finding:** `LocalBuildRunner.install()` executes `pnpm install` directly on the host server OS with all server environment variables (`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`). Malicious generated `package.json` with `preinstall` or `postinstall` executes arbitrary shell commands on the host server. `prepare()` also lacks path traversal sanitization on `filePath`.
- **Recommended Architecture:** Never execute package manager commands on the bare host server. Build verification must run inside an isolated Linux container, Docker container, or microVM with `--ignore-scripts`, stripped environment variables, and strict network isolation.

### [P1-1] — Preview Auto-Fix & Screenshot Fix Punctures Transactional Commit Gate
**Severity:** P1  
**Status:** CONFIRMED (SOURCE_PROOF)  
- **Finding:** In `components/builder/chat-panel.tsx` line 626, the commit abort gate checks `if (!compilationPassed && !isFixRequest)`. When `isFixRequest` is true, the gate evaluates to false and proceeds to commit uncompilable code to the authoritative store via `setFiles(verifiedFiles)`.
- **Recommended Architecture:** Remove `&& !isFixRequest` from the commit gate. Fix attempts must adhere to the same transactional invariant as initial generation: uncompilable candidates must never be committed to authoritative state.

### [P1-2] — Absence of Concurrency Control & Stale Candidate Rejection
**Severity:** P1  
**Status:** CONFIRMED (SOURCE_PROOF)  
- **Finding:** `project-store.ts` lacks revision tracking or optimistic concurrency. In `chat-panel.tsx`, generation snapshots `baselineFiles`. Manual edits made in Monaco or FileTree during generation are silently destroyed by last-write-wins when generation finishes.
- **Recommended Architecture:** Add monotonic `revision: number` to `ProjectState`. When candidate changes complete, verify that the current store revision matches the generation baseline revision. If newer revisions exist, prompt for merge or reject the stale candidate.

### [P1-3] — Complete Absence of Production Ownership Checks in Sandbox API
**Severity:** P1  
**Status:** CONFIRMED (SOURCE_PROOF)  
- **Finding:** `app/api/sandbox/route.ts` imports neither `verifyProjectOwnership` nor checks project owner. In the GET method, any authenticated or demo user can stop any other user's running sandbox by passing `projectId`. In the POST method, sandboxes are created and modified without verifying ownership.
- **Recommended Architecture:** Import and enforce `verifyProjectOwnership(projectId, user.id)` in all methods of `app/api/sandbox/route.ts`. Reject unauthorized callers with HTTP 403.

### [P1-4] — Disconnected BuildRunner Architecture & Unverified Native Builds
**Severity:** P1  
**Status:** CONFIRMED (SOURCE_PROOF)  
- **Finding:** `BuildRunner` is an unused abstraction never called by the application runtime. The builder relies entirely on client-side virtual esbuild and Babel DOM simulation. Real native builds (`next build`, `vite build`, `astro build`) remain completely unverified in production.
- **Recommended Architecture:** Wire build verification into server-side candidate validation before export or deployment, backed by containerized runners.

### [P1-5] — Requirements Specification Overwrite and Bypass Vulnerability
**Severity:** P1  
**Status:** CONFIRMED (SOURCE_PROOF)  
- **Finding:** `requirements.md` is synthesized on project creation, but `evaluateCandidateChanges` does not prevent subsequent AI turns from deleting or replacing it with contradictory content.
- **Recommended Architecture:** Mark `requirements.md` as protected in `evaluateCandidateChanges`. Reject candidates that delete or weaken declared security invariants or acceptance criteria unless an explicit user-approved requirements update action is invoked.

### [P1-6] — Unauthenticated AI Token Consumption & Missing Rate Limiting on `/api/agent`
**Severity:** P1  
**Status:** CONFIRMED (SOURCE_PROOF)  
- **Finding:** `/api/agent` permits `allowDemo: true` without token or IP rate limiting. Any client sending `X-Auth-Mode: demo` can exhaust the server's AI API credits.
- **Recommended Architecture:** Implement strict IP-based and session-based rate limiting (e.g. Upstash Redis token bucket) on `/api/agent`. Restrict demo mode to a small maximum turn count per IP per hour.

### [P1-7] — Secret Detection Scanner False Negatives on Common Credential Formats
**Severity:** P1  
**Status:** CONFIRMED (SOURCE_PROOF)  
- **Finding:** `scanForSecrets` only detects 7 specific regexes, missing Anthropic keys (`sk-ant-...`), Groq keys (`gsk_...`), Google AI keys (`AIzaSy...`), Stripe keys (`sk_live_...`), GitHub fine-grained PATs (`github_pat_...`), and database connection URIs.
- **Recommended Architecture:** Expand `SECRET_PATTERNS` to cover all modern cloud provider key formats and database connection URIs.

### [P2-1] — In-Memory Only Validation Evidence
**Severity:** P2  
**Status:** CONFIRMED (SOURCE_PROOF)  
- **Finding:** `ValidationEvidence` records are stored only in memory (`serverProjectRegistry`). Server restart erases all audit history.
- **Recommended Architecture:** Persist validation evidence records to database or project audit files.

### [P2-2] — Hardcoded Framework Versions and Carat Floating Dependency Ranges
**Severity:** P2  
**Status:** CONFIRMED (SOURCE_PROOF)  
- **Finding:** `lib/ai/requirements-generator.ts` hardcodes floating versions (`^15.0.0`, `^5.0.0`). User requests specifying exact versions are ignored.
- **Recommended Architecture:** Parse framework version from user prompt and pin exact versions in `package.json`.

### [P2-3] — Absence of Automated Visual Regression and DOM Baseline Testing
**Severity:** P2  
**Status:** CONFIRMED (SOURCE_PROOF)  
- **Finding:** The builder contains no visual regression testing or DOM diffing tools to detect unwanted layout breakage across iterations.
- **Recommended Architecture:** Add automated headless browser screenshot comparison for visual preview diffs.

---

## 17. Final Evidence Matrix

| Area | Result | Evidence Type | Confidence | Remaining Risk |
|---|---|---|---|---|
| **Supabase RLS (Projects)** | **PASS** | `LIVE_DATABASE_PROOF` | High | None on `public.projects`. |
| **Child-Table Isolation** | **PASS** | `LIVE_DATABASE_PROOF` | High | No child tables exist (all JSONB in projects). |
| **MCP Boundary** | **FAIL** | `LIVE_RUNTIME_PROOF` | High | `X-Demo-User-Id` spoofing allows arbitrary tenant impersonation. |
| **Mutation Boundary** | **PARTIAL** | `SOURCE_PROOF` | High | `isFixRequest` bypasses compilation commit gate. |
| **Transactional Commit** | **PARTIAL** | `SOURCE_PROOF` | High | Auto-fix commits broken code if compilation fails. |
| **Concurrency & Revisions** | **FAIL** | `SOURCE_PROOF` | High | No optimistic locking; last-write-wins destroys edits. |
| **Requirements Enforcement** | **PARTIAL** | `SOURCE_PROOF` | High | `requirements.md` can be overwritten by downstream AI. |
| **Next Generated Build** | **UNVERIFIED** | `UNVERIFIED` | High | Real `next build` never run by app; runner disconnected. |
| **Vite Generated Build** | **UNVERIFIED** | `UNVERIFIED` | High | Never run by app; runner disconnected. |
| **Astro Generated Build** | **UNVERIFIED** | `UNVERIFIED` | High | Never run by app; runner disconnected. |
| **Node Generated Runtime** | **UNVERIFIED** | `UNVERIFIED` | High | Never run by app; runner disconnected. |
| **Build Runner Isolation** | **FAIL** | `SOURCE_PROOF` | High | Runs on bare host OS; executes npm scripts; path traversal. |
| **Sandbox Truthfulness** | **PARTIAL** | `SOURCE_PROOF` | Medium | Badge added, but Sandbox API lacks ownership checks. |
| **Preview Security** | **FAIL** | `SOURCE_PROOF` | High | `allow-scripts allow-same-origin` on `srcDoc` allows sandbox escape. |
| **AI Prompt Injection** | **PARTIAL** | `SOURCE_PROOF` | Medium | Prompts can overwrite requirements and consume free AI tokens. |
| **Secret Protection** | **PARTIAL** | `SOURCE_PROOF` | High | Scanner misses Anthropic, Groq, Google, Stripe, fine-grained PATs. |
| **GitHub Push Security** | **PASS** | `SOURCE_PROOF` & `UNIT_TEST_PROOF` | High | In-memory token, no force push, remote ref drift check. |
| **Persistence / Sync** | **PASS** | `LIVE_DATABASE_PROOF` | High | RLS-enforced merge duplicates. |
| **Validation Evidence** | **PARTIAL** | `SOURCE_PROOF` | High | Ephemeral in-memory Map only. |
| **Visual Regression** | **FAIL** | `SOURCE_PROOF` | High | No visual regression or DOM diffing mechanism. |
| **CI Reproducibility** | **PASS** | `UNIT_TEST_PROOF` | High | 45/45 tests pass; lint & build exit code 0. |

---

## 18. Audit #5 Final Verdict

# NOT PRODUCTION READY

The repository cannot be certified as production ready due to:
1. **Three Critical P0 Security Vulnerabilities:**
   - **P0-1:** `X-Demo-User-Id` spoofing allows complete unauthenticated cross-tenant impersonation on `/api/mcp`.
   - **P0-2:** Same-origin `allow-scripts allow-same-origin` iframe sandbox escape in `InstantPreview` exposing parent application tokens and DOM.
   - **P0-3:** Bare-host arbitrary code execution via lifecycle scripts and path traversal in `LocalBuildRunner`.
2. **Four Critical P1 Architectural Flaws:**
   - **P1-1:** Auto-fix / screenshot fix punctures the transactional commit gate, committing broken code.
   - **P1-2:** Complete lack of concurrency control, causing AI generation to destroy concurrent manual edits.
   - **P1-3:** Sandbox API endpoints completely lack ownership verification.
   - **P1-4:** Disconnected BuildRunner architecture leaving real native builds unverified in production.
