'use client';

import React, { useState } from 'react';
import {
  Zap,
  X,
  Sparkles,
  Gift,
  Check,
  ArrowRight,
  Clock,
  History,
  ShieldCheck,
  CreditCard,
} from 'lucide-react';
import { useCreditsStore, ACTION_COSTS, CreditAction } from '@/lib/store/credits-store';

export function CreditsModal() {
  const {
    credits,
    maxCredits,
    tier,
    isModalOpen,
    setModalOpen,
    transactions,
    claimDailyBonus,
    hasClaimedBonusToday,
    addCredits,
  } = useCreditsStore();

  const [claimSuccess, setClaimSuccess] = useState(false);
  const alreadyClaimed = hasClaimedBonusToday();

  if (!isModalOpen) return null;

  const handleClaim = () => {
    if (claimDailyBonus()) {
      setClaimSuccess(true);
      setTimeout(() => setClaimSuccess(false), 3000);
    }
  };

  const handleSimulatePurchase = (amount: number, label: string) => {
    addCredits(amount, `Purchased ${label} (Mock Payment)`, 'PRO_PURCHASE');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl shadow-blue-950/40 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800/80 bg-zinc-900/40">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>AI Credits & Tokenomics</span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {tier.toUpperCase()} TIER
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Credits fuel fullstack code generation, edits, and automated repairs
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setModalOpen(false)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-6 text-zinc-200 text-sm">
          {/* Current Balance & Daily Bonus Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Balance Card */}
            <div className="p-4 bg-gradient-to-br from-zinc-900 to-zinc-900/60 border border-zinc-800 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-zinc-400 font-medium">Available Balance</span>
              <div className="flex items-baseline gap-2 my-2">
                <span className="text-3xl font-extrabold text-white font-mono">
                  {credits}
                </span>
                <span className="text-xs text-zinc-500 font-mono">/ {maxCredits} Credits</span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-blue-500 to-emerald-400 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(5, (credits / maxCredits) * 100))}%` }}
                />
              </div>
            </div>

            {/* Daily Bonus Card */}
            <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs text-amber-400 font-semibold flex items-center gap-1">
                  <Gift className="w-3.5 h-3.5" /> Daily Reward
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">+15 Credits</span>
              </div>
              <p className="text-xs text-zinc-400 my-1">
                Claim your free credits every 24 hours to keep building.
              </p>
              <button
                type="button"
                onClick={handleClaim}
                disabled={alreadyClaimed}
                className={`w-full py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  alreadyClaimed
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    : 'bg-amber-500 hover:bg-amber-400 text-black shadow-md shadow-amber-900/30'
                }`}
              >
                {alreadyClaimed ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Claimed for Today
                  </>
                ) : claimSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> +15 Credits Added!
                  </>
                ) : (
                  <>
                    <Gift className="w-3.5 h-3.5" /> Claim +15 Credits
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Action Cost Breakdown */}
          <div>
            <h3 className="text-xs uppercase font-semibold text-zinc-400 mb-2.5 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span>Credit Consumption Matrix</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="p-2.5 bg-zinc-900/70 border border-zinc-800/80 rounded-lg text-center">
                <span className="text-[11px] text-zinc-400 block mb-1">New Full Project</span>
                <span className="text-sm font-bold text-white font-mono">{ACTION_COSTS.NEW_PROJECT_BUILD} Credits</span>
              </div>
              <div className="p-2.5 bg-zinc-900/70 border border-zinc-800/80 rounded-lg text-center">
                <span className="text-[11px] text-zinc-400 block mb-1">Feature / File Edit</span>
                <span className="text-sm font-bold text-white font-mono">{ACTION_COSTS.FEATURE_EDIT} Credits</span>
              </div>
              <div className="p-2.5 bg-zinc-900/70 border border-zinc-800/80 rounded-lg text-center">
                <span className="text-[11px] text-zinc-400 block mb-1">Auto-Fix Error</span>
                <span className="text-sm font-bold text-white font-mono">{ACTION_COSTS.AUTO_FIX} Credits</span>
              </div>
              <div className="p-2.5 bg-zinc-900/70 border border-zinc-800/80 rounded-lg text-center">
                <span className="text-[11px] text-zinc-400 block mb-1">Chat / Plan</span>
                <span className="text-sm font-bold text-white font-mono">{ACTION_COSTS.CHAT_PLAN} Credit</span>
              </div>
            </div>
          </div>

          {/* Refill / Pro Top-Up Tiers */}
          <div>
            <h3 className="text-xs uppercase font-semibold text-zinc-400 mb-2.5 flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
              <span>Top-Up Credits & Pro Packs</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Creator Pack */}
              <div className="p-3.5 bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 rounded-xl flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-white text-xs">Starter Top-Up</span>
                    <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 rounded">
                      +250 Credits
                    </span>
                  </div>
                  <span className="text-[11px] text-zinc-500 font-mono">$5 one-time</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleSimulatePurchase(250, 'Starter 250 Credits')}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white cursor-pointer transition-colors"
                >
                  Top Up
                </button>
              </div>

              {/* Pro Unlimited */}
              <div className="p-3.5 bg-gradient-to-br from-blue-950/40 to-indigo-950/40 border border-blue-500/30 rounded-xl flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-white text-xs">Pro Unlimited</span>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 rounded">
                      +1,000 Credits
                    </span>
                  </div>
                  <span className="text-[11px] text-zinc-400 font-mono">$15 / mo</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleSimulatePurchase(1000, 'Pro 1,000 Credits')}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white cursor-pointer transition-all shadow-sm"
                >
                  Upgrade
                </button>
              </div>
            </div>
          </div>

          {/* Usage History Log */}
          <div>
            <h3 className="text-xs uppercase font-semibold text-zinc-400 mb-2 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-zinc-500" />
              <span>Recent Activity ({transactions.length})</span>
            </h3>
            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 font-mono text-xs">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/40 border border-zinc-800/50"
                >
                  <span className="text-zinc-400 truncate max-w-[280px]">{tx.label}</span>
                  <span
                    className={`font-bold shrink-0 ${
                      tx.amount > 0 ? 'text-emerald-400' : 'text-zinc-300'
                    }`}
                  >
                    {tx.amount > 0 ? `+${tx.amount}` : tx.amount} Credits
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-900/30 flex items-center justify-between text-xs text-zinc-500">
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>50 free points refresh automatically every 24 hours</span>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(false)}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
