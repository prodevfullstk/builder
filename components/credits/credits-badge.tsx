'use client';

import React, { useEffect, useState } from 'react';
import { Zap, Sparkles } from 'lucide-react';
import { useCreditsStore } from '@/lib/store/credits-store';

export function CreditsBadge({ className = '' }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const { credits, maxCredits, setModalOpen, checkAndApplyDailyReset } = useCreditsStore();

  useEffect(() => {
    setMounted(true);
    checkAndApplyDailyReset();
  }, [checkAndApplyDailyReset]);

  if (!mounted) {
    return (
      <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-500 font-mono animate-pulse ${className}`}>
        <Zap className="w-3.5 h-3.5 text-zinc-600" />
        <span>...</span>
      </div>
    );
  }

  // Color code based on balance
  const isLow = credits < 10;
  const isMedium = credits >= 10 && credits <= 25;

  const badgeColor = isLow
    ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:border-red-500/50'
    : isMedium
    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:border-amber-500/50'
    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:border-emerald-500/50';

  return (
    <button
      type="button"
      onClick={() => setModalOpen(true)}
      title="View AI Credits & Refill"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold font-mono transition-all shadow-sm cursor-pointer select-none hover:scale-105 active:scale-95 ${badgeColor} ${className}`}
    >
      <Zap className={`w-3.5 h-3.5 ${isLow ? 'animate-bounce text-red-400' : 'text-emerald-400'}`} />
      <span>{credits}</span>
      <span className="opacity-60 text-[10px]">/ {maxCredits} pts</span>
    </button>
  );
}
