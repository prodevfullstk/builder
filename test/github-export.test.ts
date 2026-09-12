import { describe, it } from 'node:test';
import assert from 'node:assert';
import { pushProjectToGitHub } from '../lib/export/github-export';

describe('GitHub PAT Security & Non-Force Push Safeguards', () => {
  it('rejects pushing without a valid GitHub token', async () => {
    const result = await pushProjectToGitHub('', 'owner', 'repo', { 'index.html': 'hello' });
    assert.strictEqual(result.success, false);
    assert.match(result.error || '', /Could not access repository metadata|Unexpected error/i);
  });

  it('rejects push if remote branch head has moved (conflict prevention)', async () => {
    // Mock global fetch to simulate remote branch ref advancing during push
    const originalFetch = global.fetch;
    try {
      let callCount = 0;
      global.fetch = async (url: any, init: any) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/repos/test-owner/test-repo')) {
          return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
        }
        if (urlStr.includes('/git/ref/heads/main')) {
          callCount++;
          // First check returns base sha 'sha_111'
          if (callCount === 1) {
            return new Response(JSON.stringify({ object: { sha: 'sha_111' } }), { status: 200 });
          }
          // Second check (pre-update check) detects remote changed to 'sha_222'
          return new Response(JSON.stringify({ object: { sha: 'sha_222' } }), { status: 200 });
        }
        if (urlStr.includes('/git/commits/sha_111')) {
          return new Response(JSON.stringify({ tree: { sha: 'tree_base_sha' } }), { status: 200 });
        }
        if (urlStr.includes('/git/trees')) {
          return new Response(JSON.stringify({ sha: 'new_tree_sha' }), { status: 201 });
        }
        if (urlStr.includes('/git/commits')) {
          return new Response(JSON.stringify({ sha: 'new_commit_sha' }), { status: 201 });
        }
        return new Response(JSON.stringify({ message: 'Unhandled mock URL' }), { status: 400 });
      };

      const pushResult = await pushProjectToGitHub(
        'ghp_mocktoken123456789012345678901234567890',
        'test-owner',
        'test-repo',
        { 'README.md': '# Hello' }
      );

      assert.strictEqual(pushResult.success, false);
      assert.match(pushResult.error || '', /Push rejected: remote branch "main" has changed/i);
      assert.match(pushResult.error || '', /non-fast-forward overwrites are prohibited/i);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('performs safe non-force push when remote ref is unchanged', async () => {
    const originalFetch = global.fetch;
    try {
      let patchBodyReceived: any = null;
      global.fetch = async (url: any, init: any) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/repos/test-owner/test-repo')) {
          return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
        }
        if (urlStr.includes('/git/refs/heads/main') && init?.method === 'PATCH') {
          patchBodyReceived = JSON.parse(init.body);
          return new Response(JSON.stringify({ object: { sha: 'new_commit_sha' } }), { status: 200 });
        }
        if (urlStr.includes('/git/ref/heads/main')) {
          return new Response(JSON.stringify({ object: { sha: 'sha_consistent' } }), { status: 200 });
        }
        if (urlStr.includes('/git/commits/sha_consistent')) {
          return new Response(JSON.stringify({ tree: { sha: 'tree_base_sha' } }), { status: 200 });
        }
        if (urlStr.includes('/git/trees')) {
          return new Response(JSON.stringify({ sha: 'new_tree_sha' }), { status: 201 });
        }
        if (urlStr.includes('/git/commits')) {
          return new Response(JSON.stringify({ sha: 'new_commit_sha' }), { status: 201 });
        }
        return new Response(JSON.stringify({ message: 'Unhandled mock URL: ' + urlStr }), { status: 400 });
      };

      const pushResult = await pushProjectToGitHub(
        'ghp_mocktoken123456789012345678901234567890',
        'test-owner',
        'test-repo',
        { 'README.md': '# Safe Push' }
      );

      assert.strictEqual(pushResult.success, true);
      assert.ok(patchBodyReceived);
      // Verify force: false is explicitly sent to GitHub API
      assert.strictEqual(patchBodyReceived.force, false);
      assert.strictEqual(patchBodyReceived.sha, 'new_commit_sha');
    } finally {
      global.fetch = originalFetch;
    }
  });
});