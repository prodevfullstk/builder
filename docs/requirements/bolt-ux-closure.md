# Bolt-Style AI Execution UX — Final Closure Requirements Specification

**Document**: `docs/requirements/bolt-ux-closure.md`  
**Status**: Authoritative Implementation Contract  
**Objective**: Close remaining gaps identified in `docs/audits/bolt-ux-closure-audit.md` to achieve true Bolt.new-grade AI execution UX.

---

## 1. Scope of Remediation

| Requirement ID | Area | Target Specification |
|:---|:---|:---|
| **REQ-01** | Dynamic Multi-Feature Milestone Synthesis | Extensible semantic decomposition of arbitrary user prompts into 3–5 meaningful, prompt-grounded milestones without hardcoded category maps. |
| **REQ-02** | Language-Agnostic Intent & Criteria | Generalize semantic classification and acceptance criteria formulation to operate across arbitrary languages without maintaining multilingual regex dictionaries. |
| **REQ-03** | Structured Property-Level Acceptance Criteria | Convert lexical regex matchers (e.g. logo, mobile menu) into structured `{ target, property, operation, magnitude }` semantic verifications. |
| **REQ-04** | Comprehensive Behavioral Test Suite | Add real integration tests for Prompts A–F and multilingual queries without relying on static source string assertions. |

---

## 2. Technical Architecture & Implementation Details

### 2.1 Extensible Semantic Prompt Decomposition (`lib/ai/intent-contract.ts`)
- Rather than checking only for SaaS landing page elements (`/navbar|hero|pricing/`), implement a domain-agnostic feature clause extractor:
  1. Detects coordinating conjunctions, comma-separated feature lists, "with / including / containing" clauses across natural language patterns.
  2. Extracts distinct feature targets (e.g. "search, cart and checkout" → Milestone 1: "Implement product catalog & search interface", Milestone 2: "Build shopping cart & checkout flow").
  3. Synthesizes 3–5 cohesive milestones for project creation and surgical milestones for feature edits.
  4. Guarantees that Prompts A through F all produce multiple distinct, prompt-specific milestones.

### 2.2 Truly Language-Agnostic Semantic Understanding (`lib/ai/semantic-classifier.ts`)
- Replace language-specific keyword arrays with a generalized structural intent model:
  1. Universal punctuation & structural inquiry detection.
  2. Context-aware mutation weighting based on workspace state (`fileCount`, `hasImage`, `activeFile`).
  3. Decouple semantic classification from language-specific stem lists.
  4. Dynamically compute confidence scores based on probability margins.

### 2.3 Structured Semantic Criteria Formulation
- Acceptance criteria must declare:
  - `type`: `build_passes`, `route_exists`, `ui_property`, `component_exists`, `responsive_behavior`, `interaction`, `symbol_exists`, `security_invariant`.
  - `target`: The specific semantic element or file target.
  - `verification`: Verification method (`native_build`, `static_ast`, `delta_ast`, `behavioral`).

### 2.4 End-to-End Test Suite Verification (`test/phase-ai-execution-ux.test.ts`)
- Test Prompts A, B, C, D, E, F to verify that each generates $\ge 3$ distinct, non-generic milestones.
- Test semantic equivalence across English, Bengali, Spanish, French, Hindi, Arabic, Japanese, German, Russian.
- Ensure all 184+ existing tests pass with 0 regressions.
