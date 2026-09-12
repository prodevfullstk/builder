import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateCandidateChanges } from '../lib/validation/candidate-pipeline';

describe('Candidate Validation Pipeline & State Commit Gate', () => {
  const baseFiles: Record<string, string> = {
    'package.json': JSON.stringify({
      name: 'base-app',
      dependencies: {
        next: '^15.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
    }),
    'next.config.ts': 'export default {};',
    'app/layout.tsx': 'export default function Layout({ children }: any) { return children; }',
    'app/page.tsx': 'export default function Page() { return <h1>Original State</h1>; }',
  };

  it('accepts valid candidate changes and returns committed files with validation evidence', async () => {
    const candidateFiles: Record<string, string> = {
      'app/page.tsx': 'export default function Page() { return <h1>Updated State</h1>; }',
      'app/about/page.tsx': 'export default function About() { return <h2>About Us</h2>; }',
    };

    const evaluation = await evaluateCandidateChanges({
      projectId: 'proj_test_1',
      framework: 'nextjs',
      currentFiles: baseFiles,
      candidateFiles,
    });

    assert.strictEqual(evaluation.accepted, true);
    assert.ok(evaluation.committedFiles);
    assert.strictEqual(evaluation.committedFiles['app/page.tsx'], candidateFiles['app/page.tsx']);
    assert.strictEqual(evaluation.committedFiles['app/about/page.tsx'], candidateFiles['app/about/page.tsx']);
    assert.strictEqual(evaluation.committedFiles['app/layout.tsx'], baseFiles['app/layout.tsx']);
    assert.strictEqual(evaluation.evidence.accepted, true);
    assert.ok(evaluation.evidence.validationId);
    assert.ok(evaluation.evidence.checks.length > 0);
    assert.strictEqual(evaluation.diagnostics.length, 0);
  });

  it('rejects candidate changes containing hardcoded secret keys and leaves state uncommitted', async () => {
    const candidateFilesWithSecret: Record<string, string> = {
      'app/api/route.ts': 'export const secretKey = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";',
    };

    const evaluation = await evaluateCandidateChanges({
      projectId: 'proj_test_1',
      framework: 'nextjs',
      currentFiles: baseFiles,
      candidateFiles: candidateFilesWithSecret,
    });

    assert.strictEqual(evaluation.accepted, false);
    assert.deepStrictEqual(evaluation.committedFiles, baseFiles);
    assert.strictEqual(evaluation.evidence.accepted, false);
    assert.ok(evaluation.diagnostics.some((d) => d.includes('Secret') || d.includes('GitHub Personal Access Token')));
  });

  it('rejects candidate changes that break the framework contract and preserves authoritative files', async () => {
    // Attempt to inject broken package.json missing next into nextjs project
    const breakingCandidate: Record<string, string> = {
      'package.json': JSON.stringify({
        name: 'broken',
        dependencies: {
          express: '^4.18.0',
        },
      }),
    };

    const evaluation = await evaluateCandidateChanges({
      projectId: 'proj_test_1',
      framework: 'nextjs',
      currentFiles: baseFiles,
      candidateFiles: breakingCandidate,
    });

    assert.strictEqual(evaluation.accepted, false);
    assert.deepStrictEqual(evaluation.committedFiles, baseFiles);
    assert.strictEqual(evaluation.evidence.accepted, false);
    assert.ok(evaluation.diagnostics.some((d) => d.includes("missing 'next' dependency")));
  });

  it('rejects empty candidate workspace with non-empty error', async () => {
    const evaluation = await evaluateCandidateChanges({
      projectId: 'proj_test_1',
      framework: 'nextjs',
      currentFiles: {},
      candidateFiles: {},
      isNewBuild: true,
    });

    assert.strictEqual(evaluation.accepted, false);
    assert.ok(evaluation.diagnostics.some((d) => d.includes('0 files')));
  });
});