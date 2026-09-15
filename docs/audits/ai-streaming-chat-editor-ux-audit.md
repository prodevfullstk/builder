# AI Streaming, Chat, Plan, and Editor UX Production Audit
**Authoritative Comparison Against Bolt.new Interaction Standards**

**Repository:** `https://github.com/prodevfullstk/builder.git`  
**Audited HEAD Commit:** `45784c1b7a65cbb298b30b4c4371a95b9d520426`  
**Audit Scope:** End-to-End User Experience, Streaming Protocol, Live Plan Hierarchy, File Visibility, Editor/Preview Synchronization, and Natural Language Robustness  
**Authoritative Mode:** READ-ONLY Verification (Zero Source Modifications)  
**Production Verdict:** **CONDITIONALLY READY (CORE INFRASTRUCTURE VERIFIED / UX & PLAN STREAMING DISCONNECTED)**

---

## 1. Executive Summary

The project repository possesses an enterprise-grade backend foundation:
1. **Isolated Cloud MicroVM Execution:** Live cloud runtime startup, port binding, HTTP smoke validation, process termination (`pkill -f node`), and disposable container cleanup via `@vercel/sandbox` are empirically proven and certified on commit `45784c1b7a65cbb298b30b4c4371a95b9d520426`.
2. **Authoritative Anti-Forgery & CAS Gates:** Centralized CAS commit services (`/api/validate/candidate`) enforce monotonic revision increments, cryptographic evidence digest verification, and zero partial-file mutations.
3. **Headless Browser Verification:** Playwright-based visual comparisons and mobile viewport behavioral interactions run with empirical screenshot SHA-256 binding.

**However, the user-facing interaction model between the frontend chat, the streaming transport, and the code editor falls substantially short of a modern Bolt.new-quality builder experience.**

### Key Critical Findings:
- **Suppression of Natural Language Streaming during Builds (P0):** When the user triggers a build, `chat-panel.tsx` receives `text_delta` events from the SSE stream but **completely drops them from the UI render loop**. The user sees only a static, hardcoded placeholder (`"I'll build a complete NEXTJS application. Let's inspect the setup and create the components."`) while generation occurs, hiding the AI's actual step-by-step reasoning until after the entire build finishes.
- **Cosmetic, Hardcoded Plan Card (P1):** The visible "Plan" rendered by `BoltPlanCard` does not represent dynamic, model-generated task milestones (such as *"Build Navbar"*, *"Build Hero"*, *"Build Pricing"*). Instead, the frontend synthesizes an invariable 4-step checklist (*"Analyze architecture"*, *"Configure dependencies"*, *"Build components"*, *"Verify sandbox"*). Step 2 (*"Configure dependencies"*) automatically turns green as soon as any file begins streaming, even if dependencies were never touched.
- **Premature / Inferred File Activity (P1):** File write notifications (`└ ✏️ Wrote <file>`) are inferred purely from markdown regex parsing (`<FILE path="...">`) during token streaming, before the file is validated, compiled, written to disk, or committed to CAS. If candidate validation subsequently fails, the UI has already claimed the file was written.
- **No File Read Visibility (P2):** The streaming protocol and UI have zero support for `FILE_READ` events. The collapsible drawer only shows files inferred as written.
- **Unvalidated Monaco Manual Edits & Concurrency Hazard (P1):** Manual keystrokes in Monaco directly mutate the Zustand store `files` on every keystroke, bypassing the candidate pipeline. If a user types a single character in Monaco while an AI generation is running, the project revision increments, triggering an optimistic concurrency conflict that silently aborts the entire AI build upon completion.
- **Hardcoded Natural Language Regex Gates (P2):** Despite having a multilingual semantic vector classifier, numerous critical routing paths in `chat-panel.tsx`, `intent-contract.ts`, and `project-retrieval.ts` still rely on hardcoded English and Bengali keyword regexes (e.g., `/(সমস্যা|সমাধান|ঠিক|সংশোধন|কাজ করছে না|ভুল|পরিবর্তন)/i`).

---

## 2. Repository & Baseline Identity

- **Git HEAD SHA:** `45784c1b7a65cbb298b30b4c4371a95b9d520426`
- **origin/main SHA:** `45784c1b7a65cbb298b30b4c4371a95b9d520426`
- **SHA Match:** `PASS`
- **Working Tree:** `CLEAN` (0 uncommitted or staged changes)
- **Node.js Environment:** `v24.18.1`
- **Package Manager:** `pnpm@9.15.9`

---

## 3. Current Runtime Flow Trace

```text
User Prompt + Optional Image
  │
  ▼
chat-panel.tsx [handleSubmit]
  ├─ Deducts user credits (credits-store.ts)
  ├─ Auto-detects framework / DB via regexes
  ├─ Classifies intent via parseIntentFromPrompt() (semantic-classifier.ts)
  │   └─ Determines isBuild vs Conversation mode
  │
  ▼
POST /api/agent
  ├─ authenticateRequest (Supabase / Demo)
  ├─ checkRateLimitDistributed (Redis sliding window)
  ├─ validateIntent (checks required contract fields)
  ├─ buildRetrievalContext (workspace AST / token scoring)
  ├─ createVisualSpec (if screenshot attached)
  ├─ createGeminiStream (Gemini 2.5/3.0 -> Groq Fallback)
  └─ createTypedAgentSSEStream (stream-events.ts)
      │
      ▼ (HTTP Response: text/event-stream)
  event: start
  event: intent
  event: plan (3 static strings: Analyze intent / Retrieve context / Synthesize)
  event: text_delta (prose)
  event: file_start (<FILE path="...">)
  event: file_delta (file chunks)
  event: file_complete (</FILE>)
  event: validation (hardcoded passed: true)
  event: complete (hardcoded committed: false)
      │
      ▼
Client Stream Consumer (chat-panel.tsx)
  ├─ TextDecoder + StreamEventDecoder
  ├─ In "chat" mode: streams text_delta -> updateStreamingMessage()
  ├─ In "build" mode:
  │   ├─ DISCARDS text_delta! (User sees static placeholder in BoltPlanCard)
  │   ├─ Captures plan event -> adds local TimelineStep 'plan-1'
  │   └─ Captures file_start -> adds local TimelineStep 'step-<path>'
  │
  ▼
End of Stream Post-Processing (chat-panel.tsx)
  ├─ parseToolCalls (MCP executor fallback)
  ├─ parseFinalOutput (extracts files and AI explanation)
  ├─ evaluateCandidateChanges (Client-side AST & security validation)
  │   └─ If rejected: Preserves files, posts failure message, ABORTS.
  ├─ bundleProjectWithEsbuild (Client-side virtual compilation)
  │   └─ If fails: Triggers autonomous auto-heal loop (POST /api/agent mode: auto-fix)
  ├─ Optimistic Concurrency Check: currentRevision === baselineRevision
  │   └─ If modified: Rejects candidate, posts conflict message, ABORTS.
  ├─ Local Commit: setFiles(verifiedFiles) (mutates Zustand store)
  └─ UI Update: addMessage() with cleanIntro and finalSteps.
      │
      ▼
Monaco Editor & Preview Pane
  ├─ CodeEditor re-renders from useProjectStore.files[activeFile]
  └─ PreviewPane re-renders (InstantPreview via Babel/esbuild OR VercelPreview via /api/sandbox)
```

---

## 4. Detailed Audit Findings by Dimension

### Phase 1 — Current Chat Experience

#### Finding 1.1: Complete Suppression of Natural Language Streaming during Builds
- **Severity:** `P0` (Broken Core UX / Severe Divergence from Bolt.new)
- **Exact Path:** [chat-panel.tsx:406-456](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L406-L456)
- **Current Behavior:** In `handleSubmit()` under build mode (lines 406–456), while reading the SSE stream from `/api/agent`, the loop handles `ev.type === 'plan'`, `ev.type === 'file_start'`, and `ev.type === 'file_complete'`. However, it has **no handler for `text_delta`** and does not call `updateStreamingMessage()`. Consequently, all streaming conversational text emitted by the LLM is invisible during generation. The UI displays only a static client string:
  ```tsx
  introText={
    runtimeError
      ? `Diagnosing preview sandbox error and applying surgical repair for ${framework.toUpperCase()}...`
      : Object.keys(files).length > 0
      ? `Analyzing requested changes and updating your ${framework.toUpperCase()} application...`
      : `I'll build a complete ${framework.toUpperCase()} application. Let's inspect the setup and create the components.`
  }
  ```
  Only after the entire stream, candidate validation, and esbuild bundling complete (line 783) is `addMessage` called with the first paragraph of the AI's explanation (`cleanIntro`).
- **Why It Matters:** In modern builders like Bolt.new and Cursor, the user reads the AI's natural explanation as it thinks and plans. Hiding this produces an opaque, robotic experience where the user has no idea what the AI is actually intending to do until after the code is fully generated.
- **Expected Behavior:** `chat-panel.tsx` must stream `text_delta` tokens into the active message or plan header in real time.
- **Recommended Architecture:** Stream conversational prose into an active assistant chat bubble above or within the plan card, continuously updating as chunks arrive.
- **Verification Test:** Send a prompt such as `"Build a portfolio with 3 projects"` and assert that `updateStreamingMessage` is called with non-empty deltas before any file block begins.

---

### Phase 2 — Streaming Transport

#### Finding 2.1: Disconnection between Server Event Definitions and Client Consumption
- **Severity:** `P1` (Architectural Inconsistency / Dead Types)
- **Exact Path:** [stream-events.ts:6-31](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/ai/stream-events.ts#L6-L31) and [chat-panel.tsx:414-456](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L414-L456)
- **Current Behavior:** `lib/ai/stream-events.ts` defines 24 event types in `StreamEventType`, but the server and client only use a fraction of them.

#### End-to-End Event Truth Table

| Target Event | Defined in Types? | Emitted by Server? | Transported via SSE? | Parsed by Client? | Rendered in UI? | Evidence File & Line |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `RUN_STARTED` | Yes (`start`) | **Yes** | **Yes** | No | No | [stream-events.ts:271](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/ai/stream-events.ts#L271) |
| `PLAN_CREATED` | Yes (`plan`) | **Yes** | **Yes** | **Yes** | **Yes** | [stream-events.ts:301](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/ai/stream-events.ts#L301), [chat-panel.tsx:415](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L415) |
| `PLAN_STEP_STARTED` | **No** | **No** | **No** | **No** | **No** | Missing from protocol |
| `PLAN_STEP_COMPLETED` | **No** | **No** | **No** | **No** | **No** | Missing from protocol |
| `PLAN_STEP_FAILED` | **No** | **No** | **No** | **No** | **No** | Missing from protocol |
| `FILE_READ` | **No** | **No** | **No** | **No** | **No** | Missing from protocol |
| `FILE_CREATED` | Yes (`file_start`) | **Yes** | **Yes** | **Yes** | **Yes** | [stream-events.ts:343](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/ai/stream-events.ts#L343), [chat-panel.tsx:427](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L427) |
| `FILE_UPDATED` | Yes (`file_delta`) | **Yes** | **Yes** | **Yes** (Monaco only) | Partial | [stream-events.ts:361](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/ai/stream-events.ts#L361), [code-editor.tsx:190](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/code-editor.tsx#L190) |
| `FILE_DELETED` | Yes (type only) | **No** | **No** | **No** | **No** | `StreamEventType` has no dedicated delete event |
| `DEPENDENCY_INSTALL_STARTED` | **No** | **No** | **No** | **No** | **No** | Missing from protocol |
| `DEPENDENCY_INSTALL_COMPLETED` | **No** | **No** | **No** | **No** | **No** | Missing from protocol |
| `BUILD_STARTED` | Yes (`build_start`) | **No** | **No** | **No** | **No** | Defined in type; never emitted |
| `BUILD_COMPLETED` | Yes (`build_result`) | **No** | **No** | **No** | **No** | Defined in type; never emitted |
| `VALIDATION_STARTED` | Yes (`validation`) | **Yes** | **Yes** | **No** | **No** | Emitted with hardcoded `passed: true` ([stream-events.ts:462](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/ai/stream-events.ts#L462)), ignored by client |
| `VALIDATION_COMPLETED` | Yes (`validation`) | **Yes** | **Yes** | **No** | **No** | Client executes validation locally in `chat-panel.tsx` |
| `RUNTIME_STARTED` | Yes (`runtime_start`) | **No** | **No** | **No** | **No** | Defined in type; never emitted |
| `RUNTIME_READY` | Yes (`runtime_result`) | **No** | **No** | **No** | **No** | Handled out-of-band by `/api/sandbox` polling |
| `RUNTIME_FAILED` | Yes (`runtime_result`) | **No** | **No** | **No** | **No** | Handled out-of-band by `/api/sandbox` polling |
| `AI_TEXT_DELTA` | Yes (`text_delta`) | **Yes** | **Yes** | **Yes** (Chat mode only) | Partial | Dropped during build mode ([chat-panel.tsx:406](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L406)) |
| `RUN_COMPLETED` | Yes (`complete`) | **Yes** | **Yes** | **No** | **No** | Client ignores event; relies on stream EOF |
| `RUN_FAILED` | Yes (`error`) | **Yes** | **Yes** | **Yes** (Chat mode only) | Partial | Build mode catch block handles fetch failure |

---

### Phase 3 — Plan UX

#### Finding 3.1: Plan Milestones are Hardcoded Client Templates Rather than Model-Generated
- **Severity:** `P1` (False Plan Representation / Cosmetic Milestones)
- **Exact Path:** [bolt-plan-card.tsx:46-100](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/bolt-plan-card.tsx#L46-L100)
- **Current Behavior:** In `BoltPlanCard`, if explicit `milestones` are not passed (which `chat-panel.tsx` never does), the component uses `React.useMemo` to synthesize a fixed 4-step array:
  1. `milestone-prep`: *"Analyze project architecture and design system"*
  2. `milestone-deps`: *"Configure core dependencies and framework config"*
  3. `milestone-build`: *"Build application components (${fileSteps.length} files)"*
  4. `milestone-verify`: *"Build and verify preview sandbox"*

  Furthermore, their transition states are cosmetic heuristics:
  - `milestone-prep`: Marked `'completed'` as soon as `hasAnyFiles` is true.
  - `milestone-deps`: Marked `'completed'` as soon as `hasAnyFiles` is true! (Lines 67–68: `status: (hasAnyFiles || allFilesFinished || !isStreaming) ? 'completed' : 'pending'`).
  - `milestone-verify`: Marked `'completed'` as soon as `!isStreaming`.
- **Why It Matters:** In Bolt.new, the plan reflects the actual user requirements (e.g., Step 1: "Install lucide-react", Step 2: "Create Header component", Step 3: "Add Stripe pricing table"). In opendork, whether you ask for a portfolio, an e-commerce store, or a calculator, the exact same 4 generic sentences appear.
- **Expected Behavior:** The LLM must output structured task-specific plan steps via function calling or a `<PLAN>` JSON block with unique IDs, and the execution engine must advance each step as its corresponding files and tools execute.

#### Finding 3.2: Plan Milestone Interface Lacks a Failed Status
- **Severity:** `P2` (Error State Blindspot)
- **Exact Path:** [bolt-plan-card.tsx:20](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/bolt-plan-card.tsx#L20)
- **Current Behavior:** The `PlanMilestone` interface defines:
  ```ts
  export interface PlanMilestone {
    id: string;
    label: string;
    status: 'pending' | 'running' | 'completed';
    ...
  }
  ```
  There is **no `'failed'` status**. If candidate validation or virtual esbuild compilation fails, the milestone item cannot turn red or display an error icon. Instead, the entire card is left in a partial state and an error box is rendered below it.

---

### Phase 4 — File Activity & Workspace Visibility

#### Finding 4.1: "Wrote <file>" Status is Inferred from Token Stream before File Mutation or Validation
- **Severity:** `P1` (Truthfulness Violation / Pre-mature Claim)
- **Exact Path:** [stream-events.ts:323-352](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/ai/stream-events.ts#L323-L352) and [chat-panel.tsx:427-446](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L427-L446)
- **Current Behavior:** When the LLM outputs `<FILE path="app/page.tsx">`, the server immediately emits `file_start` and the client immediately creates a `TimelineStep` with `status: 'running'`, which `BoltPlanCard` renders as:
  ```text
  └ ✏️ Wrote app/page.tsx
  ```
  At this moment in time:
  1. The file content has not finished streaming.
  2. The candidate changes have NOT passed `evaluateCandidateChanges`.
  3. The code has NOT been checked by `bundleProjectWithEsbuild`.
  4. The code has NOT been committed to the project store.
  If the candidate is rejected 5 seconds later due to a syntax error or security violation, the UI has already informed the user that it wrote `app/page.tsx`.
- **Why It Matters:** Violates the principle of evidence-backed UI truthfulness. AI claiming to write a file is not proof that the file exists in the workspace.
- **Expected Behavior:** The UI must distinguish between `"Streaming candidate: app/page.tsx"` and `"Committed: app/page.tsx"`. Only post-validation atomic CAS commit should show a completed "Wrote" status.

#### Finding 4.2: Zero Visibility into File Reads / Context Retrieval
- **Severity:** `P2` (Missing Context Transparency)
- **Exact Path:** [project-retrieval.ts:122-210](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/workspace/project-retrieval.ts#L122-L210)
- **Current Behavior:** `buildRetrievalContext()` searches the existing workspace files using AST and token scoring to select relevant component snippets. However, the retrieved file paths are injected into the system prompt behind the scenes and are **never emitted to the client**. The user cannot see which existing files the AI consulted before making its edits.
- **Expected Behavior:** An event (e.g. `FILE_READ`) should be emitted for each retrieved snippet and rendered in the collapsible drawer as `"Read 3 files for context"`.

---

### Phase 5 — Chat ↔ Editor Synchronization

#### Finding 5.1: Manual Keystrokes in Monaco Bypass Validation and Invalidate Running AI Generations
- **Severity:** `P1` (Concurrency Hazard / Data Race)
- **Exact Path:** [code-editor.tsx:436-444](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/code-editor.tsx#L436-L444) and [chat-panel.tsx:720-733](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L720-L733)
- **Current Behavior:** When a user types in Monaco:
  ```tsx
  onChange={(val: string | undefined) => {
    if (activeFile && val !== undefined) {
      updateFile(activeFile, val);
      ...
    }
  }}
  ```
  `updateFile` immediately calls:
  ```ts
  set((state) => ({
    files: { ...state.files, [path]: content },
    revision: (state.revision || 0) + 1,
  }))
  ```
  1. This mutates `files` in Zustand without passing through `evaluateCandidateChanges` or CAS verification.
  2. If the AI was currently generating code in the background (which captured `baselineRevision = state.revision`), the user's keystroke increments `revision`.
  3. When the AI finishes its generation, `chat-panel.tsx` checks:
     ```tsx
     if (currentRevision !== baselineRevision) {
       setStatus('ready', 'Concurrent modification detected');
       addMessage({ content: '⚠️ Concurrent Modification Detected...' });
       return;
     }
     ```
  4. The entire AI generation is immediately discarded!
- **Why It Matters:** Users frequently edit code while waiting for AI generation to complete. Discarding the entire AI build because of a single manual typo or space character causes extreme user frustration.
- **Expected Behavior:** Monaco should operate on a designated working copy or buffer with dirty flags, and the system should perform 3-way merge or present an inline diff rather than unconditionally dropping the AI candidate.

#### Finding 5.2: Absence of Diff / Visual Review Mechanism in Monaco
- **Severity:** `P2` (Missing Review Affordance)
- **Exact Path:** [code-editor.tsx:430-450](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/code-editor.tsx#L430-L450)
- **Current Behavior:** The editor mounts `<Editor />` from `@monaco-editor/react`. There is no `<DiffEditor />` integration. When AI updates a file, the entire text in Monaco instantly changes to the new version. The user cannot see red/green diff lines showing what was added or removed.

---

### Phase 6 — Chat ↔ Preview Synchronization

#### Finding 6.1: InstantPreview Renders Unvalidated Manual Keystrokes via In-Browser Babel
- **Severity:** `P2` (Preview Drift vs Native MicroVM)
- **Exact Path:** [instant-preview.tsx:53-56](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/preview/instant-preview.tsx#L53-L56)
- **Current Behavior:** When the preview engine is set to `instant`, `generateInstantPreviewHtml(files)` compiles React code synchronously using in-browser Babel standalone. Babel tolerates missing types, ignores TS interfaces, and does not enforce Next.js server/client component boundaries.
- **Why It Matters:** Code can render successfully in `InstantPreview` while being completely broken in a real Next.js production build. When the user switches to `vercel` microVM engine, the preview suddenly crashes.

---

### Phase 7 — AI Status & Progress Truthfulness

| Status Displayed | Trigger Source | Authoritative Backend Operation | Can be True without Operation? | Classification |
| :--- | :--- | :--- | :--- | :--- |
| **"Analyzing request..."** | Client `handleSubmit()` | None (just setting up fetch) | Yes (before server responds) | **PARTIALLY REAL** |
| **"Reading files..."** | Inferred in `bolt-plan-card.tsx` | None (no `FILE_READ` event exists) | Yes (dead code branch) | **COSMETIC** |
| **"Configure core dependencies"** | `bolt-plan-card.tsx` | None (no install takes place) | **Yes (turns green automatically)** | **FABRICATABLE** |
| **"Wrote <file>"** | `<FILE path="...">` regex in stream | None (file not yet validated or written) | **Yes (shown during token streaming)** | **FABRICATABLE** |
| **"Validating candidate"** | `evaluateCandidateChanges` | Client-side static AST rules | No (awaits check result) | **REAL** |
| **"Build verified (0 errors)"** | `bundleProjectWithEsbuild` | In-browser esbuild bundling | No (runs actual bundler) | **REAL (VIRTUAL)** |
| **"Application ready"** | Post-commit in `chat-panel.tsx` | `setFiles(verifiedFiles)` | No (only on clean exit) | **REAL** |

---

### Phase 8 — Error Experience

#### Finding 8.1: Clean Rollback on Candidate Validation Failure
- **Severity:** `PASS` (Preserved Invariant)
- **Exact Path:** [chat-panel.tsx:544-565](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L544-L565)
- **Behavior:** When candidate evaluation fails (`!evalResult.accepted`), `chat-panel.tsx` logs the diagnostics, preserves the original `files` in the store untouched, sets status to `'error'`, and renders a detailed diagnostics box in chat with an "Auto-Fix with AI" CTA. Zero partial corruption occurs.

#### Finding 8.2: Autonomous Build Auto-Healing Loop
- **Severity:** `PASS` (Advanced Recovery Feature)
- **Exact Path:** [chat-panel.tsx:586-665](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L586-L665)
- **Behavior:** If virtual esbuild bundling fails after code generation, `chat-panel.tsx` initiates an autonomous repair request to `/api/agent` (`mode: 'auto-fix'`). If the auto-healed candidate passes validation and bundling, it is committed seamlessly.

---

### Phase 9 — Stream Interruption & Resilience

#### Finding 9.1: No Idempotency, Session Resume, or Cancellation Controls
- **Severity:** `P1` (Reliability Gap)
- **Exact Path:** [chat-panel.tsx:376-408](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L376-L408)
- **Current Behavior:**
  1. The UI does not provide a "Stop Generating" or cancellation button. Once `handleSubmit()` starts, the user must wait for completion or timeout.
  2. If the browser connection drops or network hiccups mid-stream, the stream aborts, any tokens generated up to that point are discarded, and the user must start over from scratch.
  3. No `eventId` or `runId` is attached to stream chunks to allow reconnecting to an ongoing build.

---

### Phase 10 — Natural Language & Regex Routing

#### Finding 10.1: Widespread Hardcoded Natural Language Keyword Regexes
- **Severity:** `P1` (Divergence from Semantic Intent Standard)
- **Exact Paths:**
  - [chat-panel.tsx:341-346](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L341-L346):
    ```ts
    const isRuntimeFix = Boolean(runtimeError && /(fix|repair|error|broken|bug|issue|solve)/i.test(query));
    const isScreenshotFix = Boolean(
      hasExistingFiles &&
      currentImage &&
      (/(fix|repair|solve|change|update|modify|issue|bug|problem|error|not working|broken)/i.test(query) ||
       /(সমস্যা|সমাধান|ঠিক|সংশোধন|কাজ করছে না|ভুল|পরিবর্তন)/i.test(query))
    );
    ```
  - [intent-contract.ts:220-227](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/ai/intent-contract.ts#L220-L227):
    ```ts
    if (/landings*page/i.test(trimmed)) requirements.push(...);
    if (/navbar|navigation/i.test(trimmed)) requirements.push(...);
    if (/hero/i.test(trimmed)) requirements.push(...);
    if (/pricing/i.test(trimmed)) requirements.push(...);
    if (/testimonial/i.test(trimmed)) requirements.push(...);
    ```
  - [intent-contract.ts:256-258](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/ai/intent-contract.ts#L256-L258):
    ```ts
    const isSmallerLogo = /logo/i.test(trimmed) && /(?:smaller|reduce|20%|size)/i.test(trimmed);
    ```
  - [intent-contract.ts:283](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/ai/intent-contract.ts#L283):
    ```ts
    if (/hamburger|mobiles*menu/i.test(trimmed)) { ... }
    ```
  - [project-retrieval.ts:232](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/workspace/project-retrieval.ts#L232):
    ```ts
    if (/navbar|header|logo|nav/i.test(clean)) { ... }
    ```
- **Why It Matters:** True semantic intent parsing must understand intent through model intelligence or embedding projections. Relying on specific keyword stems (e.g. `20%`, `smaller`, `hamburger`, `সমস্যা`) means if a user writes *"Make the brand mark slightly more compact"* or asks in German, Italian, or Japanese, the specialized criteria and retrieval paths will fail to trigger.

---

### Phase 11 — Image / Screenshot UX

#### Finding 11.1: Vision Capabilities are Technically Strong but UI-Opaque
- **Severity:** `P2` (UX Opacity)
- **Exact Path:** [chat-panel.tsx:916-935](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L916-L935) and [agent/route.ts:124-132](file:///c:/Users/User/Desktop/opendrok/opendorkweb/app/api/agent/route.ts#L124-L132)
- **Current Behavior:** Image upload, clipboard paste (Ctrl+V), base64 preview thumbnails, and MIME/size validation work reliably. The backend generates a structured `VisualSpec` (identifying layout type, colors, components) and feeds it to Gemini/Groq vision models.
- **UX Gap:** The UI provides zero feedback that visual analysis is occurring. The user does not see what the vision model extracted (e.g. "Detected dark theme, hero layout with 2 CTA buttons").

---

## 5. Bolt-Style UX Gap Matrix

| Feature / Capability | Bolt.new Standard | Current opendork Implementation | Score | Evidence File & Line |
| :--- | :--- | :--- | :--- | :--- |
| **A. Immediate Token Streaming** | Natural language streams token-by-token immediately | Suppressed in build mode; only shown in chat mode | **FAIL** | [chat-panel.tsx:406](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L406) |
| **B. Visible Work State** | Continuous live progress log | Static hardcoded card text | **PARTIAL** | [chat-panel.tsx:884](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L884) |
| **C. Structured Execution Plan** | LLM-generated task checklist | Hardcoded 4-step client template | **FAIL** | [bolt-plan-card.tsx:58](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/bolt-plan-card.tsx#L58) |
| **D. Live Plan Status** | Real pending -> running -> completed/failed | Heuristic state machine tied to stream EOF | **PARTIAL** | [bolt-plan-card.tsx:62](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/bolt-plan-card.tsx#L62) |
| **E. File Read Visibility** | Shows files read for context | Not emitted or shown | **NOT IMPLEMENTED** | Missing in `stream-events.ts` |
| **F. File Write Visibility** | Shows file path and progress | Inferred from token regex before validation | **PARTIAL** | [chat-panel.tsx:427](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L427) |
| **G. Dependency Install Visibility** | Real terminal output of `pnpm add` | Step 2 turns green automatically | **COSMETIC** | [bolt-plan-card.tsx:67](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/bolt-plan-card.tsx#L67) |
| **H. Build / Verification Visibility** | Live terminal build progress | In-browser esbuild check logged to console | **PARTIAL** | [chat-panel.tsx:585](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L585) |
| **I. Real-time Progress Indicator** | Percentage / file count updates | Shows active file name while streaming | **PASS** | [chat-panel.tsx:428](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L428) |
| **J. Chat ↔ Editor Sync** | Instant file update with diff highlighting | Updates on commit; no diff view | **PARTIAL** | [code-editor.tsx:430](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/code-editor.tsx#L430) |
| **K. Chat ↔ Preview Sync** | Live hot-reload on commit | Instant re-render upon `setFiles` | **PASS** | [preview-pane.tsx:408](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/preview-pane.tsx#L408) |
| **L. Error Visibility** | Red failed step with error diagnostic | Diagnostic message in chat; plan card cannot fail | **PARTIAL** | [bolt-plan-card.tsx:20](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/bolt-plan-card.tsx#L20) |
| **M. Actual vs Claimed Truthfulness** | UI actions strictly bound to backend ops | File writes & dep configs claimed prematurely | **FAIL** | [bolt-plan-card.tsx:67](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/bolt-plan-card.tsx#L67) |
| **N. Run IDs** | Unique run ID on all events | Intent ID on header; missing in event payload | **PARTIAL** | [agent/route.ts:240](file:///c:/Users/User/Desktop/opendrok/opendorkweb/app/api/agent/route.ts#L240) |
| **O. Step IDs** | Server-emitted step IDs | Synthesized locally on client (`step-<path>`) | **PARTIAL** | [chat-panel.tsx:438](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L438) |
| **P. Event IDs / Sequence** | Monotonic event sequence & UUID | Monotonic `sequenceId`; no UUID | **PARTIAL** | [stream-events.ts:35](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/ai/stream-events.ts#L35) |
| **Q. Replay / Resume** | Resumable streams on disconnect | Stream disconnect requires full restart | **NOT IMPLEMENTED** | Client-side only |
| **R. Cancellation Controls** | "Stop" button halts LLM & execution | No cancel/abort button in chat UI | **NOT IMPLEMENTED** | [chat-panel.tsx:949](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L949) |
| **S. Revision / Concurrency** | Optimistic locking on project state | Monotonic revision checked before commit | **PASS** | [chat-panel.tsx:720](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L720) |
| **T. Candidate Workspace** | Staged before commit | Evaluated in-memory before store mutation | **PASS** | [chat-panel.tsx:536](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L536) |
| **U. Evidence-backed Completion** | Verified against criteria | Verified against static AST checks & bundler | **PASS** | [chat-panel.tsx:570](file:///c:/Users/User/Desktop/opendrok/opendorkweb/components/builder/chat-panel.tsx#L570) |
| **V. Language-Agnostic Intent** | Pure semantic embedding understanding | Multilingual vector space + hardcoded regexes | **PARTIAL** | [semantic-classifier.ts:51](file:///c:/Users/User/Desktop/opendrok/opendorkweb/lib/ai/semantic-classifier.ts#L51) |
| **W. Screenshot Workflow** | Vision analysis -> plan -> code | Multimodal stream + VisualSpec pipeline | **PASS** | [agent/route.ts:127](file:///c:/Users/User/Desktop/opendrok/opendorkweb/app/api/agent/route.ts#L127) |

---

## 6. User Journey Scenario Reproductions

### Scenario A: New SaaS Landing Page
> **Prompt:** *"Build me a modern SaaS landing page with a navbar, hero section, pricing, testimonials, and responsive mobile menu."*

- **Current User Experience:**
  1. Prompt submitted.
  2. The input field disables. The chat area displays a static `BoltPlanCard` with the canned text: *"I'll build a complete NEXTJS application. Let's inspect the setup and create the components."*
  3. No conversational text streams.
  4. The 4 generic milestones appear. Milestone 2 (*"Configure core dependencies"*) turns green immediately.
  5. The card shows `└ ✏️ Wrote app/page.tsx`, then `components/Navbar.tsx`, etc.
  6. Milestone 4 turns green.
  7. The final message is displayed. Code appears in Monaco and preview loads.
- **Bolt.new Standard Experience:**
  1. AI immediately streams natural language explaining its architectural choices (Tailwind styling, Lucide icons, responsive drawer design).
  2. Structured plan appears with explicit project milestones:
     - `✓ Configure Tailwind and theme tokens`
     - `✓ Create Navbar with responsive toggle`
     - `◉ Build Hero section with CTA`
     - `○ Build Pricing section with billing toggle`
     - `○ Build Testimonials grid`
  3. Under each step, live file progress is displayed.
  4. Container build finishes and preview renders.
- **Gap & Severity:** `P0` (Missing natural language streaming; missing task-specific plan decomposition).

---

### Scenario B: Surgical Component Edit
> **Prompt:** *"Make the navbar logo 20% smaller."*

- **Current User Experience:**
  1. Intent classifier detects `MODIFY_FEATURE`.
  2. Hardcoded regex matches `/logo/i` and `/20%/i`.
  3. Chat shows *"Analyzing requested changes and updating your NEXTJS application..."*.
  4. Code changes stream in background.
  5. Candidate validation verifies criteria.
  6. File committed.
- **Bolt.new Standard Experience:**
  1. AI explains: *"I will locate the logo in `components/navbar.tsx` and reduce its dimensions from `h-10 w-auto` to `h-8 w-auto`."*
  2. Plan shows: *"Update logo dimensions in Navbar"*.
  3. Monaco highlights the exact diff lines in the file.
  4. Preview hot-reloads the navbar.
- **Gap & Severity:** `P1` (No explanation streamed during edit; no editor diff view).

---

### Scenario C: Behavioral Feature Addition
> **Prompt:** *"Add a mobile hamburger menu to the navbar."*

- **Current User Experience:**
  1. Intent classifier matches `/hamburger|mobiles*menu/i`.
  2. Candidate is generated.
  3. Acceptance verifier checks for button with aria-label or onClick.
  4. Code committed.
- **Bolt.new Standard Experience:**
  1. AI outlines plan: add mobile open/close state, hamburger button trigger, and animated drawer.
  2. Individual steps advance live.
  3. Preview viewport switches to mobile to showcase the new menu.
- **Gap & Severity:** `P1` (No mobile viewport auto-suggestion; generic plan card).

---

### Scenario D: Screenshot-to-Code Recreation
> **Prompt + Image:** *"Recreate this design."*

- **Current User Experience:**
  1. Image thumbnail displays in user bubble.
  2. Backend generates `VisualSpec` and streams to vision model.
  3. Code generated, validated, and rendered.
- **Bolt.new Standard Experience:**
  1. AI summarizes image visual breakdown ("Detected dark mode SaaS dashboard with 3 sidebar navigation links and revenue chart").
  2. Plan decomposes design elements into component creation tasks.
  3. Visual verification compares output against uploaded reference.
- **Gap & Severity:** `P2` (Lack of visual analysis feedback in chat).

---

## 7. Top 10 Blockers Preventing a Bolt-Quality AI Builder Experience

1. **Natural Language Streaming Suppression in Build Mode:** `chat-panel.tsx` drops `text_delta` chunks while building, hiding the AI's step-by-step thinking and replacing it with a static, hardcoded string.
2. **Hardcoded, Static Plan Card:** `BoltPlanCard` renders an unchanging 4-step checklist rather than model-generated, prompt-specific task items (e.g. Hero, Navbar, Pricing).
3. **Cosmetic Milestone Progress Logic:** Milestones transition to `'completed'` via client heuristics (e.g. dependency configuration turns green upon any file streaming) without backend evidence.
4. **Premature "Wrote <file>" Status:** File write operations are displayed during initial token streaming before the candidate is validated, compiled, or committed to CAS.
5. **Lack of File Read / Context Transparency:** The retrieval context mechanism does not emit `FILE_READ` events, leaving the user unaware of which existing files the AI referenced.
6. **Monaco Keystrokes Silently Invalidate Running AI Generations:** Unvalidated typing in Monaco increments the workspace revision, causing background AI builds to fail the optimistic concurrency check upon completion.
7. **No Diff Editor in Monaco:** Monaco mounts as a standard single-buffer editor without side-by-side or inline diff highlighting for AI changes.
8. **Plan Card Lacks Error / Failure State:** The `PlanMilestone` interface only supports `'pending'`, `'running'`, and `'completed'`; it cannot display an inline failed step when validation or builds fail.
9. **No Stream Cancellation / Stop Button:** The user cannot abort an in-flight generation; if the stream drops, there is no session resume or replay capability.
10. **Hardcoded Natural Language Regex Gates:** Intent routing and acceptance criteria still rely on English and Bengali regex keywords rather than pure semantic model understanding.

---

## 8. What Already Works (Production Strengths)

- **Cloud MicroVM Execution & HTTP Smoke Gate (Gate A):** Empirically verified on commit `45784c1b7a65cbb298b30b4c4371a95b9d520426`. Real microVMs run Next.js, Vite, and Astro with detached process management, readiness polling, HTTP 200 response validation, and clean resource destruction (`deleteOrphanSnapshots: true`).
- **Atomic Candidate Validation & Zero Partial Mutation:** Corrupt, invalid, or crashing code is rejected before workspace commit, preserving pristine files byte-for-byte.
- **Optimistic Concurrency Control (CAS):** Monotonic revision counter prevents lost updates between concurrent edits.
- **Autonomous Build Repair:** In-browser esbuild compilation errors trigger an autonomous `auto-fix` self-healing cycle.
- **Multi-Engine Preview Architecture:** Supports isolated cloud microVMs (`@vercel/sandbox`), local in-browser compilation (esbuild/Babel), and Nodebox container runtimes with viewport switching.
- **Multi-Modal Vision Pipeline:** Clipboard image pasting, thumbnail rendering, and `VisualSpec` extraction integrated into Gemini and Groq vision streams.

---

## 9. Recommended Remediation Phases

### Phase 1: Streaming Protocol & Natural Language Visibility (Priority P0)
- Update `chat-panel.tsx` build loop to process `text_delta` events and render streaming markdown prose inside the active assistant message card.
- Emit structured plan steps from `/api/agent` (e.g. via function calling or `<PLAN>` blocks) with unique step IDs and human-readable task labels.

### Phase 2: Dynamic Plan Execution Engine (Priority P1)
- Refactor `BoltPlanCard` to accept dynamic, task-specific plan items instead of the hardcoded 4-step checklist.
- Add `'failed'` status to `PlanMilestone` with red status icon and error diagnostic drawer.
- Ensure milestones advance only when the corresponding operation (read, generate, compile, commit) actually succeeds.

### Phase 3: Truthful File Operations & Read Transparency (Priority P1)
- Emit `FILE_READ` events from `buildRetrievalContext` and display them in the collapsible drawer as *"Read X files for context"*.
- Change streaming file step from `"Wrote <file>"` to `"Generating <file>"`, updating to `"Wrote"` only after candidate validation and CAS commit succeed.

### Phase 4: Monaco Diff Integration & Concurrency Buffering (Priority P1)
- Introduce a working buffer or dirty-state management in Monaco so that user keystrokes during an active AI generation do not immediately trigger a fatal concurrency collision.
- Integrate Monaco Diff Editor (`<DiffEditor />`) to allow users to review side-by-side or inline diffs of AI-modified files.

### Phase 5: Stream Resilience & Cancellation (Priority P2)
- Add an AbortController-backed "Stop Generating" button to the chat input bar.
- Attach unique `runId` and `eventId` to all SSE payloads to facilitate stream reconnect and debugging.

### Phase 6: Language-Agnostic Semantic Cleanup (Priority P2)
- Eliminate remaining English and Bengali keyword regexes in `chat-panel.tsx`, `intent-contract.ts`, and `project-retrieval.ts`, replacing them with model-driven semantic extraction.

---

## 10. Production Readiness Verdict

```text
======================================================================
               PRODUCTION READINESS VERDICT: UX & STREAMING
======================================================================
                         CONDITIONALLY READY
======================================================================
```

**Verdict Rationale:**
- **Backend & Sandbox Infrastructure:** Fully verified and **PRODUCTION READY** (all Gates A–H certified on commit `45784c1b7a65cbb298b30b4c4371a95b9d520426`).
- **User Interaction Model:** **NOT READY** for a Bolt.new-quality experience until natural language streaming is unblocked during builds, the plan card is decoupled from hardcoded templates, and premature file write claims are bound to authoritative commit evidence.
