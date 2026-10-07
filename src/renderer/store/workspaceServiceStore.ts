import { create } from 'zustand';
import type { WorkspaceServicesUpdate } from '../../shared/types/workspaceServices';
import { useWorkspaceStore } from './workspaceStore';

/** Runtime-only main-owned service snapshots, independent of sidebar/active-workspace mounting. */
export const useWorkspaceServiceStore = create<WorkspaceServicesUpdate & { apply: (update: WorkspaceServicesUpdate) => void }>((set) => ({
  revision: -1, services: [],
  apply: (update) => set((state) => {
    if (update.revision <= state.revision) return state;
    return { revision: update.revision, services: update.services.filter((service) => {
      const workspace = useWorkspaceStore.getState().getWorkspaceById(service.workspaceId);
      return workspace?.checkoutContexts?.some((context) => context.id === service.checkoutContextId && context.path === service.checkoutRoot);
    }) };
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
  const unsubscribeStore = useWorkspaceStore.subscribe((state) => {
    const ids = new Set(state.workspaces.map((workspace) => workspace.id));
    const services = useWorkspaceServiceStore.getState().services;
    if (services.some((service) => !ids.has(service.workspaceId))) {
      useWorkspaceServiceStore.setState({ services: services.filter((service) => ids.has(service.workspaceId)) });
    }
  });
  return () => { disposed = true; unsubscribe(); unsubscribeStore(); };
}
