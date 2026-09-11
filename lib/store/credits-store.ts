import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CreditAction = 'NEW_PROJECT_BUILD' | 'FEATURE_EDIT' | 'AUTO_FIX' | 'CHAT_PLAN';

export const ACTION_COSTS: Record<CreditAction, number> = {
  NEW_PROJECT_BUILD: 10,
  FEATURE_EDIT: 3,
  AUTO_FIX: 2,
  CHAT_PLAN: 1,
};

export interface CreditTransaction {
  id: string;
  action: CreditAction | 'DAILY_REFILL' | 'BONUS_CLAIM' | 'PRO_PURCHASE';
  amount: number;
  timestamp: number;
  label: string;
}

export interface CreditsState {
  credits: number;
  maxCredits: number;
  tier: 'free' | 'pro' | 'unlimited';
  lastDailyReset: number;
  transactions: CreditTransaction[];
  isModalOpen: boolean;

  // Actions
  setModalOpen: (open: boolean) => void;
  deductCredits: (action: CreditAction, customLabel?: string) => boolean;
  addCredits: (amount: number, label: string, actionType?: CreditTransaction['action']) => void;
  checkAndApplyDailyReset: () => boolean;
  claimDailyBonus: () => boolean;
  hasClaimedBonusToday: () => boolean;
}

const DEFAULT_INITIAL_CREDITS = 100;
const DAILY_FREE_REFRESH_AMOUNT = 50;
const MS_IN_24_HOURS = 24 * 60 * 60 * 1000;

export const useCreditsStore = create<CreditsState>()(
  persist(
    (set, get) => ({
      credits: DEFAULT_INITIAL_CREDITS,
      maxCredits: DEFAULT_INITIAL_CREDITS,
      tier: 'free',
      lastDailyReset: Date.now(),
      transactions: [
        {
          id: 'tx_init',
          action: 'DAILY_REFILL',
          amount: DEFAULT_INITIAL_CREDITS,
          timestamp: Date.now(),
          label: 'Welcome Starter Credits',
        },
      ],
      isModalOpen: false,

      setModalOpen: (open: boolean) => set({ isModalOpen: open }),

      deductCredits: (action: CreditAction, customLabel?: string) => {
        // First check if 24 hours passed for automatic refresh
        get().checkAndApplyDailyReset();

        const cost = ACTION_COSTS[action] || 1;
        const current = get().credits;

        if (get().tier === 'unlimited') {
          return true;
        }

        if (current < cost) {
          // Open credits modal to notify user
          set({ isModalOpen: true });
          return false;
        }

        const newBalance = current - cost;
        const newTx: CreditTransaction = {
          id: 'tx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
          action,
          amount: -cost,
          timestamp: Date.now(),
          label: customLabel || `Deducted ${cost} credits for ${action.replace(/_/g, ' ').toLowerCase()}`,
        };

        set({
          credits: newBalance,
          transactions: [newTx, ...get().transactions.slice(0, 49)],
        });

        return true;
      },

      addCredits: (amount: number, label: string, actionType: CreditTransaction['action'] = 'BONUS_CLAIM') => {
        const newBalance = get().credits + amount;
        const newTx: CreditTransaction = {
          id: 'tx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
          action: actionType,
          amount: amount,
          timestamp: Date.now(),
          label,
        };

        set({
          credits: newBalance,
          maxCredits: Math.max(get().maxCredits, newBalance),
          transactions: [newTx, ...get().transactions.slice(0, 49)],
        });
      },

      checkAndApplyDailyReset: () => {
        const now = Date.now();
        const lastReset = get().lastDailyReset;

        if (now - lastReset >= MS_IN_24_HOURS) {
          // It's a new day! Refill up to at least 50 credits if below
          const current = get().credits;
          const refilled = Math.max(current, DAILY_FREE_REFRESH_AMOUNT);
          const gained = refilled - current;

          const txs = [...get().transactions];
          if (gained > 0) {
            txs.unshift({
              id: 'tx_daily_' + now.toString(36),
              action: 'DAILY_REFILL',
              amount: gained,
              timestamp: now,
              label: 'Daily Free Credits Refill (+50)',
            });
          }

          set({
            credits: refilled,
            lastDailyReset: now,
            transactions: txs.slice(0, 50),
          });

          return true;
        }
        return false;
      },

      claimDailyBonus: () => {
        if (get().hasClaimedBonusToday()) {
          return false;
        }

        const BONUS_AMOUNT = 15;
        get().addCredits(BONUS_AMOUNT, 'Claimed Daily Bonus (+15 Credits)', 'BONUS_CLAIM');
        return true;
      },

      hasClaimedBonusToday: () => {
        const todayStart = new Date().setHours(0, 0, 0, 0);
        return get().transactions.some(
          (tx) => tx.action === 'BONUS_CLAIM' && tx.timestamp >= todayStart
        );
      },
    }),
    {
      name: 'opendork_credits_store',
    }
  )
);
