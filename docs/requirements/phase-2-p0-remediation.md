# Phase 2 — P0 Security and Generation Integrity Remediation Specification

**Document Version:** 1.0.0  
**Author:** Antigravity Engineering  
**Status:** Authoritative Specification  
**Created:** 2026-09-13  
**Target Repository:** `opendorkweb`  
**Base Commit:** `585dbf905f6ea723d9c2f2e44b056e5e7c46a0ba`  
**Related Audit:** `docs/audits/audit-4-report.md`  

---

## 1. Executive Summary & Mission

Audit #4 identified four critical P0 security and tenant isolation vulnerabilities, four high-risk P1 architectural defects, and multiple verification gaps in the generated-project lifecycle.

This specification serves as the binding requirements document for **Phase 2 Remediation**. The mission is to eliminate all P0 vulnerabilities and high-risk P1 gaps without redesigning the application, changing the core tech stack, or adding unrelated features. Every code change must trace directly to a requirement in this document.

---

## 2. Audit #4 Finding Traceability Matrix

| Finding ID | Severity | Description | Target Remediation Layer |
|---|---|---|---|
| **P0-A** | P0 | Supabase Database-Level Cross-Tenant Data Leak via Permissive RLS | PostgreSQL Migration & Schema Validation |
| **P0-B** | P0 | Preview Error Auto-Fix Directly Bypasses Candidate Validation Pipeline | `components/builder/preview-pane.tsx` |
| **P0-C** | P0 | Monaco Editor Inline AI Edit Directly Bypasses Candidate Validation | `components/builder/code-editor.tsx` |
| **P0-D** | P0 | Unauthenticated & Unchecked MCP Tool Access with Wildcard CORS | `app/api/mcp/route.ts`, `lib/mcp/server.ts` |
| **P1-A** | P1 | Premature Authoritative State Commit Before Virtual Build Verification | `components/builder/chat-panel.tsx` |
| **P1-B** | P1 | Absence of Real Generated-Project Build Verification Runner | `lib/build/build-runner.ts` (New Abstraction) |
| **P1-C** | P1 | In-Browser Visual Preview Hides Framework Build Failures | `components/preview/instant-preview.tsx`, Status Badging |
| **P1-D** | P1 | Missing Project-Level Requirements / Specification Document | `lib/store/project-store.ts`, `lib/ai/requirements-generator.ts` |
| **P2-A** | P2 | Framework Version Discrepancies and Inability to Pin Requested Versions | `lib/validation/framework-version.ts`, `project-store.ts` |
| **P2-C** | P2 | Ephemeral and Unpersisted Validation Evidence | `lib/validation/candidate-pipeline.ts`, `project-authority.ts` |

---

## 3. Architecture & Target Flow

All AI-generated or system-generated modifications must pass through a single, strictly transactional candidate pipeline. No caller may directly mutate the authoritative project state without passing the boundary.

```text
[User Request / Prompt]
          │
          ▼
[Requirements Synthesis] (If initial or complex) ──> Persists projectSpec & requirements.md
          │
          ▼
[AI Model / Agent Execution] (Returns candidate code / tools)
          │
          ▼
[Single Candidate Boundary: evaluateCandidateChanges()]
  ├─ 1. Deterministic Secret Leak Scan (regex / credentials)
  ├─ 2. Framework Contract Validation (required files / structure)
  ├─ 3. Framework Contamination Scan (cross-framework conflicts)
  ├─ 4. Non-empty workspace check
          │
          ├─► REJECTED: Authoritative project untouched!
          │
          ▼ ACCEPTED
[Virtual / Native Build Verification (Pre-Commit!)]
  ├─ In-Browser / Runner compilation check
  ├─ Failure triggers single Auto-Heal attempt
  │    └─► Healed diff passes through evaluateCandidateChanges() again!
  ├─ If Heal Fails: Authoritative project preserved untouched byte-for-byte!
          │
          ▼ ALL CHECKS PASSED
[Single Authoritative Commit: commitCandidate()]
  ├─ Updates Zustand store (Browser memory)
  ├─ Updates AuthoritativeProject (Server registry)
  ├─ Persists ValidationEvidence (Historical audit trail)
  └─ Updates local/cloud persistence
```

---

## 4. Security Requirements

### SEC-01: Supabase Database-Level Row Level Security (RLS) [P0-A]
1. `public.projects` must have Row Level Security enabled (`ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;`).
2. Drop all existing permissive or open policies (`USING (true)` or `WITH CHECK (true)`).
3. The ownership column in `public.projects` must be explicitly identified (audit shows `user_id uuid`).
4. Strict policies must be applied for `authenticated` role:
   - `SELECT`: `USING (auth.uid() = user_id)`
   - `INSERT`: `WITH CHECK (auth.uid() = user_id)`
   - `UPDATE`: `USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`
   - `DELETE`: `USING (auth.uid() = user_id)`
5. Anonymous access (`anon` role) must be denied all CRUD operations on `public.projects`.
6. An adversary holding User B's JWT must be unable to SELECT, UPDATE, or DELETE User A's rows via Supabase REST API, returning 0 affected rows.

### SEC-02: MCP Endpoint Authentication & Authorization [P0-D]
1. `/api/mcp` must require valid authentication for all project-sensitive tools (`list_projects`, `get_project`, `create_project`, `list_files`, `get_file`, `write_file`, `edit_file`, `delete_file`, `audit_code`).
2. Unauthenticated requests to project tools must be rejected with HTTP 401.
3. Every tool operating on a project must require `projectId`. Missing `projectId` must return HTTP 400.
4. Server-side ownership verification must be enforced: `context.userId` must match `project.owner_id`. Unauthorized access attempts must return HTTP 403.
5. Non-existent projects must return HTTP 404.
6. Demo mode users must be strictly isolated to demo/local workspaces and prohibited from reading or mutating cloud-stored projects.
7. Wildcard CORS (`Access-Control-Allow-Origin: *`) must be removed from `/api/mcp`. CORS must restrict origins to trusted local or configured domains.
8. Mutation tools (`write_file`, `edit_file`, `delete_file`) must return a staged diff only (`candidateDiff`) and must NOT commit to authoritative server registries or database directly.

### SEC-03: Preview Auto-Fix Mutation Sealing [P0-B]
1. In `components/builder/preview-pane.tsx`, remove all direct `setFiles(result.updatedFiles)` and `setFiles({ ...files, ...fixedFiles })` calls.
2. AI-generated fixes must be assembled into a candidate workspace and passed to `evaluateCandidateChanges()`.
3. If candidate validation fails (e.g. secret leak or framework break), the candidate must be rejected and the existing files preserved untouched.
4. Only upon successful evaluation and compilation verification may files be committed.

### SEC-04: Monaco Editor AI Mutation Sealing [P0-C]
1. In `components/builder/code-editor.tsx`, `handleAiEdit` must not write directly to state via `updateFile`.
2. AI-generated file changes must be validated through `evaluateCandidateChanges()`.
3. Manual human typing in Monaco remains direct for developer responsiveness, but all AI-generated patches must pass the validation boundary.

---

## 5. Generation & Execution Integrity Requirements

### GEN-01: Transactional Candidate Commit [P1-A]
1. In `components/builder/chat-panel.tsx`, files must NOT be committed to authoritative state (`setFiles`) prior to virtual build verification.
2. The lifecycle must follow: Current State -> Candidate State -> Static Validation -> Virtual Compilation -> Auto-Heal (if needed) -> Single Commit.
3. If virtual compilation fails and auto-heal cannot resolve it, the candidate must be rejected, and the previous workspace must remain preserved byte-for-byte.
4. No partial or corrupt state may be committed.

### GEN-02: Real Generated-Project Build Runner Abstraction [P1-B]
1. Implement a unified build runner interface `BuildRunner`:
   ```typescript
   export interface BuildRunner {
     name: string;
     prepare(candidate: CandidateProject): Promise<void>;
     install(candidate: CandidateProject): Promise<BuildStepResult>;
     build(candidate: CandidateProject): Promise<BuildStepResult>;
     start(candidate: CandidateProject): Promise<BuildStepResult>;
     httpSmokeTest(candidate: CandidateProject, port: number): Promise<SmokeTestResult>;
     cleanup(candidate: CandidateProject): Promise<void>;
   }
   ```
2. Supported framework matrix: Next.js, Vite React, Astro, Node.js.
3. Implement `LocalBuildRunner` and `VercelSandboxRunner`.
4. If an external runner (e.g. Vercel Sandbox) lacks credentials, the system must report `runner: 'vercel_sandbox'`, `status: 'unavailable'` with exact reasons, and never falsely report native framework verification.

### GEN-03: Truthful Preview Status & Visibility [P1-C]
1. InstantPreview must be explicitly labeled as an in-browser visual approximation (`Visual Preview (Simulated DOM)`).
2. Remove silent fallback suppression in `InstantPreview`.
3. Expose truthful lifecycle states:
   - `Visual Preview (Babel DOM)`
   - `Virtual Compilation (esbuild)`
   - `Native Framework Build Verified`
   - `Runtime Smoke Tested`
   - `Build Verification Failed`
   - `Build Verification Unavailable`
4. If framework build verification fails or is unavailable, the UI must clearly display this state and not mark the project "Application ready".

### GEN-04: Persistent Project Requirements Specification [P1-D]
1. Define a persistent `ProjectSpec` schema:
   ```typescript
   export interface ProjectSpec {
     version: string;
     sourcePrompt: string;
     requirementsMarkdown: string;
     pages: string[];
     routes: string[];
     dataModel: Record<string, any>;
     acceptanceCriteria: string[];
     constraints: string[];
     framework: Framework;
     frameworkVersion: string;
     createdAt: number;
     updatedAt: number;
   }
   ```
2. Synthesize and persist a `requirements.md` file in the project workspace on initial project creation.
3. Subsequent chat generation and visual editing prompts must receive relevant requirements context from the persisted spec.
4. The timeline step "Analyzed requirements" must be backed by the generated `requirements.md` artifact.

### GEN-05: Framework Version Determinism [P2-A]
1. Track requested framework, requested framework version, and resolved framework version in `ProjectState` and `AuthoritativeProject`.
2. Generated `package.json` must avoid uncontrolled floating versions when exact requirements are specified.
3. Nodebox dependency normalization must never mutate the source project files.

### GEN-06: Persisted Validation Evidence [P2-C]
1. `ValidationEvidence` must include `validationId`, `projectId`, `timestamp`, `framework`, `requestedVersion`, `resolvedVersion`, `checks`, `accepted`, `diagnostics`, `buildResult`, `runtimeResult`, `runner`.
2. Evidence must be stored in `serverProjectRegistry` / `ProjectState` history to provide an auditable log of why candidates were accepted or rejected.

---

## 6. Acceptance Criteria

- **AC-01 (Supabase RLS):** Live multi-tenant test proves User B cannot SELECT, UPDATE, or DELETE User A's project (0 rows affected). User A retains full access.
- **AC-02 (MCP Auth & Ownership):** Unauthenticated calls to `/api/mcp` for project tools return 401. Wrong owner returns 403. Missing project ID returns 400.
- **AC-03 (Preview Auto-Fix Gating):** Injecting an invalid secret or broken framework structure into preview auto-fix is rejected by `evaluateCandidateChanges` without mutating state.
- **AC-04 (Monaco AI Edit Gating):** Injecting an invalid secret or broken framework structure into inline AI edit is rejected by `evaluateCandidateChanges` without mutating state.
- **AC-05 (Transactional Rollback):** A compilation error during generation that fails auto-heal preserves the pre-prompt project state byte-for-byte.
- **AC-06 (Truthful Preview):** Preview displays explicit badging distinguishing simulated DOM preview from verified native builds.
- **AC-07 (Requirements Persistence):** New projects generate and store `requirements.md` and `projectSpec`.
- **AC-08 (Build & Test Cleanliness):** `pnpm lint` exit 0, `pnpm build` exit 0, all unit and regression tests pass.

---

## 7. Explicit Non-Goals

1. **No UI Redesign:** Do not alter the aesthetic or theme of the builder workspace.
2. **No Framework Replacement:** Do not replace Next.js App Router as the core builder application framework.
3. **No Unrelated Feature Additions:** Focus strictly on security, authorization, transactionality, and generation integrity.
4. **No Disabling of Demo Mode:** Demo mode must remain supported as an isolated sandbox experience.
5. **No Removal of InstantPreview:** InstantPreview remains valuable for fast client feedback, but must be truthfully labeled.

