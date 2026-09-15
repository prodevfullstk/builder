# Bolt-Style AI Execution UX — Final Closure Audit

**Audit Date**: September 15, 2026  
**Auditor**: Independent DeepMind Agentic Coding Auditor  
**Repository**: `https://github.com/prodevfullstk/builder`  
**Audit Document**: `docs/audits/bolt-ux-closure-audit.md`  
**Certified Git Baseline**: `45784c1b7a65cbb298b30b4c4371a95b9d520426`  
**Current Working Tree State**: Modified / Uncommitted previous UX implementation  
**Production Readiness Verdict**: **NOT READY (Dynamic Plan Synthesis & Language-Independent Semantic Routing Require Closure)**

---

## 0. Repository Integrity & Git State Reconciliation

### 0.1 Git State
- `git rev-parse HEAD`: `45784c1b7a65cbb298b30b4c4371a95b9d520426`
- `git rev-parse origin/main`: `45784c1b7a65cbb298b30b4c4371a95b9d520426`
- `git branch --show-current`: `main`
- `HEAD == origin/main`: **YES** (commits are aligned).
- `Working tree clean`: **NO** (working tree contains uncommitted changes).

### 0.2 Modified & Untracked Files Breakdown
The following files are modified in the working tree and belong to the previous UX implementation:
1. `app/api/agent/route.ts` (Modified: dynamic milestones, runId, X-Run-Id header)
2. `components/builder/bolt-plan-card.tsx` (Modified: failed/cancelled status, filesRead/filesUpdated drawers)
3. `components/builder/chat-panel.tsx` (Modified: live prose streaming, AbortController stop button, 3-way concurrency merge)
4. `lib/ai/intent-contract.ts` (Modified: multilingual criteria patterns)
5. `lib/ai/stream-events.ts` (Modified: new typed SSE events, envelope metadata)
6. `lib/store/project-store.ts` (Modified: TimelineStep status union extension)
7. `lib/workspace/project-retrieval.ts` (Modified: navigation retrieval heuristics)
8. `package.json` (Modified: test script inclusion)
9. `docs/audits/ai-streaming-chat-editor-ux-audit.md` (Untracked)
10. `docs/requirements/phase-ai-execution-ux.md` (Untracked)
11. `docs/audits/ai-execution-ux-post-implementation-audit.md` (Untracked)
12. `test/phase-ai-execution-ux.test.ts` (Untracked)

> [!WARNING]
> Because the working tree is modified and uncommitted, this audit evaluates the **current local working state** against the final target contract. A repository with uncommitted changes is **never** declared production certified.

---

## 1. Primary Product Objective Evaluation

Our target UX is the execution experience demonstrated by modern AI website builders such as Bolt.new:
`User prompt → Semantic intent understanding → Real-time narration → Structured prompt-specific plan → Context file read drawer → File generation state ("Generating") → Post-commit state ("Built" with lines) → Editor & preview synchronization → Truthful error diagnostics → Stop / cancel control`.

### Current Execution Trace Summary:
- **Narration Streaming**: **WORKING**. `createTypedAgentSSEStream` emits `text_delta` events and `BoltPlanCard` renders them progressively above the plan.
- **File Read Transparency**: **WORKING**. Emerald `"X files read for context"` drawer accurately displays retrieved snippets.
- **File Lifecycle States**: **WORKING**. Clear separation between `"Generating [file]"` during streaming and `"Built [file]"` post-commit.
- **Stop Control**: **WORKING**. `AbortController` cleanly terminates stream and aborts commit.
- **Concurrency**: **WORKING**. Safe 3-way merge preserves non-conflicting user edits in Monaco.
- **GAPS IDENTIFIED**:
  1. **Dynamic Plan Synthesis**: Arbitrary non-landing-page prompts collapse into a single monolithic requirement line.
  2. **Language-Independent Semantic Understanding**: Replaced English regexes with multilingual regex word lists instead of an extensible semantic decomposition model.
  3. **Acceptance Criteria Generation**: Lexical regex pattern matching rather than structured semantic properties.
  4. **Monaco Diff Review**: Editor updates buffer directly without a reviewable visual diff component.

---

## 2. Dynamic Plan Intelligence Audit

We tested the 6 mandatory conceptual prompts against `parseIntentFromPrompt` (`lib/ai/intent-contract.ts`) and `/api/agent/route.ts`:

| Prompt | Request Description | Current Requirements Extraction | Milestones Count | Result |
|:---|:---|:---|:---:|:---:|
| **A** | *"Create an online bookstore with search, cart and checkout."* | `["Create complete nextjs web application matching: Create an online bookstore with search, cart and checkout."]` | **1** | **FAIL** (Collapses search, cart, checkout) |
| **B** | *"Build a portfolio website for a photographer with galleries and a contact form."* | `["Create complete nextjs web application matching: Build a portfolio website for a photographer with galleries and a contact form."]` | **1** | **FAIL** (Collapses galleries, contact form) |
| **C** | *"Create a dashboard for monitoring server uptime."* | `["Create complete nextjs web application matching: Create a dashboard for monitoring server uptime."]` | **1** | **FAIL** (Collapses uptime metrics, health cards) |
| **D** | *"Build a SaaS landing page with navbar, hero, pricing, testimonials and a responsive mobile menu."* | `["Create complete...", "Include cohesive modern layout...", "Include responsive navigation bar", "Include high-converting hero section", "Include tiered pricing...", "Include customer testimonials..."]` | **5** | **PASS** (Matches hardcoded landing page regex) |
| **E** | *"Create a recipe application with categories, search, favorites and a recipe detail page."* | `["Create complete nextjs web application matching: Create a recipe application with categories, search, favorites and a recipe detail page."]` | **1** | **FAIL** (Collapses categories, search, favorites, detail) |
| **F** | *"Build a task management application with projects, tasks, filters and a responsive sidebar."* | `["Create complete nextjs web application matching: Build a task management application with projects, tasks, filters and a responsive sidebar."]` | **1** | **FAIL** (Collapses projects, task list, filters, sidebar) |

### Core Finding (Dynamic Plan):
In `lib/ai/intent-contract.ts` (lines 220–227), requirement extraction contains a hardcoded regex block specifically for SaaS landing page elements (`landing page`, `navbar`, `hero`, `pricing`, `testimonial`, `footer`). Any arbitrary application category outside this landing page checklist collapses into a single line.
This violates the core requirement: *A plan must contain multiple meaningful milestones when the request contains multiple independently identifiable features without relying on a large hardcoded application-category map.*

---

## 3. Language-Independent Semantic Understanding Audit

### Repository Search for Hardcoded Semantic Stems & Keyword Gates:
1. **`lib/ai/semantic-classifier.ts`**:
   - Lines 51–130 (`SEMANTIC_CONCEPT_PROJECTIONS`) contain multilingual stem dictionaries across 7 languages (English, Bengali, Hindi, Spanish, French, Arabic, Japanese):
     - Question roots: `/[\?؟¿]|^(?:what|how|why|...|কী|কি|কেন|क्या|क्यों|qué|cómo|pourquoi|ماذا|كيف|どう|なぜ)/i`
     - Explanation roots: `/(?:explain|describe|...|ব্যাখ্যা|वर्णना|समझाएं|expliquer|décrire|اشرح|説明)/i`
     - Fix/Bug roots: `/(?:bug|fix|broken|...|ত্রুটি|ভাঙা|समस्या|बग|खराब|erreur|panne|roto|خطأ|バグ)/i`
     - Feature add roots: `/(?:add|integrate|...|যোগ|যুক্ত|जोड़ें|ajouter|añadir|أضف|追加)/i`
     - Modification roots: `/(?:change|update|...|পরিবর্তন|ছোট|बदलें|छोटा|modifier|ajuster|cambiar|عدل|変更)/i`
     - Project create roots: `/(?:scaffold|landing page|...|তৈরি|বানাও|बनाएं|créer|crear|أنشئ|作成)/i`
2. **`lib/ai/intent-contract.ts`**:
   - Line 256: `/(?:logo|লোগো|logotipo|marque)/i` & `/(?:smaller|reduce|shrink|compact|size|ছোট|reducir|diminuer|kleiner|20%)/i`
   - Line 283: `/(?:hamburger|mobile\s*menu|responsive\s*menu|মোবাইল\s*মেনু|menú\s*móvil|menu\s*mobile)/i`
3. **`lib/workspace/project-retrieval.ts`**:
   - Lines 235–236: `targetDescLower.includes('লোগো') || targetDescLower.includes('মেনু')`

### Core Finding (Language Independence):
The current implementation replaced English regexes with multilingual regexes. While this satisfies unit tests matching Bengali/Spanish/French stems, it is **not** truly language-independent semantic classification.
A Russian, German, Korean, Italian, or Turkish user will fail these lexical pattern gates. The architecture must decouple intent understanding and feature decomposition from multilingual word lists.

---

## 4. Acceptance Criteria Audit

- **Current State**: `lib/ai/intent-contract.ts` constructs `AcceptanceCriterion` by checking regex matches for "logo" and "mobile menu".
- **Problem**: Acceptance criteria should represent semantic invariants (e.g. `{ target: "navbar.logo", property: "size", operation: "decrease", magnitude: "20%" }`), rather than firing only if prompt matches a hardcoded string `logo|লোগো|logotipo`.
- **Requirement**: Use generalized semantic decomposition to formulate structured acceptance criteria.

---

## 5. Streaming UX & Plan State Machine Audit

- **Natural Language Streaming**: Emits `text_delta` chunks before `<FILE>` blocks; frontend displays live prose in `BoltPlanCard`.
- **Plan Event Timing**: `plan` event is emitted *before* code generation begins.
- **Milestone States**:
  - `pending` (Circle)
  - `running` (Loader2 spinner + active sub-action badge)
  - `completed` (CheckCircle2)
  - `failed` (XCircle + red badge + inline diagnostic error)
  - `cancelled` (MinusCircle + line-through)
- **Truthfulness Verification**: Fake auto-completing `milestone-deps` was eliminated. Milestones never turn green without successful candidate validation and commit.
- **File Read vs File Write**:
  - Emerald drawer: `"X files read for context"`
  - Updated drawer: `"X files updated"`
  - Streaming file label: `"Generating [file]"`
  - Committed file label: `"Built [file] (N lines)"`

---

## 6. Concurrency, Diff Review & Cancellation Audit

### 6.1 Monaco Concurrency (Gate 8)
- Captures `baselineRevision`.
- Evaluates `userModifiedPaths` vs `aiCandidatePaths`.
- Non-conflicting edits: Merged cleanly into `verifiedFiles`.
- Conflicting edits: Stale candidate rejected, user's newer edits preserved.
- **Verdict**: **PASS**

### 6.2 Monaco Diff Review (Gate 9)
- `components/builder/code-editor.tsx` directly renders `<Editor>` without a reviewable `<DiffEditor>` or side-by-side diff UI before applying AI modifications.
- **Classification**: **P2 (Remaining Enhancement)**.

### 6.3 Cancellation Control (Gate 5/11)
- User clicking Stop button aborts fetch via `AbortController`.
- Frontend catch block traps `AbortError`, sets active steps to `'cancelled'`, and aborts the pipeline before commit.
- Candidate is never applied to workspace files or revision.
- **Verdict**: **PASS**

---

## 7. Test Quality & Suite Classification Audit

Inspection of [`test/phase-ai-execution-ux.test.ts`](file:///c:/Users/User/Desktop/opendrok/opendorkweb/test/phase-ai-execution-ux.test.ts) (21 tests):

| Test Description | File Inspected / Executed | Classification | Quality Rating |
|:---|:---|:---:|:---:|
| `verifies chat-panel.tsx consumes text_delta during build mode` | `chat-panel.tsx` | Static source string assertion | Low |
| `emits text_delta events before and outside of file blocks in SSE stream` | `stream-events.ts` | Integration / Stream contract | **High** |
| `verifies chat-panel.tsx sanitizes internal rules and diagnostics` | `chat-panel.tsx` | Static source string assertion | Low |
| `generates prompt-grounded dynamic milestones in app/api/agent/route.ts` | `route.ts` | Static source string assertion | Low |
| `emits structured milestones in plan event with runId` | `stream-events.ts` | Integration / Stream contract | **High** |
| `verifies bolt-plan-card.tsx eliminates cosmetic dependency green claims` | `bolt-plan-card.tsx` | Static source string assertion | Low |
| `verifies PlanMilestone interface supports failed and cancelled` | `bolt-plan-card.tsx` | Static source string assertion | Low |
| `verifies bolt-plan-card.tsx renders XCircle and diagnostic message` | `bolt-plan-card.tsx` | Static source string assertion | Low |
| `verifies bolt-plan-card.tsx renders MinusCircle for cancelled status` | `bolt-plan-card.tsx` | Static source string assertion | Low |
| `verifies file_start step displays Generating rather than Wrote` | `chat-panel.tsx` | Static source string assertion | Low |
| `verifies file steps transition to Built with lines count only after commit` | `chat-panel.tsx` | Static source string assertion | Low |
| `emits file_read events when retrieved snippets are provided` | `stream-events.ts` | Integration / Stream contract | **High** |
| `verifies bolt-plan-card.tsx renders separate drawers` | `bolt-plan-card.tsx` | Static source string assertion | Low |
| `attaches runId, sequenceId, and timestamp to every emitted event` | `stream-events.ts` | Integration / Stream contract | **High** |
| `correctly reassembles SSE chunks split across arbitrary byte boundaries` | `stream-events.ts` | Real Unit test | **High** |
| `verifies chat-panel.tsx implements non-conflicting concurrent edit merging` | `chat-panel.tsx` | Static source string assertion | Low |
| `verifies chat-panel.tsx provides handleCancelGeneration and aborts fetch` | `chat-panel.tsx` | Static source string assertion | Low |
| `verifies cancelling generation marks running steps as cancelled` | `chat-panel.tsx` | Static source string assertion | Low |
| `verifies chat-panel.tsx eliminates hardcoded Bengali/English keyword regexes` | `chat-panel.tsx` | Static source string assertion | Low |
| `correctly classifies Bengali, Spanish, and French prompts via semantic classifier` | `semantic-classifier.ts` | Real Unit test | **High** |
| `verifies X-Run-Id header is transmitted in /api/agent response` | `route.ts` | Static source string assertion | Low |

- **Static Source String Assertions**: 15 / 21 (71.4%)
- **Integration / Stream / Unit Tests**: 6 / 21 (28.6%)
- **Assessment**: The test suite tests the presence of code patterns in source files rather than exercising end-to-end component runtime behavior with simulated streams and mock stores.

---

## 8. Summary of Confirmed Remaining Gaps (Remediation Scope)

| Gap ID | Area | Severity | Description |
|:---|:---|:---:|:---|
| **GAP-01** | Dynamic Plan Decomposition | **P1** | Generic multi-feature prompts (e.g. bookstore, uptime monitor, recipe app) collapse into a single monolithic requirement line. Must implement semantic multi-step milestone decomposition. |
| **GAP-02** | Language-Agnostic Intent & Criteria | **P1** | Hardcoded multilingual regex stems in `semantic-classifier.ts` and `intent-contract.ts` must be replaced with extensible semantic feature extraction. |
| **GAP-03** | Structured Semantic Acceptance Criteria | **P1** | Replace lexical keyword matching for logo/menu with structured property-level semantic criteria. |
| **GAP-04** | Runtime Test Quality | **P2** | Add real behavioral integration tests for multi-feature prompt plan decomposition and language equivalence without relying on static source assertions. |
| **GAP-05** | Monaco Diff Review | **P2** | (Optional / Post-closure) Side-by-side diff review UI in Monaco before accepting mutations. |

---

## 9. Next Steps

1. Create `docs/requirements/bolt-ux-closure.md` defining the exact implementation contract for GAP-01, GAP-02, GAP-03, and GAP-04.
2. Implement semantic prompt decomposition and generalized intent structuring.
3. Verify across Prompts A–F and multilingual queries (English, Bengali, Spanish, French, Hindi, Arabic, Japanese, German, Russian).
4. Run full test suite (`pnpm test`), lint (`pnpm lint`), and production build (`pnpm build`).
5. Re-audit and commit clean repository baseline.
