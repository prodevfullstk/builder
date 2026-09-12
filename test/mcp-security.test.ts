import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { handleMcpRequest, McpRequestContext } from '../lib/mcp/server';
import {
  registerServerProject,
  getServerProject,
  AuthoritativeProject,
} from '../lib/storage/project-authority';

describe('MCP Protocol Boundary & Security Isolation (P0-D)', () => {
  const aliceUserId = 'user_alice_mcp_123';
  const bobUserId = 'user_bob_mcp_456';

  const aliceProject: AuthoritativeProject = {
    id: 'proj_alice_mcp',
    name: 'Alice MCP Project',
    framework: 'nextjs',
    owner_id: aliceUserId,
    files: {
      'package.json': JSON.stringify({ name: 'alice-mcp-app' }),
      'app/page.tsx': 'export default function Page() { return <h1>Alice</h1>; }',
    },
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    registerServerProject(aliceProject);
  });

  it('allows public handshake and catalog discovery without authentication', async () => {
    const initRes = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });
    assert.strictEqual(initRes.error, undefined);
    assert.strictEqual(initRes.result?.serverInfo?.name, 'opendrok-website-builder-mcp');

    const toolsRes = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    assert.strictEqual(toolsRes.error, undefined);
    assert.ok(Array.isArray(toolsRes.result?.tools));
    assert.ok(toolsRes.result?.tools.length >= 8);
  });

  it('strictly rejects unauthenticated calls to project-scoped tools with 401', async () => {
    const unauthContext: McpRequestContext = {};

    const toolsToTest = [
      { name: 'list_projects', args: {} },
      { name: 'get_project', args: { projectId: 'proj_alice_mcp' } },
      { name: 'create_project', args: { name: 'New Proj' } },
      { name: 'list_files', args: { projectId: 'proj_alice_mcp' } },
      { name: 'get_file', args: { projectId: 'proj_alice_mcp', path: 'package.json' } },
      { name: 'write_file', args: { projectId: 'proj_alice_mcp', path: 'app/new.tsx', content: 'test' } },
      { name: 'edit_file', args: { projectId: 'proj_alice_mcp', path: 'app/page.tsx', targetContent: 'Alice', replacementContent: 'Bob' } },
      { name: 'delete_file', args: { projectId: 'proj_alice_mcp', path: 'package.json', confirm: true } },
      { name: 'audit_code', args: { projectId: 'proj_alice_mcp' } },
    ];

    for (const tool of toolsToTest) {
      const res = await handleMcpRequest(
        {
          jsonrpc: '2.0',
          id: tool.name,
          method: 'tools/call',
          params: { name: tool.name, arguments: tool.args },
        },
        unauthContext
      );

      assert.ok(res.error, `Tool '${tool.name}' should have returned an error for unauthenticated call`);
      assert.strictEqual(res.error?.data?.status, 401, `Tool '${tool.name}' must return HTTP status 401`);
      assert.match(res.error?.message || '', /Unauthorized/i);
    }
  });

  it('rejects cross-tenant project access by Bob targeting Alice with 403 Forbidden', async () => {
    const bobContext: McpRequestContext = {
      userId: bobUserId,
      authMode: 'real',
    };

    const crossTenantTools = [
      { name: 'get_project', args: { projectId: 'proj_alice_mcp' } },
      { name: 'list_files', args: { projectId: 'proj_alice_mcp' } },
      { name: 'get_file', args: { projectId: 'proj_alice_mcp', path: 'package.json' } },
      { name: 'write_file', args: { projectId: 'proj_alice_mcp', path: 'evil.js', content: 'hack' } },
      { name: 'edit_file', args: { projectId: 'proj_alice_mcp', path: 'app/page.tsx', targetContent: 'Alice', replacementContent: 'Hacked' } },
      { name: 'delete_file', args: { projectId: 'proj_alice_mcp', path: 'package.json', confirm: true } },
      { name: 'audit_code', args: { projectId: 'proj_alice_mcp' } },
    ];

    for (const tool of crossTenantTools) {
      const res = await handleMcpRequest(
        {
          jsonrpc: '2.0',
          id: tool.name,
          method: 'tools/call',
          params: { name: tool.name, arguments: tool.args },
        },
        bobContext
      );

      assert.ok(res.error, `Tool '${tool.name}' must reject unauthorized cross-tenant caller`);
      assert.strictEqual(res.error?.data?.status, 403, `Tool '${tool.name}' must return status 403 Forbidden`);
      assert.match(res.error?.message || '', /Forbidden.*permission/i);
    }
  });

  it('allows Alice to access her own project and list her own projects exclusively', async () => {
    const aliceContext: McpRequestContext = {
      userId: aliceUserId,
      authMode: 'real',
    };

    const listRes = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 'list-alice',
        method: 'tools/call',
        params: { name: 'list_projects', arguments: {} },
      },
      aliceContext
    );

    assert.strictEqual(listRes.error, undefined);
    const textContent = JSON.parse(listRes.result?.content?.[0]?.text || '{}');
    assert.ok(Array.isArray(textContent.projects));
    assert.strictEqual(textContent.projects.length, 1);
    assert.strictEqual(textContent.projects[0].id, 'proj_alice_mcp');

    const getRes = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 'get-alice',
        method: 'tools/call',
        params: { name: 'get_project', arguments: { projectId: 'proj_alice_mcp' } },
      },
      aliceContext
    );
    assert.strictEqual(getRes.error, undefined);
  });

  it('strictly returns staged candidate diffs ONLY on mutating tools without modifying storage', async () => {
    const aliceContext: McpRequestContext = {
      userId: aliceUserId,
      authMode: 'real',
    };

    const initialProjectState = getServerProject('proj_alice_mcp');
    const originalPage = initialProjectState?.files['app/page.tsx'];

    // Call write_file
    const writeRes = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 'write-staged',
        method: 'tools/call',
        params: {
          name: 'write_file',
          arguments: {
            projectId: 'proj_alice_mcp',
            path: 'app/test.tsx',
            content: 'export default function Test() {}',
          },
        },
      },
      aliceContext
    );

    assert.strictEqual(writeRes.error, undefined);
    const writeData = JSON.parse(writeRes.result?.content?.[0]?.text || '{}');
    assert.strictEqual(writeData.staged, true);
    assert.ok(writeData.candidateDiff);
    assert.strictEqual(writeData.candidateDiff['app/test.tsx'], 'export default function Test() {}');

    // Verify storage was NOT directly mutated
    const postWriteProject = getServerProject('proj_alice_mcp');
    assert.strictEqual(postWriteProject?.files['app/test.tsx'], undefined, 'Storage must not be directly mutated by MCP write_file');

    // Call edit_file
    const editRes = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 'edit-staged',
        method: 'tools/call',
        params: {
          name: 'edit_file',
          arguments: {
            projectId: 'proj_alice_mcp',
            path: 'app/page.tsx',
            targetContent: 'Alice',
            replacementContent: 'Super Alice',
          },
        },
      },
      aliceContext
    );

    assert.strictEqual(editRes.error, undefined);
    const editData = JSON.parse(editRes.result?.content?.[0]?.text || '{}');
    assert.strictEqual(editData.staged, true);
    assert.ok(editData.candidateDiff);
    assert.match(editData.candidateDiff['app/page.tsx'], /Super Alice/);

    // Verify storage was NOT mutated
    const postEditProject = getServerProject('proj_alice_mcp');
    assert.strictEqual(postEditProject?.files['app/page.tsx'], originalPage, 'Storage must not be directly mutated by MCP edit_file');

    // Call delete_file
    const deleteRes = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 'delete-staged',
        method: 'tools/call',
        params: {
          name: 'delete_file',
          arguments: {
            projectId: 'proj_alice_mcp',
            path: 'package.json',
            confirm: true,
          },
        },
      },
      aliceContext
    );

    assert.strictEqual(deleteRes.error, undefined);
    const deleteData = JSON.parse(deleteRes.result?.content?.[0]?.text || '{}');
    assert.strictEqual(deleteData.staged, true);
    assert.strictEqual(deleteData.candidateDiff['package.json'], null);

    // Verify storage still contains package.json
    const postDeleteProject = getServerProject('proj_alice_mcp');
    assert.ok(postDeleteProject?.files['package.json'], 'Storage must not delete files directly from MCP call');
  });
});
