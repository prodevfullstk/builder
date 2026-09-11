'use client';

import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Mail,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Lock,
  User,
  Github,
  Zap,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth/supabase-auth';
import { syncLocalProjectsToCloud } from '@/lib/storage/cloud-sync';

export function AuthModal() {
  const {
    isAuthModalOpen,
    setAuthModalOpen,
    loginWithOAuth,
    loginWithEmail,
    loginAsDemo,
    isLoading,
  } = useAuthStore();

  const [email, setEmail] = useState('');
  const [sentNotice, setSentNotice] = useState(false);

  if (!isAuthModalOpen) return null;

  const handleOAuth = async (provider: 'google' | 'github') => {
    await loginWithOAuth(provider);
    const user = useAuthStore.getState().user;
    if (user) {
      await syncLocalProjectsToCloud(user);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    await loginWithEmail(email.trim());
    setSentNotice(true);
    const user = useAuthStore.getState().user;
    if (user) {
      await syncLocalProjectsToCloud(user);
    }
  };

  const handleDemoSignIn = () => {
    loginAsDemo('Guest Creator', 'creator@opendork.com');
    const user = useAuthStore.getState().user;
    if (user) {
      syncLocalProjectsToCloud(user);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl shadow-blue-950/40 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800/80 bg-zinc-900/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                Welcome to opendork
              </h2>
              <p className="text-[11px] text-zinc-400">
                Sign in to sync your fullstack projects across devices
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setAuthModalOpen(false)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 text-sm">
          {/* OAuth Buttons */}
          <div className="space-y-2.5">
            {/* Google */}
            <button
              type="button"
              onClick={() => handleOAuth('google')}
              disabled={isLoading}
              className="w-full py-2.5 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-zinc-800 hover:border-zinc-700 font-medium text-xs flex items-center justify-center gap-3 transition-all cursor-pointer shadow-sm hover:scale-[1.01]"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#EA4335"
                  d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"
                />
                <path
                  fill="#4285F4"
                  d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2s.7 5.5 1.9 7.9l3.7-2.9c-.2-.7-.4-1.5-.4-2.3z"
                />
                <path
                  fill="#34A853"
                  d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16.5C3.7 20.2 7.5 23.5 12 23.5z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>

            {/* GitHub */}
            <button
              type="button"
              onClick={() => handleOAuth('github')}
              disabled={isLoading}
              className="w-full py-2.5 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-zinc-800 hover:border-zinc-700 font-medium text-xs flex items-center justify-center gap-3 transition-all cursor-pointer shadow-sm hover:scale-[1.01]"
            >
              <Github className="w-4 h-4" />
              <span>Continue with GitHub</span>
            </button>
          </div>

          {/* Divider */}
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-800" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase">
              <span className="bg-zinc-950 px-2 text-zinc-500 font-mono">
                or sign in with email
              </span>
            </div>
          </div>

          {/* Email form */}
          <form onSubmit={handleEmailSubmit} className="space-y-3">
            <div className="relative">
              <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full py-2.5 pl-9 pr-3 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-all shadow-md shadow-blue-900/30 cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Send Magic Link / Sign In</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            {sentNotice && (
              <p className="text-[11px] text-emerald-400 text-center flex items-center justify-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Signed in successfully!
              </p>
            )}
          </form>

          {/* Quick Demo Login CTA */}
          <div className="pt-2 border-t border-zinc-800/80 text-center">
            <button
              type="button"
              onClick={handleDemoSignIn}
              className="text-xs text-zinc-400 hover:text-white transition-colors underline underline-offset-4 cursor-pointer"
            >
              Or click here for 1-Click Instant Demo Login ➔
            </button>
          </div>
        </div>

        {/* Footer info */}
        <div className="p-3.5 border-t border-zinc-800/80 bg-zinc-900/20 text-center text-[10px] text-zinc-500">
          🔒 Secure authentication powered by Supabase Auth & Local Encryption
        </div>
      </div>
    </div>
  );
}
