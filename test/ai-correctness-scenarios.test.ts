import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseIntentFromPrompt, validateIntent } from '../lib/ai/intent-contract';
import { buildRetrievalContext, inspectRelatedFiles } from '../lib/workspace/project-retrieval';
import { evaluateCandidateChanges, computeCandidateHash } from '../lib/validation/candidate-pipeline';
import { commitVerifiedCandidate } from '../lib/validation/candidate-commit-service';
import { seedAuthoritativeProject, getServerProject } from '../lib/storage/project-authority';
import { createVisualSpec } from '../lib/vision/visual-spec';
import { validateImageUpload } from '../lib/vision/image-hardening';
import { recordVisualVerification } from '../lib/vision/visual-verifier';

describe('Antigravity Phase AI Correctness — Primary Scenarios (A, B, C, D)', () => {

  // ── Scenario A: Natural-Language Project Creation ────────────────────────
  describe('Scenario A: SaaS Landing Page Creation', () => {
    const prompt = 'Build me a SaaS landing page with navbar, hero, pricing, testimonials and footer.';

    it('Scenario A.1: Resolves CREATE_PROJECT intent with full requirements and acceptance criteria', () => {
      const intent = parseIntentFromPrompt({
        prompt,
        framework: 'nextjs',
        currentFiles: {},
      });

      assert.strictEqual(intent.action, 'CREATE_PROJECT');
      assert.strictEqual(intent.framework, 'nextjs');
      assert.ok(intent.requirements.length >= 4, 'Must extract multi-section requirements');
      assert.ok(intent.requirements.some((r) => r.includes('navbar')), 'Requirements must include navbar');
      assert.ok(intent.requirements.some((r) => r.includes('pricing')), 'Requirements must include pricing');
      assert.ok(intent.requirements.some((r) => r.includes('footer')), 'Requirements must include footer');

      const validation = validateIntent(intent);
      assert.strictEqual(validation.valid, true, `Intent must be valid: ${validation.errors.join(', ')}`);
    });

    it('Scenario A.2: Evaluates generated candidate workspace, passes criteria, and commits via CAS', async () => {
      const projectId = 'scenario-a-saas-project';
      seedAuthoritativeProject(projectId, 'test-user', 'SaaS App', 'nextjs', {});

      const intent = parseIntentFromPrompt({ prompt, framework: 'nextjs', currentFiles: {} });

      const candidateFiles = {
        'package.json': JSON.stringify({
          name: 'saas-landing',
          dependencies: { next: '^15.0.0', react: '^19.0.0', 'lucide-react': '^0.454.0' },
        }),
        'app/layout.tsx': 'export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }',
        'app/page.tsx': `
          import { Navbar } from '@/components/Navbar';
          import { Hero } from '@/components/Hero';
          import { Pricing } from '@/components/Pricing';
          import { Testimonials } from '@/components/Testimonials';
          import { Footer } from '@/components/Footer';

          export default function Page() {
            return (
              <main>
                <Navbar />
                <Hero />
                <Pricing />
                <Testimonials />
                <Footer />
              </main>
            );
          }
        `,
        'components/Navbar.tsx': 'export function Navbar() { return <nav className="flex justify-between"><div>Logo</div><div>Links</div></nav>; }',
        'components/Hero.tsx': 'export function Hero() { return <section><h1>Convert Visitors</h1></section>; }',
        'components/Pricing.tsx': 'export function Pricing() { return <section><div>$29/mo</div></section>; }',
        'components/Testimonials.tsx': 'export function Testimonials() { return <section><blockquote>Great tool</blockquote></section>; }',
        'components/Footer.tsx': 'export function Footer() { return <footer><p>&copy; 2026 SaaS Inc.</p></footer>; }',
      };

      const evalResult = await evaluateCandidateChanges({
        projectId,
        framework: 'nextjs',
        currentFiles: {},
        candidateFiles,
        isNewBuild: true,
        intent,
        runtimeContext: {
          nativeBuildStatus: 'passed',
          runtimeHttpStatus: 200,
        },
      });

      assert.strictEqual(evalResult.accepted, true, `Candidate must be accepted: ${evalResult.diagnostics.join(', ')}`);
      assert.strictEqual(evalResult.evidence.accepted, true);
      assert.strictEqual(evalResult.evidence.candidateHash, computeCandidateHash(candidateFiles));

      const commitResult = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash: evalResult.evidence.candidateHash!,
        validationEvidence: evalResult.evidence,
        userId: 'test-user',
        authMode: 'real',
      });

      assert.strictEqual(commitResult.success, true);
      assert.strictEqual(commitResult.committed, true);
      assert.strictEqual(commitResult.revision, 2);

      const saved = getServerProject(projectId);
      assert.strictEqual(saved?.files['app/page.tsx'], candidateFiles['app/page.tsx']);
    });
  });

  // ── Scenario B: Targeted Minimal Scope Modification ──────────────────────
  describe('Scenario B: Targeted Navbar Logo 20% Reduction', () => {
    const baselineFiles = {
      'package.json': JSON.stringify({ name: 'existing-app', dependencies: { next: '^15.0.0' } }),
      'app/layout.tsx': 'export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }',
      'app/page.tsx': "import { Navbar } from '@/components/Navbar'; export default function Page() { return <main><Navbar /><section>Content</section></main>; }",
      'components/Navbar.tsx': `
        export function Navbar() {
          return (
            <nav className="flex items-center justify-between p-4">
              <div className="logo h-10 w-10">Logo</div>
              <ul className="flex gap-4">
                <li><a href="/">Home</a></li>
                <li><a href="/about">About</a></li>
              </ul>
            </nav>
          );
        }
      `,
      'components/Footer.tsx': 'export function Footer() { return <footer>Footer</footer>; }',
    };

    const prompt = 'Make the navbar logo 20% smaller.';

    it('Scenario B.1: Discovers navbar/logo targets via retrieval context without reading unrelated files', () => {
      const intent = parseIntentFromPrompt({
        prompt,
        framework: 'nextjs',
        currentFiles: baselineFiles,
      });

      assert.strictEqual(intent.action, 'MODIFY_FEATURE');

      const retrieval = buildRetrievalContext(baselineFiles, intent);
      assert.ok(retrieval.matchedFiles.includes('components/Navbar.tsx'), 'Must discover Navbar.tsx as target');
      assert.ok(!retrieval.matchedFiles.includes('components/Footer.tsx'), 'Must not match unrelated Footer.tsx as direct target');
    });

    it('Scenario B.2: Verifies minimal scope (only Navbar touched) and delta verification succeeds', async () => {
      const projectId = 'scenario-b-logo-project';
      seedAuthoritativeProject(projectId, 'test-user', 'Logo Project', 'nextjs', baselineFiles);

      const intent = parseIntentFromPrompt({
        prompt,
        framework: 'nextjs',
        currentFiles: baselineFiles,
      });

      // Candidate modifies only components/Navbar.tsx (h-10 w-10 -> h-8 w-8 = 20% reduction)
      const candidateFiles = {
        ...baselineFiles,
        'components/Navbar.tsx': `
          export function Navbar() {
            return (
              <nav className="flex items-center justify-between p-4">
                <div className="logo h-8 w-8 scale-[0.8]">Logo</div>
                <ul className="flex gap-4">
                  <li><a href="/">Home</a></li>
                  <li><a href="/about">About</a></li>
                </ul>
              </nav>
            );
          }
        `,
      };

      const evalResult = await evaluateCandidateChanges({
        projectId,
        framework: 'nextjs',
        currentFiles: baselineFiles,
        candidateFiles,
        intent,
        baselineRevision: 1,
        runtimeContext: {
          nativeBuildStatus: 'passed',
          runtimeHttpStatus: 200,
        },
      });

      assert.strictEqual(evalResult.accepted, true, `Candidate must be accepted: ${evalResult.diagnostics.join(', ')}`);
      assert.deepStrictEqual(evalResult.evidence.changedFiles, ['components/Navbar.tsx']);

      const commitResult = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash: evalResult.evidence.candidateHash!,
        validationEvidence: evalResult.evidence,
        userId: 'test-user',
        authMode: 'real',
      });

      assert.strictEqual(commitResult.success, true);
      assert.strictEqual(commitResult.revision, 2);

      const current = getServerProject(projectId);
      assert.strictEqual(current?.files['components/Footer.tsx'], baselineFiles['components/Footer.tsx'], 'Unrelated footer must be untouched');
    });
  });

  // ── Scenario C: Cross-File Feature Addition ──────────────────────────────
  describe('Scenario C: Add Mobile Hamburger Menu', () => {
    const baselineFiles = {
      'package.json': JSON.stringify({ name: 'nav-app', dependencies: { next: '^15.0.0', react: '^19.0.0' } }),
      'app/layout.tsx': 'export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }',
      'app/page.tsx': "import { Navbar } from '@/components/Navbar'; export default function Page() { return <Navbar />; }",
      'components/Navbar.tsx': `
        export function Navbar() {
          return (
            <nav className="flex justify-between p-4">
              <div>Logo</div>
              <div className="desktop-links">
                <a href="/features">Features</a>
              </div>
            </nav>
          );
        }
      `,
    };

    const prompt = 'Add a mobile hamburger menu.';

    it('Scenario C.1: Discovers layout and navigation dependencies', () => {
      const intent = parseIntentFromPrompt({
        prompt,
        framework: 'nextjs',
        currentFiles: baselineFiles,
      });

      assert.strictEqual(intent.action, 'ADD_FEATURE');
      const retrieval = buildRetrievalContext(baselineFiles, intent);
      assert.ok(retrieval.matchedFiles.includes('components/Navbar.tsx'));
      const related = inspectRelatedFiles(baselineFiles, 'components/Navbar.tsx');
      assert.ok(related.includes('app/page.tsx'), 'Traces app/page.tsx as consumer of Navbar');
    });

    it('Scenario C.2: Behavioral assertions verify mobile trigger toggle while desktop nav remains functional', async () => {
      const projectId = 'scenario-c-menu-project';
      seedAuthoritativeProject(projectId, 'test-user', 'Menu Project', 'nextjs', baselineFiles);

      const intent = parseIntentFromPrompt({
        prompt,
        framework: 'nextjs',
        currentFiles: baselineFiles,
      });

      const candidateFiles = {
        ...baselineFiles,
        'components/Navbar.tsx': `
          'use client';
          import { useState } from 'react';

          export function Navbar() {
            const [isOpen, setIsOpen] = useState(false);

            return (
              <nav className="flex justify-between p-4">
                <div>Logo</div>

                {/* Desktop navigation */}
                <div className="hidden md:flex gap-4">
                  <a href="/features">Features</a>
                </div>

                {/* Mobile hamburger button */}
                <button
                  aria-label="menu"
                  className="md:hidden"
                  onClick={() => setIsOpen(!isOpen)}
                >
                  <span className="hamburger-icon">Menu</span>
                </button>

                {/* Mobile dropdown drawer */}
                {isOpen && (
                  <div className="mobile-drawer md:hidden flex flex-col">
                    <a href="/features">Features</a>
                  </div>
                )}
              </nav>
            );
          }
        `,
      };

      const evalResult = await evaluateCandidateChanges({
        projectId,
        framework: 'nextjs',
        currentFiles: baselineFiles,
        candidateFiles,
        intent,
        baselineRevision: 1,
        runtimeContext: {
          nativeBuildStatus: 'passed',
          runtimeHttpStatus: 200,
        },
      });

      assert.strictEqual(evalResult.accepted, true, `Candidate must be accepted: ${evalResult.diagnostics.join(', ')}`);

      // Verify criteria
      const behavioralCheck = evalResult.evidence.checks.find((c) => c.name === 'behavioral_contract_verification');
      assert.ok(behavioralCheck);
      assert.strictEqual(behavioralCheck.status, 'passed');

      const commitResult = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash: evalResult.evidence.candidateHash!,
        validationEvidence: evalResult.evidence,
        userId: 'test-user',
        authMode: 'real',
      });

      assert.strictEqual(commitResult.success, true);
      assert.strictEqual(commitResult.revision, 2);
    });
  });

  // ── Scenario D: Screenshot Re-creation ───────────────────────────────────
  describe('Scenario D: Screenshot Re-creation Pipeline', () => {
    const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    it('Scenario D.1: Validates image upload and synthesizes structured VisualSpec', () => {
      const uploadRes = validateImageUpload(validPng);
      assert.strictEqual(uploadRes.valid, true);
      assert.ok(uploadRes.imageReference);
      assert.strictEqual(uploadRes.imageReference?.mimeType, 'image/png');

      const vspec = createVisualSpec({
        imageReference: uploadRes.imageReference,
        visualPrompt: 'Recreate this SaaS landing design',
      });

      assert.ok(vspec.id.startsWith('vspec_'));
      assert.ok(vspec.sections.length >= 3, 'VisualSpec must identify structural sections');
      assert.ok(vspec.colors.primaryColor, 'VisualSpec must extract color theme');
      assert.strictEqual(vspec.viewport.width, 1280);
      assert.ok(vspec.confidence > 0.8);
    });

    it('Scenario D.2: Visual verification truthful reporting (unverified when infrastructure unavailable)', () => {
      const unavailEvidence = recordVisualVerification({
        hasScreenshotService: false,
      });
      assert.strictEqual(unavailEvidence.comparisonStatus, 'VISUAL_VERIFICATION_UNAVAILABLE');
      assert.strictEqual(unavailEvidence.screenshotCaptured, false);
      assert.strictEqual(unavailEvidence.verificationConfidence, 0.0);

      const verifiedEvidence = recordVisualVerification({
        hasScreenshotService: true,
        screenshotCaptured: true,
        targetRegionSelector: 'Navbar.logo',
        simulatedScore: 0.95,
      });
      assert.strictEqual(verifiedEvidence.comparisonStatus, 'VERIFIED_MATCH');
      assert.strictEqual(verifiedEvidence.screenshotCaptured, true);
      assert.strictEqual(verifiedEvidence.verificationConfidence, 0.95);
    });

    it('Scenario D.3: Full pipeline execution and policy-compliant commit', async () => {
      const projectId = 'scenario-d-vision-project';
      seedAuthoritativeProject(projectId, 'test-user', 'Vision Recreate', 'nextjs', {});

      const uploadRes = validateImageUpload(validPng);
      const intent = parseIntentFromPrompt({
        prompt: 'Recreate this design.',
        framework: 'nextjs',
        hasImage: true,
        imageContext: {
          hasImage: true,
          imageType: uploadRes.imageReference?.mimeType,
          dataUrl: uploadRes.imageReference?.dataUrl,
        },
        currentFiles: {},
      });

      assert.strictEqual(intent.action, 'VISUAL_RECREATE');

      const candidateFiles = {
        'package.json': JSON.stringify({ name: 'visual-app', dependencies: { next: '^15.0.0', react: '^19.0.0' } }),
        'app/layout.tsx': 'export default function Root({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }',
        'app/page.tsx': 'export default function Page() { return <div>Visual Design Match</div>; }',
      };

      const evalResult = await evaluateCandidateChanges({
        projectId,
        framework: 'nextjs',
        currentFiles: {},
        candidateFiles,
        isNewBuild: true,
        intent,
        runtimeContext: {
          nativeBuildStatus: 'passed',
          runtimeHttpStatus: 200,
          visualStatus: 'passed',
        },
      });

      assert.strictEqual(evalResult.accepted, true);

      const commitResult = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash: evalResult.evidence.candidateHash!,
        validationEvidence: evalResult.evidence,
        userId: 'test-user',
        authMode: 'real',
      });

      assert.strictEqual(commitResult.success, true);
      assert.strictEqual(commitResult.revision, 2);
    });
  });
});
