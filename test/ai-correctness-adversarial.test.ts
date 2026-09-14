import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { validateIntent, IntentContract } from '../lib/ai/intent-contract';
import { evaluateCandidateChanges, computeCandidateHash } from '../lib/validation/candidate-pipeline';
import { commitVerifiedCandidate } from '../lib/validation/candidate-commit-service';
import { seedAuthoritativeProject, updateServerProjectWithCas } from '../lib/storage/project-authority';
import { validateImageUpload, MAX_IMAGE_SIZE_BYTES } from '../lib/vision/image-hardening';
import { parseFinalOutput } from '../lib/ai/code-parser';
import { recordVisualVerification } from '../lib/vision/visual-verifier';

describe('Antigravity Phase AI Correctness — Negative & Adversarial Vectors (SEC-AI-ADV)', () => {
  const projectId = 'adv-test-project';
  const baselineFiles = {
    'package.json': JSON.stringify({ name: 'adv-app', dependencies: { next: '^15.0.0' } }),
    'app/page.tsx': 'export default function Page() { return <h1>Original</h1>; }',
    'components/Navbar.tsx': 'export function Navbar() { return <nav>Nav</nav>; }',
    'requirements.md': '# Specs\n- Tenant isolation\n- Zero leaked credentials\n- Row-Level Security',
  };

  beforeEach(() => {
    seedAuthoritativeProject(projectId, 'test-user', 'Adv Project', 'nextjs', baselineFiles);
  });

  // 1. Rejection of malformed intent
  it('Vector 1: Rejects malformed intent object (missing id, missing targetDescription)', () => {
    const malformedIntent = {
      action: 'MODIFY_FEATURE',
      framework: 'nextjs',
      confidence: 0.9,
    };
    const res = validateIntent(malformedIntent);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('id')));
    assert.ok(res.errors.some((e) => e.includes('targetDescription')));
  });

  // 2. Rejection of unsupported action
  it('Vector 2: Rejects unsupported intent action', () => {
    const unsupportedIntent = {
      id: 'intent-bad-act',
      action: 'HACK_SERVER' as any,
      framework: 'nextjs',
      confidence: 0.9,
      targetDescription: 'test',
    };
    const res = validateIntent(unsupportedIntent);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('Invalid or unsupported intent action')));
  });

  // 3. Rejection of unknown framework
  it('Vector 3: Rejects unknown framework', () => {
    const badFrameworkIntent = {
      id: 'intent-bad-fw',
      action: 'CREATE_PROJECT',
      framework: 'ruby-on-rails' as any,
      confidence: 0.9,
      targetDescription: 'test project',
      requirements: ['req 1'],
      acceptanceCriteria: [{ id: '1', criterion: 'test', type: 'file_exists', target: 'app', verification: 'static_ast' }],
    };
    const res = validateIntent(badFrameworkIntent);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('Invalid or unsupported framework')));
  });

  // 4. Rejection of unrelated broad rewrites (minimal scope violation)
  it('Vector 4: Rejects unauthorized broad rewrite of unrelated files during targeted micro-edit', async () => {
    const intent: IntentContract = {
      id: 'intent-scope-violation',
      action: 'MODIFY_FEATURE',
      language: 'en',
      framework: 'nextjs',
      targetDescription: 'Make the navbar logo smaller',
      targetFiles: ['components/Navbar.tsx'],
      requirements: ['Reduce logo size'],
      constraints: [],
      acceptanceCriteria: [{ id: '1', criterion: 'Navbar logo adjusted', type: 'ui_property', target: 'navbar.logo', verification: 'delta_ast' }],
      confidence: 0.95,
      clarificationRequired: false,
      timestamp: new Date().toISOString(),
    };

    // Adversarial candidate modifies 4 files including package.json and other files
    const candidateFiles = {
      ...baselineFiles,
      'components/Navbar.tsx': 'export function Navbar() { return <nav className="scale-80">Nav</nav>; }',
      'package.json': JSON.stringify({ name: 'unrelated-rewrite', dependencies: { evil: '1.0.0' } }),
      'components/UnrelatedA.tsx': 'export function A() {}',
      'components/UnrelatedB.tsx': 'export function B() {}',
    };

    const evalResult = await evaluateCandidateChanges({
      projectId,
      framework: 'nextjs',
      currentFiles: baselineFiles,
      candidateFiles,
      intent,
    });

    assert.strictEqual(evalResult.accepted, false);
    const scopeCheck = evalResult.evidence.checks.find((c) => c.name === 'minimal_scope_enforcement');
    assert.ok(scopeCheck);
    assert.strictEqual(scopeCheck.status, 'failed');
  });

  // 5. Rejection of stale revision commit (CAS conflict)
  it('Vector 5: Rejects commit with stale revision', async () => {
    // Increment project revision from 1 to 2
    updateServerProjectWithCas(projectId, 1, { files: baselineFiles });

    const candidateFiles = { ...baselineFiles, 'app/page.tsx': 'export default function Page() { return <h1>V3</h1>; }' };
    const hash = computeCandidateHash(candidateFiles);

    const res = await commitVerifiedCandidate({
      projectId,
      expectedRevision: 1, // Stale! Current is 2
      candidateFiles,
      candidateHash: hash,
      validationEvidence: {
        validationId: 'val-stale',
        projectId,
        candidateHash: hash,
        timestamp: new Date().toISOString(),
        framework: 'nextjs',
        checks: [{ name: 'test', status: 'passed' }],
        accepted: true,
        diagnostics: [],
      },
      userId: 'test-user',
      authMode: 'real',
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.conflict, true);
  });

  // 6. Rejection of invalid candidate (empty workspace or missing required entry)
  it('Vector 6: Rejects invalid candidate (empty workspace)', async () => {
    const evalResult = await evaluateCandidateChanges({
      projectId,
      framework: 'nextjs',
      currentFiles: {},
      candidateFiles: {},
      isNewBuild: true,
    });

    assert.strictEqual(evalResult.accepted, false);
    assert.ok(evalResult.diagnostics.some((d) => d.includes('Candidate workspace contains 0 files')));
  });

  // 7. Rejection of failed native build
  it('Vector 7: Rejects candidate with failed native build status', async () => {
    const candidateFiles = { ...baselineFiles };
    const hash = computeCandidateHash(candidateFiles);

    const res = await commitVerifiedCandidate({
      projectId,
      expectedRevision: 1,
      candidateFiles,
      candidateHash: hash,
      validationEvidence: {
        validationId: 'val-failed-build',
        projectId,
        candidateHash: hash,
        timestamp: new Date().toISOString(),
        framework: 'nextjs',
        checks: [{ name: 'test', status: 'passed' }],
        accepted: true,
        nativeBuild: {
          attempted: true,
          status: 'failed',
          framework: 'nextjs',
          runner: 'vercel_sandbox',
          environment: 'vercel_sandbox',
          exitCode: 1,
        },
        diagnostics: [],
      },
      userId: 'test-user',
      authMode: 'real',
    });

    assert.strictEqual(res.success, false);
    assert.match(res.error!, /Native build failed/);
  });

  // 8. Rejection of failed acceptance criterion
  it('Vector 8: Rejects candidate when required acceptance criterion fails', async () => {
    const intent: IntentContract = {
      id: 'intent-fail-crit',
      action: 'MODIFY_FEATURE',
      language: 'en',
      framework: 'nextjs',
      targetDescription: 'Add about route',
      requirements: ['Add app/about/page.tsx'],
      constraints: [],
      acceptanceCriteria: [
        {
          id: 'crit-about-route',
          criterion: 'Route app/about/page.tsx exists',
          type: 'route_exists',
          target: 'app/about/page.tsx',
          verification: 'static_ast',
        },
      ],
      confidence: 0.95,
      clarificationRequired: false,
      timestamp: new Date().toISOString(),
    };

    // Candidate fails to create app/about/page.tsx
    const candidateFiles = { ...baselineFiles };

    const evalResult = await evaluateCandidateChanges({
      projectId,
      framework: 'nextjs',
      currentFiles: baselineFiles,
      candidateFiles,
      intent,
    });

    assert.strictEqual(evalResult.accepted, false);
    const critCheck = evalResult.evidence.checks.find((c) => c.name === 'acceptance_criteria_verification');
    assert.strictEqual(critCheck?.status, 'failed');
  });

  // 9. Rejection of candidate hash mismatch
  it('Vector 9: Rejects candidate when candidateHash does not match actual payload content', async () => {
    const candidateFiles = { ...baselineFiles, 'app/page.tsx': 'export default function Page() { return <h1>Modified</h1>; }' };

    const res = await commitVerifiedCandidate({
      projectId,
      expectedRevision: 1,
      candidateFiles,
      candidateHash: 'forged-hash-does-not-match',
      validationEvidence: {
        validationId: 'val-mismatch',
        projectId,
        candidateHash: 'forged-hash-does-not-match',
        timestamp: new Date().toISOString(),
        framework: 'nextjs',
        checks: [{ name: 'test', status: 'passed' }],
        accepted: true,
        diagnostics: [],
      },
      userId: 'test-user',
      authMode: 'real',
    });

    assert.strictEqual(res.success, false);
    assert.match(res.error!, /Candidate Integrity Error/);
  });

  // 10. Rejection of forged evidence (candidateHash in evidence != candidate content)
  it('Vector 10: Rejects commit when evidence candidateHash does not match candidate content', async () => {
    const candidateFiles = { ...baselineFiles };
    const actualHash = computeCandidateHash(candidateFiles);

    const res = await commitVerifiedCandidate({
      projectId,
      expectedRevision: 1,
      candidateFiles,
      candidateHash: actualHash,
      validationEvidence: {
        validationId: 'val-forged',
        projectId,
        candidateHash: 'different-hash-forged',
        timestamp: new Date().toISOString(),
        framework: 'nextjs',
        checks: [{ name: 'test', status: 'passed' }],
        accepted: true,
        diagnostics: [],
      },
      userId: 'test-user',
      authMode: 'real',
    });

    assert.strictEqual(res.success, false);
    assert.match(res.error!, /Evidence Mismatch/);
  });

  // 11. Rejection of visual claim without authentic visual evidence
  it('Vector 11: Truthfully assigns VISUAL_VERIFICATION_UNAVAILABLE when comparison is unavailable', () => {
    const ev = recordVisualVerification({
      hasScreenshotService: false,
    });
    assert.strictEqual(ev.comparisonStatus, 'VISUAL_VERIFICATION_UNAVAILABLE');
    assert.strictEqual(ev.screenshotCaptured, false);
    assert.strictEqual(ev.verificationConfidence, 0.0);
  });

  // 12. Rejection of oversized or malformed image uploads
  it('Vector 12: Rejects oversized and malformed image payloads', () => {
    // Malformed data url
    const malformedDataUrl = 'data:image/png;notbase64,hello world';
    const malformedRes = validateImageUpload(malformedDataUrl);
    assert.strictEqual(malformedRes.valid, false);
    assert.match(malformedRes.error!, /only base64 encoding is supported/);

    // Unsupported MIME
    const badMime = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    const badMimeRes = validateImageUpload(badMime);
    assert.strictEqual(badMimeRes.valid, false);
    assert.match(badMimeRes.error!, /Unsupported image MIME type/);

    // Oversized (>10MB)
    const giantBase64 = 'data:image/png;base64,' + 'A'.repeat(MAX_IMAGE_SIZE_BYTES * 2);
    const oversizeRes = validateImageUpload(giantBase64);
    assert.strictEqual(oversizeRes.valid, false);
    assert.match(oversizeRes.error!, /exceeds maximum limit of 10MB/);
  });

  // 13. Strict parser status and rejection of synthetic files during targeted modifications
  it('Vector 13: Rejects synthetic filenames during targeted modifications and returns explicit malformed status', () => {
    // Malformed structured JSON
    const malformedOutput = '<FILES> { "files": [ invalid json ] } </FILES>';
    const parseRes = parseFinalOutput(malformedOutput);
    assert.strictEqual(parseRes.status, 'malformed');
    assert.strictEqual(parseRes.parseError, true);

    // Code fence with no filename during targeted modification
    const textWithNoFilename = '```tsx\nexport function Component() {}\n```';
    const targetedRes = parseFinalOutput(textWithNoFilename, { forTargetedModification: true });
    assert.strictEqual(targetedRes.status, 'unsupported');
    assert.strictEqual(targetedRes.parseError, true);
    assert.ok(targetedRes.diagnostics.some((d) => d.includes('Synthetic filenames')));
  });

  // 14. Requirements invariant weakening rejection
  it('Vector 14: Rejects candidate modifications that remove platform security invariants', async () => {
    const candidateFiles = {
      ...baselineFiles,
      'requirements.md': '# Weakened Specs\n- Non-isolated tenants\n- No row-level security',
    };

    const evalResult = await evaluateCandidateChanges({
      projectId,
      framework: 'nextjs',
      currentFiles: baselineFiles,
      candidateFiles,
    });

    assert.strictEqual(evalResult.accepted, false);
    const reqCheck = evalResult.evidence.checks.find((c) => c.name === 'requirements_protection');
    assert.strictEqual(reqCheck?.status, 'failed');
    assert.ok(reqCheck?.message?.includes('removed mandatory security invariants'));
  });
});
