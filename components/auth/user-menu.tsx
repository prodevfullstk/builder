'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  User,
  LogOut,
  FolderCode,
  Zap,
  Sparkles,
  ChevronDown,
  Shield,
  CreditCard,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth/supabase-auth';
import { useCreditsStore } from '@/lib/store/credits-store';

export function UserMenu() {
  const { user, isAuthenticated, setAuthModalOpen, logout } = useAuthStore();
  const { setModalOpen: setCreditsModalOpen, credits, tier } = useCreditsStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isAuthenticated || !user) {
    return (
      <button
        type="button"
        onClick={() => setAuthModalOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-zinc-800 text-xs font-semibold transition-all cursor-pointer shadow-sm hover:scale-105"
      >
        <User className="w-3.5 h-3.5 text-zinc-400" />
        <span>Sign In</span>
      </button>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="inline-flex items-center gap-2 p-1 pl-2 pr-2.5 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 transition-all cursor-pointer select-none"
      >
        {/* Avatar */}
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt={user.name}
            className="w-5 h-5 rounded-full object-cover border border-zinc-700"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
        )}

        <span className="max-w-[100px] truncate">{user.name.split(' ')[0]}</span>
        <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
          {tier}
        </span>
        <ChevronDown className="w-3 h-3 text-zinc-500" />
      </button>

      {/* Dropdown Menu */}
      {dropdownOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl shadow-blue-950/40 py-2 z-50 text-xs animate-in fade-in zoom-in-95 duration-150">
          {/* User Profile Header */}
          <div className="px-3.5 py-2 border-b border-zinc-800/80 mb-1">
            <p className="font-semibold text-white truncate">{user.name}</p>
            <p className="text-[11px] text-zinc-400 truncate">{user.email}</p>
          </div>

          {/* Credits item */}
          <button
            type="button"
            onClick={() => {
              setDropdownOpen(false);
              setCreditsModalOpen(true);
            }}
            className="w-full text-left px-3.5 py-2 hover:bg-zinc-900 text-zinc-300 hover:text-white flex items-center justify-between transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              Credits & Usage
            </span>
            <span className="font-mono text-emerald-400 font-bold">{credits} pts</span>
          </button>

          {/* Pricing & Upgrade link */}
          <Link
            href="/pricing"
            onClick={() => setDropdownOpen(false)}
            className="w-full text-left px-3.5 py-2 hover:bg-zinc-900 text-zinc-300 hover:text-white flex items-center justify-between transition-colors"
          >
            <span className="flex items-center gap-2">
              <CreditCard className="w-3.5 h-3.5 text-blue-400" />
              Pricing & Plans
            </span>
            <span className="text-[10px] text-blue-400 font-semibold uppercase">Upgrade</span>
          </Link>

          {/* Sign Out */}
          <div className="border-t border-zinc-800/80 mt-1 pt-1">
            <button
              type="button"
              onClick={() => {
                setDropdownOpen(false);
                logout();
              }}
              className="w-full text-left px-3.5 py-2 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 flex items-center gap-2 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
