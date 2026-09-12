# Diagnosing Bugs & Auto-Fix Discipline

A disciplined diagnosis and self-healing loop for runtime errors, compilation bugs, and broken preview sandboxes.

## Phase 1: Analyze the Error Signal
- Examine the exact error message, stack trace, and line numbers.
- Pinpoint the exact failure category:
  - **Syntax Error** (unclosed JSX tag, unexpected token).
  - **Missing / Invalid Import** (importing a non-existent file or wrong named export).
  - **Type or Undefined Error** (e.g., Cannot read property of undefined).
  - **Hydration / SSR Mismatch** (window is not defined, date/time differences).

## Phase 2: Reproduce & Isolate the Seam
- Locate the specific file and function responsible for the failure.
- Do NOT jump to random rewrites. Isolate the minimal breaking code hunk.

## Phase 3: Rank Hypotheses
- State the most probable root cause before editing.
- Ensure the proposed change addresses the core issue without altering unrelated working functionality.

## Phase 4: Surgical Fix
- Apply minimal, precise edits to resolve the error.
- **NEVER delete working components, features, or state** to silence an error.
- Ensure all required dependencies exist in package.json.
- If a missing component was imported, create that component with full implementation.

## Phase 5: Verify & Clean
- Ensure the fix passes syntax and type checks.
- Keep other files intact and verify that the preview can compile cleanly.
