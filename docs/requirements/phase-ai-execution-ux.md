# Requirements Specification: Phase AI Execution UX, Streaming, Plan, and Workspace Visibility
**Authoritative Implementation Contract for Bolt.new-Quality AI Builder Experience**

- **Document Version:** `1.0.0`
- **Target Repository:** `https://github.com/prodevfullstk/builder.git`
- **Certified Baseline Git SHA:** `45784c1b7a65cbb298b30b4c4371a95b9d520426`
- **Reference Audit Report:** `docs/audits/ai-streaming-chat-editor-ux-audit.md`
- **Status:** **APPROVED FOR IMPLEMENTATION**

---

## 1. Objective & Scope

This specification defines the mandatory architectural and UX requirements to transform opendork's AI builder experience into an evidence-backed, responsive interaction model matching the standards set by modern AI development environments (such as Bolt.new and Cursor).

Every requirement in this document is normative and binding. All previous production gates (A through H), atomic candidate validations, optimistic concurrency control (CAS), sandbox isolations, and rate limiters must remain strictly intact and fail-closed.

---

## 2. Invariant Security & Integrity Guarantees

The implementation **must preserve without compromise**:
1. **Authentication & Identity Isolation:** Real Supabase JWT authentication and isolated demo identity partitioning (`demo:<ip>`).
2. **Distributed Rate Limiting:** Enforce sliding-window quotas with fail-closed semantics.
3. **Atomic Candidate Validation Gate:** Candidate changes must be evaluated against framework AST and security invariants in memory before any workspace store mutation. Zero partial mutations on failure.
4. **Optimistic Concurrency Control (CAS):** Commit requests must verify monotonic expected revisions. Concurrent edits must never overwrite uninspected state.
5. **Sandbox Isolation:** Vercel Sandbox microVM execution, path traversal rejection, symlink restrictions, and child process isolation must remain unbroken.
6. **No Private Chain-of-Thought Exposure:** The system must never expose raw model internal reasoning traces, prompt instructions, or private scratchpads to the user interface. User-visible streams must consist of clear, helpful conversational narration, architectural planning, and operational progress updates.

---

## 3. Streaming Transport & Event Protocol Contract

### 3.1 Event Envelope Schema
All events transmitted over `/api/agent` (SSE: `text/event-stream`) must adhere to the extended `StreamEvent` schema. Each event must include:
- `type`: Discriminated union of event types.
- `runId`: Unique execution run identifier (UUID or cryptographic timestamp ID) uniform across all chunks of a single generation.
- `sequenceId`: Strictly monotonic integer starting at `1`.
- `timestamp`: ISO 8601 UTC timestamp string.
- `stepId`: Optional identifier associating the event with a specific plan milestone or execution step.
- `payload`: Event-specific data attributes.

### 3.2 Canonical Event Set
The streaming protocol must support and emit:
1. `start` (`RUN_STARTED`): Emitted once at connection start with `runId`, `messageId`, `role: 'assistant'`.
2. `intent` (`INTENT_DECLARED`): Emitted with the classified `IntentContract` (`id`, `action`, `framework`, `confidence`).
3. `plan` (`PLAN_CREATED`): Emitted with structured milestones (`id`, `title`, `description`, `order`, `estimatedFiles`).
4. `plan_step_start`: Emitted when an individual plan milestone begins execution (`stepId`, `title`).
5. `plan_step_complete`: Emitted when an individual plan milestone succeeds (`stepId`, `summary`).
6. `plan_step_failed`: Emitted when a plan milestone fails (`stepId`, `error`).
7. `text_delta`: Emitted for streaming natural language explanation and architectural rationale.
8. `file_read`: Emitted when existing workspace context files are retrieved (`path`, `reason`, `tokenCount`).
9. `file_start`: Emitted when candidate code generation starts for a path (`path`, `operation: 'create' | 'modify' | 'delete'`).
10. `file_delta`: Emitted as code chunks are streamed for the active file (`path`, `delta`).
11. `file_complete`: Emitted when the model finishes generating a file block (`path`, `sizeBytes`, `hash`).
12. `validation_start`: Emitted when candidate evaluation begins (`candidateHash`, `fileCount`).
13. `validation_result`: Emitted with actual verification evidence (`passed: boolean`, `diagnostics`, `checks`).
14. `build_start`: Emitted when native or virtual compilation begins (`runner`).
15. `build_result`: Emitted with compilation outcome (`exitCode`, `success`, `output`).
16. `commit`: Emitted when verified files are atomically written to the project store (`revision`, `candidateHash`).
17. `complete`: Emitted when the run finishes successfully (`totalDurationMs`, `committed: boolean`).
18. `error`: Emitted on any runtime, syntax, or network failure (`code`, `message`, `fatal: boolean`).

---

## 4. User-Facing Interaction Model Requirements

### 4.1 Progressive Natural Language Streaming in Build Mode (P0)
- **Violation in Baseline:** In `chat-panel.tsx`, `text_delta` events were discarded during build mode, rendering only a static hardcoded card string while generation was underway.
- **Contract Requirement:**
  - In build mode, `chat-panel.tsx` must consume `text_delta` SSE chunks and render the incoming conversational text progressively in the active message card.
  - The user must be able to read the assistant's natural language explanation of the solution, architecture, and design system choices as it streams.
  - The streaming message must display a live typing cursor indicator while `isStreaming` is active.

### 4.2 Dynamic, Prompt-Grounded Plan Execution Engine (P1)
- **Violation in Baseline:** `BoltPlanCard` fell back to a hardcoded 4-step checklist ("Analyze architecture", "Configure dependencies", "Build components", "Verify sandbox") where Step 2 automatically turned green without dependency activity.
- **Contract Requirement:**
  - The plan must be generated dynamically based on the specific prompt and intent. For example, a SaaS landing page prompt must generate steps like:
    1. *Design layout system and navigation*
    2. *Implement hero section with responsive CTA*
    3. *Create pricing tier comparison grid*
    4. *Build customer testimonials and footer*
  - The `/api/agent` route must formulate prompt-relevant plan steps and emit them via the `plan` SSE event.
  - `BoltPlanCard` must accept and render dynamic `milestones` directly from the server stream.
  - Hardcoded milestone synthesis that unconditionally claims dependency configuration is forbidden.

### 4.3 Plan Milestone Status State Machine (P1)
- `PlanMilestone` status must support: `'pending' | 'running' | 'completed' | 'failed' | 'cancelled'`.
- Status transitions must be strictly evidence-backed:
  - A step is `'pending'` until execution commences.
  - A step is `'running'` while its corresponding operations (reads, generation, compilation) are active.
  - A step is `'completed'` only when its associated operation successfully finishes without error.
  - A step transitions to `'failed'` if candidate validation, compilation, or tool execution fails, rendering an accessible error badge and diagnostic description.
  - Steps remaining when a run is aborted transition to `'cancelled'`.

### 4.4 Truthful File Lifecycle & Operations (P1)
- **Separation of Generation and Commit:**
  - During token streaming, file steps must display `"Generating <path>"` or `"Proposing <path>"` with a running spinner.
  - The UI must **never claim** `"Wrote <path>"` until the candidate has passed candidate validation and has been committed.
  - Once committed to the store, the label transitions to `"Built <path>"` or `"Wrote <path>"` with line count evidence.
- **Context Read Visibility:**
  - Retrieved workspace context files must be emitted as `file_read` events.
  - `BoltPlanCard` must provide a collapsible drawer clearly displaying:
    - `"Read X files for context"` (listing paths inspected).
    - `"Updated Y files"` (listing paths modified).

### 4.5 Editor Concurrency Buffering & Cancellation (P1 / P2)
- **Concurrency Protection:**
  - Typing in Monaco while an AI generation is running must not immediately increment the project revision and trigger a silent drop of the generated candidate.
  - If a concurrent edit occurs during generation, the system must either buffer the manual edits or present a side-by-side / inline diff review affordance rather than abruptly discarding the candidate.
- **Stop / Cancel Control:**
  - `chat-panel.tsx` must feature a visible "Stop" / "Cancel" control when `isStreaming` is active.
  - Triggering cancel must immediately abort the `fetch` via `AbortController`, terminate the stream consumer, mark running steps as `'cancelled'`, and restore the UI to an idle, ready state without corrupting the workspace.

### 4.6 Language-Agnostic Intent Parsing & Regex Cleanliness (P2)
- Hardcoded English and Bengali keyword regexes (e.g. `/(সমস্যা|সমাধান|ঠিক|সংশোধন|কাজ করছে না|ভুল|পরিবর্তন)/i`, `/\b(fix|repair|error|broken|bug|issue|solve)\b/i`, `/logo/i && /20%/i`, `/hamburger/i`) must be removed from `chat-panel.tsx` and generalized in `intent-contract.ts` and `project-retrieval.ts`.
- Routing must rely on the semantic classifier (`parseIntentFromPrompt`), structured `IntentContract` flags (`action`, `framework`, `targetFiles`, `context`), and prompt intent semantics.

---

## 5. Verification & Acceptance Criteria (20-Point Contract)

The remediation is certified only when all 20 verification points pass:
1. `text_delta` chunks are streamed and visible in real time during build mode.
2. The user sees conversational prose before or alongside file blocks.
3. No internal chain-of-thought or prompt leakage appears in user streams.
4. Plan milestones are generated dynamically and reflect the user's specific prompt.
5. Invariable 4-step checklist fallback is removed or made truthful.
6. Step 2 ("Configure dependencies") never turns green unless dependencies are actually configured.
7. `PlanMilestone` interface supports `'failed'` and `'cancelled'` statuses.
8. Failed candidate validation turns the active milestone red with diagnostic information.
9. File operations distinguish between "Generating" (streaming) and "Built/Wrote" (committed).
10. `FILE_READ` events are emitted for retrieved workspace context files.
11. The collapsible drawer displays files read for context separately from files written.
12. Stream chunks carry `runId`, `sequenceId`, `timestamp`, and optional `stepId`.
13. Stream decoder parses interleaved SSE events across chunk boundaries deterministically.
14. Typing in Monaco during generation does not cause silent abort of valid candidates.
15. A visible "Stop Generating" button halts in-flight streams via `AbortController`.
16. Aborting generation transitions running steps to `'cancelled'` cleanly.
17. Hardcoded Bengali and English keyword regex gates are eliminated.
18. Multilingual prompts (e.g., Bengali, Spanish, German) route to correct intent actions without keyword regexes.
19. All existing security invariants (RLS, CAS, sandbox isolation, rate limiting) remain 100% passing.
20. Complete test suite passes with zero regressions.
