import { create } from 'zustand';

const KEY = 'clanker.usageWidget';

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

/** Which harnesses the status-bar Usage widget shows. A per-viewer display preference; none = dial only. */
export const useUsageWidgetStore = create<{ ids: readonly string[]; toggle: (harnessId: string) => void }>((set, get) => ({
  ids: load(),
  toggle: (harnessId) => {
    const ids = get().ids.includes(harnessId) ? get().ids.filter((id) => id !== harnessId) : [...get().ids, harnessId];
    set({ ids });
    try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* preference stays in memory */ }
  },
}));
