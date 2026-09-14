# Antigravity Phase AI Correctness — Production-Hardening Requirements Specification

**Document Version:** 1.0.0  
**Status:** AUTHORITATIVE (Source of Truth for AI Generation, Verification & Commit)  
**Date:** September 14, 2026  
**Auditor Baseline:** Audit #10 (`docs/audits/audit-10-report.md`)  
**Base Git Commit:** `39c64b8849b29dbba53c45fe1a8a27d2c38827fa`  
**Target Application:** `opendorkweb` Website Builder (`https://github.com/prodevfullstk/builder`)  

---

## 1. Executive Summary & Problem Statement

Prior phases of `opendorkweb` hardened infrastructure isolation, remote microVM execution (`@vercel/sandbox`), cryptographic candidate hash binding, and monotonic database Compare-And-Swap (CAS) concurrency. However, AI code generation and mutation still exhibit critical correctness vulnerabilities:

1. **Heuristic & Language-Biased Intent Detection:** Semantic routing previously relied on language-specific heuristics and keywords rather than a validated, generic intent contract.
2. **Blind Workspace Context / Active File Dependency:** Mutations relied heavily on the active file or arbitrary file truncation, lacking deterministic workspace discovery and dependency tracing.
3. **Unstructured String-Replacement & Whole-File Regeneration:** Incremental modifications risk silent regressions, scope creep, and unintended feature deletion.
4. **Weak Acceptance Verification:** AI output saying "done" or passing static syntax checks was treated as proof of success, without machine-readable behavioral or visual validation.
5. **Transport & Parser Fragility:** Arbitrary model prose mixed with markdown code fences led to unclosed fence ambiguities, silent malformed repairs, or synthetic filenames (`generated/file_N.ext`).

This specification establishes the end-to-end production standard:
$$\text{Prompt} \longrightarrow \text{Intent} \longrightarrow \text{Retrieval} \longrightarrow \text{Plan} \longrightarrow \text{Candidate} \longrightarrow \text{Static Validation} \longrightarrow \text{Native Build} \longrightarrow \text{Runtime / Behavioral / Visual Verification} \longrightarrow \text{Evidence} \longrightarrow \text{CAS Commit}$$

No AI response claiming success is accepted as proof that the requested change occurred. Only verified, machine-readable evidence bound to the exact candidate digest may commit to authoritative storage.

---

## 2. Core Policies & Technical Invariants

### 2.1 Canonical Structured Intent Contract (INTENT-101)
- Every user prompt must be resolved into a strongly typed, server-validated structured `IntentContract`.
- Supported actions:
  - `CREATE_PROJECT`: New project scaffold from natural language specification.
  - `ADD_FEATURE`: Adding an incremental feature/route/component to an existing project.
  - `MODIFY_FEATURE`: Targeted surgical modification to an existing component/behavior.
  - `FIX_BUG`: Targeted bug repair or runtime issue remediation.
  - `REFACTOR`: Structural or code-quality refactoring preserving external behavior.
  - `QUESTION`: Read-only inquiry answering questions about the codebase.
  - `EXPLAIN`: Explaining code or architecture without workspace mutations.
  - `CONTINUE_BUILD`: Multi-step incremental implementation continuation.
  - `VISUAL_RECREATE`: Recreating a website or component from an uploaded image/screenshot.
  - `VISUAL_EDIT`: Targeted visual styling, spacing, or color modification matching image or instructions.
  - `INSPECT`: Codebase inspection, auditing, or diagnostic query.
- The contract must specify: `action`, `language`, `framework`, `frameworkVersion`, `targetDescription`, `targetFiles`, `requirements`, `constraints`, `acceptanceCriteria`, `imageContext`, `confidence`, `clarificationRequired`.
- **Language Generality:** The intent router MUST NOT use hardcoded language-specific vocabulary lists (e.g., Bengali, English keywords) as semantic gates. Natural language must be processed via language-agnostic semantic classification. Heuristics are permitted only as secondary fallback hints.
- Server-side validation MUST strictly validate the intent before authorizing candidate patch generation or mutation.

### 2.2 Project Intelligence & Deterministic Workspace Retrieval (RETRIEVAL-201)
- Edits must never depend solely on the client's currently active file.
- The system must provide deterministic workspace discovery tools:
  - `listFiles(filter?, maxDepth?)`: Enumerate all workspace files with sizes and types.
  - `searchFiles(pattern)`: Glob/regex filename search.
  - `searchText(query, options)`: Content search across files.
  - `findSymbols(symbolName, fileFilter?)`: Component, function, class, and export identification.
  - `inspectFile(path, lineRange?)`: Read exact file contents or ranges.
  - `inspectRelatedFiles(path)`: Discovers imported dependencies, stylesheet bindings, and consumer components.
- Retrieval flow: $\text{Intent} \to \text{Relevant Files} \to \text{Relevant Symbols} \to \text{Surrounding Context} \to \text{Dependencies} \to \text{AI Generation Context}$.
- Retrieval context must be auditable and recorded in candidate evaluation evidence (`retrievalContext`).

### 2.3 Structured Candidate Patches (PATCH-301)
- Mutations must be represented as structured candidate patches rather than indiscriminate whole-file overwrites.
- Supported patch operations:
  - `create_file`: Create new file with content.
  - `modify_file`: Replace entire file content.
  - `delete_file`: Remove existing file.
  - `rename_file`: Move file from old path to new path.
  - `structured_text_replacement`: Replace exact block with target content and before/after verification.
  - `ast_symbol_replace`: Targeted component/symbol replacement.
- Every patch item must declare: `path`, `operation`, `targetDescription`, `beforeHash`, `replacement`, `reason`, `relatedIntentRequirement`.

### 2.4 Minimal Patch Scope Enforcement (SCOPE-401)
- Targeted modifications (e.g., "Make navbar logo 20% smaller") must identify minimal targets (e.g., `Navbar.logo`) and touch ONLY relevant files.
- If additional files are modified, explicit rationale must be recorded.
- Unrelated files and existing project behavior must be preserved.
- Suspicious or extraneous rewrites must be rejected by scope validation.

### 2.5 Canonical Machine-Readable Acceptance Criteria (CRITERIA-501)
- Every mutating request must generate machine-readable acceptance criteria bound to the project specification.
- Supported criterion types:
  - `file_exists`: Verifies file presence in candidate workspace.
  - `symbol_exists`: Verifies export or component declaration.
  - `text_contains`: Verifies regex or substring presence.
  - `route_exists`: Verifies framework route file structure (e.g. Next.js App Router route).
  - `build_passes`: Native compilation exit code 0.
  - `runtime_http`: HTTP status and marker match on local/microVM server.
  - `component_exists`: Verifies component structure and export.
  - `ui_property`: Verifies CSS/DOM/Tailwind styling property delta (e.g., height, width, scale).
  - `responsive_behavior`: Verifies mobile/desktop breakpoint rules.
  - `interaction`: Verifies event handler / state toggles (e.g. menu open/close).
  - `visual_similarity`: Screenshot comparison metric.
  - `security_invariant`: Invariants in `requirements.md` preserved byte-for-byte.
- Candidates cannot be committed merely because static validation succeeds; all declared criteria must evaluate to `passed`.

### 2.6 Baseline-vs-Candidate Delta Verification (DELTA-601)
- For modifications, the system captures a baseline snapshot: `baselineRevision`, `baselineHash`, `changedFiles`, `changedSymbols`.
- The validator evaluates the delta between baseline and candidate against the requested intent.
- Property adjustments (e.g., size $\times 0.8$) must be verified against baseline values.

### 2.7 Multi-Tier Behavioral Verification (BEHAVIOR-701)
- Candidate evaluation execution order:
  $$\text{Static AST / Syntax Validation} \longrightarrow \text{Secret Scan} \longrightarrow \text{Native MicroVM Build} \longrightarrow \text{Runtime Server Boot} \longrightarrow \text{HTTP Smoke Test} \longrightarrow \text{Targeted Behavioral Assertion}$$
- Verification must execute deterministic checks against the candidate. Model prose is never accepted as evidence.

### 2.8 Screenshot / Image Understanding Pipeline & VisualSpec (VISION-801)
- Images are not treated as unparsed attachments.
- A structured `VisualSpec` must be synthesized containing:
  `viewport`, `pageStructure`, `sections`, `components`, `layout`, `alignment`, `colors`, `typography`, `spacing`, `borders`, `radii`, `shadows`, `imagery`, `responsiveBehavior`, `visualTargets`, `confidence`.
- Workflow: $\text{Image} \to \text{Vision Analysis} \to \text{VisualSpec} \to \text{Workspace Target Discovery} \to \text{Plan} \to \text{Patch} \to \text{Native Build} \to \text{Screenshot} \to \text{Visual Verification}$.
- Upload hardening: strict validation of MIME type (`image/png`, `image/jpeg`, `image/webp`, `image/gif`), size limit (max 10MB), dimensions (max 4096px), and malformed binary checks. Canonical `ImageReference` abstraction.

### 2.9 Truthful Visual Verification (VISUAL-901)
- When visual verification is conducted, evidence must capture: `screenshotCaptured`, `viewportUsed`, `targetRegion`, `comparisonStatus`, `visualMismatches`, `verificationConfidence`.
- When visual comparison infrastructure is unavailable, status MUST be explicitly recorded as `VISUAL_VERIFICATION_UNAVAILABLE`.
- The system MUST NEVER claim "matches screenshot" without authentic visual evidence.

### 2.10 Structured Event-Driven Streaming Protocol (STREAM-1001)
- Replace unformatted streaming with strongly typed event streams (SSE / ndjson).
- Canonical events: `message_start`, `intent`, `plan`, `text_delta`, `tool_call`, `file_start`, `file_delta`, `file_complete`, `validation_start`, `validation_result`, `build_start`, `build_result`, `runtime_start`, `runtime_result`, `visual_result`, `commit`, `error`, `done`.
- Resilient stream processing: graceful handling of chunk boundaries, UTF-8 split bytes, provider failures, cancellation, timeouts, and ordering.
- A truncated or aborted stream MUST NOT result in a partial candidate commit.

### 2.11 Strict Parser Correctness (PARSER-1101)
- Parsers must return explicit status: `parsed`, `malformed`, `partial`, `unsupported`.
- Silent repair of invalid JSON into arbitrary file structures is forbidden.
- Synthetic filenames (e.g. `generated/file_N.ext`) are strictly prohibited for targeted modifications.

### 2.12 Provider Fallback Semantic Preservation (PROVIDER-1201)
- When falling back between providers (e.g., Gemini $\to$ Groq):
  - Vision requests must not silently downgrade to text-only without explicit reporting.
  - Pre-existing `VisualSpec` must be preserved.
  - Evidence must record `provider`, `model`, `visionCapability`, and `fallbackReason`.

### 2.13 Central Candidate Pipeline Integration (PIPELINE-1301)
- Direct client `setFiles` calls that bypass the server verification pipeline are strictly blocked for AI mutations.
- Candidates must pass all verification gates before atomic server-side CAS commit.

### 2.14 Server-Side Revision & Optimistic CAS Concurrency (CONC-1401)
- Commits require `expectedRevision === currentRevision`.
- Stale candidates are rejected with HTTP 409 Conflict. Client state is refreshed without overwriting concurrent edits.

### 2.15 Immutable Validation Evidence (EVIDENCE-1501)
- `ValidationEvidence` binds all verification claims: `validationId`, `intentId`, `candidateId`, `baselineRevision`, `expectedRevision`, `baselineHash`, `candidateHash`, `changedFiles`, `changedSymbols`, `acceptanceCriteria`, `acceptanceResults`, `retrievalContext`, `provider`, `model`, `nativeBuild`, `runtimeResult`, `visualResult`, `timestamp`.
- Cryptographic SHA-256 candidate hash binding prevents payload tampering or cross-project replay.

### 2.16 Security Boundary Preservation (SEC-1601)
- No regression of existing security protections:
  - Authentication (Supabase token / demo isolation).
  - Row-Level Security (RLS) & project ownership.
  - MCP authorization checks.
  - Zero host execution in production (`ProductionHostExecutionForbiddenError`).
  - Strict sandbox path containment (`/vercel/app`).
  - Secret leak scanner.
  - Distributed rate limiting (fail-closed).
  - Protected `requirements.md` security invariants.

---

## 3. End-to-End Verification Scenarios

### Scenario A: Natural-Language Creation
- **Prompt:** "Build me a SaaS landing page with navbar, hero, pricing, testimonials and footer."
- **Assertions:** `intent = CREATE_PROJECT`, multi-section requirements extracted, Next.js / React project generated, native build passes, acceptance criteria pass, CAS commit succeeds.

### Scenario B: Targeted Minimal Scope Modification
- **Prompt:** "Make the navbar logo 20% smaller."
- **Assertions:** `intent = MODIFY_FEATURE`, `Navbar` and logo target discovered via retrieval, minimal files modified, unrelated files preserved, logo dimension reduced by 20%, delta validated, CAS commit succeeds.

### Scenario C: Cross-File Incremental Feature
- **Prompt:** "Add a mobile hamburger menu."
- **Assertions:** Cross-file discovery of navbar and layout, mobile toggle added, open/close behavior verified, desktop view preserved, acceptance criteria pass.

### Scenario D: Screenshot Re-creation
- **Prompt:** Image attached + "Recreate this design."
- **Assertions:** Image parsed into structured `VisualSpec`, targets identified, code generated matching visual spec, native build succeeds, runtime screenshot captured or truthfully classified as unavailable, evidence bound.

---

## 4. Certification Criteria

Phase AI Correctness is certified when:
1. `docs/requirements/phase-ai-correctness.md` is authoritative and complete.
2. All canonical intent contracts, retrieval services, structured patch abstractions, acceptance criteria, vision pipelines, and stream protocols are implemented and tested.
3. 100% of all existing tests (87+) pass without regression.
4. Comprehensive test suites for Scenarios A, B, C, D and all negative/adversarial vectors pass cleanly.
5. Production build (`pnpm build`) and lint (`pnpm lint`) succeed with Exit Code 0.
6. Verification report `docs/audits/ai-correctness-verification.md` is generated with clean git attribution.
