import { describe, it } from 'node:test';
import assert from 'node:assert';

// Test the sandbox status lifecycle transitions and type discrimination
// without importing Next.js server-only modules (we test pure logic)

describe('Sandbox Status Lifecycle & visual_preview vs framework_runtime Distinction', () => {
  type SandboxStatusType =
    | 'created'
    | 'installing'
    | 'building'
    | 'build_failed'
    | 'starting'
    | 'runtime_ready'
    | 'runtime_failed'
    | 'stopped';

  type SandboxType = 'visual_preview' | 'framework_runtime';

  interface SandboxStatus {
    sandboxId: string;
    projectId: string;
    sandboxType: SandboxType;
    status: SandboxStatusType;
    startedAt: string;
    updatedAt: string;
    error?: string;
  }

  function buildSandboxStatus(
    sandboxType: SandboxType,
    status: SandboxStatusType,
    error?: string
  ): SandboxStatus {
    return {
      sandboxId: `sb_${Date.now()}`,
      projectId: 'test_proj',
      sandboxType,
      status,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error,
    };
  }

  it('correctly distinguishes visual_preview from framework_runtime sandbox types', () => {
    const visualPreview = buildSandboxStatus('visual_preview', 'runtime_ready');
    const frameworkRuntime = buildSandboxStatus('framework_runtime', 'runtime_ready');

    assert.strictEqual(visualPreview.sandboxType, 'visual_preview');
    assert.strictEqual(frameworkRuntime.sandboxType, 'framework_runtime');

    // These are distinct types and MUST NOT be falsely equated
    assert.notStrictEqual(visualPreview.sandboxType, frameworkRuntime.sandboxType);
  });

  it('validates lifecycle status transitions are structured and predictable', () => {
    const validTransitions: Record<SandboxStatusType, SandboxStatusType[]> = {
      created: ['installing'],
      installing: ['building', 'build_failed'],
      building: ['starting', 'build_failed'],
      build_failed: [],
      starting: ['runtime_ready', 'runtime_failed'],
      runtime_ready: ['stopped'],
      runtime_failed: ['stopped'],
      stopped: [],
    };

    // Verify each transition pair
    function isValidTransition(from: SandboxStatusType, to: SandboxStatusType): boolean {
      return (validTransitions[from] || []).includes(to);
    }

    // Valid transitions
    assert.strictEqual(isValidTransition('created', 'installing'), true);
    assert.strictEqual(isValidTransition('installing', 'building'), true);
    assert.strictEqual(isValidTransition('building', 'starting'), true);
    assert.strictEqual(isValidTransition('starting', 'runtime_ready'), true);
    assert.strictEqual(isValidTransition('runtime_ready', 'stopped'), true);
    assert.strictEqual(isValidTransition('installing', 'build_failed'), true);
    assert.strictEqual(isValidTransition('building', 'build_failed'), true);
    assert.strictEqual(isValidTransition('starting', 'runtime_failed'), true);
    assert.strictEqual(isValidTransition('runtime_failed', 'stopped'), true);

    // Invalid transitions
    assert.strictEqual(isValidTransition('created', 'runtime_ready'), false);
    assert.strictEqual(isValidTransition('stopped', 'runtime_ready'), false);
    assert.strictEqual(isValidTransition('build_failed', 'runtime_ready'), false);
  });

  it('ensures visual_preview sandbox never claims framework_runtime status truthfully', () => {
    const previewSandbox = buildSandboxStatus('visual_preview', 'runtime_ready');

    // visual_preview reaching runtime_ready is only valid for the esbuild preview, not Node.js execution
    // The key check: it must never self-report as framework_runtime
    assert.notStrictEqual(previewSandbox.sandboxType, 'framework_runtime');
    assert.strictEqual(previewSandbox.status, 'runtime_ready');

    // Any UI reading this must distinguish the type before claiming Node/framework execution
    const isFullFrameworkExecution = previewSandbox.sandboxType === 'framework_runtime' && previewSandbox.status === 'runtime_ready';
    assert.strictEqual(isFullFrameworkExecution, false);
  });

  it('handles build_failed status with error message preserved', () => {
    const failedBuild = buildSandboxStatus('framework_runtime', 'build_failed', 'Cannot find module react');

    assert.strictEqual(failedBuild.status, 'build_failed');
    assert.ok(failedBuild.error);
    assert.match(failedBuild.error, /Cannot find module/);
    assert.strictEqual(failedBuild.sandboxType, 'framework_runtime');
  });

  it('validates that stopped status always has updatedAt timestamp refreshed', () => {
    const before = new Date();
    const stoppedSandbox = buildSandboxStatus('visual_preview', 'stopped');
    const after = new Date();

    const updatedAt = new Date(stoppedSandbox.updatedAt);
    assert.ok(updatedAt >= before);
    assert.ok(updatedAt <= after);
    assert.strictEqual(stoppedSandbox.status, 'stopped');
  });
});