import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  provider: 'google' | 'github' | 'email';
  authMode: 'real';
  created_at: string;
}

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAuthModalOpen: boolean;
  otpSent: boolean;
  authError: string | null;

  // Actions
  setAuthModalOpen: (open: boolean) => void;
  clearAuthError: () => void;
  setOtpSent: (sent: boolean) => void;
  loginWithOAuth: (provider: 'google' | 'github') => Promise<void>;
  loginWithEmail: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyOtp: (email: string, token: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  handleAuthExpired: (reason?: string) => void;
  refreshSession: () => Promise<boolean>;
  setSession: (
    user: AuthUser,
    accessToken: string,
    refreshToken?: string | null,
    expiresAt?: number | null
  ) => void;
}

const DEFAULT_SUPABASE_URL = 'https://gmstovafjvsmsscfynqh.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdtc3RvdmFmanZzbXNzY2Z5bnFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMDcwMzcsImV4cCI6MjEwNDc4MzAzN30.rPvAJ-4stmHY9s4pQxuNKvHIROXXbc1yg6yVR6hsxVI';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

export const isRealSupabaseConfigured = Boolean(
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes('your-project')
);

// Zero-dependency native Supabase REST helper
export const supabaseAuthHelper = {
  getOAuthUrl: (provider: 'google' | 'github', redirectTo?: string) => {
    const redirect = redirectTo || (typeof window !== 'undefined' ? `${window.location.origin}/builder` : '');
    return `${SUPABASE_URL}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirect)}`;
  },
  sendOtp: async (email: string) => {
    return fetch(`${SUPABASE_URL}/auth/v1/otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email }),
    });
  },
  verifyOtp: async (email: string, token: string) => {
    return fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        type: 'magiclink',
        email,
        token,
      }),
    });
  },
  refreshSession: async (refreshToken: string) => {
    return fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  },
  saveProject: async (
    accessToken: string,
    userId: string,
    project: any,
    expectedRevision?: number
  ) => {
    // CONC-401: Authoritative Database Compare-And-Swap (CAS)
    const expectedRev = expectedRevision ?? project.revision ?? 1;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/commit_project_revision_cas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        p_project_id: project.id,
        p_expected_revision: expectedRev,
        p_name: project.name,
        p_framework: project.framework,
        p_files: project.files,
        p_messages: project.messages || [],
      }),
    });

    // CONC-401 / CONC-502: Authoritative Database Compare-And-Swap (CAS)
    // CAS failures or conflicts must NEVER fall back to last-write-wins (resolution=merge-duplicates)
    return response;
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      isAuthenticated: false,
      isLoading: false,
      isAuthModalOpen: false,
      otpSent: false,
      authError: null,

      setAuthModalOpen: (open: boolean) => set({ isAuthModalOpen: open, authError: null, otpSent: false }),
      clearAuthError: () => set({ authError: null }),
      setOtpSent: (sent: boolean) => set({ otpSent: sent }),

      loginWithOAuth: async (provider: 'google' | 'github') => {
        set({ isLoading: true, authError: null });

        if (isRealSupabaseConfigured && typeof window !== 'undefined') {
          // Redirect to real Supabase OAuth provider
          window.location.href = supabaseAuthHelper.getOAuthUrl(provider);
        } else {
          set({
            isLoading: false,
            authError: 'Supabase authentication is not configured in this environment. Please check your Supabase environment variables.',
          });
        }
      },

      loginWithEmail: async (email: string) => {
        set({ isLoading: true, authError: null });

        if (!isRealSupabaseConfigured) {
          const errorMsg = 'Supabase authentication is not configured. Please configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.';
          set({ isLoading: false, authError: errorMsg });
          return { success: false, error: errorMsg };
        }

        try {
          const res = await supabaseAuthHelper.sendOtp(email);
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const errMsg = data.msg || data.error_description || data.message || `Failed to send OTP (${res.status})`;
            set({ isLoading: false, authError: errMsg });
            return { success: false, error: errMsg };
          }

          // In production: OTP request succeeded, but user is NOT authenticated yet!
          set({ isLoading: false, otpSent: true, authError: null });
          return { success: true };
        } catch (err: any) {
          const errMsg = err?.message || 'Network error while requesting magic link.';
          set({ isLoading: false, authError: errMsg });
          return { success: false, error: errMsg };
        }
      },

      verifyOtp: async (email: string, token: string) => {
        set({ isLoading: true, authError: null });

        if (!isRealSupabaseConfigured) {
          const errMsg = 'Supabase is not configured.';
          set({ isLoading: false, authError: errMsg });
          return { success: false, error: errMsg };
        }

        try {
          const res = await supabaseAuthHelper.verifyOtp(email, token);
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const errMsg = data.msg || data.error_description || 'Invalid or expired OTP code.';
            set({ isLoading: false, authError: errMsg });
            return { success: false, error: errMsg };
          }

          const data = await res.json();
          const sessionUser = data.user;
          const accessToken = data.access_token;
          const refreshToken = data.refresh_token || null;
          const expiresIn = data.expires_in || 3600;
          const expiresAt = Date.now() + expiresIn * 1000;

          const authUser: AuthUser = {
            id: sessionUser.id,
            email: sessionUser.email,
            name: sessionUser.user_metadata?.full_name || email.split('@')[0],
            avatar_url: sessionUser.user_metadata?.avatar_url,
            provider: 'email',
            authMode: 'real',
            created_at: sessionUser.created_at || new Date().toISOString(),
          };

          set({
            user: authUser,
            accessToken,
            refreshToken,
            expiresAt,
            isAuthenticated: true,
            isAuthModalOpen: false,
            isLoading: false,
            otpSent: false,
            authError: null,
          });

          return { success: true };
        } catch (err: any) {
          const errMsg = err?.message || 'Failed to verify OTP code.';
          set({ isLoading: false, authError: errMsg });
          return { success: false, error: errMsg };
        }
      },

      setSession: (
        user: AuthUser,
        accessToken: string,
        refreshToken?: string | null,
        expiresAt?: number | null
      ) => {
        set((state) => ({
          user,
          accessToken,
          refreshToken: refreshToken !== undefined ? refreshToken : state.refreshToken,
          expiresAt: expiresAt !== undefined ? expiresAt : state.expiresAt,
          isAuthenticated: true,
          isLoading: false,
          authError: null,
        }));
      },

      handleAuthExpired: (reason?: string) => {
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          isAuthenticated: false,
          isLoading: false,
          isAuthModalOpen: true,
          authError: reason || 'Your session has expired. Please sign in to continue.',
        });
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem('opendork_auth_session');
          } catch {}
        }
      },

      refreshSession: async () => {
        const state = get();
        if (!state.refreshToken) {
          return false;
        }

        try {
          const res = await supabaseAuthHelper.refreshSession(state.refreshToken);
          if (!res.ok) {
            get().handleAuthExpired('Session expired. Please sign in again.');
            return false;
          }

          const data = await res.json();
          if (!data.access_token) {
            get().handleAuthExpired('Session expired. Please sign in again.');
            return false;
          }

          const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
          set({
            accessToken: data.access_token,
            refreshToken: data.refresh_token || state.refreshToken,
            expiresAt,
            isAuthenticated: true,
            authError: null,
          });
          return true;
        } catch (err) {
          console.warn('[Auth] Failed to refresh session:', err);
          return false;
        }
      },

      logout: async () => {
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          isAuthenticated: false,
          isAuthModalOpen: false,
          otpSent: false,
          authError: null,
        });
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem('opendork_auth_session');
          } catch {}
        }
      },
    }),
    {
      name: 'opendork_auth_session',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        expiresAt: state.expiresAt,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Strictly purge legacy demo users or sessions without real Bearer access token
          if (
            !state.accessToken ||
            !state.user ||
            state.user.authMode !== 'real' ||
            state.user.id === 'demo-user' ||
            (state.user as any).provider === 'demo'
          ) {
            state.user = null;
            state.accessToken = null;
            state.refreshToken = null;
            state.expiresAt = null;
            state.isAuthenticated = false;
            if (typeof window !== 'undefined') {
              try {
                localStorage.removeItem('opendork_auth_session');
              } catch {}
            }
          }
        }
      },
    }
  )
);

// Immediate startup check in browser to clean legacy demo sessions and extract OAuth callback tokens
export function initAuthFromUrlHash(): void {
  if (typeof window === 'undefined') return;

  try {
    // 1. Clean legacy demo tokens
    const raw = localStorage.getItem('opendork_auth_session');
    if (raw && (raw.includes('"demo-user"') || raw.includes('"authMode":"demo"') || raw.includes('"provider":"demo"'))) {
      localStorage.removeItem('opendork_auth_session');
    }

    // 2. Parse OAuth callback tokens from URL hash (#access_token=...)
    const hash = window.location.hash;
    if (hash && hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
      const expiresAt = Date.now() + expiresIn * 1000;
      const provider = (params.get('provider') as any) || 'google';

      if (accessToken) {
        // Set session immediately with token so API calls immediately succeed
        const tempUser: AuthUser = {
          id: 'auth-user',
          email: '',
          name: 'User',
          provider,
          authMode: 'real',
          created_at: new Date().toISOString(),
        };
        useAuthStore.getState().setSession(tempUser, accessToken, refreshToken, expiresAt);

        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
          fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${accessToken}`,
            },
          })
            .then((res) => (res.ok ? res.json() : null))
            .then((userData) => {
              if (userData && userData.id) {
                const authUser: AuthUser = {
                  id: userData.id,
                  email: userData.email || '',
                  name: userData.user_metadata?.full_name || userData.user_metadata?.name || userData.email?.split('@')[0] || 'User',
                  avatar_url: userData.user_metadata?.avatar_url || userData.user_metadata?.picture,
                  provider: (userData.app_metadata?.provider as any) || provider || 'google',
                  authMode: 'real',
                  created_at: userData.created_at || new Date().toISOString(),
                };
                useAuthStore.getState().setSession(authUser, accessToken, refreshToken, expiresAt);
              }
            })
            .catch((err) => console.warn('[Auth] Failed to initialize session from URL hash:', err))
            .finally(() => {
              // Clean hash from URL bar
              window.history.replaceState(null, '', window.location.pathname + window.location.search);
            });
        }
      }
    }
  } catch (err) {
    console.warn('[Auth] Error initializing auth:', err);
  }
}

if (typeof window !== 'undefined') {
  initAuthFromUrlHash();
}

/**
 * Synchronous version of getClientAuthHeaders for backward compatibility (tests only).
 * Does NOT perform automatic token refresh.
 */
export function getClientAuthHeadersSync(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Checks if current token is expired or will expire soon (within 5 minutes)
 */
function isTokenExpiringSoon(): boolean {
  const state = useAuthStore.getState();
  if (!state.expiresAt || !state.isAuthenticated) {
    return false;
  }
  const fiveMinutes = 5 * 60 * 1000;
  return Date.now() >= (state.expiresAt - fiveMinutes);
}

/**
 * Centralized helper for client-side API requests.
 * Attaches verified Supabase Bearer token if the user is authenticated.
 * Automatically refreshes token if expired or expiring soon.
 */
export async function getClientAuthHeaders(extraHeaders: Record<string, string> = {}): Promise<Record<string, string>> {
  // Check if token needs refresh
  if (isTokenExpiringSoon()) {
    const state = useAuthStore.getState();
    if (state.refreshToken) {
      console.log('[Auth] Token expiring soon, attempting refresh...');
      const refreshed = await state.refreshSession();
      if (!refreshed) {
        console.warn('[Auth] Token refresh failed, user may need to re-login');
      }
    }
  }

  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Background token refresh interval.
 * Checks every 5 minutes if token needs refresh.
 */
let refreshIntervalId: NodeJS.Timeout | null = null;

export function startTokenRefreshInterval(): void {
  if (typeof window === 'undefined') return;
  
  // Clear existing interval if any
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
  }
  
  // Check every 5 minutes
  refreshIntervalId = setInterval(async () => {
    const state = useAuthStore.getState();
    if (!state.isAuthenticated || !state.refreshToken) {
      return;
    }
    
    if (isTokenExpiringSoon()) {
      console.log('[Auth] Background token refresh triggered');
      const refreshed = await state.refreshSession();
      if (!refreshed) {
        console.warn('[Auth] Background token refresh failed');
      }
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}

export function stopTokenRefreshInterval(): void {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
}

// Start background refresh on module load (browser only)
if (typeof window !== 'undefined') {
  startTokenRefreshInterval();
  
  // Stop interval when page unloads
  window.addEventListener('beforeunload', stopTokenRefreshInterval);
}

