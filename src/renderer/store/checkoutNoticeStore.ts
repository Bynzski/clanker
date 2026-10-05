import { create } from 'zustand';

export interface CheckoutNotice {
  /** Monotonic, so a repeated message is still a new notice. */
  id: number;
  workspaceId: string;
  tone: 'info' | 'warning';
  message: string;
}

interface CheckoutNoticeState {
  notice: CheckoutNotice | null;
  show: (notice: Omit<CheckoutNotice, 'id'>) => void;
  dismiss: (id?: number) => void;
}

let nextId = 1;

/**
 * The outcome of a checkout transition main performed. The agent that asked is not told (its process
 * was replaced), so the user is. Only the latest is kept; it is descriptive and never read back.
 */
export const useCheckoutNoticeStore = create<CheckoutNoticeState>((set) => ({
  notice: null,
  show: (notice) => set({ notice: { ...notice, id: nextId++ } }),
  dismiss: (id) => set((state) => (id === undefined || state.notice?.id === id ? { notice: null } : state)),
}));
