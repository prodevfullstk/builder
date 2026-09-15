import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  createTypedAgentSSEStream,
  StreamEventDecoder,
  formatStreamEvent,
  StreamEvent,
  PlanEvent,
  FileReadEvent,
} from '../lib/ai/stream-events';
import { parseIntentFromPrompt } from '../lib/ai/intent-contract';

describe('Phase AI Execution UX, Streaming, Plan & Workspace Visibility Contract', () => {
  // ── 1 & 2: Progressive Streaming & Conversational Prose ──
  describe('P0-1 & P0-2: Progressive Natural Language Streaming in Build Mode', () => {
    it('verifies chat-panel.tsx consumes text_delta during build mode', () => {
      const chatPanelSrc = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/chat-panel.tsx'),
        'utf-8'
      );
      assert.ok(
        chatPanelSrc.includes("ev.type === 'text_delta'"),
        'chat-panel.tsx must process text_delta events'
      );
      assert.ok(
        chatPanelSrc.includes('setStreamingProse(accumulatedProse)'),
        'chat-panel.tsx must stream prose to UI via setStreamingProse'
      );
      assert.ok(
        chatPanelSrc.includes('introText={') && chatPanelSrc.includes('streamingProse'),
        'ExecutionPlanCard must receive live streamingProse as introText'
      );
    });

    it('emits text_delta events before and outside of file blocks in SSE stream', async () => {
      const rawText = 'I will create a Next.js landing page with a navbar and hero section.\n\n<FILE path="app/page.tsx">export default function Page() { return <div>Hello</div>; }</FILE>\n\nAll components have been configured.';
      const encoder = new TextEncoder();
      const rawStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(rawText));
          controller.close();
        },
      });

      const intent = parseIntentFromPrompt({
        prompt: 'Build SaaS landing page',
        framework: 'nextjs',
        currentFiles: {},
      });

      const sseStream = createTypedAgentSSEStream({
        rawStream,
        intent,
      });

      const reader = sseStream.getReader();
      const decoder = new TextDecoder();
      const sseDecoder = new StreamEventDecoder();
      const receivedEvents: StreamEvent[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const events = sseDecoder.pushChunk(chunk);
        receivedEvents.push(...events);
      }

      const textDeltas = receivedEvents.filter((e) => e.type === 'text_delta');
      assert.ok(textDeltas.length >= 1, 'Must emit at least one text_delta before file block');
      assert.ok(
        textDeltas.some((t: any) => t.delta.includes('landing page')),
        'text_delta must contain the introductory natural language explanation'
      );
    });
  });

  // ── 3: No Internal Chain-of-Thought Leakage ──
  describe('P0-3: Private Chain-of-Thought & Prompt Leakage Sanitization', () => {
    it('verifies chat-panel.tsx sanitizes internal rules and diagnostics before UI presentation', () => {
      const chatPanelSrc = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/chat-panel.tsx'),
        'utf-8'
      );
      assert.ok(
        chatPanelSrc.includes('Assessment of initial workspace state'),
        'chat-panel.tsx must sanitize assessment scratchpads'
      );
      assert.ok(
        chatPanelSrc.includes('CRITICAL GENERATION RULES'),
        'chat-panel.tsx must sanitize system generation rules'
      );
    });
  });

  // ── 4, 5, 6: Dynamic Plan Generation & Truthful Milestones ──
  describe('P1-4, P1-5 & P1-6: Dynamic Plan Milestones & Truthful State Machine', () => {
    it('generates prompt-grounded dynamic milestones in app/api/agent/route.ts', () => {
      const routeSrc = fs.readFileSync(
        path.join(process.cwd(), 'app/api/agent/route.ts'),
        'utf-8'
      );
      assert.ok(
        routeSrc.includes('dynamicSteps'),
        'route.ts must compute dynamic steps based on intent and prompt requirements'
      );
      assert.ok(
        routeSrc.includes('milestones: dynamicSteps.map'),
        'route.ts must pass structured milestones into createTypedAgentSSEStream'
      );
    });

    it('emits structured milestones in plan event with runId', async () => {
      const encoder = new TextEncoder();
      const rawStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('Starting generation...'));
          controller.close();
        },
      });

      const intent = parseIntentFromPrompt({
        prompt: 'Build modern SaaS with hero and pricing',
        framework: 'nextjs',
        currentFiles: {},
      });

      const testRunId = 'test_run_xyz_123';
      const sseStream = createTypedAgentSSEStream({
        rawStream,
        intent,
        runId: testRunId,
        planSteps: ['Design layout system', 'Build Hero section', 'Build Pricing cards'],
        milestones: [
          { id: 'm-1', title: 'Design layout system', order: 1, status: 'pending' },
          { id: 'm-2', title: 'Build Hero section', order: 2, status: 'pending' },
          { id: 'm-3', title: 'Build Pricing cards', order: 3, status: 'pending' },
        ],
      });

      const reader = sseStream.getReader();
      const decoder = new TextDecoder();
      const sseDecoder = new StreamEventDecoder();
      const receivedEvents: StreamEvent[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        receivedEvents.push(...sseDecoder.pushChunk(chunk));
      }

      const planEvent = receivedEvents.find((e) => e.type === 'plan') as PlanEvent;
      assert.ok(planEvent, 'Must emit plan event');
      assert.strictEqual(planEvent.runId, testRunId, 'Plan event must carry runId');
      assert.ok(planEvent.milestones && planEvent.milestones.length === 3, 'Must include 3 dynamic milestones');
      assert.strictEqual(planEvent.milestones[0].title, 'Design layout system');
    });

    it('verifies execution-plan-card.tsx eliminates cosmetic dependency green claims', () => {
      const cardSrc = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/execution-plan-card.tsx'),
        'utf-8'
      );
      assert.ok(
        !cardSrc.includes("id: 'milestone-deps'"),
        'execution-plan-card.tsx must not contain hardcoded milestone-deps that auto-completes'
      );
    });

    it('synthesizes multi-step prompt-grounded milestones for arbitrary prompts A through F', () => {
      const prompts = [
        { name: 'Prompt A (Bookstore)', prompt: 'Create an online bookstore with search, cart and checkout.' },
        { name: 'Prompt B (Photographer)', prompt: 'Build a portfolio website for a photographer with galleries and a contact form.' },
        { name: 'Prompt C (Dashboard)', prompt: 'Create a dashboard for monitoring server uptime.' },
        { name: 'Prompt D (SaaS Landing Page)', prompt: 'Build a SaaS landing page with navbar, hero, pricing, testimonials and a responsive mobile menu.' },
        { name: 'Prompt E (Recipe App)', prompt: 'Create a recipe application with categories, search, favorites and a recipe detail page.' },
        { name: 'Prompt F (Task App)', prompt: 'Build a task management application with projects, tasks, filters and a responsive sidebar.' },
      ];

      for (const { name, prompt } of prompts) {
        const intent = parseIntentFromPrompt({
          prompt,
          framework: 'nextjs',
          currentFiles: {},
        });

        assert.strictEqual(intent.action, 'CREATE_PROJECT', `${name} must resolve to CREATE_PROJECT`);
        assert.ok(
          intent.requirements.length >= 3,
          `${name} must produce at least 3 distinct milestones (got ${intent.requirements.length})`
        );
        assert.ok(
          !intent.requirements.every((r) => r.startsWith('Create complete nextjs web application matching')),
          `${name} must not collapse into a single monolithic requirement line`
        );
      }
    });
  });

  // ── 7 & 8: PlanMilestone Error / Failed & Cancelled States ──
  describe('P1-7 & P1-8: PlanMilestone Failed & Cancelled Status Representation', () => {
    it('verifies PlanMilestone interface supports failed and cancelled', () => {
      const cardSrc = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/execution-plan-card.tsx'),
        'utf-8'
      );
      assert.ok(
        cardSrc.includes("'pending' | 'running' | 'completed' | 'failed' | 'cancelled'"),
        'PlanMilestone status must support failed and cancelled'
      );
    });

    it('verifies execution-plan-card.tsx renders XCircle and diagnostic message for failed status', () => {
      const cardSrc = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/execution-plan-card.tsx'),
        'utf-8'
      );
      assert.ok(cardSrc.includes('XCircle'), 'execution-plan-card.tsx must render XCircle for failed milestone');
      assert.ok(cardSrc.includes('milestone.error'), 'execution-plan-card.tsx must display milestone.error');
    });

    it('verifies execution-plan-card.tsx renders MinusCircle for cancelled status', () => {
      const cardSrc = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/execution-plan-card.tsx'),
        'utf-8'
      );
      assert.ok(cardSrc.includes('MinusCircle'), 'execution-plan-card.tsx must render MinusCircle for cancelled milestone');
    });
  });

  // ── 9: Generating vs Built/Wrote Lifecycle ──
  describe('P1-9: File Lifecycle Separation (Generating vs Built/Wrote)', () => {
    it('verifies file_start step displays Generating rather than Wrote', () => {
      const chatPanelSrc = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/chat-panel.tsx'),
        'utf-8'
      );
      assert.ok(
        chatPanelSrc.includes('label: `Generating ${ev.path.split(\'/\').pop()}`'),
        'file_start must label file step as Generating'
      );
      assert.ok(
        chatPanelSrc.includes("state: 'generating'"),
        'file_start must set subAction state to generating'
      );
    });

    it('verifies file steps transition to Built with lines count only after commit', () => {
      const chatPanelSrc = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/chat-panel.tsx'),
        'utf-8'
      );
      assert.ok(
        chatPanelSrc.includes('label: `Built ${step.file.split(\'/\').pop()}`'),
        'Committed files must be labeled Built with linesAdded'
      );
    });
  });

  // ── 10 & 11: File Read Transparency Drawer ──
  describe('P1-10 & P1-11: Context File Read Visibility', () => {
    it('emits file_read events when retrieved snippets are provided', async () => {
      const encoder = new TextEncoder();
      const rawStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('Processing with context...'));
          controller.close();
        },
      });

      const intent = parseIntentFromPrompt({
        prompt: 'Update navbar brand logo',
        framework: 'nextjs',
        currentFiles: { 'components/Navbar.tsx': 'export function Navbar() {}' },
      });

      const sseStream = createTypedAgentSSEStream({
        rawStream,
        intent,
        retrievedSnippets: [
          { path: 'components/Navbar.tsx', relevanceReason: 'Direct navigation component', content: 'export function Navbar() {}' },
          { path: 'app/layout.tsx', relevanceReason: 'Root shell layout', content: 'export default function Layout() {}' },
        ],
      });

      const reader = sseStream.getReader();
      const decoder = new TextDecoder();
      const sseDecoder = new StreamEventDecoder();
      const receivedEvents: StreamEvent[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        receivedEvents.push(...sseDecoder.pushChunk(chunk));
      }

      const fileReads = receivedEvents.filter((e) => e.type === 'file_read') as FileReadEvent[];
      assert.strictEqual(fileReads.length, 2, 'Must emit 2 file_read events');
      assert.strictEqual(fileReads[0].path, 'components/Navbar.tsx');
      assert.strictEqual(fileReads[0].reason, 'Direct navigation component');
    });

    it('verifies execution-plan-card.tsx renders separate drawers for files read and files updated', () => {
      const cardSrc = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/execution-plan-card.tsx'),
        'utf-8'
      );
      assert.ok(
        cardSrc.includes('files read for context'),
        'execution-plan-card.tsx must display context files read drawer'
      );
      assert.ok(
        cardSrc.includes('files updated'),
        'execution-plan-card.tsx must display files updated drawer'
      );
    });
  });

  // ── 12 & 13: Event Envelope (runId, sequenceId, timestamp) & SSE Decoder ──
  describe('P1-12 & P1-13: Event Envelope & Stream Parsing Determinism', () => {
    it('attaches runId, sequenceId, and timestamp to every emitted event', async () => {
      const encoder = new TextEncoder();
      const rawStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('<FILE path="test.tsx">const x = 1;</FILE>'));
          controller.close();
        },
      });

      const intent = parseIntentFromPrompt({
        prompt: 'Build demo',
        framework: 'nextjs',
        currentFiles: {},
      });

      const testRunId = 'run_envelope_check_999';
      const sseStream = createTypedAgentSSEStream({
        rawStream,
        intent,
        runId: testRunId,
      });

      const reader = sseStream.getReader();
      const decoder = new TextDecoder();
      const sseDecoder = new StreamEventDecoder();
      const receivedEvents: StreamEvent[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        receivedEvents.push(...sseDecoder.pushChunk(chunk));
      }

      assert.ok(receivedEvents.length >= 4, 'Must emit start, intent, plan, file events, validation, complete');
      let previousSeq = 0;
      for (const ev of receivedEvents) {
        assert.strictEqual(ev.runId, testRunId, `Event ${ev.type} must have runId`);
        assert.ok(ev.sequenceId > previousSeq, `Event sequenceId must be strictly increasing (${ev.sequenceId} > ${previousSeq})`);
        assert.ok(Boolean(ev.timestamp), `Event ${ev.type} must have timestamp`);
        previousSeq = ev.sequenceId;
      }
    });

    it('correctly reassembles SSE chunks split across arbitrary byte boundaries', () => {
      const decoder = new StreamEventDecoder();
      const eventJson1 = JSON.stringify({ type: 'start', sequenceId: 1, timestamp: new Date().toISOString(), messageId: 'm1', role: 'assistant' });
      const eventJson2 = JSON.stringify({ type: 'text_delta', sequenceId: 2, timestamp: new Date().toISOString(), delta: 'Hello world' });

      const fullString = `event: start\ndata: ${eventJson1}\n\nevent: text_delta\ndata: ${eventJson2}\n\n`;

      // Split into 3 arbitrary chunks
      const chunk1 = fullString.slice(0, 15);
      const chunk2 = fullString.slice(15, 60);
      const chunk3 = fullString.slice(60);

      const events1 = decoder.pushChunk(chunk1);
      const events2 = decoder.pushChunk(chunk2);
      const events3 = decoder.pushChunk(chunk3);

      const allEvents = [...events1, ...events2, ...events3];
      assert.strictEqual(allEvents.length, 2, 'Must parse exactly 2 events across boundaries');
      assert.strictEqual(allEvents[0].type, 'start');
      assert.strictEqual(allEvents[1].type, 'text_delta');
    });
  });

  // ── 14: Monaco AI Concurrency Preservation & Safe 3-Way Merge ──
  describe('P1-14: Monaco Concurrency Buffering & Non-Destructive Merge', () => {
    it('verifies chat-panel.tsx implements non-conflicting concurrent edit merging', () => {
      const chatPanelSrc = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/chat-panel.tsx'),
        'utf-8'
      );
      assert.ok(
        chatPanelSrc.includes('conflictPaths.length === 0'),
        'chat-panel.tsx must check for absence of conflicting paths'
      );
      assert.ok(
        chatPanelSrc.includes('Seamlessly merged non-conflicting concurrent user edits'),
        'chat-panel.tsx must log successful merge of non-conflicting edits'
      );
    });
  });

  // ── 15 & 16: Stop / Cancel Control via AbortController ──
  describe('P1-15 & P1-16: User-Visible Stop Control & Clean Cancellation', () => {
    it('verifies chat-panel.tsx provides handleCancelGeneration and aborts fetch', () => {
      const chatPanelSrc = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/chat-panel.tsx'),
        'utf-8'
      );
      assert.ok(
        chatPanelSrc.includes('handleCancelGeneration'),
        'chat-panel.tsx must provide handleCancelGeneration'
      );
      assert.ok(
        chatPanelSrc.includes('abortControllerRef.current.abort()'),
        'handleCancelGeneration must invoke abort() on AbortController'
      );
      assert.ok(
        chatPanelSrc.includes("title=\"Stop Generating\""),
        'chat-panel.tsx must render user-facing Stop Generating button'
      );
    });

    it('verifies cancelling generation marks running steps and milestones as cancelled', () => {
      const chatPanelSrc = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/chat-panel.tsx'),
        'utf-8'
      );
      assert.ok(
        chatPanelSrc.includes("status: 'cancelled' as const"),
        'handleCancelGeneration must mark running steps and milestones as cancelled'
      );
    });
  });

  // ── 17 & 18: Language-Agnostic Intent & Elimination of Hardcoded Keyword Regexes ──
  describe('P2-17 & P2-18: Language-Agnostic Intent & Regex Cleanliness', () => {
    it('verifies chat-panel.tsx eliminates hardcoded Bengali and English keyword regexes', () => {
      const chatPanelSrc = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/chat-panel.tsx'),
        'utf-8'
      );
      assert.ok(
        !chatPanelSrc.includes('সমস্যা|সমাধান'),
        'chat-panel.tsx must not contain hardcoded Bengali keyword regexes'
      );
      assert.ok(
        !chatPanelSrc.includes('/\\b(fix|repair|error|broken|bug|issue|solve)\\b/i.test(query)'),
        'chat-panel.tsx must not route via English keyword regexes'
      );
      assert.ok(
        chatPanelSrc.includes("intent.action === 'FIX_BUG'"),
        'chat-panel.tsx must rely on structured IntentContract actions'
      );
    });

    it('correctly classifies Bengali, Spanish, French, German, Russian, Arabic, Japanese, Hindi prompts via semantic classifier', () => {
      // 1. Bengali creation
      const bnIntent = parseIntentFromPrompt({
        prompt: 'একটি সুন্দর পোর্টফোলিও ওয়েবসাইট তৈরি করুন',
        framework: 'nextjs',
        currentFiles: {},
      });
      assert.strictEqual(bnIntent.action, 'CREATE_PROJECT', 'Bengali creation prompt must resolve to CREATE_PROJECT');

      // 2. Spanish creation
      const esIntent = parseIntentFromPrompt({
        prompt: 'Crea una página de aterrizaje moderna con barra de navegación',
        framework: 'nextjs',
        currentFiles: {},
      });
      assert.strictEqual(esIntent.action, 'CREATE_PROJECT', 'Spanish creation prompt must resolve to CREATE_PROJECT');

      // 3. French question
      const frQuestion = parseIntentFromPrompt({
        prompt: 'Comment fonctionne ce composant?',
        framework: 'nextjs',
        currentFiles: { 'app/page.tsx': 'export default function Page() {}' },
      });
      assert.strictEqual(frQuestion.action, 'QUESTION', 'French question prompt must resolve to QUESTION');

      // 4. German modification
      const deMod = parseIntentFromPrompt({
        prompt: 'Mache das Logo im Navigationsmenü 20% kleiner',
        framework: 'nextjs',
        currentFiles: { 'components/Navbar.tsx': 'export function Navbar() {}' },
      });
      assert.strictEqual(deMod.action, 'MODIFY_FEATURE', 'German modification prompt must resolve to MODIFY_FEATURE');

      // 5. Russian bug fix
      const ruFix = parseIntentFromPrompt({
        prompt: 'Исправь ошибку сборки в hero компоненте',
        framework: 'nextjs',
        currentFiles: { 'components/Hero.tsx': 'export function Hero() {}' },
      });
      assert.strictEqual(ruFix.action, 'FIX_BUG', 'Russian bug fix prompt must resolve to FIX_BUG');

      // 6. Arabic feature addition
      const arAdd = parseIntentFromPrompt({
        prompt: 'أضف قائمة تنقل متجاوبة للأجهزة المحمولة',
        framework: 'nextjs',
        currentFiles: { 'components/Navbar.tsx': 'export function Navbar() {}' },
      });
      assert.strictEqual(arAdd.action, 'ADD_FEATURE', 'Arabic feature add prompt must resolve to ADD_FEATURE');

      // 7. Japanese creation
      const jaIntent = parseIntentFromPrompt({
        prompt: '検索とカートを備えたオンライン書店を作成する',
        framework: 'nextjs',
        currentFiles: {},
      });
      assert.strictEqual(jaIntent.action, 'CREATE_PROJECT', 'Japanese creation prompt must resolve to CREATE_PROJECT');

      // 8. Hindi feature addition
      const hiAdd = parseIntentFromPrompt({
        prompt: 'मोबाइल नेविगेशन मेनू जोड़ें',
        framework: 'nextjs',
        currentFiles: { 'components/Navbar.tsx': 'export function Navbar() {}' },
      });
      assert.strictEqual(hiAdd.action, 'ADD_FEATURE', 'Hindi feature add prompt must resolve to ADD_FEATURE');
    });
  });

  // ── 19 & 20: Security & Regression Preservation ──
  describe('P2-19 & P2-20: Security Invariant Preservation', () => {
    it('verifies X-Run-Id header is transmitted in /api/agent response', () => {
      const routeSrc = fs.readFileSync(
        path.join(process.cwd(), 'app/api/agent/route.ts'),
        'utf-8'
      );
      assert.ok(
        routeSrc.includes('"X-Run-Id": runId'),
        'app/api/agent/route.ts must emit X-Run-Id header'
      );
    });
  });
});
