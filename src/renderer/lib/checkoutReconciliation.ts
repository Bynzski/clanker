import { useEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAgentAttentionStore } from '../store/agentAttentionStore';
import { isIsolatedWorktreeContext } from './worktreeAgents';

/**
 * Keeps each workspace's worktree checkouts in line with Git. Main does the work
 * (`RECONCILE_CHECKOUT_CONTEXTS`: branches refreshed, gone checkouts dropped, or marked missing
 * while an agent is still bound to them); this only decides when to ask and applies the answer.
 *
 * It asks when something may have changed a worktree behind Clanker's back: an agent's turn ended
 * or its agent exited, a terminal closed (a missing checkout can then be dropped), the app regained
 * focus, the active workspace changed, or the Git menu reloaded its worktrees.
 */

const running = new Map<string, Promise<void>>();
const queued = new Set<string>();

const hasWorktreeContexts = (workspaceId: string): boolean => {
  const workspace = useWorkspaceStore.getState().getWorkspaceById(workspaceId);
  return Boolean(workspace?.checkoutContexts?.some((context) => isIsolatedWorktreeContext(workspace, context)));
};

async function reconcileOnce(workspaceId: string): Promise<void> {
  try {
    const result = await window.electronAPI.reconcileCheckoutContexts(workspaceId);
    useWorkspaceStore.getState().applyCheckoutContextReconciliation(workspaceId, result);
  } catch {
    // Best effort: a closed workspace or an unreachable host changes nothing; the next trigger retries.
  }
}

/** Asks main to reconcile one workspace. Requests made while one runs collapse into one follow-up. */
export function requestCheckoutReconciliation(workspaceId: string): Promise<void> {
  const current = running.get(workspaceId);
  if (current) {
    queued.add(workspaceId);
    return current;
  }
  if (!hasWorktreeContexts(workspaceId)) return Promise.resolve();
  const run = reconcileOnce(workspaceId).finally(() => {
    running.delete(workspaceId);
    if (queued.delete(workspaceId)) void requestCheckoutReconciliation(workspaceId);
  });
  running.set(workspaceId, run);
  return run;
}

const workspaceOfTerminal = (terminalId: string): string | null =>
  useWorkspaceStore.getState().workspaces.find((workspace) => workspace.terminals.some((terminal) => terminal.id === terminalId))?.id ?? null;

/** Mounted once by the app shell. */
export function useCheckoutReconciliation(): void {
  useEffect(() => {
    const request = (workspaceId: string | null | undefined) => { if (workspaceId) void requestCheckoutReconciliation(workspaceId); };

    const onFocus = () => request(useWorkspaceStore.getState().activeWorkspaceId);
    window.addEventListener('focus', onFocus);

    // A turn ended (any outcome) or the agent exited: the agent may have merged, removed or switched a worktree.
    const stopAttention = useAgentAttentionStore.subscribe((state, previous) => {
      for (const [terminalId, revision] of Object.entries(state.revisionByTerminalId)) {
        if (previous.revisionByTerminalId[terminalId] === revision) continue;
        const before = previous.byTerminalId[terminalId];
        const after = state.byTerminalId[terminalId];
        const ended = after ? Boolean(after.lastOutcome && after.lastOutcome.revision !== before?.lastOutcome?.revision) : Boolean(before);
        if (ended) request(workspaceOfTerminal(terminalId));
      }
    });

    const stopWorkspaces = useWorkspaceStore.subscribe((state, previous) => {
      if (state.activeWorkspaceId !== previous.activeWorkspaceId) request(state.activeWorkspaceId);
      if (state.workspaces === previous.workspaces) return;
      for (const workspace of state.workspaces) {
        const before = previous.workspaces.find((entry) => entry.id === workspace.id);
        if (!before || before.terminals === workspace.terminals) continue;
        if (before.terminals.some((terminal) => !workspace.terminals.some((entry) => entry.id === terminal.id))) request(workspace.id);
      }
    });

    return () => {
      window.removeEventListener('focus', onFocus);
      stopAttention();
      stopWorkspaces();
    };
  }, []);
}
