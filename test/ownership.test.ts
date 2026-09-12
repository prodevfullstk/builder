import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  registerServerProject,
  getServerProject,
  verifyProjectOwnership,
  listServerProjectsForOwner,
} from '../lib/storage/project-authority';

describe('Project Authority & Strict Ownership Model', () => {
  const alice = {
    id: 'user_alice_123',
    email: 'alice@example.com',
    name: 'Alice',
  };

  const bob = {
    id: 'user_bob_456',
    email: 'bob@example.com',
    name: 'Bob',
  };

  const projectA: any = {
    id: 'proj_alice_alpha',
    name: 'Alice Alpha Project',
    framework: 'nextjs',
    owner_id: alice.id,
    files: { 'package.json': '{}' },
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    registerServerProject(projectA);
  });

  it('allows owner to verify and access their own project', async () => {
    const result = await verifyProjectOwnership('proj_alice_alpha', alice.id);
    assert.strictEqual(result.authorized, true);
    assert.ok(result.project);
    assert.strictEqual(result.project?.id, 'proj_alice_alpha');
    assert.strictEqual(result.project?.owner_id, alice.id);
  });

  it('strictly rejects non-owner with 403 Forbidden', async () => {
    const result = await verifyProjectOwnership('proj_alice_alpha', bob.id);
    assert.strictEqual(result.authorized, false);
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.project, undefined);
    assert.match(result.error || '', /Forbidden.*permission/i);
  });

  it('rejects missing or empty projectId with 400 Bad Request', async () => {
    const resultEmpty = await verifyProjectOwnership('', alice.id);
    assert.strictEqual(resultEmpty.authorized, false);
    assert.strictEqual(resultEmpty.status, 400);
    assert.match(resultEmpty.error || '', /projectId is required/i);

    const resultNull = await verifyProjectOwnership(null, alice.id);
    assert.strictEqual(resultNull.authorized, false);
    assert.strictEqual(resultNull.status, 400);

    const resultWhitespace = await verifyProjectOwnership('   ', alice.id);
    assert.strictEqual(resultWhitespace.authorized, false);
    assert.strictEqual(resultWhitespace.status, 400);
  });

  it('rejects requests for non-existent projects with 404 Not Found', async () => {
    const result = await verifyProjectOwnership('proj_does_not_exist', alice.id);
    assert.strictEqual(result.authorized, false);
    assert.strictEqual(result.status, 404);
    assert.match(result.error || '', /Project not found/i);
  });

  it('lists only projects belonging to the specified owner without leaking other projects', () => {
    registerServerProject({
      id: 'proj_bob_beta',
      name: 'Bob Beta Project',
      framework: 'vite',
      owner_id: bob.id,
      files: { 'package.json': '{}' },
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const aliceProjects = listServerProjectsForOwner(alice.id);
    assert.strictEqual(aliceProjects.length, 1);
    assert.strictEqual(aliceProjects[0].id, 'proj_alice_alpha');

    const bobProjects = listServerProjectsForOwner(bob.id);
    assert.strictEqual(bobProjects.length, 1);
    assert.strictEqual(bobProjects[0].id, 'proj_bob_beta');
  });
});