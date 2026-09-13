import { NextRequest } from 'next/server';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  authMode: 'real' | 'demo';
}

export interface AuthContext {
  user: AuthenticatedUser;
  error?: never;
}

export interface AuthFailure {
  user?: never;
  error: string;
  status: number;
}

export type AuthResult = AuthContext | AuthFailure;

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Validates a Supabase access token against Supabase Auth API
 */
export async function verifySupabaseToken(token: string): Promise<AuthenticatedUser | null> {
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return null;
    }

    const userData = await res.json();
    if (!userData || !userData.id) {
      return null;
    }

    return {
      id: userData.id,
      email: userData.email || '',
      name: userData.user_metadata?.full_name || userData.user_metadata?.name || userData.email,
      authMode: 'real',
    };
  } catch (err) {
    console.error('[ServerAuth] Failed to verify Supabase token:', err);
    return null;
  }
}

/**
 * Server-side authentication helper.
 * Derives user identity strictly from the cryptographically verified Supabase session token.
 * Rejects missing sessions, invalid sessions, and demo users for protected operations.
 */
export async function authenticateRequest(
  req: NextRequest | Request,
  options: { allowDemo?: boolean } = {}
): Promise<AuthResult> {
  const getHeader = (name: string): string | null => {
    if (!req.headers) return null;
    if (typeof req.headers.get === 'function') {
      return req.headers.get(name);
    }
    return (req.headers as any)[name.toLowerCase()] || (req.headers as any)[name] || null;
  };

  // 1. Extract Bearer token from Authorization header or cookie
  const authHeader = getHeader('Authorization') || getHeader('authorization');
  let token: string | null = null;

  if (authHeader) {
    if (authHeader.startsWith('Bearer ') || authHeader === 'Bearer') {
      token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token) {
        return {
          error: 'Authentication failed. Token required in Bearer authorization header.',
          status: 401,
        };
      }
    } else {
      return {
        error: 'Authentication failed. Invalid Authorization scheme; expected "Bearer <token>".',
        status: 401,
      };
    }
  } else {
    // Check cookies for Supabase auth token
    const cookies = (req as any).cookies;
    if (cookies && typeof cookies.get === 'function') {
      const cookieToken = cookies.get('sb-access-token')?.value || cookies.get('supabase-auth-token')?.value;
      if (cookieToken) {
        token = cookieToken;
      }
    }
  }

  // Check for explicit demo mode header
  const isDemoHeader = getHeader('X-Auth-Mode') === 'demo';

  if (isDemoHeader) {
    if (options.allowDemo) {
      // Security Invariant (SEC-301): Demo identity is strictly server-defined.
      // Client-controlled headers (e.g. X-Demo-User-Id) are NEVER trusted to assign identity.
      const demoId = 'demo-user';
      return {
        user: {
          id: demoId,
          email: 'demo@opendork.com',
          name: 'Demo User',
          authMode: 'demo',
        },
      };
    }
    return {
      error: 'Demo identities are not authorized for protected production operations.',
      status: 403,
    };
  }

  if (!token) {
    return {
      error: 'Authentication required. Missing Bearer token or active session.',
      status: 401,
    };
  }

  // Verify real Supabase identity
  const verifiedUser = await verifySupabaseToken(token);
  if (!verifiedUser) {
    return {
      error: 'Invalid or expired session token.',
      status: 401,
    };
  }

  return {
    user: verifiedUser,
  };
}
