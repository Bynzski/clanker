import { create } from 'zustand';
import type { HarnessUsageEntry } from '../../shared/types/harnessUsage';

interface UsageStoreState {
  entries: Record<string /* environmentId */, Record<string /* harnessId */, HarnessUsageEntry | undefined>>;
  otherAccounts: Record<string /* environmentId */, Record<string /* harnessId */, HarnessUsageEntry[] | undefined>>;

  getEntries: (environmentId: string) => Record<string, HarnessUsageEntry | undefined>;
  getOtherAccounts: (environmentId: string) => Record<string, HarnessUsageEntry[] | undefined>;
  setEntry: (environmentId: string, harnessId: string, entry: HarnessUsageEntry | undefined, others?: HarnessUsageEntry[]) => void;
  selectAccount: (environmentId: string, harnessId: string, accountId: string) => void;
  reset: () => void;
}

export const useUsageStore = create<UsageStoreState>((set, get) => ({
  entries: {},
  otherAccounts: {},

  getEntries: (environmentId: string) => {
    return { ...(get().entries[environmentId] ?? {}) };
  },

  getOtherAccounts: (environmentId: string) => {
    return { ...(get().otherAccounts[environmentId] ?? {}) };
  },

  setEntry: (environmentId: string, harnessId: string, entry: HarnessUsageEntry | undefined, others: HarnessUsageEntry[] = []) => {
    set((state) => {
      const envEntries = { ...state.entries[environmentId] };
      const envOthers = { ...state.otherAccounts[environmentId] };
      if (entry) {
        envEntries[harnessId] = entry;
      } else {
        delete envEntries[harnessId];
      }
      envOthers[harnessId] = others;
      return {
        entries: { ...state.entries, [environmentId]: envEntries },
        otherAccounts: { ...state.otherAccounts, [environmentId]: envOthers },
      };
    });
  },

  selectAccount: (environmentId: string, harnessId: string, accountId: string) => {
    set((state) => {
      const currentEntry = state.entries[environmentId]?.[harnessId];
      const others = state.otherAccounts[environmentId]?.[harnessId] ?? [];
      const target = others.find((candidate) => candidate.account?.id === accountId);
      if (target) {
        const remainingOthers = [
          ...(currentEntry ? [{ ...currentEntry, account: currentEntry.account ? { ...currentEntry.account, selected: false } : undefined }] : []),
          ...others.filter((candidate) => candidate.account?.id !== accountId),
        ];
        return {
          entries: {
            ...state.entries,
            [environmentId]: {
              ...state.entries[environmentId],
              [harnessId]: { ...target, account: target.account ? { ...target.account, selected: true } : undefined },
            },
          },
          otherAccounts: {
            ...state.otherAccounts,
            [environmentId]: {
              ...state.otherAccounts[environmentId],
              [harnessId]: remainingOthers,
            },
          },
        };
      } else {
        const envEntries = { ...state.entries[environmentId] };
        delete envEntries[harnessId];
        return {
          entries: {
            ...state.entries,
            [environmentId]: envEntries,
          },
        };
      }
    });
  },

  reset: () => {
    set({
      entries: {},
      otherAccounts: {},
    });
  },
}));
