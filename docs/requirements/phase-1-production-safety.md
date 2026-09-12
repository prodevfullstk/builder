# Phase 1 Specification: Production Safety Foundation

**Status:** Authoritative Specification  
**Scope:** `prodevfullstk/builder` repository (`opendorkweb`)  
**Target:** Phase 1 Production-Safety Engineering Foundation  

---

## 1. Objectives

1. Eliminate insecure fallback authentication and separate real authenticated identities from demo modes.
2. Establish server-side authorization so identity and permissions are verified by the server rather than trusted from client payloads.
3. Enforce deterministic project ownership: every cloud/persisted project belongs to exactly one authenticated owner; no operations allow cross-user access or "first project" fallbacks.
4. Replace immediate-commit AI code generation with an atomic Candidate → Validate → Commit pipeline.
5. Deterministically validate generated code against requested framework contracts (Next.js, Vite, Astro, Node) before acceptance.
6. Generate and persist machine-readable validation evidence for every accepted state change.
7. Ensure truthful sandbox reporting: differentiate instant/visual static preview from true containerized framework runtimes.
8. Remove invisible package/dependency mutations during sandbox execution.
9. Eliminate long-lived GitHub PAT storage in browser persistence and eliminate unconditional force-pushes in GitHub branch synchronization.
10. Ensure zero critical errors are swallowed or converted into false successes.

---

## 2. Current Problems Being Fixed

1. **Fake Auth Fallbacks:** When real Supabase authentication failed or was pending OTP verification, the client automatically called `loginAsDemo()` and marked the user as authenticated. Real errors were swallowed and converted into mock logins.
2. **Untrusted Client Identity:** Endpoints and database operations trusted client-supplied `user_id` and client Zustand state without validating cryptographic JWT sessions on the server.
3. **Implicit Project Selection:** Missing `projectId` in API routes (such as `/api/sandbox` and `/api/mcp`) defaulted to `"default"` or grabbed the first project in memory (`memoryProjects.values().next().value`), leading to data corruption and cross-project pollution.
4. **No Ownership Boundary:** No server-side check verified whether the user performing an action owned the project being modified or accessed.
5. **Direct Unvalidated Mutation:** Streaming AI generation directly overwrote project files in Zustand store without prior compilation or contract validation. If code was broken, the previous working state was destroyed.
6. **No Framework Contract Validation:** A prompt requesting Next.js could generate a Vite project, and the system accepted it without structural verification.
7. **Dishonest Sandbox Status:** The sandbox reported `status: 'ready'` simply because a static Node HTTP server served pre-bundled HTML, misleading users into believing server components, route handlers, and real Next.js runtimes functioned.
8. **Invisible Package Mutation:** `nodebox-adapter.ts` silently rewrote `package.json` dependencies and version pins without logging or notifying the user.
9. **Insecure PAT Storage & Force Push:** GitHub Personal Access Tokens were saved in plaintext `localStorage`, exposing them to XSS and token leaks. Pushes used `force: true`, silently overwriting remote branches.
10. **Swallowed Errors:** Network and compilation failures used `catch { console.warn(...) }` and returned fake success metrics (e.g. `syncedCount: localProjects.length`).
11. **ESLint/Next.js Build Incompatibility:** Missing ESLint configuration caused `next lint` and `next build` to stall on interactive prompts in CI/headless environments.

---

## 3. Architectural Decisions

### 3.1 Authentication Architecture
* **Distinct Auth Modes:** Auth state is strongly typed with `authMode: "real" | "demo"`.
* **No Silent Demotions:** When Supabase is configured, OAuth failures or in-flight OTP flows remain in their actual error or pending state. `loginAsDemo` is strictly an explicit user action.
* **Session Management:** Real authentication produces and retains a Supabase session token (`access_token`) used in all authenticated server communication via `Authorization: Bearer <token>`.

### 3.2 Server-Side Authorization (`lib/auth/server-auth.ts`)
* A single reusable server authorization utility validates the session token against Supabase Auth.
* Protected server endpoints (`/api/sandbox`, `/api/mcp`, cloud storage) invoke `authenticateRequest(req)`.
* Operations reject missing tokens, invalid tokens, and demo identities for production cloud operations.
* Identity is derived from the verified token, never from `body.user_id`.

### 3.3 Authoritative Project Hierarchy
The system establishes a single authoritative flow:
```text
Authoritative Project Identity (Owner + Project ID)
          ↓
  Authoritative Workspace
          ↓
  Candidate File Changes (AI / User)
          ↓
  Deterministic Validation Pipeline
          ↓
  Decision: ACCEPT or REJECT
          ↓
  Commit to Authoritative Workspace & Storage
          ↓
  Runtime / Export Execution
```
* MCP, sandbox, and persistence layers must reference explicit `projectId` values.
* If `projectId` is missing for an operation that requires an existing project, return a 400 validation error.
* Supabase database storage is authoritative for cloud projects. Local browser storage is a working cache for offline/demo operation.

### 3.4 Atomic Candidate Pipeline (`lib/validation/candidate-pipeline.ts`)
* Streaming AI edits are treated as a **candidate**.
* A candidate is isolated in memory / preview buffer.
* Candidate is evaluated against:
  1. Framework contract rules (`framework-validator.ts`)
  2. File structure & required manifests (`package.json`, entry points)
  3. Secret detection (no leaked API keys or credentials)
  4. Build/type validation where available
* If validation succeeds: ACCEPT → commit candidate files into authoritative project state.
* If validation fails: REJECT → previous known-good project is untouched; failure diagnostics are surfaced to UI and passed to auto-fix.

### 3.5 Truthful Sandbox Architecture
* Sandbox status lifecycle is explicitly separated:
  - `created`
  - `installing`
  - `building`
  - `build_failed`
  - `starting`
  - `runtime_ready`
  - `runtime_failed`
  - `stopped`
* Instant preview is labeled `visual_preview` (static DOM approximation), clearly distinct from `framework_runtime` (true microVM execution of Next.js/Vite/Node).

### 3.6 Dependency Integrity
* Generated `package.json` manifests are not silently modified.
* If runtime normalization is required, it must be recorded in an explicit normalization descriptor, separating source files from runtime execution files.

### 3.7 GitHub Security & Non-Force Sync
* GitHub PAT is held in memory during the user's active session only.
* PAT is never written to `localStorage` or `sessionStorage`. Any legacy stored PAT is purged on startup.
* Git Tree pushes perform a remote ref check comparing the current remote SHA to expected base SHA, setting `force: false`. If the remote has diverged, a conflict is returned.

---

## 4. Security Requirements

1. **Token Protection:** No tokens (Supabase, GitHub PAT, Gemini, Groq) may be leaked to client storage, included in AI prompts, or exposed in validation evidence records.
2. **Server Identity Derivation:** No endpoint may authenticate or authorize an operation based on `body.user_id` or query parameters. Identity must come from verified `Bearer` tokens.
3. **Demo Isolation:** Demo identities cannot create, mutate, or access cloud-persisted projects or trigger cloud sandbox resources.
4. **CORS Hardening:** MCP endpoints must validate requests and restrict access rather than exposing unrestricted write tools to arbitrary origins.

---

## 5. Project Ownership Requirements

1. Every project record has `id` and `owner_id`.
2. For all CRUD, sync, export, and sandbox actions:
   - Server verifies `authenticatedUser.id === project.owner_id`.
   - Access by any other user yields 403 Forbidden.
   - Missing `projectId` yields 400 Bad Request.
   - Non-existent project yields 404 Not Found.
3. No fallback to `"default"` or `"first project"`.

---

## 6. Validation Requirements

### 6.1 Framework Contracts
* **Next.js:**
  - `package.json` contains `next` dependency.
  - Contains `app/` or `pages/` directory structure.
  - Does NOT contain incompatible standalone Vite setup (e.g. `vite.config.ts`, `src/main.tsx` without Next.js).
* **Vite React:**
  - `package.json` contains `vite` and `react`.
  - Expected Vite entry structure (`index.html` + `src/main.tsx` or `src/App.tsx`).
* **Astro:**
  - `package.json` contains `astro`.
  - Expected Astro structure (`src/pages/` or `astro.config.*`).
* **Node Backend:**
  - `package.json` contains node configuration.
  - Recognized backend entry point exists (`server.js`, `index.js`, `app.js`).

### 6.2 Validation Evidence
Every validation event outputs a machine-readable `ValidationEvidence` record:
```ts
interface ValidationEvidence {
  validationId: string;
  projectId: string;
  timestamp: string;
  framework: string;
  checks: Array<{
    name: string;
    status: "passed" | "failed" | "skipped";
    message?: string;
  }>;
  accepted: boolean;
  diagnostics: string[];
}
```

---

## 7. Sandbox Requirements

1. Status must truthfully reflect VM state.
2. Do not emit `runtime_ready` for static HTML preview.
3. Attempt real build steps (`npm install`, `build`, `start`) when `framework_runtime` is requested.
4. Record skipped steps with explicit reasons.

---

## 8. Explicit Non-Goals

1. Redesigning or rewriting UI components (Monaco editor, builder header, chat bubble styling).
2. Changing the application framework of the builder itself (stays Next.js 15 App Router).
3. Replacing Gemini AI model interfaces or altering the prompt templates.
4. Introducing multi-tenant collaborative real-time editing (CRDT/OT).
5. Adding unrequested cloud hosting providers.

---

## 9. Acceptance Criteria

* [x] Specification document exists at `docs/requirements/phase-1-production-safety.md`.
* [x] Auth store distinguishes `authMode: "real" | "demo"`.
* [x] OTP requests do not authenticate the user prior to verification.
* [x] Failed Supabase authentication does not silently log in as demo.
* [x] Server authorization utility enforces valid Supabase session and rejects demo identities for cloud operations.
* [x] Project ownership enforced server-side; missing `projectId` rejected with 400; no "first project" fallback.
* [x] AI edits go through atomic Candidate → Validate → Commit flow.
* [x] Framework compliance verified deterministically; hybrid/mismatched projects rejected.
* [x] Machine-readable validation evidence produced for candidate evaluations.
* [x] Sandbox status truthfully distinguishes `visual_preview` from `framework_runtime`.
* [x] Invisible package mutations removed from `nodebox-adapter.ts`.
* [x] GitHub PAT removed from `localStorage` and existing legacy tokens purged.
* [x] GitHub push uses `force: false` and detects branch conflicts.
* [x] Automated tests cover all P0 behavior.
* [x] `pnpm install --frozen-lockfile` passes.
* [x] ESLint configuration provided so `pnpm lint` and `pnpm build` pass cleanly.
* [x] Comprehensive audit verification report generated at `docs/audits/phase-1-verification.md`.
