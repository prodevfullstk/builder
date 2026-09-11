import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  provider: 'google' | 'github' | 'email' | 'demo';
  created_at: string;
}

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAuthModalOpen: boolean;

  // Actions
  setAuthModalOpen: (open: boolean) => void;
  loginWithOAuth: (provider: 'google' | 'github') => Promise<void>;
  loginWithEmail: (email: string) => Promise<void>;
  loginAsDemo: (name?: string, email?: string) => void;
  logout: () => Promise<void>;
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
    const redirect = redirectTo || (typeof window !== 'undefined' ? window.location.origin : '');
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
  saveProject: async (userId: string, project: any) => {
    return fetch(`${SUPABASE_URL}/rest/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: project.id,
        user_id: userId,
        name: project.name,
        framework: project.framework,
        files: project.files,
        messages: project.messages,
        updated_at: new Date(project.updatedAt || Date.now()).toISOString(),
      }),
    });
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isAuthModalOpen: false,

      setAuthModalOpen: (open: boolean) => set({ isAuthModalOpen: open }),

      loginWithOAuth: async (provider: 'google' | 'github') => {
        set({ isLoading: true });

        if (isRealSupabaseConfigured && typeof window !== 'undefined') {
          // Redirect to real Supabase OAuth provider
          window.location.href = supabaseAuthHelper.getOAuthUrl(provider);
        } else {
          // Graceful instant mock login when Supabase env vars not provided
          setTimeout(() => {
            get().loginAsDemo(
              provider === 'github' ? 'GitHub Developer' : 'Google Developer',
              provider === 'github' ? 'dev@github.com' : 'user@gmail.com'
            );
            set({ isLoading: false, isAuthModalOpen: false });
          }, 300);
        }
      },

      loginWithEmail: async (email: string) => {
        set({ isLoading: true });
        if (isRealSupabaseConfigured) {
          try {
            await supabaseAuthHelper.sendOtp(email);
          } catch (err) {
            console.warn('[Supabase Auth] OTP error, falling back:', err);
          }
        }
        setTimeout(() => {
          get().loginAsDemo(email.split('@')[0] || 'Web Developer', email);
          set({ isLoading: false, isAuthModalOpen: false });
        }, 300);
      },

      loginAsDemo: (name = 'Pro Developer', email = 'developer@opendork.com') => {
        const seed = Math.random().toString(36).substring(2, 7);
        const demoUser: AuthUser = {
          id: 'user_' + Date.now().toString(36) + '_' + seed,
          name,
          email,
          avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
          provider: 'demo',
          created_at: new Date().toISOString(),
        };

        set({
          user: demoUser,
          isAuthenticated: true,
          isAuthModalOpen: false,
          isLoading: false,
        });
      },

      logout: async () => {
        set({
          user: null,
          isAuthenticated: false,
          isAuthModalOpen: false,
        });
      },
    }),
    {
      name: 'opendork_auth_session',
    }
  )
);
