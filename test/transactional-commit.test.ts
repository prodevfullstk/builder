import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateCandidateChanges } from '../lib/validation/candidate-pipeline';

describe('Transactional Commit Boundary & Zero Partial Mutation (P1-A)', () => {
  const initialWorkspaceState = {
    'package.json': JSON.stringify({ name: 'safe-app', dependencies: { vite: '^5.0.0' } }),
    'index.html': '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
    'src/main.tsx': 'import React from "react";\nconsole.log("clean");',
    'src/App.tsx': 'export default function App() { return <div>Safe Working App</div>; }',
  };

  it('preserves initial workspace files byte-for-byte when candidate validation fails', async () => {
    const corruptCandidate = {
      'src/App.tsx': 'export default function App() { const token = "ghp_111111111122222222223333333333444444"; return <div/>; }',
    };

    const evalResult = await evaluateCandidateChanges({
      projectId: 'trans-1',
      framework: 'vite',
      currentFiles: initialWorkspaceState,
      candidateFiles: corruptCandidate,
      isNewBuild: false,
    });

    assert.strictEqual(evalResult.accepted, false);
    // Workspace must not contain the corrupted file
    assert.deepStrictEqual(evalResult.committedFiles, initialWorkspaceState);
    assert.strictEqual(evalResult.committedFiles['src/App.tsx'], initialWorkspaceState['src/App.tsx']);
  });

  it('atomically commits candidate when both candidate validation and compilation simulation pass', async () => {
    const validCandidate = {
      'src/App.tsx': 'export default function App() { return <div>Updated Clean App</div>; }',
      'src/components/Header.tsx': 'export function Header() { return <header>Header</header>; }',
    };

    const evalResult = await evaluateCandidateChanges({
      projectId: 'trans-2',
      framework: 'vite',
      currentFiles: initialWorkspaceState,
      candidateFiles: validCandidate,
      isNewBuild: false,
    });

    assert.strictEqual(evalResult.accepted, true);
    assert.strictEqual(evalResult.committedFiles['src/App.tsx'], validCandidate['src/App.tsx']);
    assert.strictEqual(evalResult.committedFiles['src/components/Header.tsx'], validCandidate['src/components/Header.tsx']);
    // Untouched files preserved
    assert.strictEqual(evalResult.committedFiles['src/main.tsx'], initialWorkspaceState['src/main.tsx']);
    assert.strictEqual(evalResult.committedFiles['index.html'], initialWorkspaceState['index.html']);
  });

  it('rejects candidate with missing required entry and aborts commit', async () => {
    const candidateDeletingEntry = {
      'index.html': null, // Deletion of root index.html
      'src/App.tsx': 'export default function App() { return <div/>; }',
    };

    const evalResult = await evaluateCandidateChanges({
      projectId: 'trans-3',
      framework: 'vite',
      currentFiles: initialWorkspaceState,
      candidateFiles: candidateDeletingEntry,
      isNewBuild: false,
    });

    assert.strictEqual(evalResult.accepted, false);
    assert.deepStrictEqual(evalResult.committedFiles, initialWorkspaceState);
    assert.ok(evalResult.committedFiles['index.html']);
  });
});
