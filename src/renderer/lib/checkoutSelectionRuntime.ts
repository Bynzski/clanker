import { useAgentAttentionStore } from '../store/agentAttentionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { checkoutSelectionKey, currentCheckoutSelection } from './checkoutSelection';

/** Reactivity shared by imperative watcher owners. No timer, polling or alternate observer stream. */
export function subscribeCheckoutSelection(changed: () => void): () => void {
  const workspace = useWorkspaceStore.subscribe(changed);
  const attention = useAgentAttentionStore.subscribe(changed);
  return () => { workspace(); attention(); };
}

let sequence = 0;
const generations = new Map<string, { key: string; token: number }>();
let watching = false;
/** Synchronous selection epochs reject A→B→A responses even if React batches the intermediate
 * render. Bound to live workspaces, with a monotonic floor so closing/reopening cannot revive it. */
export function checkoutSelectionToken(workspaceId: string): number {
  const sync = () => {
    const state = useWorkspaceStore.getState();
    for (const id of generations.keys()) if (!state.getWorkspaceById(id)) generations.delete(id);
    for (const workspace of state.workspaces) {
      const key = JSON.stringify([checkoutSelectionKey(currentCheckoutSelection(workspace)), state.activeWorkspaceId === workspace.id]);
      if (generations.get(workspace.id)?.key !== key) generations.set(workspace.id, { key, token: ++sequence });
    }
  };
  if (!watching) { watching = true; subscribeCheckoutSelection(sync); }
  sync();
  return generations.get(workspaceId)?.token ?? -1;
}
