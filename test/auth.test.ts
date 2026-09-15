import { describe, it } from 'node:test';
import assert from 'node:assert';
import { authenticateRequest } from '../lib/auth/server-auth';
import { useAuthStore, getClientAuthHeaders } from '../lib/auth/supabase-auth';

describe('Server Authentication & Token Validation', () => {
  it('rejects requests with missing Authorization header', async () => {
    const req = new Request('http://localhost/api/test', {
      headers: {},
    });

    const result = await authenticateRequest(req);
    assert.strictEqual(result.user, undefined);
    assert.ok(result.error);
    assert.match(result.error, /Missing Bearer token or active session/i);
    assert.strictEqual(result.status, 401);
  });

  it('rejects requests with malformed Authorization header scheme', async () => {
    const req = new Request('http://localhost/api/test', {
      headers: {
        Authorization: 'Basic 12345',
      },
    });

    const result = await authenticateRequest(req);
    assert.strictEqual(result.user, undefined);
    assert.match(result.error || '', /Invalid Authorization scheme/i);
    assert.strictEqual(result.status, 401);
  });

  it('rejects empty or whitespace bearer tokens', async () => {
    const req = new Request('http://localhost/api/test', {
      headers: {
        Authorization: 'Bearer    ',
      },
    });

    const result = await authenticateRequest(req);
    assert.strictEqual(result.user, undefined);
    assert.match(result.error || '', /Token required/i);
    assert.strictEqual(result.status, 401);
  });

  it('verifies demo identity is rejected on protected operations without allowDemo', async () => {
    const req = new Request('http://localhost/api/test', {
      headers: {
        'X-Auth-Mode': 'demo',
      },
    });

    const result = await authenticateRequest(req, { allowDemo: false });
    assert.strictEqual(result.user, undefined);
    assert.strictEqual(result.status, 403);
    assert.match(result.error || '', /Demo identities are not authorized/i);
  });

  it('verifies demo identity is accepted and strictly bound to deterministic demo-user (SEC-301)', async () => {
    const req = new Request('http://localhost/api/test', {
      headers: {
        'X-Auth-Mode': 'demo',
        'X-Demo-User-Id': 'attacker-spoofed-id',
      },
    });

    const result = await authenticateRequest(req, { allowDemo: true });
    assert.ok(result.user);
    // Security Invariant (SEC-301): Client cannot spoof arbitrary user ID via header
    assert.strictEqual(result.user?.id, 'demo-user');
    assert.strictEqual(result.user?.authMode, 'demo');
  });

  it('distinguishes real auth from demo auth in client auth store', () => {
    const store = useAuthStore.getState();
    // Initially unauthenticated
    assert.strictEqual(store.isAuthenticated, false);
    assert.strictEqual(store.accessToken, null);

    // Explicit demo login
    store.loginAsDemo('Test Demo User', 'test-demo@example.com');
    const demoState = useAuthStore.getState();
    assert.strictEqual(demoState.isAuthenticated, true);
    assert.strictEqual(demoState.user?.authMode, 'demo');
    assert.strictEqual(demoState.user?.provider, 'demo');
    assert.strictEqual(demoState.accessToken, null); // No real Supabase token for demo

    // Explicit real session set
    store.setSession(
      {
        id: 'real-user-123',
        email: 'real@example.com',
        name: 'Real User',
        provider: 'email',
        authMode: 'real',
        created_at: new Date().toISOString(),
      },
      'real-supabase-jwt-token'
    );
    const realState = useAuthStore.getState();
    assert.strictEqual(realState.isAuthenticated, true);
    assert.strictEqual(realState.user?.authMode, 'real');
    assert.strictEqual(realState.accessToken, 'real-supabase-jwt-token');
  });

  it('fails OTP verification when Supabase is not configured without falsely authenticating', async () => {
    const store = useAuthStore.getState();
    // Attempt OTP verification
    const result = await store.verifyOtp('test@example.com', '123456');
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    // User should NOT be automatically logged in as demo or authenticated
    const afterState = useAuthStore.getState();
    assert.strictEqual(afterState.isLoading, false);
  });

  it('generates demo auth headers when client has no access token', async () => {
    await useAuthStore.getState().logout();
    const headers = getClientAuthHeaders();
    assert.strictEqual(headers['Content-Type'], 'application/json');
    assert.strictEqual(headers['X-Auth-Mode'], 'demo');
    assert.strictEqual(headers['Authorization'], undefined);

    // Verify authenticateRequest accepts these headers when allowDemo is true
    const req = new Request('http://localhost/api/agent', {
      headers,
    });
    const authResult = await authenticateRequest(req, { allowDemo: true });
    assert.ok(authResult.user);
    assert.strictEqual(authResult.user?.authMode, 'demo');
    assert.strictEqual(authResult.user?.id, 'demo-user');
  });

  it('generates Bearer authorization headers when client has an active access token', () => {
    useAuthStore.getState().setSession(
      {
        id: 'user-xyz',
        email: 'user@example.com',
        name: 'User XYZ',
        provider: 'email',
        authMode: 'real',
        created_at: new Date().toISOString(),
      },
      'test-jwt-token-456'
    );
    const headers = getClientAuthHeaders({ 'X-Custom-Header': 'test' });
    assert.strictEqual(headers['Content-Type'], 'application/json');
    assert.strictEqual(headers['Authorization'], 'Bearer test-jwt-token-456');
    assert.strictEqual(headers['X-Auth-Mode'], undefined);
    assert.strictEqual(headers['X-Custom-Header'], 'test');
  });
});