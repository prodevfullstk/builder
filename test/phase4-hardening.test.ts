import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  seedAuthoritativeProject,
  getServerProject,
  updateServerProjectWithCas,
} from '../lib/storage/project-authority';
import { POST as sandboxPOST } from '../app/api/sandbox/route';
import { assertContainedSandboxPath } from '../lib/sandbox/sandbox-containment';
import { checkRateLimit, resetRateLimitStore, checkRateLimitDistributed } from '../lib/auth/rate-limiter';
import { POST as validateBuildPOST } from '../app/api/validate/build/route';
import { evaluateCandidateChanges } from '../lib/validation/candidate-pipeline';

describe('Antigravity Phase 4 — Production Verification, Concurrency & Sandbox Hardening', () => {

  // ── CONC-401 & CONC-402: Authoritative Concurrency Control ──
  describe('CONC-401 & CONC-402: Authoritative Concurrency Control & Auto-Fix Boundary', () => {
    it('commits successfully when expected revision matches current revision and increments revision', () => {
      const projId = 'cas-test-proj-1';
      seedAuthoritativeProject(projId, 'user-alice', 'Alice Project', 'nextjs', {
        'app/page.tsx': 'export default function Page() { return <h1>V1</h1>; }',
      });

      const initial = getServerProject(projId)!;
      assert.strictEqual(initial.revision, 1);

      const res = updateServerProjectWithCas(projId, 1, {
        files: { 'app/page.tsx': 'export default function Page() { return <h1>V2</h1>; }' },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.conflict, undefined);
      assert.strictEqual(res.revision, 2);

      const updated = getServerProject(projId)!;
      assert.strictEqual(updated.revision, 2);
      assert.strictEqual(updated.files['app/page.tsx'], 'export default function Page() { return <h1>V2</h1>; }');
    });

    it('strictly rejects stale commit when expected revision is older than current revision', () => {
      const projId = 'cas-test-proj-2';
      seedAuthoritativeProject(projId, 'user-bob', 'Bob Project', 'nextjs', {
        'app/page.tsx': 'export default function Page() { return <h1>V1</h1>; }',
      });

      // Client A advances revision to 2
      const resA = updateServerProjectWithCas(projId, 1, {
        files: { 'app/page.tsx': 'export default function Page() { return <h1>V2 by Client A</h1>; }' },
      });
      assert.strictEqual(resA.success, true);
      assert.strictEqual(resA.revision, 2);

      // Client B attempts to commit based on stale revision 1
      const resB = updateServerProjectWithCas(projId, 1, {
        files: { 'app/page.tsx': 'export default function Page() { return <h1>V2 by Client B Stale</h1>; }' },
      });

      assert.strictEqual(resB.success, false);
      assert.strictEqual(resB.conflict, true);
      assert.strictEqual(resB.currentRevision, 2);
      assert.strictEqual(resB.expectedRevision, 1);
      assert.match(resB.error!, /Conflict: Stale revision detected/);

      // Verify Client A's data was NOT overwritten
      const current = getServerProject(projId)!;
      assert.strictEqual(current.revision, 2);
      assert.strictEqual(current.files['app/page.tsx'], 'export default function Page() { return <h1>V2 by Client A</h1>; }');
    });

    it('verifies preview-pane.tsx captures baselineRevision and rejects stale auto-fix commit', () => {
      const previewSource = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/preview-pane.tsx'),
        'utf-8'
      );

      // Must capture baseline revision at start
      assert.ok(
        previewSource.includes('const baselineRevision = useProjectStore.getState().revision || 1;'),
        'Expected preview-pane.tsx to capture baselineRevision at start of auto-fix'
      );

      // Must check revision before committing
      assert.ok(
        previewSource.includes('currentRevision !== baselineRevision'),
        'Expected preview-pane.tsx to compare currentRevision with baselineRevision before setFiles'
      );
    });
  });

  // ── SEC-401: Sandbox Canonical Path Containment ──
  describe('SEC-401: Sandbox Canonical Path Containment', () => {
    it('accepts valid nested paths and resolves inside sandbox root', () => {
      const normal = assertContainedSandboxPath('app/page.tsx');
      assert.strictEqual(normal, '/vercel/app/app/page.tsx');

      const leadingSlash = assertContainedSandboxPath('/src/components/button.tsx');
      assert.strictEqual(leadingSlash, '/vercel/app/src/components/button.tsx');
    });

    it('rejects ../ and ../../ traversal attempts outside sandbox workspace', () => {
      assert.throws(
        () => assertContainedSandboxPath('../etc/passwd'),
        /Security Violation: Path traversal outside sandbox workspace detected/
      );

      assert.throws(
        () => assertContainedSandboxPath('../../root/.ssh/authorized_keys'),
        /Security Violation: Path traversal outside sandbox workspace detected/
      );

      assert.throws(
        () => assertContainedSandboxPath('components/../../etc/shadow'),
        /Security Violation: Path traversal outside sandbox workspace detected/
      );
    });

    it('rejects Windows drive letters, UNC shares, and null bytes', () => {
      assert.throws(
        () => assertContainedSandboxPath('C:\\Windows\\System32\\cmd.exe'),
        /Security Violation: Absolute host path prohibited/
      );

      assert.throws(
        () => assertContainedSandboxPath('\\\\attacker-server\\share\\evil.js'),
        /Security Violation: Absolute host path prohibited/
      );

      assert.throws(
        () => assertContainedSandboxPath('app/page.tsx\0.evil'),
        /Security Violation: Invalid or null-byte path/
      );
    });

    it('rejects sibling-prefix escape paths (e.g. /vercel/app-evil)', () => {
      assert.throws(
        () => assertContainedSandboxPath('../app-evil/payload.js'),
        /Security Violation: Path traversal outside sandbox workspace detected/
      );
    });

    it('rejects traversal payload on POST /api/sandbox with HTTP 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost/api/sandbox', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Mode': 'demo',
        },
        body: JSON.stringify({
          action: 'start',
          projectId: 'demo-sandbox-traversal',
          mode: 'visual_preview',
          files: {
            '../../etc/shadow': 'root:*:1234:0:99999:7:::',
          },
        }),
      });

      const res = await sandboxPOST(req);
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /Security Violation: Path traversal/);
    });
  });

  // ── SEC-402: Distributed Multi-Instance Rate Limiting ──
  describe('SEC-402: Distributed Rate Limiting & Demo Bounding', () => {
    beforeEach(() => {
      resetRateLimitStore();
    });

    it('enforces 10 requests demo quota and returns 429 reset time', async () => {
      const key = `demo-test-ip-${Date.now()}`;
      for (let i = 0; i < 10; i++) {
        const res = await checkRateLimitDistributed(key, 10, 3600_000);
        assert.strictEqual(res.allowed, true);
        assert.strictEqual(res.remaining, 9 - i);
      }

      // 11th request must be rejected
      const overflow = await checkRateLimitDistributed(key, 10, 3600_000);
      assert.strictEqual(overflow.allowed, false);
      assert.strictEqual(overflow.remaining, 0);
      assert.ok(overflow.resetSeconds > 0);
    });
  });

  // ── GEN-401: Connected Native BuildRunner & Truthful Evidence ──
  describe('GEN-401: Connected Native BuildRunner & Truthful Verification Evidence', () => {
    it('returns truthful VERIFICATION_UNAVAILABLE when VERCEL_TOKEN is not configured', async () => {
      seedAuthoritativeProject('test-build-verif-1', 'demo-user', 'Demo Build Project', 'nextjs', {
        'package.json': JSON.stringify({ dependencies: { next: '^15.0.0' } }),
      });

      const req = new NextRequest('http://localhost/api/validate/build', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Mode': 'demo',
        },
        body: JSON.stringify({
          projectId: 'test-build-verif-1',
          framework: 'nextjs',
          files: { 'package.json': '{}' },
          mandatory: false,
        }),
      });

      const res = await validateBuildPOST(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.verificationLevel, 'VERIFICATION_UNAVAILABLE');
      assert.strictEqual(data.nativeBuild.status, 'unavailable');
      assert.strictEqual(data.nativeBuild.environment, 'none');
    });

    it('fails closed with HTTP 503 when mandatory native verification is requested but sandbox is missing', async () => {
      const req = new NextRequest('http://localhost/api/validate/build', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Mode': 'demo',
        },
        body: JSON.stringify({
          projectId: 'test-build-verif-1',
          framework: 'nextjs',
          files: { 'package.json': '{}' },
          mandatory: true, // Mandatory!
        }),
      });

      const res = await validateBuildPOST(req);
      assert.strictEqual(res.status, 503);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /failed closed/);
      assert.strictEqual(data.verificationLevel, 'VERIFICATION_UNAVAILABLE');
    });

    it('candidate pipeline assigns STATIC_VALIDATED level to verified candidates', async () => {
      const evalResult = await evaluateCandidateChanges({
        projectId: 'test-evidence-level',
        framework: 'nextjs',
        currentFiles: {},
        candidateFiles: {
          'package.json': JSON.stringify({ name: 'valid', dependencies: { next: '^15.0.0', react: '^19.0.0' } }),
          'app/layout.tsx': 'export default function Root({children}: any) { return <html><body>{children}</body></html>; }',
          'app/page.tsx': 'export default function Page() { return <h1>Hi</h1>; }',
          'requirements.md': '# Requirements\n## 4. Security & Safety Invariants\n- Tenant isolation\n- Zero leaked credentials\n- Row-Level Security',
        },
        isNewBuild: true,
      });

      assert.strictEqual(evalResult.accepted, true);
      assert.strictEqual(evalResult.evidence.verificationLevel, 'STATIC_VALIDATED');
    });
  });
});
