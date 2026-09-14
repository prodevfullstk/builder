# Requirements Specification — Phase AI Final Runtime, Browser & Semantic Closure

**Project:** `opendorkweb`  
**Repository:** `https://github.com/prodevfullstk/builder.git`  
**Status:** FROZEN REQUIREMENT SPECIFICATION  
**Authoritative Standard:** Production Gate Closure — Evidence-First, Zero-Assumption

---

## 0. Authoritative Mandate & Invariants

> **CRITICAL INVARIANT:**  
> PRODUCTION READY requires every mandatory gate to have empirical PASS evidence.  
> No `UNPROVEN` or `FAIL` item may coexist with a production-ready certification.

### 0.1 Inviolable Rules
1. **Zero Evidence Fabrication:**
   - Simulated scores (e.g. `simulatedScore: 0.98`), synthetic visual metrics, hardcoded `passed` defaults, hardcoded confidence numbers (e.g. `confidence: 0.95`), and source-code token heuristics masquerading as runtime/browser execution are strictly forbidden in production pathways.
   - Any evidence object must be generated cryptographically and dynamically by the runner executing the candidate. Caller-forged evidence must be rejected.
2. **Security & Invariant Preservation:**
   - Supabase RLS policies, tenant boundaries, authentication session verification, MCP authorization, CAS monotonic revision checks, sandbox path/symlink containment, distributed rate limiting, and requirements protections must never be bypassed or weakened.
3. **Host Isolation Guarantee:**
   - Untrusted generated code must NEVER execute on the Next.js/application server host (`NODE_ENV === 'production'`).
   - Browser and runtime verification must execute against an isolated sandbox microVM (e.g. `@vercel/sandbox`) or an explicitly isolated production runner.
4. **Fail-Closed Verification:**
   - If sandbox infrastructure, network connectivity, browser runner, or credentials fail or exhaust quota, the system MUST emit `*_VERIFICATION_UNAVAILABLE` and fail closed.
   - Authoritative CAS commit must strictly reject any candidate missing mandatory verification.

---

## 1. Gate A — Real Runtime Startup + HTTP Smoke

### 1.1 Objective
Move beyond build compilation alone. Untrusted candidate workspaces must execute:
`prepare` $\to$ `install` $\to$ `build` $\to$ `start` $\to$ `readiness polling` $\to$ `HTTP smoke request` $\to$ `response validation` $\to$ `terminate process` $\to$ `cleanup sandbox`.

### 1.2 Evidence Structure
The runtime runner must cryptographically generate and return:
```ts
export interface RealRuntimeEvidence {
  candidateHash: string;
  projectId: string;
  revision: number;
  buildEvidenceId: string;
  runtimeStatus: 'passed' | 'failed' | 'unavailable' | 'not_run';
  startStatus: 'started' | 'failed' | 'not_run';
  readinessStatus: 'ready' | 'timeout' | 'failed';
  httpStatus?: number;
  httpUrl?: string;
  responsePreview?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  processTerminated: boolean;
  cleanupCompleted: boolean;
  error?: string;
}
```

### 1.3 Framework Support
- **Next.js:** Native `npm run build` followed by `npm run start` or `npx next start -p <port>`.
- **Vite:** Production build `npm run build` served via static server (e.g. `npx serve dist -l <port>` or `npx vite preview --port <port>`).
- **Astro:** Production build `npm run build` served via preview server (`npx astro preview --port <port>`).

### 1.4 Failure Modes & Negative Gates
- Candidates that fail to start or return non-200 / error payloads MUST fail runtime verification and be rejected by CAS.
- Subprocesses must be reliably killed and sandboxes cleaned up upon completion or failure.

---

## 2. Gate B — Real Browser Screenshot Capture & Visual Comparison

### 2.1 Objective
Automated server-side screenshot capture must execute against the live application running in the isolated sandbox using headless browser automation (Playwright/Puppeteer).

### 2.2 Execution Path
`candidate` $\to$ `sandbox build` $\to$ `sandbox runtime` $\to$ `browser connects to sandbox endpoint` $\to$ `navigate to page` $\to$ `wait for readiness` $\to$ `capture screenshot bytes` $\to$ `calculate SHA-256 digest` $\to$ `compare against reference buffer` $\to$ `generate visual evidence` $\to$ `terminate browser` $\to$ `terminate runtime`.

### 2.3 Evidence Structure
```ts
export interface RealVisualEvidence {
  candidateHash: string;
  projectId: string;
  revision: number;
  screenshotSha256: string;
  referenceSha256?: string;
  similarity: number; // 0.0 - 1.0, calculated strictly from perceptual byte diff
  viewport: { width: number; height: number };
  url: string;
  capturedAt: string;
  captureMethod: 'playwright' | 'puppeteer' | 'client_signed';
  verified: boolean;
  error?: string;
}
```

### 2.4 Integrity & Negative Gates
- Pathways accepting `simulatedScore` or `screenshotCaptured: true` without byte artifacts are completely rejected.
- If browser automation fails or is not available, emit `VISUAL_VERIFICATION_UNAVAILABLE` and reject mandatory visual commits.
- Candidates with perceptual similarity below threshold (e.g. 0.85) when visual match is required must fail verification.

---

## 3. Gate C — Real Behavioral Browser Verification

### 3.1 Objective
Static AST heuristics (`isOpen`, `onClick`, `aria-label`, `md:hidden`) are insufficient for behavioral criteria. Behavioral verification must interact with the live running page in a real browser session.

### 3.2 Execution Path
1. Launch browser against running sandbox endpoint.
2. Set specified viewport (e.g. mobile 375x667 for responsive menus).
3. Locate interactive element (button, link, form).
4. Perform user action (`click`, `fill`, `hover`).
5. Wait for and assert DOM mutation / visibility change (e.g. menu drawer visible).
6. Capture behavioral evidence and session log.
7. Clean up browser and runtime.

### 3.3 Behavioral Evidence Structure
```ts
export interface RealBehavioralEvidence {
  criterionId: string;
  candidateHash: string;
  projectId: string;
  revision: number;
  browserSessionId: string;
  action: 'click' | 'resize' | 'navigate' | 'type' | 'scroll';
  target: string;
  observedResult: string;
  assertion: string;
  passed: boolean;
  capturedAt: string;
  error?: string;
}
```

### 3.4 Anti-Forgery Negative Gate
A candidate containing static source tokens (`setIsOpen`, `toggleMenu`) whose interactive DOM button does not open the menu MUST fail behavioral verification and be rejected.

---

## 4. Gate D & E — True Semantic, Language-Agnostic Intent & Production Route

### 4.1 Objective
Eliminate all human-language regexes (`\b(add|fix|make|refactor)\b`) and static fallback defaults with hardcoded `confidence: 0.95`.
Intent classification must be performed via semantic model evaluation producing dynamic, calibrated confidence.

### 4.2 Intent Contract
```ts
export type AgentAction =
  | 'CREATE_PROJECT'
  | 'ADD_FEATURE'
  | 'MODIFY_FEATURE'
  | 'FIX_BUG'
  | 'REFACTOR'
  | 'CONTINUE_BUILD'
  | 'VISUAL_RECREATE'
  | 'INSPECT'
  | 'EXPLAIN'
  | 'QUESTION';

export interface SemanticIntentContract {
  action: AgentAction;
  language: string;
  confidence: number; // 0.0 - 1.0, calibrated model score
  targetFiles?: string[];
  requirements: string[];
  framework?: 'nextjs' | 'vite' | 'astro' | 'node';
  visualRequest?: boolean;
  mutating: boolean;
  reasoning: string;
}
```

### 4.3 Multilingual Standard
The semantic classifier must correctly route equivalent prompts across English, Bengali, Hindi, Spanish, French, Arabic, Japanese, and adversarial verb-free prompts to identical semantic actions without relying on language-specific regex dictionaries.

### 4.4 Unified Production Routing
The authoritative route `POST /api/agent` must directly invoke the semantic intent classifier. Duplicate or conflicting regex routers across the codebase must be decommissioned.

---

## 5. Gate F — Evidence Authentication & Binding

Every evidence artifact (native build, runtime smoke, visual capture, behavioral test) must be bound to:
1. `candidateHash` (deterministic canonical SHA-256 of candidate files)
2. `projectId` (matching authenticated project)
3. `revision` (matching base revision)
4. `timestamp` (fresh within validity window, not prior to candidate creation)

Reused, forged, mismatched, or stale evidence must be rejected by `commitVerifiedCandidate`.

---

## 6. Gate G & H — End-to-End Production Verification & Sandbox Tests

End-to-end integration tests must exercise the entire chain:
`Prompt` $\to$ `Semantic Intent` $\to$ `Candidate Generation` $\to$ `Static Validation` $\to$ `Native Build` $\to$ `Runtime Start` $\to$ `HTTP Smoke` $\to$ `Browser Verification` $\to$ `CAS Commit`.

Negative paths must strictly verify rollback and fail-closed isolation on build failure, runtime failure, visual mismatch, behavioral failure, and CAS concurrency conflicts.
