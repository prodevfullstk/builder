import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateCandidateChanges } from '../lib/validation/candidate-pipeline';

describe('Mutation Boundary & Candidate Gating (P0-B, P0-C)', () => {
  const currentNextjsFiles = {
    'package.json': JSON.stringify({ name: 'my-app', dependencies: { next: '^15.0.0', react: '^19.0.0' } }, null, 2),
    'app/layout.tsx': 'export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }',
    'app/page.tsx': 'export default function Page() { return <h1>Home</h1>; }',
  };

  it('rejects an auto-fix candidate that deletes app/layout.tsx framework entry', async () => {
    // Malicious or buggy repair candidate deletes app/layout.tsx
    const buggyRepairCandidate = {
      'app/layout.tsx': null, // Staged deletion of required root layout
      'app/page.tsx': 'export default function Page() { return <h1>Repaired</h1>; }',
    };

    const evalResult = await evaluateCandidateChanges({
      projectId: 'test-proj',
      framework: 'nextjs',
      currentFiles: currentNextjsFiles,
      candidateFiles: buggyRepairCandidate,
      isNewBuild: false,
    });

    assert.strictEqual(evalResult.accepted, false);
    assert.ok(evalResult.diagnostics.length > 0);
    assert.match(evalResult.diagnostics.join(' '), /layout/i);
    // Preserves committedFiles as currentFiles
    assert.deepStrictEqual(evalResult.committedFiles, currentNextjsFiles);
  });

  it('rejects a Monaco Ask AI edit that injects an API key / secret into a file', async () => {
    const candidateWithSecret = {
      'app/page.tsx': 'export default function Page() { const apiKey = "sk-proj1234567890abcdefghij"; return <div>Leaked</div>; }',
    };

    const evalResult = await evaluateCandidateChanges({
      projectId: 'test-proj',
      framework: 'nextjs',
      currentFiles: currentNextjsFiles,
      candidateFiles: candidateWithSecret,
      isNewBuild: false,
    });

    assert.strictEqual(evalResult.accepted, false);
    assert.match(evalResult.diagnostics.join(' '), /secret|key|security/i);
    assert.deepStrictEqual(evalResult.committedFiles, currentNextjsFiles);
  });

  it('accepts a safe, valid surgical edit and produces evidence with framework version', async () => {
    const validEdit = {
      'app/page.tsx': 'export default function Page() { return <h1>Home - Updated Successfully</h1>; }',
    };

    const evalResult = await evaluateCandidateChanges({
      projectId: 'test-proj',
      framework: 'nextjs',
      currentFiles: currentNextjsFiles,
      candidateFiles: validEdit,
      isNewBuild: false,
    });

    assert.strictEqual(evalResult.accepted, true);
    assert.strictEqual(evalResult.committedFiles['app/page.tsx'], validEdit['app/page.tsx']);
    assert.strictEqual(evalResult.evidence.framework, 'nextjs');
    assert.ok(Boolean(evalResult.evidence.timestamp));
    assert.ok(evalResult.evidence.checks.length > 0);
  });
});
