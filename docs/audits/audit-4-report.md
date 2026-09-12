# Antigravity Audit #4 — Generation-to-Production Evidence Audit Report

**Repository:** `opendorkweb`  
**Audit Date:** 2026-09-13  
**Audit ID:** `audit-4`  
**Auditor:** Strict Independent Adversarial Auditor  
**Audit Scope:** End-to-end Generation-to-Production Lifecycle (Requirements -> Candidate -> Validation -> Build -> Runtime -> Evidence -> Commit)  
**Base Commit Audited:** `585dbf905f6ea723d9c2f2e44b056e5e7c46a0ba` (includes Phase 1 and Audit #3 fixes, verified clean locally and on origin/main)  

---

## 1. Executive Verdict

> ### **FINAL VERDICT: NOT PRODUCTION READY**

While previous audits established that unit tests pass (30/30), the builder application itself builds, and server-side authentication functions correctly, this generation-to-production audit revealed **four critical P0 security and data isolation vulnerabilities**, **four major P1 architectural gaps**, and significant evidence that **generated projects cannot be verified as functional framework applications**.

### Key Critical Findings:
1. **[P0-A] Supabase Database-Level Cross-Tenant Data Leak:** Direct live REST testing against Supabase proved that Row Level Security (RLS) on `public.projects` permits any authenticated user to **READ, UPDATE, and DELETE any other user's projects and confidential files** (HTTP 200). Authorization exists only in application code, completely absent at the database layer.
2. **[P0-B] Candidate Validation Pipeline Bypass in Preview Auto-Fix:** When users trigger "Auto-Fix" from the preview error banner (`preview-pane.tsx`), AI-generated code is committed directly to the authoritative Zustand store (`setFiles`) with **zero candidate validation, zero secret scanning, and zero framework contract checks**.
3. **[P0-C] Candidate Validation Pipeline Bypass in Code Editor AI Edit:** The inline Monaco AI editing bar (`code-editor.tsx`) applies AI-generated code directly to the active file via `updateFile`, completely bypassing the candidate validation pipeline.
4. **[P0-D] Unauthenticated & Unchecked MCP Tool Access:** The `/api/mcp` endpoint accepts JSON-RPC requests without authentication, allows arbitrary CORS from any origin (`Access-Control-Allow-Origin: *`), and executes file operations without verifying project ownership.
5. **[P1-A] State Committed Before Virtual Build Verification:** In `chat-panel.tsx`, candidate files are committed to authoritative project state *before* virtual compilation runs. If compilation fails and auto-healing fails, broken files remain committed to the project store with no rollback mechanism.
6. **[P1-B] Complete Absence of Server-Side Generated Project Build Pipeline:** The repository provides no backend runner or build service to actually install and build generated Next.js, Vite, or Astro projects. The only server-side mechanism relies on `@vercel/sandbox`, which fails immediately because no Vercel credentials exist in the environment.
7. **[P1-C] In-Browser Visual Preview Hides Framework Build Failures:** When virtual compilation fails, `InstantPreview` silently falls back to in-browser Babel standalone compilation. Visual preview success can and does coexist with total framework build failure.
8. **[P1-D] Total Lack of Project-Level Requirements Persistence:** The builder does not persist or generate project-specific requirements documents (pages, routes, data models, acceptance criteria, constraints). The UI displays a cosmetic step "Analyzed requirements", but no requirements artifact is produced or saved.

---

## 2. Repository Baseline

- **Current HEAD Commit:** `585dbf905f6ea723d9c2f2e44b056e5e7c46a0ba`
- **Current Branch:** `main`
- **Git Status:** Clean (working tree clean)
- **Local Commit Existence (585dbf9):** Verified locally
- **Remote Commit Existence (585dbf9):** Verified on `origin/main` (`https://github.com/prodevfullstk/builder.git`)
- **Package Manager:** `pnpm 11.18.0` (Note: `package.json` specifies `pnpm@9.15.9` — version discrepancy recorded)
- **Node Version:** `v24.18.1`
- **Next.js Version:** `15.5.25` installed (Note: `package.json` specifies `^15.1.12`)
- **Lockfile Version:** `lockfileVersion: '9.0'` (`pnpm-lock.yaml`)
- **Environment Configuration:**
  - `.env.local` present: **yes**
  - Supabase URL configured: **yes**
  - Supabase Anon Key configured: **yes**
  - Supabase Service Role Key configured: **yes**
  - Database URL configured: **yes**
  - Gemini API Key configured: **yes**
  - Vercel Sandbox Token configured: **no**
  - *(All secret values held strictly confidential; zero secret values printed)*

---

## 3. Architecture Map

The actual system architecture was traced through source code and runtime behavior:

```text
                      [User Prompt]
                            │
                            ▼
              [/api/agent (Gemini Streaming)]
           (Receives prompt + truncated file history)
           (No requirements spec generated or stored)
                            │
                            ▼
           [Raw Output / MCP Tool XML Stream]
                            │
                            ▼
            [parseToolCalls / parseFinalOutput]
                            │
                            ▼
    ┌───────────────────────┴───────────────────────┐
    │                                               │
    ▼                                               ▼
[Valid Candidate Path]                 [BYPASS PATHS (CRITICAL P0)]
(chat-panel / builder page)            • preview-pane handleAutoFix ──> setFiles() DIRECT
    │                                  • code-editor handleAiEdit  ──> updateFile() DIRECT
    ▼                                  • file-tree deleteFile      ──> deleteFile() DIRECT
[evaluateCandidateChanges]
- Regex secret leak scan
- Framework contract check
- Non-empty workspace check
    │
    ├─> REJECTED: Preserves previous files
    │
    ▼ ACCEPTED
[Authoritative State: setFiles(verifiedFiles)]  <── FILES COMMITTED HERE!
    │
    ▼ (POST-COMMIT)
[bundleProjectWithEsbuild (Browser Virtual Compilation)]
    │
    ├─> ERRORS DETECTED:
    │     Attempts Auto-Heal via /api/agent
    │     If Heal Fails: Files REMAIN COMMITTED in Zustand store!
    │
    ▼
[Preview Engine Selection]
    ├── 1. Vercel Sandbox (API /api/sandbox Mode B)
    │        └── FAILS: Missing VERCEL_SANDBOX_TOKEN
    │        └── Fallback to Engine 2
    ├── 2. InstantPreview (Browser Babel / esbuild-wasm)
    │        └── Renders mock client JSX in iframe
    │        └── Hides server component / SSR / build failures
    └── 3. NodeboxPreview (In-Browser CodeSandbox WASM)
             └── Downgrades dependencies at runtime
```

---

## 4. Requirements / Specification Audit

**Question:** Does the builder maintain a real project-level source of truth for user requirements?

- **Finding:** **NO — Major Architectural Gap [P1-D]**.
- **Evidence:**
  1. Inspection of `lib/store/project-store.ts` shows `ProjectState` has no field for requirements, user specifications, functional criteria, or data models.
  2. Inspection of `lib/storage/project-authority.ts` shows `AuthoritativeProject` contains only `{ id, owner_id, name, framework, files, messages, createdAt, updatedAt }`. No requirements document or metadata exists.
  3. In `app/builder/page.tsx` line 228, the timeline displays a hardcoded step:
     `{ id: 'init-analyze', type: 'thought', label: 'Analyzed requirements', status: 'completed' }`.
     This label is purely cosmetic. No requirements analysis artifact is written, persisted, or validated against.
  4. The AI prompt in `lib/ai/prompt-templates.ts` receives the raw user chat message directly. If the request is complex or ambiguous, it does not lock down a formal specification document before writing code.

---

## 5. Framework Compliance Audit

**Path Audited:** User prompt -> Framework selection -> System prompt -> AI generation -> Parser -> Validator -> Authoritative Commit.

### Test Cases Evaluated:
- **Case A: Next.js 15 App Router:**
  - Positive contract: Requires `app/layout.tsx` (or `.jsx`) and `app/page.tsx` (or `.jsx`). Rejects presence of `vite.config.ts` or `src/App.tsx`.
  - Result: **STATIC CONTRACT ENFORCED**. Unit tests and pipeline reject Vite hybrid contamination.
- **Case B: Vite + React:**
  - Positive contract: Requires `index.html` and `src/App.tsx` (or `src/main.tsx`). Rejects presence of `app/layout.tsx` or `next.config.*`.
  - Result: **STATIC CONTRACT ENFORCED**. Unit tests reject Next.js files in Vite project.
- **Case C: Astro:**
  - Contract in validator: Requires `src/pages/index.astro` or `astro.config.*`.
  - Result: **STATIC CONTRACT DEFINED**. However, Astro cannot be built or run on the server.
- **Case D: Node.js Backend:**
  - Contract in validator: Requires `package.json` and `src/server.ts` or `index.js`.
  - Result: **STATIC CONTRACT DEFINED**.
- **Cross-Framework Contamination:**
  - Static detection works as designed in `lib/validation/framework-validator.ts`.
  - **Runtime Contamination:** Because `InstantPreview` wraps all code in a generic client-side Babel browser bundle with Next.js hooks mocked via `esm.sh`, runtime behavior is identical across Next.js and Vite. True framework-specific runtime semantics (App Router streaming, React Server Components, server actions) are never executed.

---

## 6. Framework Version Compliance Audit

- **Requested vs Resolved Version:**
  - `ProjectState` and `AuthoritativeProject` track framework only as an enum: `'nextjs' | 'vite' | 'astro' | 'node'`.
  - There is **no field for framework version** (e.g. `requestedVersion` or `resolvedVersion`).
  - If a user requests `Next.js 15.1.12`, the system prompt injects generic instructions for `Next.js 15 (App Router)`.
  - In `opendorkweb/package.json`, Next.js is declared as `^15.1.12`, but the installed package in `node_modules` is `15.5.25`.
  - In generated projects, the AI generates a `package.json` with floating versions (e.g. `^15.0.0` or `latest`).
  - When mounted in CodeSandbox Nodebox (`lib/sandbox/nodebox-adapter.ts`), floating and canary versions are mutated at runtime, but the source `package.json` is not permanently altered.

---

## 7. Candidate Pipeline Mutation Graph & Bypass Audit

Every path that can mutate project state was mapped and audited:

| Mutation Path | Calling Location | State Mutated | Passes Candidate Pipeline? | Secret Scan? | Framework Check? | Impact |
|---|---|---|---|---|---|---|
| **Initial Prompt Generation** | `app/builder/page.tsx:217` | Zustand `files` | **YES** | YES | YES | Protected |
| **Chat Incremental Generation** | `components/builder/chat-panel.tsx:303` | Zustand `files` | **YES** | YES | YES | Protected |
| **Auto-Heal (Virtual Compile)** | `components/builder/chat-panel.tsx:599` | Zustand `files` | **YES** | YES | YES | Protected (re-evaluates) |
| **Preview Error Auto-Fix** | `components/builder/preview-pane.tsx:111,118` | Zustand `files` | **NO — BYPASS** | **NO** | **NO** | **CRITICAL P0-B** |
| **Monaco Inline AI Edit** | `components/builder/code-editor.tsx:183,188` | Zustand `files` | **NO — BYPASS** | **NO** | **NO** | **CRITICAL P0-C** |
| **Monaco Manual Typing** | `components/builder/code-editor.tsx:330` | Zustand `files` | **NO — BYPASS** | **NO** | **NO** | Intended manual edit |
| **FileTree Delete File** | `components/builder/file-tree.tsx:296` | Zustand `files` | **NO — BYPASS** | **NO** | **NO** | Can delete layout.tsx |
| **FileTree Create File** | `components/builder/file-tree.tsx:133` | Zustand `files` | **NO — BYPASS** | **NO** | **NO** | Creates empty file |
| **MCP File Operations** | `lib/mcp/server.ts:330-385` | MCP `memoryProjects` | **NO — BYPASS** | **NO** | **NO** | **CRITICAL P0-D** |
| **Cloud Sync** | `lib/storage/cloud-sync.ts:53` | Supabase `projects` | **NO** (Syncs state) | N/A | N/A | Subject to RLS bug |
| **GitHub Export** | `lib/export/github-export.ts:210` | Remote Git repo | **NO** (Exports state) | Has scanner | No | Read-only export |

### Critical Bypass Findings:
- **Bypass 1 (P0-B):** `preview-pane.tsx` lines 110–121: Clicking "Auto-Fix" on preview errors executes `setFiles(result.updatedFiles)` or `setFiles({ ...files, ...fixedFiles })` directly with zero validation.
- **Bypass 2 (P0-C):** `code-editor.tsx` lines 183–188: Submitting an inline AI prompt inside the code editor executes `updateFile(activeFile, file.content)` directly, which writes directly into `files` in the store with zero validation.
- **Bypass 3 (P0-D):** In `lib/mcp/server.ts`, `write_file`, `edit_file`, and `delete_file` mutate the project directly in the MCP session memory without passing through candidate validation.

---

## 8. MCP Audit

Every tool in `lib/mcp/server.ts` was audited:

| MCP Tool | Auth Required? | ProjectId Required? | Ownership Checked? | Validation Enforced? | Status |
|---|---|---|---|---|---|
| `list_projects` | No | No | No (returns memoryProjects only) | N/A | P3 (Divergent store) |
| `get_project` | No | Yes | **NO (Any user can read any proj)** | N/A | **P0 (Unauthorized read)** |
| `create_project` | No | No | Defaults owner to "anonymous" | No validation | P2 |
| `list_files` | No | Yes | **NO (Any user can list files)** | N/A | **P0 (Unauthorized read)** |
| `get_file` | No | Yes | **NO (Any user can read file)** | N/A | **P0 (Unauthorized read)** |
| `write_file` | No | Yes | **NO (Any user can write file)** | Staged note only | **P0 (Unauthorized write)** |
| `edit_file` | No | Yes | **NO (Any user can edit file)** | Staged note only | **P0 (Unauthorized write)** |
| `delete_file` | No | Yes | **NO (Any user can delete file)** | Staged note only | **P0 (Unauthorized write)** |
| `audit_code` | No | Yes | No | Runs code scanner | P2 |
| `list_templates` | No | No | N/A | Read-only catalog | OK |

### Key MCP Finding:
In `app/api/mcp/route.ts`, `authenticateRequest` is only invoked *if* an `Authorization` header is present. If the header is omitted, `context` is `undefined`, and the tool execution proceeds unauthenticated. In `resolveProjectExplicit`, no check verifies whether `context.userId === project.owner_id`. Anyone can read, modify, or delete project files via MCP. Wildcard CORS (`Access-Control-Allow-Origin: *`) further exposes this to any website in the user's browser.

---

## 9. Generated Project Build Matrix

Direct live tests were performed to determine whether the builder repository provides a mechanism to install and build generated projects:

| Framework | Mechanism Available in Repo? | Local Install Tested? | Local Build Tested? | Exact Command | Exit Code | Result |
|---|---|---|---|---|---|---|
| **Next.js** | Partial (only via external @vercel/sandbox) | No server install runner | Attempted via local next binary | `node ../node_modules/next/dist/bin/next build` in fixture | Exit null (lockfile warning/hang) | **FAILED / UNVERIFIED** |
| **Vite React** | **NONE** (Vite not installed in repo) | No runner exists | Cannot build | `require.resolve('vite')` | Error: Cannot find module | **FAILED** |
| **Astro** | **NONE** (Astro not installed in repo) | No runner exists | Cannot build | `require.resolve('astro')` | Error: Cannot find module | **FAILED** |
| **Node.js** | Built-in Node runtime | N/A | Direct execution | `node -e "...http.createServer..."` | Exit 0 | **PASSED** |

**Conclusion:** The builder repository contains **no local or server-side build harness** for Vite or Astro. For Next.js, the repository has no server-side build worker; it relies entirely on external Vercel Sandboxes.

---

## 10. Generated Project Runtime & HTTP Smoke Test Matrix

| Framework | Process Startup | Port Binding | HTTP Smoke Test Status | Cleanup | Result |
|---|---|---|---|---|---|
| **Node.js** | Started HTTP server | Port 3991 | **200 OK** (`NODE_SMOKE_OK`) | Clean server.close() | **PASSED** |
| **Next.js** | External Sandbox only | Port 3000 (claimed) | Untestable (no sandbox credentials) | N/A | **UNVERIFIED** |
| **Vite React** | In-browser Nodebox only | Port 5173 (client) | Untestable server-side | N/A | **UNVERIFIED** |
| **Astro** | In-browser Nodebox only | Port 4321 (client) | Untestable server-side | N/A | **UNVERIFIED** |

---

## 11. Vercel Sandbox Audit

- **Creation & Credentials:**
  - Tested live in Node: `const { Sandbox } = require('@vercel/sandbox'); Sandbox.getOrCreate({ name: 'test-sbx', ports: [3000] })`.
  - **Live Result:** Throws error:
    `Could not get credentials from OIDC context. Please link your Vercel project using npx vercel link. Then, pull an initial OIDC token with npx vercel env pull and retry.`
  - Verification: `VERCEL_SANDBOX_TOKEN` is not configured in `.env.local`.
- **Mode A vs Mode B:**
  - Mode A (`visual_preview`): Starts a custom static HTTP server script (`/vercel/server.mjs`) on port 3000. Correctly returns `mode: 'visual_preview'` and lists skipped checks.
  - Mode B (`framework_runtime`): Runs `npm install`, `npm run build`, `npm start`, followed by an HTTP ping. Correctly structured, but **completely inoperable without Vercel credentials**.
- **Client Fallback:**
  - In `components/builder/preview-pane.tsx` line 331, when Vercel Sandbox fails, it catches the error and silently sets `setEngine('instant')`.
  - The user is transitioned to in-browser Babel rendering without knowing that framework runtime execution failed.

---

## 12. Instant Preview & Babel Fallback Audit

- **Execution Model:**
  - Uses `generateInstantPreviewHtml(files)` (Babel standalone loaded from unpkg/esm.sh CDNs) and `bundleProjectWithEsbuild(files)` (esbuild-wasm loaded from esm.sh).
- **Semantics:**
  - **Server Components:** Not supported. All components are executed as client-side React components.
  - **`'use client'` Directive:** Ignored by Babel standalone.
  - **Routing:** Fake client-side router simulation; Next.js App Router dynamic routes, layouts, and server actions are not executed.
  - **Build Failure Concealment:**
    In `components/preview/instant-preview.tsx` lines 56–58:
    `catch { // esbuild failed - Babel fallback already showing, no action needed }`.
    If a generated project contains serious TypeScript, Next.js, or compilation errors, Babel standalone renders whatever client-side JSX it can parse. The preview appears "successful" to the user even though the project would fail `next build`.

---

## 13. Auto-Fix / Auto-Heal Lifecycle Audit

The auto-fix lifecycle was traced across two distinct implementations:

### 1. Chat Panel Auto-Heal (Compilation errors detected after initial acceptance)
- Location: `components/builder/chat-panel.tsx` lines 534–610.
- Flow:
  1. Candidate passes static validation.
  2. Authoritative state updated: `setFiles(verifiedFiles)` (Line 515).
  3. Virtual compilation check runs: `bundleProjectWithEsbuild(verifiedFiles)` (Line 537).
  4. If errors detected: AI called with `mode: 'auto-fix'`.
  5. Healed diff is re-validated via `evaluateCandidateChanges`.
  6. **CRITICAL DEFECT:** If healing fails or candidate is rejected, the project files **remain committed** in their broken state from step 2. There is no rollback to the pre-prompt snapshot!

### 2. Preview Pane Auto-Fix (User clicks "Auto-Fix" on runtime preview error)
- Location: `components/builder/preview-pane.tsx` lines 73–130.
- Flow:
  1. User clicks "Auto-Fix".
  2. Sends request to `/api/agent` with `mode: 'auto-fix'`.
  3. Receives AI output.
  4. **CRITICAL DEFECT (P0-B):** Calls `setFiles(result.updatedFiles)` or `setFiles({ ...files, ...fixedFiles })` directly without calling `evaluateCandidateChanges`. Bypasses candidate pipeline entirely!

---

## 14. Screenshot / Visual Edit Audit

- **Context Sent to AI:**
  - Base64 screenshot image (`image`).
  - Truncated files: up to 14 files, sliced to 2,000–6,000 characters.
  - Active file content.
  - No project requirements or route context.
- **Surgical Patching:**
  - AI prompt instructs minimal edits, but the resulting files are parsed by standard file parsers.
- **Visual Verification:**
  - **ZERO automated visual regression verification.** There is no Playwright visual comparison, pixel diff, or DOM comparison.
  - The system relies entirely on the AI model self-reporting correctness.


---

## 15. Project Authority & State Store Audit

### Competing Project Universes Identified:
1. **Client In-Memory Store (Zustand):** `lib/store/project-store.ts` — Active workspace in browser memory.
2. **Client Persistent Store (localStorage):** `lib/storage/project-storage.ts` — Local persistent cache.
3. **Server In-Memory Registry:** `lib/storage/project-authority.ts` — Process memory on server.
4. **MCP Session Store:** `lib/mcp/server.ts` (`memoryProjects`) — Independent in-memory Map for MCP.
5. **Cloud Database Store:** Supabase PostgreSQL table `public.projects`.

### Findings:
- There is no single unified source of truth.
- MCP maintains its own Map (`memoryProjects`) seeded with a demo project. Projects created or edited via MCP diverge from the browser Zustand store.
- Revisions/ETags do not exist in any store.

---

## 16. Concurrency / Revision Audit

- **Finding:** Neither `ProjectState`, `AuthoritativeProject`, nor the Supabase `projects` table maintains a revision number or optimistic locking token.
- **Simulation:**
  - Client A and Client B read project version at timestamp `T`.
  - Client A commits changes at `T+1`.
  - Client B commits changes at `T+2`.
  - Result: Client B silently overwrites Client A's work without conflict detection.
- **GitHub Export Exception:** `lib/export/github-export.ts` correctly implements concurrency protection: it checks remote branch head SHA before updating, and passes `force: false`.

---

## 17. Live Authentication & Supabase RLS Audit

An adversarial test was executed against live Supabase using real generated test users:

```text
=== AUDITING SUPABASE RLS & DIRECT REST ACCESS ===
Created User A: true | Created User B: true
User A JWT token generated (length 823)
User B JWT token generated (length 823)

1. User A inserts project 'col-test-...' via Supabase REST:
   Status: 201 Created

2. User B queries User A's project via Supabase REST:
   GET /rest/v1/projects?id=eq.col-test-...
   Status: 200 OK
   Rows returned: 1  <--- CRITICAL P0 VULNERABILITY!
   User B reads confidential files of User A!

3. User B updates User A's project via Supabase REST:
   PATCH /rest/v1/projects?id=eq.col-test-...
   Body: { name: 'Hacked by User B' }
   Status: 200 OK
   Rows updated: 1   <--- CRITICAL P0 VULNERABILITY!

4. User B deletes User A's project via Supabase REST:
   DELETE /rest/v1/projects?id=eq.col-test-...
   Status: 200 OK
   Rows deleted: 1   <--- CRITICAL P0 VULNERABILITY!

5. Invalid Token Test:
   GET /rest/v1/projects with invalid Bearer token
   Status: 401 Unauthorized (PASS)
```

### Verdict on Supabase RLS:
**FAILED [CRITICAL P0-A].** While application code checks ownership in server endpoints, the database table `public.projects` permits any authenticated user to perform full CRUD operations on any other user's projects.

---

## 18. Demo User Privilege Matrix

| Operation | Demo User Allowed? | Implemented Guard | Status |
|---|---|---|---|
| **AI Generation** | YES | `authenticateRequest({ allowDemo: true })` | Working as intended |
| **Project Storage** | YES | LocalStorage in browser | Working as intended |
| **Cloud Sync** | **BLOCKED** | `user.authMode === 'demo'` returns error | Working as intended |
| **MCP** | YES | Allows demo identity | Working as intended |
| **Sandbox** | YES | Allows demo identity | Inoperable (no Vercel credentials) |
| **GitHub Export** | Requires PAT | Requires user to provide personal PAT | Working as intended |

---

## 19. GitHub Audit

- **Token Persistence:** Audited all storage layers. No GitHub PAT is stored in `localStorage`, `sessionStorage`, or Zustand persist middleware. The token exists only in React component memory (`useState('')`).
- **Push Protection:** `lib/export/github-export.ts` uses `force: false` and compares remote branch head SHA before updating the reference. Concurrency race protection verified.

---

## 20. Dependency Normalization Audit

- **Isolation:** `lib/sandbox/nodebox-adapter.ts` creates a shallow copy `runtimeFiles = { ...files }`. Mutates `runtimeFiles['package.json']` only. Source files in Zustand store remain unmodified.
- **Normalization Report:** Correctly populates `DependencyNormalizationReport` with mutation count and reasons.
- **Risk Identified:** Pins `lucide-react` to `^0.344.0` even if the project uses `^0.454.0`. May break projects using newer icons at runtime.

---

## 21. Evidence System Audit

- **Structure:** `ValidationEvidence` in `lib/validation/types.ts` contains `validationId`, `projectId`, `timestamp`, `framework`, `checks`, `accepted`, `diagnostics`.
- **Missing Fields:** Missing `requestedFrameworkVersion`, `resolvedFrameworkVersion`, `buildResult`, `runtimeResult`, `runtimeUrl`, `commitRevision`.
- **Persistence:** **NOT PERSISTED.** Validation evidence is returned in memory from `evaluateCandidateChanges` and discarded after logging. It cannot be audited historically.

---

## 22. Security Scan Summary

Across all tracked files:
- `localStorage`: Used for client-side project caching and auth persistence; zero GitHub PATs stored.
- `sessionStorage`: 0 occurrences.
- `Authorization` / `Bearer`: Properly validated in `server-auth.ts`.
- `service_role`: Configured in server env; never leaked to client bundle.
- `eval()`: 0 occurrences in application code.
- `new Function()`: 0 occurrences in application runtime (only in test script).
- `dangerouslySetInnerHTML`: 0 occurrences.
- `innerHTML`: 1 occurrence in iframe error boundary (`instant-preview-html.ts`).
- `child_process`: 0 occurrences in application code.
- `Access-Control-Allow-Origin: *`: Present on `/api/mcp` — **P0 risk**.

---

## 23. Comprehensive Finding Table

| ID | Severity | Status | Title | Affected Files |
|---|---|---|---|---|
| **P0-A** | P0 | OPEN | Supabase Database-Level Cross-Tenant Data Leak via Permissive RLS | Supabase `public.projects` |
| **P0-B** | P0 | OPEN | Preview Error Auto-Fix Directly Bypasses Candidate Validation Pipeline | `components/builder/preview-pane.tsx:111,118` |
| **P0-C** | P0 | OPEN | Monaco Editor Inline AI Edit Directly Bypasses Candidate Validation | `components/builder/code-editor.tsx:183,188` |
| **P0-D** | P0 | OPEN | Unauthenticated & Unchecked MCP Tool Access with Wildcard CORS | `app/api/mcp/route.ts`, `lib/mcp/server.ts` |
| **P1-A** | P1 | OPEN | Premature Authoritative State Commit Before Virtual Build Verification | `components/builder/chat-panel.tsx:515,537` |
| **P1-B** | P1 | OPEN | Absence of Server-Side Generated Project Build Pipeline | Repository Architecture |
| **P1-C** | P1 | OPEN | In-Browser Visual Preview Hides Framework Build Failures | `components/preview/instant-preview.tsx:57` |
| **P1-D** | P1 | OPEN | Missing Project-Level Requirements / Specification Document | `lib/store/project-store.ts`, `app/builder/page.tsx` |
| **P2-A** | P2 | OPEN | Framework Version Discrepancies and Inability to Pin Requested Versions | `lib/store/project-store.ts`, `package.json` |
| **P2-B** | P2 | OPEN | Lack of Concurrency and Revision Control Across State Stores | `lib/store/project-store.ts`, `lib/storage/project-authority.ts` |
| **P2-C** | P2 | OPEN | Ephemeral and Unpersisted Validation Evidence | `lib/validation/candidate-pipeline.ts` |
| **P2-D** | P2 | OPEN | Missing Automated Visual Regression Infrastructure | `components/builder/chat-panel.tsx` |
| **P3-A** | P3 | OPEN | Package Manager Version Discrepancy (pnpm 9 vs 11) | `package.json` |
| **P3-B** | P3 | OPEN | Divergent MCP In-Memory Store vs Authoritative Project Store | `lib/mcp/server.ts:264` |

---

## 24. Detailed Finding Reports (P0 & P1)

### Finding P0-A
- **ID:** P0-A
- **Severity:** P0
- **Status:** OPEN
- **Title:** Supabase Database-Level Cross-Tenant Data Leak via Permissive RLS
- **Evidence:** Live REST API test against Supabase: User B using their own JWT queried `GET /rest/v1/projects?id=eq.<UserA_Id>`, updated `PATCH /rest/v1/projects?id=eq.<UserA_Id>`, and deleted `DELETE /rest/v1/projects?id=eq.<UserA_Id>`. All returned HTTP 200 with 1 row affected.
- **Affected Files:** Supabase PostgreSQL database schema (table `public.projects`).
- **Why It Matters:** Any user who signs up can steal, overwrite, or delete every other user's project files and data by sending requests directly to Supabase REST.
- **Reproduction:** Create two users via admin API, sign in to get tokens A and B. Insert project with token A. Perform GET, PATCH, and DELETE using token B.
- **Expected Behavior:** Database returns HTTP 200 with 0 rows or 403 Forbidden.
- **Actual Behavior:** Database executes SELECT, UPDATE, and DELETE across tenant boundaries.
- **Recommended Architecture:** Implement strict Row Level Security policies at PostgreSQL level:
  `CREATE POLICY "Users can only manage their own projects" ON public.projects FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);`
- **Required Fix:** Apply PostgreSQL migration enabling RLS and binding permissions to `auth.uid()`.
- **Verification Test:** Automated multi-tenant REST isolation script.

---

### Finding P0-B
- **ID:** P0-B
- **Severity:** P0
- **Status:** OPEN
- **Title:** Preview Error Auto-Fix Directly Bypasses Candidate Validation Pipeline
- **Evidence:** `components/builder/preview-pane.tsx` lines 110–121:
  `const result = executeToolCalls(files, toolCalls); setFiles(result.updatedFiles);`
  `setFiles({ ...files, ...fixedFiles });`
- **Affected Files:** `components/builder/preview-pane.tsx`
- **Why It Matters:** When a user clicks "Auto-Fix" on preview errors, the AI output is committed directly into the project state without secret scanning, framework contract validation, or candidate gating. A compromised or hallucinating model can inject credentials or corrupt project structure.
- **Reproduction:** Trigger an auto-fix with a prompt that outputs a hardcoded API key or invalid layout. The invalid file is committed to state.
- **Expected Behavior:** Auto-fix candidate must pass through `evaluateCandidateChanges` before calling `setFiles`.
- **Actual Behavior:** Directly calls `setFiles`.
- **Recommended Architecture:** Route all preview auto-fixes through `evaluateCandidateChanges`.
- **Required Fix:** Wrap `setFiles` in `evaluateCandidateChanges` in `handleAutoFix`.
- **Verification Test:** Unit test asserting that preview auto-fix rejects candidate with secret key.

---

### Finding P0-C
- **ID:** P0-C
- **Severity:** P0
- **Status:** OPEN
- **Title:** Monaco Editor Inline AI Edit Directly Bypasses Candidate Validation
- **Evidence:** `components/builder/code-editor.tsx` lines 182–188:
  `updateFile(activeFile, file.content);`
- **Affected Files:** `components/builder/code-editor.tsx`
- **Why It Matters:** Inline AI edits inside Monaco do not invoke the candidate pipeline. An AI response containing a leaked secret or invalid syntax is written directly into the project store.
- **Reproduction:** Open inline AI edit in Monaco, ask AI to add code containing a secret key or removing layout.tsx. Code is immediately applied.
- **Expected Behavior:** Candidate diff must be evaluated by `evaluateCandidateChanges`.
- **Actual Behavior:** Directly calls `updateFile`.
- **Recommended Architecture:** Construct candidate workspace and run `evaluateCandidateChanges` before applying inline AI edits.
- **Required Fix:** Add validation check in `handleAiEdit`.
- **Verification Test:** Unit test testing inline editor AI generation against secret injection.

---

### Finding P0-D
- **ID:** P0-D
- **Severity:** P0
- **Status:** OPEN
- **Title:** Unauthenticated & Unchecked MCP Tool Access with Wildcard CORS
- **Evidence:** `app/api/mcp/route.ts` lines 14 & 46–57, and `lib/mcp/server.ts` line 236.
  `Access-Control-Allow-Origin: *` is returned for all non-local origins.
  Authentication is optional; unauthenticated requests are executed with `context: undefined`.
  `resolveProjectExplicit` has no check comparing `context.userId` with `project.owner_id`.
- **Affected Files:** `app/api/mcp/route.ts`, `lib/mcp/server.ts`
- **Why It Matters:** Any malicious website in a user's browser can make cross-origin JSON-RPC requests to `/api/mcp` and read, modify, or delete project files without authentication.
- **Reproduction:** Send `curl -X POST /api/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_file","arguments":{"projectId":"demo-saas","path":"package.json"}}}'` with no headers. Returns file contents.
- **Expected Behavior:** Requires valid Bearer token and verifies project ownership; restricts CORS.
- **Actual Behavior:** Executes unauthenticated with wildcard CORS.
- **Recommended Architecture:** Mandate Bearer auth for all mutation and read tools; restrict CORS to trusted origins; enforce `verifyProjectOwnership` inside `resolveProjectExplicit`.
- **Required Fix:** Add auth gate and ownership check to `/api/mcp`.
- **Verification Test:** Integration test verifying unauthenticated MCP calls receive 401 and wrong-user calls receive 403.

---

### Finding P1-A
- **ID:** P1-A
- **Severity:** P1
- **Status:** OPEN
- **Title:** Premature Authoritative State Commit Before Virtual Build Verification
- **Evidence:** `components/builder/chat-panel.tsx` line 515 (`setFiles(verifiedFiles)`) executes *before* line 537 (`bundleProjectWithEsbuild(verifiedFiles)`).
- **Affected Files:** `components/builder/chat-panel.tsx`
- **Why It Matters:** If virtual build verification detects compilation errors and autonomous healing fails, the broken files are already committed to the authoritative store. The project is left in a broken state without rollback.
- **Reproduction:** Generate code that passes framework contract but contains a syntax error. Observe that state is updated to the broken files before compilation check runs.
- **Expected Behavior:** Files should be committed to authoritative state only after both candidate validation and compilation checks succeed.
- **Actual Behavior:** Files are committed before compilation check; heal failure leaves broken files in store.
- **Recommended Architecture:** Stage changes in a candidate buffer; only call `setFiles` once all build verification checks pass.
- **Required Fix:** Move `setFiles` below compilation verification and auto-heal.
- **Verification Test:** Test asserting state remains unchanged when virtual compilation fails.

---

### Finding P1-B
- **ID:** P1-B
- **Severity:** P1
- **Status:** OPEN
- **Title:** Absence of Server-Side Generated Project Build Pipeline
- **Evidence:** Source code analysis of `app/api/` and `lib/` reveals no backend runner to build generated projects. Local test of `@vercel/sandbox` fails with `Could not get credentials from OIDC context`. `vite` and `astro` are not installed in the repository.
- **Affected Files:** Server architecture (`app/api/sandbox/route.ts`).
- **Why It Matters:** The system cannot independently prove that a generated project can build with its native framework compiler. It relies on in-browser approximations.
- **Reproduction:** Attempt to trigger `framework_runtime` build via `/api/sandbox`. Request fails due to missing credentials.
- **Expected Behavior:** Server-side build worker builds and smoke-tests generated projects.
- **Actual Behavior:** No build worker exists; Vercel sandbox fails without credentials.
- **Recommended Architecture:** Dedicated build runner service or container sandbox with configured credentials.
- **Required Fix:** Configure real sandbox credentials or implement local containerized build runner.
- **Verification Test:** E2E test verifying `pnpm build` on generated project output.

---

### Finding P1-C
- **ID:** P1-C
- **Severity:** P1
- **Status:** OPEN
- **Title:** In-Browser Visual Preview Hides Framework Build Failures
- **Evidence:** `components/preview/instant-preview.tsx` lines 56–58:
  `catch { // esbuild failed - Babel fallback already showing, no action needed }`.
- **Affected Files:** `components/preview/instant-preview.tsx`, `lib/preview/instant-preview-html.ts`
- **Why It Matters:** Visual preview success can coexist with total framework build failure. Users are led to believe their Next.js App Router project is working when it cannot compile with `next build`.
- **Reproduction:** Create a Next.js project with invalid server component imports. Preview renders in Babel iframe; native build fails.
- **Expected Behavior:** Visual preview reflects framework build status or warns user when preview is purely an unverified DOM approximation.
- **Actual Behavior:** Babel fallback silently renders without indicating framework build failure.
- **Recommended Architecture:** Display clear visual badge distinguishing "Simulated DOM Preview" from "Verified Framework Runtime".
- **Required Fix:** Expose compilation failure banners in preview pane.
- **Verification Test:** Test verifying preview banner displays when esbuild fails.

---

### Finding P1-D
- **ID:** P1-D
- **Severity:** P1
- **Status:** OPEN
- **Title:** Missing Project-Level Requirements / Specification Document
- **Evidence:** Inspection of `lib/store/project-store.ts` and `lib/storage/project-authority.ts` confirms zero fields or documents for persisting project specifications or requirements.
- **Affected Files:** `lib/store/project-store.ts`, `app/builder/page.tsx`
- **Why It Matters:** Without a persistent requirements specification, incremental edits suffer from prompt drift and feature regressions. The AI has no authoritative contract defining pages, routes, data model, or acceptance criteria.
- **Reproduction:** Inspect state after project generation; observe no `requirements.md` or specification object is created.
- **Expected Behavior:** Builder generates and stores an authoritative project specification document.
- **Actual Behavior:** No requirements artifact is created or persisted.
- **Recommended Architecture:** Implement `project.requirements.md` or `projectSpec` stored in project authority.
- **Required Fix:** Add requirements synthesis phase before code generation.
- **Verification Test:** Test asserting new project contains persistent requirements artifact.

---

## 25. Exact Commands Executed & Evidence Summary

| Command | Working Directory | Exit Code | Purpose |
|---|---|---|---|
| `git rev-parse HEAD; git branch --show-current; git status --short` | `opendorkweb` | 0 | Baseline verification |
| `git branch -r -v; git ls-remote origin refs/heads/main` | `opendorkweb` | 0 | Remote commit verification |
| `node -v; pnpm -v` | `opendorkweb` | 0 | Environment versions |
| `node -e "...check package.json and .env.local..."` | `opendorkweb` | 0 | Dependencies and secrets check |
| `node ./node_modules/eslint/bin/eslint.js app components lib` | `opendorkweb` | 0 | Linting check (0 errors, 12 warnings) |
| `node -r ./test/test-register.js --test test/*.test.ts` | `opendorkweb` | 0 | Unit test execution (30/30 passed) |
| `node ./node_modules/next/dist/bin/next build` | `opendorkweb` | 0 | Builder application build (BUILD EXIT 0) |
| `node -e "...auditSupabaseRLS..."` | `opendorkweb` | 0 | Live Supabase RLS multi-tenant attack test |
| `node -e "...testSandboxRoute / Sandbox.getOrCreate..."` | `opendorkweb` | 0 | Vercel Sandbox credential test |
| `node -e "...Node server HTTP smoke test..."` | `opendorkweb` | 0 | Node runtime and HTTP smoke test |
| `node -e "...Next.js fixture build..."` | `opendorkweb` | null | Next.js generated project build test |
| `node -e "...search dangerous sinks..."` | `opendorkweb` | 0 | Static security search |

---

## 26. Remaining Blockers for Production

1. **Fix Supabase RLS:** Apply PostgreSQL Row Level Security policy binding `public.projects` access to `auth.uid() = user_id`.
2. **Seal Preview Auto-Fix Bypass:** Enforce `evaluateCandidateChanges` in `components/builder/preview-pane.tsx`.
3. **Seal Inline Editor AI Bypass:** Enforce `evaluateCandidateChanges` in `components/builder/code-editor.tsx`.
4. **Enforce MCP Auth & Ownership:** Restrict CORS, require Bearer token, and enforce `verifyProjectOwnership` on all MCP tool calls in `/api/mcp`.
5. **Implement Transactional State Commit:** Move `setFiles` in `chat-panel.tsx` to execute only after virtual compilation succeeds, with full rollback on failure.
6. **Deploy Server Build Worker / Configure Sandbox:** Provide real credentials or containerized worker to compile and smoke-test generated projects.
7. **Synthesize & Persist Requirements:** Create project-level specification document persisted in project authority.

---

## 27. Final Principle

A web builder cannot be certified as production-ready merely because the builder UI runs and passes static file shape checks. Production readiness requires proven, end-to-end transformation from requirements into real, isolated, securely stored, verifiable, and executable framework applications.

As established by this adversarial audit, critical security bypasses and runtime gaps remain open.

**FINAL AUDIT VERDICT: NOT PRODUCTION READY**
