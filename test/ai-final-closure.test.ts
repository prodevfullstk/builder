import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';

import { parseIntentFromPrompt, validateIntent } from '../lib/ai/intent-contract';
import { classifySemanticIntent } from '../lib/ai/semantic-classifier';
import {
  executeRealVisualVerification,
  captureRealBrowserScreenshot,
  validateVisualEvidenceIntegrity,
  recordVisualVerification,
} from '../lib/vision/visual-verifier';
import {
  executeRealBehavioralVerification,
  validateBehavioralEvidenceIntegrity,
} from '../lib/validation/browser-behavioral-runner';
import {
  evaluateAcceptanceCriteria,
  AcceptanceCriterion,
} from '../lib/validation/acceptance-verifier';
import {
  commitVerifiedCandidate,
} from '../lib/validation/candidate-commit-service';
import {
  seedAuthoritativeProject,
  getServerProject,
  AuthoritativeProject,
} from '../lib/storage/project-authority';
import { computeCandidateHash } from '../lib/validation/candidate-pipeline';
import {
  validateRuntimeEvidenceIntegrity,
  RealRuntimeEvidence,
} from '../lib/build/build-runner';

describe('Phase AI Final Closure Verification Suite', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // GATE D: Semantic Multilingual Intent Classification (No Human-Language Regexes)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gate D: Multilingual Semantic Intent Classification', () => {
    const testCases = [
      { lang: 'English', prompt: 'Add a mobile navigation menu to the website.', expected: 'ADD_FEATURE', fileCount: 3 },
      { lang: 'Bengali', prompt: 'ওয়েবসাইটে একটি মোবাইল নেভিগেশন মেনু যোগ করো।', expected: 'ADD_FEATURE', fileCount: 3 },
      { lang: 'Hindi', prompt: 'वेबसाइट में एक मोबाइल नेविगेशन मेनू जोड़ें।', expected: 'ADD_FEATURE', fileCount: 3 },
      { lang: 'Spanish', prompt: 'Añadir un menú de navegación móvil al sitio web.', expected: 'ADD_FEATURE', fileCount: 3 },
      { lang: 'French', prompt: 'Ajouter un menu de navigation mobile au site web.', expected: 'ADD_FEATURE', fileCount: 3 },
      { lang: 'Arabic', prompt: 'أضف قائمة تنقل للجوال إلى الموقع.', expected: 'ADD_FEATURE', fileCount: 3 },
      { lang: 'Japanese', prompt: 'ウェブサイトにモバイルナビゲーションメニューを追加してください。', expected: 'ADD_FEATURE', fileCount: 3 },
      { lang: 'Adversarial Verb-Free', prompt: 'The navigation on small screens should expose the page links behind a compact control.', expected: 'ADD_FEATURE', fileCount: 3 },
      { lang: 'Question', prompt: 'How does the authentication flow work?', expected: 'QUESTION', fileCount: 3 },
      { lang: 'Explain', prompt: 'Explain the project structure and data flow.', expected: 'EXPLAIN', fileCount: 3 },
      { lang: 'Inspect', prompt: 'Inspect the repository security and list files.', expected: 'INSPECT', fileCount: 3 },
      { lang: 'FixBug', prompt: 'The checkout button crashes with a null pointer exception.', expected: 'FIX_BUG', fileCount: 3 },
      { lang: 'Refactor', prompt: 'Clean up and reorganize the components directory.', expected: 'REFACTOR', fileCount: 3 },
      { lang: 'CreateProject', prompt: 'Create a modern SaaS landing page for an AI productivity tool.', expected: 'CREATE_PROJECT', fileCount: 0 },
      { lang: 'ModifyFeature', prompt: 'Change the hero section background color to dark slate.', expected: 'MODIFY_FEATURE', fileCount: 3 },
    ];

    it('D.1: correctly classifies multilingual and adversarial requests to identical semantic actions', () => {
      const observedConfidences = new Set<number>();

      for (const tc of testCases) {
        const dummyFiles: Record<string, string> = {};
        for (let i = 0; i < tc.fileCount; i++) {
          dummyFiles[`file_${i}.tsx`] = '// existing';
        }

        const intent = parseIntentFromPrompt({
          prompt: tc.prompt,
          currentFiles: dummyFiles,
        });

        assert.strictEqual(
          intent.action,
          tc.expected,
          `Failed on ${tc.lang}: expected '${tc.expected}', got '${intent.action}' for prompt: "${tc.prompt}"`
        );

        // Confidence must be dynamic, not constant 0.95
        assert.ok(typeof intent.confidence === 'number' && intent.confidence >= 0.60 && intent.confidence <= 1.0);
        observedConfidences.add(intent.confidence);
      }

      // Confidence must vary dynamically across queries
      assert.ok(observedConfidences.size > 1, `Confidence must not be a hardcoded constant: observed ${Array.from(observedConfidences)}`);
    });

    it('D.2: read-only conversational inquiries produce non-mutating intent contracts', () => {
      const questionIntent = parseIntentFromPrompt({
        prompt: 'Can you explain how the Next.js routing works?',
        currentFiles: { 'app/page.tsx': 'export default function Page() {}' },
      });
      assert.ok(questionIntent.action === 'QUESTION' || questionIntent.action === 'EXPLAIN');
      const val = validateIntent(questionIntent);
      assert.strictEqual(val.valid, true);

      const inspectIntent = parseIntentFromPrompt({
        prompt: 'Inspect dependencies and audit security.',
        currentFiles: { 'app/page.tsx': 'export default function Page() {}' },
      });
      assert.strictEqual(inspectIntent.action, 'INSPECT');
      assert.strictEqual(validateIntent(inspectIntent).valid, true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GATE B: Real Browser Screenshot Capture & Visual Verification
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gate B: Real Browser Screenshot Capture & Comparison', () => {
    let testServer: http.Server;
    let serverUrl: string;

    it('B.0: spins up local isolated HTTP test page for real browser verification', async () => {
      await new Promise<void>((resolve) => {
        testServer = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>Visual Test</title><style>body { font-family: sans-serif; background: #f0fdf4; padding: 20px; }</style></head>
              <body>
                <h1 id="title">Visual Verification Live Target</h1>
                <p id="desc">Rendered inside isolated headless Chromium</p>
              </body>
            </html>
          `);
        });
        testServer.listen(0, '127.0.0.1', () => {
          const addr = testServer.address() as any;
          serverUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    it('B.1: captures real screenshot bytes from live running page via Playwright', async () => {
      const cap = await captureRealBrowserScreenshot({
        url: serverUrl,
        viewport: { width: 800, height: 600 },
      });

      assert.strictEqual(cap.success, true);
      assert.ok(cap.screenshot instanceof Buffer);
      assert.ok(cap.screenshot.length > 500, 'Screenshot buffer must contain non-trivial PNG bytes');
      // PNG header check
      assert.strictEqual(cap.screenshot[0], 0x89);
      assert.strictEqual(cap.screenshot[1], 0x50); // 'P'
      assert.strictEqual(cap.screenshot[2], 0x4e); // 'N'
      assert.strictEqual(cap.screenshot[3], 0x47); // 'G'
    });

    it('B.2: computes SHA-256 and validates visual comparison evidence', async () => {
      const cap = await captureRealBrowserScreenshot({ url: serverUrl });
      assert.ok(cap.screenshot);

      const candidateHash = 'cand_hash_' + 'a'.repeat(54);
      const projectId = 'proj_vis_test';
      const revision = 2;

      const evidence = executeRealVisualVerification({
        renderedScreenshot: cap.screenshot,
        referenceImage: cap.screenshot, // Identical reference
        candidateHash,
        projectId,
        revision,
      });

      assert.strictEqual(evidence.comparisonStatus, 'VERIFIED_MATCH');
      assert.strictEqual(evidence.comparisonScore, 1.0);
      assert.strictEqual(evidence.renderedImageHash.length, 64);
      assert.strictEqual(evidence.referenceImageHash, evidence.renderedImageHash);

      const val = validateVisualEvidenceIntegrity(evidence, { candidateHash, projectId, revision });
      assert.strictEqual(val.valid, true);
    });

    it('B.3: strictly rejects simulatedScore injection in production visual verification', () => {
      const candidateHash = 'cand_hash_' + 'b'.repeat(54);
      const fakeEvidence = executeRealVisualVerification({
        renderedScreenshot: Buffer.from('fake screenshot bytes'),
        candidateHash,
        projectId: 'proj_vis_test',
        revision: 1,
        simulatedScore: 0.99, // Injection attempt
      });

      assert.strictEqual(fakeEvidence.comparisonStatus, 'VISUAL_VERIFICATION_UNAVAILABLE');
      assert.strictEqual(fakeEvidence.comparisonMethod, 'simulated_rejected');
      assert.strictEqual(fakeEvidence.renderedImageHash, '');
    });

    it('B.4: detects visual mismatch when rendered bytes differ significantly from reference', async () => {
      const capA = await captureRealBrowserScreenshot({ url: serverUrl });
      assert.ok(capA.screenshot);

      // Create an entirely different reference image (e.g. 1000 zero bytes vs PNG)
      const diffRef = Buffer.alloc(capA.screenshot.length, 0xff);

      const evidence = executeRealVisualVerification({
        renderedScreenshot: capA.screenshot,
        referenceImage: diffRef,
        candidateHash: 'cand_hash_' + 'c'.repeat(54),
        projectId: 'proj_vis_test',
        revision: 1,
      });

      assert.strictEqual(evidence.comparisonStatus, 'MISMATCH_DETECTED');
      assert.ok((evidence.comparisonScore || 0) < 0.85);
    });

    it('B.5: cleans up local visual test server', async () => {
      await new Promise<void>((resolve) => testServer.close(() => resolve()));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GATE C: Real Behavioral Browser Verification
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gate C: Real Behavioral Browser Verification', () => {
    let appServer: http.Server;
    let appUrl: string;

    it('C.0: spins up interactive mobile menu test application', async () => {
      await new Promise<void>((resolve) => {
        appServer = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                  .mobile-nav { display: none; }
                  .mobile-nav.open { display: block; }
                  @media (min-width: 768px) {
                    .desktop-nav { display: block; }
                    .mobile-toggle { display: none; }
                  }
                </style>
              </head>
              <body>
                <header>
                  <button id="menu-btn" class="mobile-toggle" aria-label="Toggle navigation menu" aria-expanded="false" onclick="toggle()">
                    Menu
                  </button>
                  <div id="drawer" class="mobile-nav" data-state="closed">
                    <nav>
                      <a href="#features">Features</a>
                      <a href="#pricing">Pricing</a>
                      <a href="#contact">Contact</a>
                    </nav>
                  </div>
                </header>
                <script>
                  function toggle() {
                    const btn = document.getElementById('menu-btn');
                    const drawer = document.getElementById('drawer');
                    const isOpen = drawer.classList.contains('open');
                    if (isOpen) {
                      drawer.classList.remove('open');
                      drawer.setAttribute('data-state', 'closed');
                      btn.setAttribute('aria-expanded', 'false');
                    } else {
                      drawer.classList.add('open');
                      drawer.setAttribute('data-state', 'open');
                      btn.setAttribute('aria-expanded', 'true');
                    }
                  }
                </script>
              </body>
            </html>
          `);
        });
        appServer.listen(0, '127.0.0.1', () => {
          const addr = appServer.address() as any;
          appUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    it('C.1: executes real mobile viewport click and verifies menu drawer expansion', async () => {
      const criterion: AcceptanceCriterion = {
        id: 'crit_mobile_menu',
        criterion: 'Add responsive mobile hamburger navigation menu',
        type: 'responsive_behavior',
        criterionClass: 'behavioral',
        target: 'Navbar.mobileMenu',
        verification: 'behavioral',
      };

      const candidateHash = 'hash_' + 'd'.repeat(59);
      const projectId = 'proj_behavioral';
      const revision = 1;

      const evidence = await executeRealBehavioralVerification({
        url: appUrl,
        candidateHash,
        projectId,
        revision,
        criterion,
        viewport: { width: 375, height: 667 },
      });

      assert.strictEqual(evidence.passed, true);
      assert.strictEqual(evidence.action, 'click');
      assert.match(evidence.observedResult, /Menu button clicked: exposed \d+ navigation elements/);
      assert.ok(evidence.browserSessionId.startsWith('bs_'));

      const val = validateBehavioralEvidenceIntegrity(evidence, { candidateHash, projectId, revision });
      assert.strictEqual(val.valid, true);
    });

    it('C.2: anti-forgery test: rejects candidate when interactive button does not open menu', async () => {
      // Create broken server where button exists but does nothing (broken click handler)
      const brokenServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <body>
              <!-- Source tokens exist: toggleMenu, aria-label="Toggle navigation menu" -->
              <button aria-label="Toggle navigation menu" onclick="/* broken handler */">Menu</button>
              <nav style="display:none"><a href="#">Links</a></nav>
            </body>
          </html>
        `);
      });

      const brokenUrl = await new Promise<string>((resolve) => {
        brokenServer.listen(0, '127.0.0.1', () => {
          const addr = brokenServer.address() as any;
          resolve(`http://127.0.0.1:${addr.port}`);
        });
      });

      try {
        const criterion: AcceptanceCriterion = {
          id: 'crit_broken_menu',
          criterion: 'Mobile menu opens upon click',
          type: 'responsive_behavior',
          criterionClass: 'behavioral',
          target: 'Navbar.broken',
          verification: 'behavioral',
        };

        const evidence = await executeRealBehavioralVerification({
          url: brokenUrl,
          candidateHash: 'hash_broken',
          projectId: 'proj_broken',
          revision: 1,
          criterion,
        });

        assert.strictEqual(evidence.passed, false, 'Broken button click must not pass behavioral verification');
        assert.match(evidence.observedResult, /did not become visible/);
      } finally {
        await new Promise<void>((resolve) => brokenServer.close(() => resolve()));
      }
    });

    it('C.3: acceptance-verifier rejects behavioral criteria if runtime check was not performed', () => {
      const workspace = {
        'components/navbar.tsx': `
          export function Navbar() {
            // Static tokens present:
            const [isOpen, setIsOpen] = useState(false);
            const toggleMenu = () => setIsOpen(!isOpen);
            return <button aria-label="menu" onClick={toggleMenu} className="md:hidden">Menu</button>;
          }
        `,
      };

      const criteria: AcceptanceCriterion[] = [
        {
          id: 'c_resp',
          criterion: 'Mobile menu interactive behavior',
          type: 'responsive_behavior',
          criterionClass: 'behavioral',
          target: 'Navbar',
          verification: 'behavioral',
        },
      ];

      // When runtime behavioral check fails (behavioralPassed: false), it strictly fails even if static tokens exist (Anti-forgery)
      const failedEval = evaluateAcceptanceCriteria({
        workspace,
        criteria,
        runtimeContext: {
          nativeBuildStatus: 'passed',
          runtimeHttpStatus: 200,
          behavioralPassed: false,
        },
      });

      assert.strictEqual(failedEval.allPassed, false);
      assert.strictEqual(failedEval.results[0].status, 'failed');
      assert.match(failedEval.results[0].message, /Runtime behavioral interaction failed/);

      // With runtimeContext.behavioralPassed: true -> PASSES
      const verifiedEval = evaluateAcceptanceCriteria({
        workspace,
        criteria,
        runtimeContext: {
          nativeBuildStatus: 'passed',
          runtimeHttpStatus: 200,
          behavioralPassed: true,
          behavioralDetails: { action: 'click', target: 'Navbar' },
        },
      });

      assert.strictEqual(verifiedEval.allPassed, true);
      assert.strictEqual(verifiedEval.results[0].status, 'passed');
    });

    it('C.4: cleans up interactive app test server', async () => {
      await new Promise<void>((resolve) => appServer.close(() => resolve()));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GATE A: Real Runtime Evidence Integrity & Binding
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gate A: Real Runtime Evidence Integrity', () => {
    it('A.1: validates truthful runtime evidence structure', () => {
      const candidateHash = 'hash_' + 'e'.repeat(59);
      const projectId = 'proj_rt_valid';
      const revision = 3;

      const runtimeEvidence: RealRuntimeEvidence = {
        evidenceId: 'ev_rt_' + Date.now().toString(36) + '_abc123',
        projectId,
        revision,
        candidateHash,
        framework: 'nextjs',
        command: 'next start',
        exitStatus: 0,
        stdoutSummary: 'Ready in 300ms',
        stderrSummary: '',
        startupStatus: 'ready',
        url: 'https://sb-abc-3000.vercel.run',
        port: 3000,
        httpStatus: 200,
        healthy: true,
        timestamp: new Date().toISOString(),
        durationMs: 450,
        processTerminated: true,
        sandboxCleaned: true,
      };

      const val = validateRuntimeEvidenceIntegrity(runtimeEvidence, {
        candidateHash,
        projectId,
        revision,
        framework: 'nextjs',
      });
      assert.strictEqual(val.valid, true);
    });

    it('A.2: rejects forged or HTTP-failed runtime evidence', () => {
      const runtimeEvidence: RealRuntimeEvidence = {
        evidenceId: 'forged_id',
        projectId: 'proj_rt',
        revision: 1,
        candidateHash: 'hash_a',
        framework: 'nextjs',
        command: 'next start',
        exitStatus: 1,
        stdoutSummary: '',
        stderrSummary: 'Crash',
        startupStatus: 'failed',
        url: 'http://localhost:3000',
        port: 3000,
        httpStatus: 500,
        healthy: false,
        timestamp: new Date().toISOString(),
        durationMs: 100,
        processTerminated: true,
        sandboxCleaned: true,
      };

      const val = validateRuntimeEvidenceIntegrity(runtimeEvidence, {
        candidateHash: 'hash_a',
        projectId: 'proj_rt',
        revision: 1,
        framework: 'nextjs',
      });
      assert.strictEqual(val.valid, false);
      assert.match(val.error || '', /Invalid or forged runtime evidence identifier/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GATE F & G: Centralized CAS Commit Gate with Full Evidence Authentication
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gate F & G: Centralized CAS Commit Service with Full Evidence Verification', () => {
    const projectId = 'proj_commit_full_gate';
    const userId = 'user_audit';

    it('G.1: commits candidate when native build, runtime, and visual evidence are verified', async () => {
      seedAuthoritativeProject(projectId, userId, 'Audit Project', 'nextjs', {
        'app/page.tsx': 'export default function Page() { return <h1>Rev 1</h1>; }',
      });

      const candidateFiles = {
        'app/page.tsx': 'export default function Page() { return <h1>Rev 2 Verified</h1>; }',
      };
      const candidateHash = computeCandidateHash(candidateFiles);
      const expectedRevision = 1;
      const timestamp = new Date().toISOString();

      const commitRes = await commitVerifiedCandidate({
        projectId,
        expectedRevision,
        candidateFiles,
        candidateHash,
        userId,
        authMode: 'real',
        validationEvidence: {
          validationId: 'val_' + Date.now().toString(36),
          projectId,
          expectedRevision,
          candidateHash,
          timestamp,
          framework: 'nextjs',
          accepted: true,
          checks: [{ name: 'security_invariants', status: 'passed' }],
          diagnostics: [],
          nativeBuild: {
            attempted: true,
            status: 'passed',
            framework: 'nextjs',
            runner: 'vercel_sandbox',
            environment: 'vercel_sandbox',
            candidateHash,
            projectId,
            revision: expectedRevision,
          },
          realRuntime: {
            healthy: true,
            httpStatus: 200,
            candidateHash,
            projectId,
            revision: expectedRevision,
          },
          realVisual: {
            comparisonStatus: 'VERIFIED_MATCH',
            candidateHash,
            projectId,
            revision: expectedRevision,
            renderedImageHash: 'sha256_' + 'f'.repeat(57),
          },
        },
      });

      assert.strictEqual(commitRes.success, true);
      assert.strictEqual(commitRes.committed, true);
      assert.strictEqual(commitRes.revision, 2);

      const updatedProj = getServerProject(projectId);
      assert.strictEqual(updatedProj?.revision, 2);
      assert.strictEqual(updatedProj?.files['app/page.tsx'], candidateFiles['app/page.tsx']);
    });

    it('G.2: strictly rejects commit when runtime evidence indicates HTTP error or failed health', async () => {
      const candidateFiles = {
        'app/page.tsx': 'export default function Page() { return <h1>Rev 3 Broken</h1>; }',
      };
      const candidateHash = computeCandidateHash(candidateFiles);
      const expectedRevision = 2;

      const commitRes = await commitVerifiedCandidate({
        projectId,
        expectedRevision,
        candidateFiles,
        candidateHash,
        userId,
        authMode: 'real',
        validationEvidence: {
          validationId: 'val_broken_rt',
          projectId,
          expectedRevision,
          candidateHash,
          timestamp: new Date().toISOString(),
          framework: 'nextjs',
          accepted: true,
          checks: [],
          diagnostics: [],
          nativeBuild: {
            attempted: true,
            status: 'passed',
            framework: 'nextjs',
            runner: 'vercel_sandbox',
            environment: 'vercel_sandbox',
            candidateHash,
            projectId,
            revision: expectedRevision,
          },
          realRuntime: {
            healthy: false,
            httpStatus: 500, // Runtime failed
            candidateHash,
            projectId,
            revision: expectedRevision,
          },
        },
      });

      assert.strictEqual(commitRes.success, false);
      assert.strictEqual(commitRes.committed, false);
      assert.match(commitRes.error || '', /Application failed runtime smoke check/);

      // Workspace remains at rev 2
      const proj = getServerProject(projectId);
      assert.strictEqual(proj?.revision, 2);
    });

    it('G.3: strictly rejects commit when behavioral verification failed', async () => {
      const candidateFiles = {
        'app/page.tsx': 'export default function Page() { return <h1>Rev 3 Broken Behavior</h1>; }',
      };
      const candidateHash = computeCandidateHash(candidateFiles);
      const expectedRevision = 2;

      const commitRes = await commitVerifiedCandidate({
        projectId,
        expectedRevision,
        candidateFiles,
        candidateHash,
        userId,
        authMode: 'real',
        validationEvidence: {
          validationId: 'val_broken_behav',
          projectId,
          expectedRevision,
          candidateHash,
          timestamp: new Date().toISOString(),
          framework: 'nextjs',
          accepted: true,
          checks: [],
          diagnostics: [],
          nativeBuild: {
            attempted: true,
            status: 'passed',
            framework: 'nextjs',
            runner: 'vercel_sandbox',
            environment: 'vercel_sandbox',
            candidateHash,
            projectId,
            revision: expectedRevision,
          },
          realBehavioral: [
            {
              criterionId: 'crit_nav',
              target: 'Navbar.toggle',
              passed: false, // Behavioral check failed!
              observedResult: 'Menu drawer did not open on click',
              candidateHash,
              projectId,
              revision: expectedRevision,
            },
          ],
        },
      });

      assert.strictEqual(commitRes.success, false);
      assert.strictEqual(commitRes.committed, false);
      assert.match(commitRes.error || '', /Behavioral Verification Failed on 'Navbar.toggle'/);

      // Project state remains unchanged
      assert.strictEqual(getServerProject(projectId)?.revision, 2);
    });

    it('G.4: strictly rejects commit when visual comparison indicates mismatch', async () => {
      const candidateFiles = {
        'app/page.tsx': 'export default function Page() { return <h1>Rev 3 Visual Mismatch</h1>; }',
      };
      const candidateHash = computeCandidateHash(candidateFiles);
      const expectedRevision = 2;

      const commitRes = await commitVerifiedCandidate({
        projectId,
        expectedRevision,
        candidateFiles,
        candidateHash,
        userId,
        authMode: 'real',
        validationEvidence: {
          validationId: 'val_visual_mismatch',
          projectId,
          expectedRevision,
          candidateHash,
          timestamp: new Date().toISOString(),
          framework: 'nextjs',
          accepted: true,
          checks: [],
          diagnostics: [],
          nativeBuild: {
            attempted: true,
            status: 'passed',
            framework: 'nextjs',
            runner: 'vercel_sandbox',
            environment: 'vercel_sandbox',
            candidateHash,
            projectId,
            revision: expectedRevision,
          },
          realVisual: {
            comparisonStatus: 'MISMATCH_DETECTED', // Visual mismatch
            candidateHash,
            projectId,
            revision: expectedRevision,
          },
        },
      });

      assert.strictEqual(commitRes.success, false);
      assert.match(commitRes.error || '', /Status 'MISMATCH_DETECTED' is not certified match/);
      assert.strictEqual(getServerProject(projectId)?.revision, 2);
    });

    it('G.5: strictly rejects commit on CAS concurrency conflict (stale revision)', async () => {
      const candidateFiles = {
        'app/page.tsx': 'export default function Page() { return <h1>Rev 3 Stale</h1>; }',
      };
      const candidateHash = computeCandidateHash(candidateFiles);
      const staleRevision = 1; // Project is already at revision 2!

      const commitRes = await commitVerifiedCandidate({
        projectId,
        expectedRevision: staleRevision,
        candidateFiles,
        candidateHash,
        userId,
        authMode: 'real',
        validationEvidence: {
          validationId: 'val_stale',
          projectId,
          expectedRevision: staleRevision,
          candidateHash,
          timestamp: new Date().toISOString(),
          framework: 'nextjs',
          accepted: true,
          checks: [],
          diagnostics: [],
          nativeBuild: {
            attempted: true,
            status: 'passed',
            framework: 'nextjs',
            runner: 'vercel_sandbox',
            environment: 'vercel_sandbox',
            candidateHash,
            projectId,
            revision: staleRevision,
          },
        },
      });

      assert.strictEqual(commitRes.success, false);
      assert.strictEqual(commitRes.conflict, true);
      assert.strictEqual(commitRes.currentRevision, 2);
      assert.strictEqual(commitRes.expectedRevision, 1);
      assert.strictEqual(getServerProject(projectId)?.revision, 2);
    });
  });
});
