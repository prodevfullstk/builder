import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

import { authenticateRequest } from '../lib/auth/server-auth';
import {
  registerServerProject,
  getServerProject,
  verifyProjectOwnership,
  recordValidationEvidence,
  getValidationHistory,
} from '../lib/storage/project-authority';
import { LocalBuildRunner, getSafeChildEnvironment } from '../lib/build/build-runner';
import {
  evaluateCandidateChanges,
  scanForSecrets,
  validateRequirementsProtection,
} from '../lib/validation/candidate-pipeline';
import { checkRateLimit, resetRateLimitStore } from '../lib/auth/rate-limiter';
import { synthesizeProjectRequirements } from '../lib/ai/requirements-generator';
import { useProjectStore } from '../lib/store/project-store';
import { POST as sandboxPOST, GET as sandboxGET, DELETE as sandboxDELETE } from '../app/api/sandbox/route';

describe('Antigravity Phase 3 Security Hardening & Execution Isolation', () => {

  // ── P0-1: Demo Identity Isolation & Anti-Spoofing (SEC-301) ──
  describe('P0-1: Demo Identity Isolation & Anti-Spoofing', () => {
    it('strictly rejects demo identity header or spoofing header', async () => {
      const req = new Request('http://localhost/api/test', {
        headers: {
          'X-Auth-Mode': 'demo',
          'X-Demo-User-Id': 'attacker-spoofed-tenant-999',
        },
      });

      const auth = await authenticateRequest(req);
      assert.strictEqual(auth.user, undefined);
      assert.strictEqual(auth.status, 401);
      assert.match(auth.error || '', /Anonymous and demo access is disabled/i);
    });

    it('strictly forbids unauthorized user from accessing another user project', async () => {
      registerServerProject({
        id: 'prod-fintech-project',
        owner_id: 'real-enterprise-user-uuid',
        name: 'Enterprise Bank App',
        framework: 'nextjs',
        files: { 'app/page.tsx': 'export default function Page() { return <div>Secret</div>; }' },
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Attempt access with another user identity
      const verifyResult = await verifyProjectOwnership(
        'prod-fintech-project',
        'unauthorized-attacker-uuid',
        'real'
      );

      assert.strictEqual(verifyResult.authorized, false);
      assert.strictEqual(verifyResult.status, 403);
      assert.match(verifyResult.error || '', /Forbidden: You do not have permission to access or modify this project/i);
    });
  });

  // ── P0-2: InstantPreview Iframe Sandboxing (SEC-302) ──
  describe('P0-2: InstantPreview Iframe Sandboxing', () => {
    it('verifies instant-preview source code excludes allow-same-origin from sandbox attribute', () => {
      const previewFile = path.resolve(__dirname, '../components/preview/instant-preview.tsx');
      const content = fs.readFileSync(previewFile, 'utf8');

      // Must have sandbox attribute
      assert.match(content, /sandbox="[^"]*"/);
      // Must NOT contain allow-same-origin
      assert.doesNotMatch(content, /sandbox="[^"]*allow-same-origin[^"]*"/);
      // Must contain allow-scripts
      assert.match(content, /sandbox="[^"]*allow-scripts[^"]*"/);
    });

    it('verifies postMessage sender validation against iframeRef.current.contentWindow', () => {
      const previewFile = path.resolve(__dirname, '../components/preview/instant-preview.tsx');
      const content = fs.readFileSync(previewFile, 'utf8');

      assert.match(content, /event\.source\s*!==\s*iframeRef\.current\.contentWindow/);
    });
  });

  // ── P0-3 & P1-4: Build Runner Containment & File Boundary (EXE-301 / SEC-303) ──
  describe('P0-3 & P1-4: Build Runner Containment & File Boundary', () => {
    it('strictly rejects execution on host in production environment (NODE_ENV=production)', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const runner = new LocalBuildRunner();
        await assert.rejects(
          async () => {
            await runner.prepare({ 'package.json': '{}' });
          },
          /Security Violation: LocalBuildRunner is disabled in production/i
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('rejects directory traversal and absolute paths outside the workspace directory', async () => {
      const runner = new LocalBuildRunner();
      await assert.rejects(
        async () => {
          await runner.prepare({
            '../../../etc/passwd': 'root:x:0:0',
          });
        },
        /Path traversal attempt detected/i
      );
    });

    it('sanitizes child environment variables and strips sensitive secrets', () => {
      // getSafeChildEnvironment() builds from process.env allowlist then removes SENSITIVE_KEYS.
      // Verify that keys in the SENSITIVE_KEYS blacklist are never present in output even if
      // the host process.env contains them.
      const savedVals: Record<string, string | undefined> = {};
      const sensitiveKeys = [
        'DATABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'GROQ_API_KEY',
        'ANTHROPIC_API_KEY',
        'GEMINI_API_KEY',
        'STRIPE_SECRET_KEY',
      ];
      for (const k of sensitiveKeys) {
        savedVals[k] = process.env[k];
        process.env[k] = 'super_secret_value';
      }
      process.env.SAFE_APP_VAR = 'public_value';

      try {
        const sanitized = getSafeChildEnvironment();
        for (const k of sensitiveKeys) {
          assert.strictEqual(sanitized[k], undefined,
            `Expected ${k} to be stripped from child environment`);
        }
        // PATH should always be present
        assert.ok(sanitized.PATH !== undefined);
      } finally {
        for (const k of sensitiveKeys) {
          if (savedVals[k] === undefined) {
            delete process.env[k];
          } else {
            process.env[k] = savedVals[k];
          }
        }
        delete process.env.SAFE_APP_VAR;
      }
    });
  });

  // ── P1-1: Unconditional Build/Commit Gate (GEN-301) ──
  describe('P1-1: Unconditional Build Verification Commit Gate', () => {
    it('verifies chat-panel does not bypass compilation failures during auto-fix requests', () => {
      const chatPanelFile = path.resolve(__dirname, '../components/builder/chat-panel.tsx');
      const content = fs.readFileSync(chatPanelFile, 'utf8');

      // The commit gate must NOT have "!isFixRequest" exception
      assert.doesNotMatch(content, /if\s*\(!compilationPassed\s*&&\s*!isFixRequest\)/);
      // The gate must be unconditional: if (!compilationPassed)
      assert.match(content, /if\s*\(!compilationPassed\)/);
    });
  });

  // ── P1-2: Monotonic Revision Tracking & Optimistic Concurrency (GEN-302) ──
  describe('P1-2: Monotonic Revision Tracking & Optimistic Concurrency', () => {
    it('increments project revision monotonically upon each file mutation', () => {
      const store = useProjectStore.getState();
      const initialRev = store.revision || 1;

      store.updateFile('app/page.tsx', 'export default function Page() { return <h1>Rev 2</h1>; }');
      const revAfterUpdate = useProjectStore.getState().revision;
      assert.strictEqual(revAfterUpdate, initialRev + 1);

      store.createFile('components/Button.tsx', 'export function Button() { return <button>Click</button>; }');
      const revAfterCreate = useProjectStore.getState().revision;
      assert.strictEqual(revAfterCreate, revAfterUpdate + 1);

      store.deleteFile('components/Button.tsx');
      const revAfterDelete = useProjectStore.getState().revision;
      assert.strictEqual(revAfterDelete, revAfterCreate + 1);
    });
  });

  // ── P1-3: Sandbox API Ownership Verification (SEC-304) ──
  describe('P1-3: Sandbox API Ownership Verification', () => {
    it('rejects POST /api/sandbox with missing projectId with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost/api/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token-user-alpha' },
        body: JSON.stringify({ action: 'start', files: {} }),
      });

      const res = await sandboxPOST(req);
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /projectId.*required/i);
    });

    it('rejects cross-tenant caller on POST /api/sandbox with 403 Forbidden', async () => {
      // Register a project owned by user-alpha
      registerServerProject({
        id: 'alpha-private-project',
        owner_id: 'user-alpha',
        name: 'Alpha Project',
        framework: 'nextjs',
        files: { 'app/page.tsx': 'export default function Page() { return <div>Alpha</div>; }' },
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Call as user-beta trying to overwrite user-alpha's sandbox
      const req = new NextRequest('http://localhost/api/sandbox', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token-user-beta',
        },
        body: JSON.stringify({
          action: 'start',
          projectId: 'alpha-private-project',
          files: { 'app/page.tsx': 'hacked' },
        }),
      });

      const res = await sandboxPOST(req);
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.match(data.error, /Forbidden/i);
    });

    it('rejects cross-tenant caller on DELETE /api/sandbox with 403 Forbidden', async () => {
      const deleteReq = new NextRequest('http://localhost/api/sandbox?projectId=alpha-private-project', {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer test-token-user-beta' },
      });

      const res = await sandboxDELETE(deleteReq);
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.match(data.error, /Forbidden/i);
    });

    it('rejects cross-tenant caller on GET /api/sandbox with 403 Forbidden', async () => {
      const getReq = new NextRequest('http://localhost/api/sandbox?projectId=alpha-private-project', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token-user-beta' },
      });

      const res = await sandboxGET(getReq);
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.match(data.error, /Forbidden/i);
    });
  });

  // ── P1-5: Requirements Specification Protection (SEC-306) ──
  describe('P1-5: Requirements Specification Protection', () => {
    const baseFiles = {
      'package.json': JSON.stringify({ name: 'safe-app', dependencies: { next: '^15.0.0', react: '^19.0.0' } }),
      'app/layout.tsx': 'export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }',
      'app/page.tsx': 'export default function Page() { return <h1>Page</h1>; }',
      'requirements.md': `# Requirements
## 4. Security & Safety Invariants
- Tenant isolation: users may only read and modify their own project data.
- Zero leaked credentials: API keys and private tokens must never be committed.
- Database access must enforce Row-Level Security policies.`,
    };

    it('rejects candidate changes that attempt to delete requirements.md', async () => {
      const candidateFiles = {
        'requirements.md': null, // Deletion attempt
      };

      const result = await evaluateCandidateChanges({
        projectId: 'test-reqs-del',
        framework: 'nextjs',
        currentFiles: baseFiles,
        candidateFiles,
        isNewBuild: false,
      });

      assert.strictEqual(result.accepted, false);
      // Actual message: "Security Violation: Cannot delete requirements.md. Project specifications are protected."
      assert.match(result.diagnostics.join(' '), /Cannot delete requirements\.md/i);
      assert.deepStrictEqual(result.committedFiles, baseFiles);
    });

    it('rejects candidate changes that remove declared security invariants from requirements.md', async () => {
      const weakenedCandidate = {
        'requirements.md': `# Requirements\n## Summary\nAll security invariants have been removed for convenience.`,
      };

      const result = await evaluateCandidateChanges({
        projectId: 'test-reqs-weaken',
        framework: 'nextjs',
        currentFiles: baseFiles,
        candidateFiles: weakenedCandidate,
        isNewBuild: false,
      });

      assert.strictEqual(result.accepted, false);
      // Actual message: "Security Violation: Weakening declared security invariants (...) in requirements.md is forbidden."
      assert.match(result.diagnostics.join(' '), /Weakening declared security invariants/i);
      assert.deepStrictEqual(result.committedFiles, baseFiles);
    });

    it('accepts legitimate enhancements to requirements.md that preserve security invariants', async () => {
      const enhancedCandidate = {
        'requirements.md': `${baseFiles['requirements.md']}\n\n## 7. Additional Features\n- Added dark mode support`,
      };

      const result = await evaluateCandidateChanges({
        projectId: 'test-reqs-enhance',
        framework: 'nextjs',
        currentFiles: baseFiles,
        candidateFiles: enhancedCandidate,
        isNewBuild: false,
      });

      assert.strictEqual(result.accepted, true);
      assert.ok(result.committedFiles['requirements.md'].includes('Additional Features'));
    });
  });

  // ── P1-6: Sliding-Window Rate Limiting (SEC-305) ──
  describe('P1-6: Sliding-Window Rate Limiting on AI Generation', () => {
    it('allows up to 10 requests for demo mode and rejects the 11th request with reset time', () => {
      resetRateLimitStore();
      const demoKey = 'demo:198.51.100.1';

      for (let i = 0; i < 10; i++) {
        const res = checkRateLimit(demoKey, 10, 3600_000);
        assert.strictEqual(res.allowed, true);
        assert.strictEqual(res.remaining, 9 - i);
      }

      // 11th request must be rejected
      const overflowRes = checkRateLimit(demoKey, 10, 3600_000);
      assert.strictEqual(overflowRes.allowed, false);
      assert.strictEqual(overflowRes.remaining, 0);
      assert.ok(overflowRes.resetSeconds > 0);
    });
  });

  // ── P1-7: Secret Detection Scanner Expansion (SEC-307) ──
  describe('P1-7: Secret Detection Scanner Expansion', () => {
    it('detects Anthropic, Groq, Google AI, Stripe, fine-grained PAT, and PostgreSQL connection URIs', () => {
      const filesWithSecrets = {
        'lib/anthropic.ts': `const key = "${'sk-ant-' + 'api03-abcdefghijklmnopqrstuvwxyz123456'}";`,
        'lib/groq.ts': `const key = "${'gsk_' + 'abcdefghijklmnopqrstuvwxyz123456'}";`,
        'lib/google.ts': `const key = "${'AIza' + 'SyD-1234567890abcdefghijklmnopqrstuv'}";`,
        'lib/stripe.ts': `const stripeKey = "${'sk_' + 'live_51Abcdefghijklmnopqrstuv'}";`,
        'lib/github.ts': `const pat = "${'github_' + 'pat_11ABCD1234_abcdefghijklmnopqrstuvwxyz1234567890abcdefghijkl'}";`,
        'lib/db.ts': `const uri = "${'postgres' + 'ql://postgres:p%40ssw0rd!@db.example.com:5432/production_db'}";`,
      };

      const result = scanForSecrets(filesWithSecrets);
      assert.strictEqual(result.hasSecrets, true);
      assert.strictEqual(result.checks[0].status, 'failed');
      assert.ok(result.diagnostics.length >= 6);
      assert.match(result.diagnostics.join(' '), /Anthropic API Key/);
      assert.match(result.diagnostics.join(' '), /Groq API Key/);
      assert.match(result.diagnostics.join(' '), /Google Gemini API Key/);
      assert.match(result.diagnostics.join(' '), /Stripe Secret Key/);
      assert.match(result.diagnostics.join(' '), /GitHub Fine-Grained Personal Access Token/);
      assert.match(result.diagnostics.join(' '), /PostgreSQL Connection URI/);
    });
  });

  // ── P2-1: Validation Evidence Disk Persistence (REL-301) ──
  describe('P2-1: Validation Evidence Disk Persistence', () => {
    it('persists validation evidence to disk and recovers history', () => {
      const projectId = 'audit-evidence-test-proj';
      const sampleEvidence = {
        validationId: 'val_test_123',
        projectId,
        timestamp: new Date().toISOString(),
        framework: 'nextjs',
        checks: [{ name: 'secret_leak_scan', status: 'passed' as const, message: 'All clear' }],
        accepted: true,
        diagnostics: [],
      };

      recordValidationEvidence(projectId, sampleEvidence);

      const history = getValidationHistory(projectId);
      assert.ok(history.length > 0);
      assert.strictEqual(history[history.length - 1].validationId, 'val_test_123');

      // Verify file exists on disk
      const evidencePath = path.join(process.cwd(), '.opendork', 'evidence', `${projectId}.json`);
      assert.ok(fs.existsSync(evidencePath));
      const diskContent = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      assert.strictEqual(diskContent[diskContent.length - 1].validationId, 'val_test_123');
    });
  });

  // ── P2-3: Framework Version Resolution in Requirements Generator ──
  describe('P2-3: Framework Version Resolution from Prompt', () => {
    it('parses explicit framework versions requested in user prompt', () => {
      const next14 = synthesizeProjectRequirements('Build an inventory dashboard with Next.js 14 and Tailwind', 'nextjs');
      assert.strictEqual(next14.spec.frameworkVersion, '^14.0.0');

      const vite4 = synthesizeProjectRequirements('Build a game with Vite 4 and Canvas', 'vite');
      assert.strictEqual(vite4.spec.frameworkVersion, '^4.0.0');

      const astro3 = synthesizeProjectRequirements('Build a blog with Astro 3', 'astro');
      assert.strictEqual(astro3.spec.frameworkVersion, '^3.0.0');

      const defaultNext = synthesizeProjectRequirements('Build an e-commerce store', 'nextjs');
      assert.strictEqual(defaultNext.spec.frameworkVersion, '^15.0.0');
    });
  });
});
