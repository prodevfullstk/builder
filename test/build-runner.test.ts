import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LocalBuildRunner, VercelSandboxRunner } from '../lib/build/build-runner';

describe('Build Runner Abstraction & Verification (P1-B)', () => {
  it('prepares workspace and writes nested files to isolated temp directory', async () => {
    const runner = new LocalBuildRunner();
    const files = {
      'package.json': JSON.stringify({ name: 'runner-test-app' }),
      'app/page.tsx': 'export default function Page() { return <h1>Page</h1>; }',
      'components/Navbar.tsx': 'export function Navbar() { return <nav/>; }',
    };

    try {
      await runner.prepare(files);
      const tempDir = runner.getTempDir();
      assert.ok(tempDir, 'Temp directory must be assigned');

      const pkgStat = await fs.stat(path.join(tempDir, 'package.json'));
      assert.ok(pkgStat.isFile());

      const pageStat = await fs.stat(path.join(tempDir, 'app', 'page.tsx'));
      assert.ok(pageStat.isFile());

      const navStat = await fs.stat(path.join(tempDir, 'components', 'Navbar.tsx'));
      assert.ok(navStat.isFile());

      const pageContent = await fs.readFile(path.join(tempDir, 'app', 'page.tsx'), 'utf-8');
      assert.strictEqual(pageContent, files['app/page.tsx']);
    } finally {
      await runner.cleanup();
      const tempDir = runner.getTempDir();
      assert.strictEqual(tempDir, null);
    }
  });

  it('VercelSandboxRunner truthfully reports Verification Unavailable when credentials are missing', async () => {
    // Ensure credentials are unset for test
    const origToken = process.env.VERCEL_TOKEN;
    const origProject = process.env.VERCEL_PROJECT_ID;
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_PROJECT_ID;

    try {
      const runner = new VercelSandboxRunner();
      const installRes = await runner.install();
      assert.strictEqual(installRes.success, false);
      assert.strictEqual(installRes.exitCode, 1);
      assert.strictEqual(installRes.error, 'Credentials Missing');
      assert.match(installRes.stderr, /Verification Unavailable.*VERCEL_TOKEN/i);

      const buildRes = await runner.build();
      assert.strictEqual(buildRes.success, false);
      assert.strictEqual(buildRes.exitCode, 1);
      assert.strictEqual(buildRes.error, 'Credentials Missing');
      assert.match(buildRes.stderr, /Verification Unavailable.*VERCEL_TOKEN/i);

      await assert.rejects(async () => {
        await runner.start();
      }, /Verification Unavailable/i);
    } finally {
      if (origToken) process.env.VERCEL_TOKEN = origToken;
      if (origProject) process.env.VERCEL_PROJECT_ID = origProject;
    }
  });
});
