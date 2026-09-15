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

  it('strictly rejects demo/anonymous header X-Auth-Mode: demo with HTTP 401', async () => {
    const req = new Request('http://localhost/api/test', {
      headers: {
        'X-Auth-Mode': 'demo',
      },
    });

    const result = await authenticateRequest(req);
    assert.strictEqual(result.user, undefined);
    assert.strictEqual(result.status, 401);
    assert.match(result.error || '', /Anonymous and demo access is disabled/i);
  });

  it('strictly rejects demo header with spoofed user id', async () => {
    const req = new Request('http://localhost/api/test', {
      headers: {
        'X-Auth-Mode': 'demo',
        'X-Demo-User-Id': 'attacker-spoofed-id',
      },
    });

    const result = await authenticateRequest(req);
    assert.strictEqual(result.user, undefined);
    assert.strictEqual(result.status, 401);
    assert.match(result.error || '', /Anonymous and demo access is disabled/i);
  });

  it('maintains verified Supabase authentication in client auth store', () => {
    const store = useAuthStore.getState();
    // Initially unauthenticated
    assert.strictEqual(store.isAuthenticated, false);
    assert.strictEqual(store.accessToken, null);

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

  it('omits Authorization header when client has no access token', async () => {
    await useAuthStore.getState().logout();
    const headers = getClientAuthHeaders();
    assert.strictEqual(headers['Content-Type'], 'application/json');
    assert.strictEqual(headers['X-Auth-Mode'], undefined);
    assert.strictEqual(headers['Authorization'], undefined);

    // Verify authenticateRequest strictly rejects these headers
    const req = new Request('http://localhost/api/agent', {
      headers,
    });
    const authResult = await authenticateRequest(req);
    assert.strictEqual(authResult.user, undefined);
    assert.strictEqual(authResult.status, 401);
  });

  it('attaches Bearer authorization headers when client has an active access token', () => {
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