import { create } from 'zustand';
import { isLiveWorkspaceService, type WorkspaceService, type WorkspaceServicesUpdate } from '../../shared/types/workspaceServices';
import { useWorkspaceStore } from './workspaceStore';

function hasServiceOwner(service: WorkspaceService): boolean {
  const workspace = useWorkspaceStore.getState().getWorkspaceById(service.workspaceId);
  return Boolean(workspace?.checkoutContexts?.some((context) => context.id === service.checkoutContextId && context.path === service.checkoutRoot)
    && (isLiveWorkspaceService(service) || workspace.terminals.some((terminal) => terminal.checkoutContextId === service.checkoutContextId)));
}

/** Runtime-only main-owned service snapshots, independent of sidebar/active-workspace mounting. */
export const useWorkspaceServiceStore = create<WorkspaceServicesUpdate & { apply: (update: WorkspaceServicesUpdate) => void }>((set) => ({
  revision: -1, services: [],
  apply: (update) => set((state) => {
    if (update.revision <= state.revision) return state;
    return { revision: update.revision, services: update.services.filter(hasServiceOwner), settings: update.settings };
  }),
}));

export function startWorkspaceServiceBridge(): () => void {
  let disposed = false;
  const unsubscribe = window.electronAPI.onWorkspaceServicesChanged((update) => {
    if (!disposed) useWorkspaceServiceStore.getState().apply(update);
  });
  void window.electronAPI.workspaceServiceGet().then((update) => {
    if (!disposed) useWorkspaceServiceStore.getState().apply(update);
  }).catch(() => undefined);
  const unsubscribeStore = useWorkspaceStore.subscribe(() => {
    const services = useWorkspaceServiceStore.getState().services;
    const retained = services.filter(hasServiceOwner);
    if (retained.length !== services.length) useWorkspaceServiceStore.setState({ services: retained });
  });
  return () => { disposed = true; unsubscribe(); unsubscribeStore(); };
}
