import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  provider: 'google' | 'github' | 'email' | 'demo';
  authMode: 'real' | 'demo';
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
  loginAsDemo: (name?: string, email?: string) => void;
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
            authError: 'Supabase authentication is not configured in this environment. Please configure Supabase or use Demo Login.',
          });
        }
      },

      loginWithEmail: async (email: string) => {
        set({ isLoading: true, authError: null });

        if (!isRealSupabaseConfigured) {
          const errorMsg = 'Supabase authentication is not configured. Use 1-Click Demo Login to preview the builder.';
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

      loginAsDemo: (name = 'Pro Developer', email = 'developer@opendork.com') => {
        const seed = Math.random().toString(36).substring(2, 7);
        const demoUser: AuthUser = {
          id: 'demo_' + Date.now().toString(36) + '_' + seed,
          name,
          email,
          avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
          provider: 'demo',
          authMode: 'demo',
          created_at: new Date().toISOString(),
        };

        set({
          user: demoUser,
          accessToken: null,
          isAuthenticated: true,
          isAuthModalOpen: false,
          isLoading: false,
          otpSent: false,
          authError: null,
        });
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
      },
    }),
    {
      name: 'opendork_auth_session',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
