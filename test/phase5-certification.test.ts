import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { computeCandidateHash } from '../lib/validation/candidate-pipeline';
import { commitVerifiedCandidate } from '../lib/validation/candidate-commit-service';
import { POST as candidateCommitPOST } from '../app/api/validate/candidate/route';
import { checkRateLimitDistributed, resetRateLimitStore } from '../lib/auth/rate-limiter';
import { assertContainedSandboxPath } from '../lib/sandbox/sandbox-containment';
import {
  seedAuthoritativeProject,
  getServerProject,
  updateServerProjectWithCas,
} from '../lib/storage/project-authority';

describe('Antigravity Phase 5 — Production Certification Hardening', () => {

  // ── 1. Centralized Candidate Commit Service & Deterministic Hash Binding ──
  describe('Centralized Candidate Commit Service (GEN-501 & REL-501)', () => {
    const projectId = 'p5-test-proj-1';
    const initialFiles = {
      'app/page.tsx': 'export default function Page() { return <h1>P5 V1</h1>; }',
    };

    beforeEach(() => {
      seedAuthoritativeProject(projectId, 'user-alice', 'Alice P5 Proj', 'nextjs', initialFiles);
    });

    it('computes deterministic SHA-256 hash regardless of object key insertion order', () => {
      const filesA = { 'b.txt': 'beta', 'a.txt': 'alpha', 'c.txt': 'gamma' };
      const filesB = { 'a.txt': 'alpha', 'c.txt': 'gamma', 'b.txt': 'beta' };
      const hashA = computeCandidateHash(filesA);
      const hashB = computeCandidateHash(filesB);
      assert.strictEqual(hashA, hashB);
      assert.strictEqual(typeof hashA, 'string');
      assert.strictEqual(hashA.length, 64);
    });

    it('atomically commits candidate when expectedRevision, hash, and evidence match', async () => {
      const candidateFiles = {
        'app/page.tsx': 'export default function Page() { return <h1>P5 V2</h1>; }',
      };
      const candidateHash = computeCandidateHash(candidateFiles);

      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash,
        validationEvidence: {
          validationId: 'val-p5-ok',
          projectId,
          candidateHash,
          timestamp: new Date().toISOString(),
          framework: 'nextjs',
          nativeBuild: {
            attempted: true,
            status: 'passed',
            framework: 'nextjs',
            runner: 'microvm_sandbox',
            environment: 'vercel_sandbox',
          },
          checks: [{ name: 'all_passed', status: 'passed' }],
          accepted: true,
          diagnostics: [],
        },
        userId: 'user-alice',
        authMode: 'real',
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.committed, true);
      assert.strictEqual(res.revision, 2);

      const serverProj = getServerProject(projectId)!;
      assert.strictEqual(serverProj.revision, 2);
      assert.strictEqual(serverProj.files['app/page.tsx'], candidateFiles['app/page.tsx']);
    });

    it('rejects commit when candidateHash does not match actual candidate content', async () => {
      const candidateFiles = { 'app/page.tsx': 'export default function Page() { return <h1>Tampered</h1>; }' };

      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash: '0000000000000000000000000000000000000000000000000000000000000000',
        validationEvidence: {
          validationId: 'val-fake',
          projectId,
          candidateHash: '0000000000000000000000000000000000000000000000000000000000000000',
          timestamp: new Date().toISOString(),
          framework: 'nextjs',
          checks: [],
          accepted: true,
          diagnostics: [],
        },
        userId: 'user-alice',
        authMode: 'real',
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.committed, false);
      assert.match(res.error!, /Candidate Integrity Error/);

      // Verify workspace remained untouched
      const serverProj = getServerProject(projectId)!;
      assert.strictEqual(serverProj.revision, 1);
    });

    it('rejects commit when validation evidence indicates rejected status', async () => {
      const candidateFiles = { 'app/page.tsx': 'export default function Page() { return <h1>Broken</h1>; }' };
      const candidateHash = computeCandidateHash(candidateFiles);

      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1,
        candidateFiles,
        candidateHash,
        validationEvidence: {
          validationId: 'val-rejected',
          projectId,
          candidateHash,
          timestamp: new Date().toISOString(),
          framework: 'nextjs',
          checks: [{ name: 'secret_leak_scan', status: 'failed' }],
          accepted: false,
          diagnostics: ['Secret leak detected'],
        },
        userId: 'user-alice',
        authMode: 'real',
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.committed, false);
      assert.match(res.error!, /Commit Gate Rejected/);
    });

    it('strictly rejects stale commit with conflict when expectedRevision does not match', async () => {
      const candidateFiles = { 'app/page.tsx': 'export default function Page() { return <h1>Stale</h1>; }' };
      const candidateHash = computeCandidateHash(candidateFiles);

      // Advance revision to 2 first
      updateServerProjectWithCas(projectId, 1, { files: { 'app/page.tsx': '<h1>Client A</h1>' } });

      const res = await commitVerifiedCandidate({
        projectId,
        expectedRevision: 1, // Stale!
        candidateFiles,
        candidateHash,
        validationEvidence: {
          validationId: 'val-stale',
          projectId,
          candidateHash,
          timestamp: new Date().toISOString(),
          framework: 'nextjs',
          nativeBuild: {
            attempted: true,
            status: 'passed',
            framework: 'nextjs',
            runner: 'microvm_sandbox',
            environment: 'vercel_sandbox',
          },
          checks: [],
          accepted: true,
          diagnostics: [],
        },
        userId: 'user-alice',
        authMode: 'real',
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.conflict, true);
      assert.strictEqual(res.currentRevision, 2);
      assert.strictEqual(res.expectedRevision, 1);
    });
  });

  // ── 2. Fail-Closed Rate Limiting ──
  describe('Fail-Closed Distributed Rate Limiting (SEC-501)', () => {
    it('fails closed when distributed backend is unavailable in failClosed mode', async () => {
      // Temporarily override Supabase URL to invalid host
      const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      try {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://invalid-unreachable-db:9999';
        const res = await checkRateLimitDistributed('fail-closed-test-key', 10, 3600_000, { failClosed: true });
        assert.strictEqual(res.allowed, false);
        assert.strictEqual(res.remaining, 0);
        assert.strictEqual(res.error, 'Distributed rate limiting unavailable');
      } finally {
        process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      }
    });
  });

  // ── 3. Monaco Concurrency Protection ──
  describe('Monaco AI Concurrency Protection (CONC-501)', () => {
    it('verifies code-editor.tsx captures baselineRevision and rejects stale inline edits', () => {
      const editorSource = fs.readFileSync(
        path.join(process.cwd(), 'components/builder/code-editor.tsx'),
        'utf-8'
      );
      assert.ok(
        editorSource.includes('const baselineRevision = useProjectStore.getState().revision || 1;'),
        'code-editor.tsx must capture baselineRevision before Ask AI stream begins'
      );
      assert.ok(
        editorSource.includes('currentRevision !== baselineRevision'),
        'code-editor.tsx must verify revision freshness before updateFile'
      );
    });
  });

  // ── 4. Elimination of merge-duplicates in supabase-auth.ts ──
  describe('Elimination of Last-Write-Wins (CONC-502)', () => {
    it('verifies saveProject in supabase-auth.ts does not fall back to resolution=merge-duplicates', () => {
      const authSource = fs.readFileSync(
        path.join(process.cwd(), 'lib/auth/supabase-auth.ts'),
        'utf-8'
      );
      assert.ok(
        !authSource.includes('Prefer\': \'resolution=merge-duplicates\''),
        'supabase-auth.ts must NOT use resolution=merge-duplicates fallback'
      );
    });
  });

  // ── 5. Sandbox Symlink Pattern Containment ──
  describe('Sandbox Symlink & Path Containment (SEC-502)', () => {
    it('rejects symlink traversal patterns targeting outside sandbox workspace', () => {
      assert.throws(
        () => assertContainedSandboxPath('symlink->/etc/passwd'),
        /Security Violation/
      );
      assert.throws(
        () => assertContainedSandboxPath('sub/dir/symlink/../etc/shadow'),
        /Security Violation/
      );
      assert.throws(
        () => assertContainedSandboxPath('symlink/root/.ssh'),
        /Security Violation/
      );
    });
  });

  // ── 6. Candidate Commit HTTP Endpoint ──
  describe('POST /api/validate/candidate Route Gate', () => {
    it('returns HTTP 400 when required commit parameters are missing', async () => {
      const req = new NextRequest('http://localhost/api/validate/candidate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token-user-1',
        },
        body: JSON.stringify({ projectId: 'test' }),
      });

      const res = await candidateCommitPOST(req);
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /expectedRevision/);
    });
  });
});
