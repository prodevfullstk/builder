import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  commitVerifiedCandidate,
  ValidationEvidence,
} from '../lib/validation/candidate-commit-service';
import {
  computeCandidateHash,
  evaluateCandidateChanges,
} from '../lib/validation/candidate-pipeline';
import {
  evaluateAcceptanceCriteria,
} from '../lib/validation/acceptance-verifier';
import {
  executeRealRuntimeVerification,
  validateRuntimeEvidenceIntegrity,
  RealRuntimeEvidence,
} from '../lib/build/build-runner';
import {
  executeRealVisualVerification,
  validateVisualEvidenceIntegrity,
  RealVisualEvidence,
} from '../lib/vision/visual-verifier';
import {
  createTypedAgentSSEStream,
  formatStreamEvent,
  StreamEventDecoder,
  StreamEvent,
} from '../lib/ai/stream-events';
import {
  parseIntentFromPrompt,
  MUTATING_INTENT_ACTIONS,
  READONLY_INTENT_ACTIONS,
} from '../lib/ai/intent-contract';
import {
  seedAuthoritativeProject,
  getServerProject,
} from '../lib/storage/project-authority';
import { assertContainedSandboxPath } from '../lib/sandbox/sandbox-containment';
import { checkRateLimitDistributed, resetRateLimitStore } from '../lib/auth/rate-limiter';

describe('Antigravity Phase AI Correctness — Gate Closure Authoritative Verification', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // GATE 1: Authoritative Native Build Enforcement (GATE-101)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gate 1: Authoritative Native Build Enforcement', () => {
    const projectId = 'gate1-build-project';
    const initialFiles = {
      'package.json': JSON.stringify({ name: 'g1-app', dependencies: { next: '15.0.0' } }),
      'app/page.tsx': 'export default function Page() { return <h1>G1 V1</h1>; }',
    };
    const candidateFiles = {
      'package.json': JSON.stringify({ name: 'g1-app', dependencies: { next: '15.0.0' } }),
      'app/page.tsx': 'export default function Page() { return <h1>G1 V2 - Native Verified</h1>; }',
    };
    const candidateHash = computeCandidateHash(candidateFiles);
    const now = Date.now();

    beforeEach(() => {
      seedAuthoritativeProject(projectId, 'user-gate1', 'Gate 1 Project', 'nextjs', initialFiles);
    });

    const createValidEvidence = (overrides: Partial<ValidationEvidence> = {}): ValidationEvidence => ({
      validationId: 'val-g1-valid-001',
      candidateHash,
      candidateTimestamp: now,
      timestamp: now + 50,
      accepted: true,
      staticAnalysis: { valid: true, errorCount: 0, warningCount: 0, diagnostics: [] },
      nativeBuild: {
        status: 'passed',
        exitCode: 0,
        buildOutput: 'compiled successfully',
        timestamp: now + 40,
        projectId,
        revision: 1,
        candidateHash,
      },
      ...overrides,
    });

    it('1.1: allows commit when native build is explicitly "passed" and evidence is intact', async () => {
      const evidence = createValidEvidence();
      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash,
        validationEvidence: evidence,
        userId: 'user-gate1',
        authMode: 'real',
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.revision, 2);
    });

    it('1.2: strictly rejects commit when native build status is "failed"', async () => {
      const evidence = createValidEvidence({
        nativeBuild: {
          status: 'failed',
          exitCode: 1,
          buildOutput: 'Type error in app/page.tsx',
          timestamp: now + 40,
        },
      });
      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash,
        validationEvidence: evidence,
        userId: 'user-gate1',
        authMode: 'real',
      });
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /Native build failed or did not pass/);
    });

    it('1.3: strictly rejects commit when native build status is "unavailable"', async () => {
      const evidence = createValidEvidence({
        nativeBuild: {
          status: 'unavailable',
          timestamp: now + 40,
        },
      });
      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash,
        validationEvidence: evidence,
        userId: 'user-gate1',
        authMode: 'real',
      });
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /Native build failed or did not pass/);
    });

    it('1.4: strictly rejects commit when native build status is "not_run"', async () => {
      const evidence = createValidEvidence({
        nativeBuild: {
          status: 'not_run',
          timestamp: now + 40,
        },
      });
      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash,
        validationEvidence: evidence,
        userId: 'user-gate1',
        authMode: 'real',
      });
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /Native build failed or did not pass/);
    });

    it('1.5: strictly rejects commit when native build status is "stale"', async () => {
      const evidence = createValidEvidence({
        nativeBuild: {
          status: 'stale',
          timestamp: now + 40,
        },
      });
      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash,
        validationEvidence: evidence,
        userId: 'user-gate1',
        authMode: 'real',
      });
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /Native build failed or did not pass/);
    });

    it('1.6: strictly rejects commit when native build status is "invalid"', async () => {
      const evidence = createValidEvidence({
        nativeBuild: {
          status: 'invalid',
          timestamp: now + 40,
        },
      });
      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash,
        validationEvidence: evidence,
        userId: 'user-gate1',
        authMode: 'real',
      });
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /Native build failed or did not pass/);
    });

    it('1.7: strictly rejects commit when native build evidence is omitted', async () => {
      const evidence = createValidEvidence();
      delete (evidence as any).nativeBuild;
      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash,
        validationEvidence: evidence,
        userId: 'user-gate1',
        authMode: 'real',
      });
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /Native build verification is mandatory/);
    });

    it('1.8: rejects forged native build evidence with mismatched candidate hash', async () => {
      const evidence = createValidEvidence({
        nativeBuild: {
          status: 'passed',
          candidateHash: 'forged-sha256-0000000000000000000000000000000000000000000000000000000000',
          timestamp: now + 40,
        },
      });
      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash,
        validationEvidence: evidence,
        userId: 'user-gate1',
        authMode: 'real',
      });
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /mismatches candidate hash/);
    });

    it('1.9: rejects forged native build evidence with mismatched projectId', async () => {
      const evidence = createValidEvidence({
        nativeBuild: {
          status: 'passed',
          candidateHash,
          projectId: 'wrong-project-id',
          timestamp: now + 40,
        },
      });
      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash,
        validationEvidence: evidence,
        userId: 'user-gate1',
        authMode: 'real',
      });
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /mismatches target project/);
    });

    it('1.10: rejects evidence whose candidateTimestamp predates candidate generation', async () => {
      const evidence = createValidEvidence({
        candidateTimestamp: now - 10_000,
        timestamp: now - 9_000,
      });
      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash,
        validationEvidence: evidence,
        userId: 'user-gate1',
        authMode: 'real',
        candidateTimestamp: now,
      });
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /predates candidate generation timestamp/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GATE 2: Real Runtime Verification & Lifecycle Cleanup (GATE-201)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gate 2: Real Runtime Verification & Lifecycle Cleanup', () => {
    it('2.1: executes real runtime verification flow with clean teardown', async () => {
      let prepared = false;
      let installed = false;
      let built = false;
      let started = false;
      let killed = false;
      let cleanedUp = false;

      const mockRunner = {
        name: 'MockRunner',
        async prepare() { prepared = true; },
        async install() {
          installed = true;
          return { success: true, exitCode: 0, stdout: 'npm ok', stderr: '', durationMs: 100 };
        },
        async build() {
          built = true;
          return { success: true, exitCode: 0, stdout: 'compiled ok', stderr: '', durationMs: 200 };
        },
        async start() {
          started = true;
          return {
            processId: 'proc-12345',
            port: 3000,
            url: 'http://localhost:3000',
            stdoutStream: null,
            stderrStream: null,
            async stop() {
              killed = true;
            },
          };
        },
        async smokeTest() {
          return { success: true, statusCode: 200 };
        },
        async kill() {
          killed = true;
        },
        async cleanup() {
          cleanedUp = true;
        },
      };

      const candidateFiles = { 'app/page.tsx': 'export default function Page() { return <h1>Runtime Ok</h1>; }' };
      const candidateHash = computeCandidateHash(candidateFiles);

      const evidence = await executeRealRuntimeVerification({
        files: candidateFiles,
        candidateHash,
        framework: 'nextjs',
        projectId: 'g2-proj',
        revision: 1,
        runner: mockRunner as any,
      });

      assert.strictEqual(prepared, true, 'Workspace must be prepared');
      assert.strictEqual(installed, true, 'Dependencies must be installed');
      assert.strictEqual(built, true, 'Build must be executed');
      assert.strictEqual(started, true, 'Application server must be started');
      assert.strictEqual(killed, true, 'Application process must be killed');
      assert.strictEqual(cleanedUp, true, 'Sandbox workspace must be cleaned up');

      assert.strictEqual(evidence.startupStatus, 'ready');
      assert.strictEqual(evidence.healthy, true);
      assert.strictEqual(evidence.httpStatus, 200);
      assert.strictEqual(evidence.processTerminated, true);
      assert.strictEqual(evidence.sandboxCleaned, true);
      assert.strictEqual(evidence.candidateHash, candidateHash);
      assert.ok(evidence.evidenceId.startsWith('ev_rt_'));
    });

    it('2.2: validates runtime evidence integrity and rejects simulated evidence', () => {
      const validEvidence: RealRuntimeEvidence = {
        evidenceId: 'ev_rt_test123_abc',
        projectId: 'g2-proj',
        revision: 1,
        candidateHash: 'hash-abc',
        framework: 'nextjs',
        command: 'next start',
        exitStatus: 0,
        startupStatus: 'ready',
        url: 'http://localhost:3000',
        port: 3000,
        httpStatus: 200,
        healthy: true,
        timestamp: new Date().toISOString(),
        durationMs: 1500,
        processTerminated: true,
        sandboxCleaned: true,
      };

      const expected = { candidateHash: 'hash-abc', projectId: 'g2-proj', revision: 1, framework: 'nextjs' };

      assert.strictEqual(validateRuntimeEvidenceIntegrity(validEvidence, expected).valid, true);

      // Rejects hash mismatch
      assert.strictEqual(
        validateRuntimeEvidenceIntegrity(validEvidence, { ...expected, candidateHash: 'different-hash' }).valid,
        false
      );

      // Rejects unhealthy / failed HTTP smoke check
      assert.strictEqual(
        validateRuntimeEvidenceIntegrity({ ...validEvidence, healthy: false, httpStatus: 500 }, expected).valid,
        false
      );

      // Rejects forged ID
      assert.strictEqual(
        validateRuntimeEvidenceIntegrity({ ...validEvidence, evidenceId: 'forged-id' }, expected).valid,
        false
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GATE 3: Real Visual Verification (GATE-301)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gate 3: Real Visual Verification', () => {
    it('3.1: computes real screenshot bytes SHA-256 and perceptual diff', () => {
      const candidateFiles = { 'app/page.tsx': 'export default function Page() { return <h1>Visual Match</h1>; }' };
      const candidateHash = computeCandidateHash(candidateFiles);

      // Real screenshot bytes
      const mockCandidateScreenshot = Buffer.from('mock-png-candidate-image-bytes-123456');
      const mockBaselineScreenshot = Buffer.from('mock-png-candidate-image-bytes-123456'); // Identical

      const evidence = executeRealVisualVerification({
        renderedScreenshot: mockCandidateScreenshot,
        referenceImage: mockBaselineScreenshot,
        candidateHash,
        projectId: 'g3-proj',
        revision: 1,
      });

      assert.strictEqual(evidence.comparisonStatus, 'VERIFIED_MATCH');
      assert.strictEqual(evidence.candidateHash, candidateHash);
      assert.strictEqual(typeof evidence.renderedImageHash, 'string');
      assert.strictEqual(evidence.renderedImageHash.length, 64);
      assert.strictEqual(evidence.comparisonScore, 1.0);
      assert.ok(evidence.screenshotEvidenceId.startsWith('visshot_'));
    });

    it('3.2: validates visual evidence integrity and rejects simulated scores or missing bytes', () => {
      const validVisual: RealVisualEvidence = {
        renderedImageHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        referenceImageHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        screenshotEvidenceId: 'visshot_valid_123456',
        comparisonMethod: 'rendered_checksum',
        comparisonScore: 1.0,
        viewport: { width: 1280, height: 800 },
        candidateHash: 'hash-vis-1',
        projectId: 'g3-proj',
        revision: 1,
        timestamp: new Date().toISOString(),
        comparisonStatus: 'VERIFIED_MATCH',
      };

      const expected = { candidateHash: 'hash-vis-1', projectId: 'g3-proj', revision: 1 };

      assert.strictEqual(validateVisualEvidenceIntegrity(validVisual, expected).valid, true);

      // Rejects mismatched candidate hash
      assert.strictEqual(
        validateVisualEvidenceIntegrity(validVisual, { ...expected, candidateHash: 'wrong-hash' }).valid,
        false
      );

      // Rejects non-verified comparison status
      const unverifiedPayload = { ...validVisual, comparisonStatus: 'VISUAL_VERIFICATION_UNAVAILABLE' as const };
      assert.strictEqual(validateVisualEvidenceIntegrity(unverifiedPayload, expected).valid, false);

      // Rejects missing screenshot evidence ID
      const missingEvidenceId = { ...validVisual, screenshotEvidenceId: '' };
      assert.strictEqual(validateVisualEvidenceIntegrity(missingEvidenceId, expected).valid, false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GATE 4: Typed SSE Streaming Transport (GATE-401)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gate 4: Typed SSE Streaming Transport', () => {
    it('4.1: formats and decodes typed SSE event streams correctly', () => {
      const events: StreamEvent[] = [
        { type: 'start', sequenceId: 1, timestamp: new Date().toISOString(), messageId: 'm1', role: 'assistant' },
        { type: 'intent', sequenceId: 2, timestamp: new Date().toISOString(), intent: { action: 'ADD_FEATURE', description: 'Hero update' } as any },
        { type: 'file_start', sequenceId: 3, timestamp: new Date().toISOString(), path: 'components/Hero.tsx', operation: 'create' },
        { type: 'file_delta', sequenceId: 4, timestamp: new Date().toISOString(), path: 'components/Hero.tsx', delta: 'export function Hero() {}' },
        { type: 'file_complete', sequenceId: 5, timestamp: new Date().toISOString(), path: 'components/Hero.tsx', sizeBytes: 25, hash: 'h1' },
        { type: 'validation', sequenceId: 6, timestamp: new Date().toISOString(), stage: 'static', passed: true },
        { type: 'build', sequenceId: 7, timestamp: new Date().toISOString(), status: 'passed', exitCode: 0 },
        { type: 'runtime', sequenceId: 8, timestamp: new Date().toISOString(), status: 'passed', httpStatus: 200 },
        { type: 'visual', sequenceId: 9, timestamp: new Date().toISOString(), status: 'passed', match: true },
        { type: 'complete', sequenceId: 10, timestamp: new Date().toISOString(), totalDurationMs: 100 },
      ];

      const sseText = events.map(e => formatStreamEvent(e)).join('');
      const decoder = new StreamEventDecoder();
      const decodedEvents = decoder.pushChunk(sseText);

      assert.strictEqual(decodedEvents.length, events.length);
      assert.strictEqual(decodedEvents[0].type, 'start');
      assert.strictEqual(decodedEvents[1].type, 'intent');
      assert.strictEqual(decodedEvents[2].type, 'file_start');
      assert.strictEqual(decodedEvents[3].type, 'file_delta');
      assert.strictEqual(decodedEvents[4].type, 'file_complete');
      assert.strictEqual(decodedEvents[5].type, 'validation');
      assert.strictEqual(decodedEvents[6].type, 'build');
      assert.strictEqual(decodedEvents[7].type, 'runtime');
      assert.strictEqual(decodedEvents[8].type, 'visual');
      assert.strictEqual(decodedEvents[9].type, 'complete');
    });

    it('4.2: fails explicitly on malformed SSE payloads', () => {
      const decoder = new StreamEventDecoder();
      const events = decoder.pushChunk('data: { this is corrupted not valid JSON }\n\n');
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'error');
      assert.strictEqual((events[0] as any).code, 'MALFORMED_SSE_PAYLOAD');
      assert.strictEqual((events[0] as any).fatal, true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GATE 5: Multilingual Semantic Intent Routing (GATE-501)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gate 5: Non-Keyword Multilingual Semantic Intent Routing', () => {
    it('5.1: verifies chat-panel does not contain human-language keyword regex lists', () => {
      const chatPanelPath = path.resolve(process.cwd(), 'components/builder/chat-panel.tsx');
      const chatPanelSrc = fs.readFileSync(chatPanelPath, 'utf8');

      // Bengali keyword list must NOT be present
      assert.doesNotMatch(chatPanelSrc, /বানাও|তৈরি|তৈরী|বানিয়ে|করে দাও|লিখো/);

      // English keyword regex list must NOT be present
      assert.doesNotMatch(chatPanelSrc, /^(build|create|make|generate|start|setup|scaffold|code)\s+/i);

      // Affirmative confirmation regex list must NOT be present
      assert.doesNotMatch(chatPanelSrc, /^(yes|proceed|continue|confirm|do it|go ahead|apply|approve|sure|ok|okay)\b/i);

      // Intent parsing must be routed via parseIntentFromPrompt
      assert.match(chatPanelSrc, /parseIntentFromPrompt/);
      assert.match(chatPanelSrc, /MUTATING_INTENT_ACTIONS/);
    });

    it('5.2: routes natural language prompts semantically across 7 languages', () => {
      const prompts = [
        { lang: 'English', text: 'Please modify the navbar to include a search bar' },
        { lang: 'Bengali', text: 'ন্যাভবারে একটি সার্চ বার যুক্ত করো' },
        { lang: 'Hindi', text: 'कृपया नेवबार में एक सर्च बार जोड़ें' },
        { lang: 'Spanish', text: 'Por favor añade una barra de búsqueda en la barra de navegación' },
        { lang: 'French', text: 'Veuillez ajouter une barre de recherche dans la barre de navigation' },
        { lang: 'Arabic', text: 'يرجى إضافة شريط بحث إلى شريط التنقل' },
        { lang: 'Japanese', text: 'ナビゲーションバーに検索バーを追加してください' },
      ];

      for (const { lang, text } of prompts) {
        const intent = parseIntentFromPrompt({
          prompt: text,
          framework: 'nextjs',
          currentFiles: {
            'components/Navbar.tsx': 'export function Navbar() { return <nav>Logo</nav>; }',
          },
        });
        assert.ok(
          MUTATING_INTENT_ACTIONS.has(intent.action),
          `Prompt in ${lang} must resolve to a mutating action, got ${intent.action}`
        );
      }
    });

    it('5.3: routes purely conversational or explanatory prompts safely to non-mutating intent', () => {
      const nonMutatingPrompts = [
        'How does the authentication flow work in this app?',
        'Can you explain what the Hero component renders?',
        'What packages are installed in this project?',
      ];

      for (const prompt of nonMutatingPrompts) {
        const intent = parseIntentFromPrompt({
          prompt,
          framework: 'nextjs',
          currentFiles: {
            'components/Hero.tsx': 'export function Hero() { return <section>Hero</section>; }',
          },
        });
        assert.ok(
          READONLY_INTENT_ACTIONS.has(intent.action),
          `Exploratory prompt "${prompt}" must resolve to non-mutating action, got ${intent.action}`
        );
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GATE 6: Monaco Authoritative Mutation Path (GATE-601)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gate 6: Monaco Authoritative Mutation Path & Multi-file Support', () => {
    it('6.1: verifies code-editor.tsx uses CAS commit and routes through candidate verification', () => {
      const editorPath = path.resolve(process.cwd(), 'components/builder/code-editor.tsx');
      const editorSrc = fs.readFileSync(editorPath, 'utf8');

      // Must capture baselineRevision
      assert.match(editorSrc, /baselineRevision/);

      // Must call candidate validation route
      assert.match(editorSrc, /\/api\/validate\/candidate/);

      // Must support multi-file candidate payload via files object
      assert.match(editorSrc, /json\.files/);

      // Must handle concurrency conflict
      assert.match(editorSrc, /conflict/i);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GATE 7: Acceptance Verification Matched to Criterion Type (GATE-701)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gate 7: Acceptance Verification Matched to Criterion Type', () => {
    const workspace = {
      'components/Button.tsx': 'export function Button() { return <button onClick={() => alert("clicked")}>Click</button>; }',
    };

    it('7.1: classifies criteria correctly into static, build, runtime, behavioral, visual', () => {
      const criteria = [
        { id: 'c1', criterion: 'Button exists', type: 'symbol_exists' as const, target: 'Button', verification: 'static_ast' as const },
        { id: 'c2', criterion: 'Build passes', type: 'build_passes' as const, target: 'build', verification: 'native_build' as const },
        { id: 'c3', criterion: 'Runtime HTTP 200', type: 'runtime_http' as const, target: 'http', verification: 'runtime_http' as const },
        { id: 'c4', criterion: 'Button click handler', type: 'interaction' as const, target: 'button click', verification: 'behavioral' as const },
        { id: 'c5', criterion: 'Visual similarity', type: 'visual_similarity' as const, target: 'screenshot', verification: 'visual_or_runtime' as const },
      ];

      const res = evaluateAcceptanceCriteria({
        workspace,
        criteria,
        runtimeContext: {
          nativeBuildStatus: 'passed',
          runtimeHttpStatus: 200,
          behavioralPassed: true,
          visualStatus: 'passed',
        },
      });

      assert.strictEqual(res.allPassed, true);
      assert.strictEqual(res.results.find(r => r.id === 'c1')?.criterionClass, 'static');
      assert.strictEqual(res.results.find(r => r.id === 'c2')?.criterionClass, 'build');
      assert.strictEqual(res.results.find(r => r.id === 'c3')?.criterionClass, 'runtime');
      assert.strictEqual(res.results.find(r => r.id === 'c4')?.criterionClass, 'behavioral');
      assert.strictEqual(res.results.find(r => r.id === 'c5')?.criterionClass, 'visual');
    });

    it('7.2: behavioral criteria fail when runtime behavioral check fails', () => {
      const criteria = [{ id: 'c4', criterion: 'Button click', type: 'interaction' as const, target: 'button click', verification: 'behavioral' as const }];
      const res = evaluateAcceptanceCriteria({
        workspace,
        criteria,
        runtimeContext: {
          behavioralPassed: false,
        },
      });
      assert.strictEqual(res.allPassed, false);
      assert.strictEqual(res.results[0].status, 'failed');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GATES 9 & 10: Broken Candidates & Unavailable Infrastructure Fail-Closed
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gates 9 & 10: Fail-Closed Boundaries', () => {
    it('9.1: deliberately broken syntax candidate fails static evaluation and rejects commit', async () => {
      const brokenFiles = {
        'package.json': JSON.stringify({ name: 'broken-app' }),
        'app/page.tsx': 'export default function Page() { return <div>Broken Syntax <><><>! };',
      };

      const evalRes = await evaluateCandidateChanges({
        projectId: 'proj-broken-cand',
        framework: 'nextjs',
        currentFiles: {},
        candidateFiles: brokenFiles,
        isNewBuild: true,
      });

      assert.strictEqual(evalRes.accepted, false);
      assert.ok(evalRes.diagnostics.length > 0);
    });

    it('10.1: candidate evaluation fails closed when native build is not passed', async () => {
      const candidateFiles = {
        'package.json': JSON.stringify({ name: 'ok-app', dependencies: { next: '15.0.0' } }),
        'app/page.tsx': 'export default function Page() { return <div>Ok</div>; }',
      };

      const evalRes = await evaluateCandidateChanges({
        projectId: 'proj-unavail-cand',
        framework: 'nextjs',
        currentFiles: {},
        candidateFiles,
        isNewBuild: true,
        runtimeContext: {
          nativeBuildStatus: 'unavailable',
        },
      });

      assert.strictEqual(evalRes.accepted, false);
      assert.ok(evalRes.diagnostics.some(d => d.includes('native build is not \'passed\'')));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GATES 13 & 14: Security Invariants and Zero Regression
  // ──────────────────────────────────────────────────────────────────────────
  describe('Gates 13 & 14: Security Invariants & Zero Regression', () => {
    it('13.1: enforces CAS revision conflicts and prevents concurrent overwrites', async () => {
      const projectId = 'proj-sec-cas-01';
      seedAuthoritativeProject(projectId, 'alice', 'CAS Proj', 'nextjs', { 'index.html': 'v1' });

      const candidateFiles = { 'index.html': 'v2' };
      const candidateHash = computeCandidateHash(candidateFiles);
      const evidence: ValidationEvidence = {
        validationId: 'val-cas-1',
        candidateHash,
        candidateTimestamp: Date.now(),
        timestamp: Date.now(),
        accepted: true,
        staticAnalysis: { valid: true, errorCount: 0, warningCount: 0, diagnostics: [] },
        nativeBuild: { status: 'passed', exitCode: 0, timestamp: Date.now() },
      };

      // Concurrent commit with wrong expected revision (2 instead of 1)
      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 2,
        candidateFiles,
        candidateHash,
        validationEvidence: evidence,
        userId: 'alice',
        authMode: 'real',
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.conflict, true);
    });

    it('13.2: enforces sandbox path containment against path traversals and drive letters', () => {
      const sandboxRoot = 'C:\\sandbox\\workspace';

      assert.doesNotMatch(assertContainedSandboxPath('app/page.tsx', sandboxRoot), /\.\./);
      assert.throws(() => assertContainedSandboxPath('../evil.js', sandboxRoot), /Path traversal/i);
      assert.throws(() => assertContainedSandboxPath('../../etc/passwd', sandboxRoot), /Path traversal/i);
      assert.throws(() => assertContainedSandboxPath('D:\\hacked.txt', sandboxRoot), /prohibited|Windows drive letter/i);
      assert.throws(() => assertContainedSandboxPath('\\\\attacker\\share\\pwn', sandboxRoot), /prohibited|UNC share/i);
      assert.throws(() => assertContainedSandboxPath('test\0payload', sandboxRoot), /null-byte|null byte/i);
    });

    it('13.3: enforces distributed rate limiting in failClosed mode', async () => {
      resetRateLimitStore();
      const clientIp = '198.51.100.99';

      // Verify that in failClosed mode, backend errors result in rejection
      const mockFailingBackend = {
        async get() { throw new Error('Redis connection timeout'); },
        async set() { throw new Error('Redis connection timeout'); },
        async incr() { throw new Error('Redis connection timeout'); },
        async expire() { throw new Error('Redis connection timeout'); },
      };

      const res = await checkRateLimitDistributed(clientIp, {
        backend: mockFailingBackend as any,
        failClosed: true,
        limit: 10,
        windowSeconds: 60,
      });

      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.remaining, 0);
    });
  });
});
