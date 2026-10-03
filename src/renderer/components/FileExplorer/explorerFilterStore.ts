import { useCallback, useState } from 'react';
import { create } from 'zustand';

/**
 * Per-workspace Files filter text for the sidebar FILES section, kept for the
 * life of the app (not persisted). The sidebar remounts the explorer on
 * workspace switch, so the filter must live outside the component. Entries are
 * dropped when cleared, so the map only holds active filters.
 */
const useExplorerFilterStore = create<{
  byWorkspaceId: Record<string, string>;
  setFilter: (workspaceId: string, value: string) => void;
}>((set) => ({
  byWorkspaceId: {},
  setFilter: (workspaceId, value) => set((state) => {
    const next = { ...state.byWorkspaceId };
    if (value === '') delete next[workspaceId];
    else next[workspaceId] = value;
    return { byWorkspaceId: next };
  }),
}));

export { useExplorerFilterStore };

/** Dock explorers keep the filter in component state; sidebar sections keep it per workspace. */
export function useExplorerFilter(workspaceId: string | null, perWorkspace: boolean): [string, (value: string) => void] {
  const [localQuery, setLocalQuery] = useState('');
  const storedQuery = useExplorerFilterStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined) ?? '');
  const setFilter = useExplorerFilterStore((state) => state.setFilter);
  const setStoredQuery = useCallback((value: string) => {
    if (workspaceId) setFilter(workspaceId, value);
  }, [setFilter, workspaceId]);
  return perWorkspace ? [storedQuery, setStoredQuery] : [localQuery, setLocalQuery];
}
