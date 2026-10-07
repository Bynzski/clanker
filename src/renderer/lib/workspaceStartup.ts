import { useWorkspaceStore } from '../store/workspaceStore';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { useNotificationStore } from '../store/notificationStore';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { isSameWorkspaceIdentity, workspaceIdentityKey } from '../../shared/workspaceIdentity';
import { findOpenWorkspace, prepareWorkspaceShell, unregisterWorkspaceShell, workspaceLocation } from './openWorkspace';
import { persistOpenWorkspaces, readOpenWorkspaceState } from './openWorkspaceStorage';

/** One mount owns startup registrations. Persistence is barred until the atomic commit. */
export function startWorkspaceRestoration(): { dispose: () => void; done: Promise<void> } {
  let invalidIdentities = 0;
  const saved = readOpenWorkspaceState(() => { invalidIdentities++; });
  let cancelled = false;
  let hydrating = true;
  let userSelected = useWorkspaceStore.getState().activeWorkspaceId !== null;
  let lastNavigation = '';
  const persist = () => {
    const state = useWorkspaceStore.getState();
    const navigation = JSON.stringify([state.workspaces.map(workspaceLocation), state.activeWorkspaceId]);
    if (navigation === lastNavigation) return;
    lastNavigation = navigation;
    persistOpenWorkspaces(state.workspaces, state.activeWorkspaceId);
  };
  const closed = new Set<string>();
  const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
    if (hydrating) {
      if (state.activeWorkspaceId !== previous.activeWorkspaceId) userSelected = true;
      for (const workspace of previous.workspaces) {
        if (!state.workspaces.some((entry) => entry.id === workspace.id)) closed.add(workspaceIdentityKey(workspaceLocation(workspace)));
      }
      return;
    }
    persist();
  });
  const unsubscribeAssistant = useAssistantNavStore.subscribe((state, previous) => {
    if (state.activeAssistantId !== previous.activeAssistantId) userSelected = true;
  });
  const done = (async () => {
    const prepared = new Set<WorkspaceTab>();
    let restoredActive: WorkspaceTab | undefined;
    const restored: WorkspaceTab[] = [];
    const failures = Array.from({ length: invalidIdentities }, () => 'Invalid saved workspace identity');
    try {
      for (const location of saved.workspaces) {
        if (cancelled) break;
        try {
          const existing = findOpenWorkspace(location, [...useWorkspaceStore.getState().workspaces, ...restored]);
          const shell = existing ?? await prepareWorkspaceShell(location);
          if (!existing) prepared.add(shell);
          const duplicate = findOpenWorkspace(workspaceLocation(shell), [...useWorkspaceStore.getState().workspaces, ...restored]);
          const selected = duplicate ?? shell;
          restored.push(selected);
          if (saved.activeWorkspace && isSameWorkspaceIdentity(location, saved.activeWorkspace)) restoredActive = selected;
          if (!existing && duplicate) {
            await unregisterWorkspaceShell(shell);
            prepared.delete(shell);
          }
        } catch (error) {
          failures.push(`${location.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (cancelled) return;
      const shells = restored.filter((shell) => !closed.has(workspaceIdentityKey(workspaceLocation(shell))));
      const persistedActive = restoredActive && shells.includes(restoredActive) ? restoredActive
        : saved.activeWorkspace ? findOpenWorkspace(saved.activeWorkspace, shells) : undefined;
      const live = useWorkspaceStore.getState();
      const activeId = userSelected ? live.activeWorkspaceId : persistedActive?.id ?? shells[0]?.id ?? null;
      // No awaits between the final identity check and the store commit.
      useWorkspaceStore.getState().hydrateWorkspaceShells(shells, activeId);
      hydrating = false;
      persist();
      if (failures.length) {
        const details = failures.slice(0, 3).map((failure) => failure.length > 180 ? `${failure.slice(0, 179)}…` : failure).join('; ');
        useNotificationStore.getState().show({
          tone: 'warning', message: `${failures.length} workspace${failures.length === 1 ? '' : 's'} could not be reopened. ${details}${failures.length > 3 ? '; …' : ''}`,
          dedupeKey: 'workspace-startup',
        });
      }
    } finally {
      // Includes canonical duplicates, user-closed shells and cancellation during registration.
      const liveIds = new Set(useWorkspaceStore.getState().workspaces.map((entry) => entry.id));
      await Promise.all([...prepared].filter((shell) => !liveIds.has(shell.id)).map(unregisterWorkspaceShell));
    }
  })();
  return { done, dispose: () => { cancelled = true; unsubscribe(); unsubscribeAssistant(); } };
}
