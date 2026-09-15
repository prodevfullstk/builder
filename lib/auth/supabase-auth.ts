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
  setSession: (user: AuthUser, accessToken: string) => void;
}

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

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

      setSession: (user: AuthUser, accessToken: string) => {
        set({
          user,
          accessToken,
          isAuthenticated: true,
          isLoading: false,
          authError: null,
        });
      },

      logout: async () => {
        set({
          user: null,
          accessToken: null,
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

// Immediate startup check in browser to clean legacy demo sessions
if (typeof window !== 'undefined') {
  try {
    const raw = localStorage.getItem('opendork_auth_session');
    if (raw && (raw.includes('"demo-user"') || raw.includes('"authMode":"demo"') || raw.includes('"provider":"demo"'))) {
      localStorage.removeItem('opendork_auth_session');
    }
  } catch {}
}

/**
 * Centralized helper for client-side API requests.
 * Attaches verified Supabase Bearer token if the user is authenticated.
 */
export function getClientAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
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

