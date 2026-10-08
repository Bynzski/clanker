import type { CheckoutContext } from '../../shared/types/checkoutContext';
import { useWorkspaceStore } from '../store/workspaceStore';
import { getCheckoutContext } from './checkoutContexts';
import type { Terminal, WorkspaceTab } from '../store/workspaceTypes';

export interface CheckoutContextLaunchOptions {
  harness?: string;
  model?: string;
  initialCommand?: string;
  /** Optional canonical cwd/subdirectory; main still confines it to the registered context root. */
  workingDir?: string;
  displayName?: string;
  /** Capture at the initiating action, before any checkout-creation await. */
  pageId?: string;
}

/**
 * Launches a terminal/agent in one of a workspace's checkout contexts (main or worktree) and
 * adds it to that same workspace. Main resolves and confines the launch to the context's root;
 * this only carries the identity, then records what main reports.
 *
 * Never creates or registers a workspace.
 */
export async function launchTerminalInCheckoutContext(
  workspace: Pick<WorkspaceTab, 'id' | 'environmentId'>,
  checkoutContext: CheckoutContext,
  options: CheckoutContextLaunchOptions = {},
): Promise<Terminal> {
  if (checkoutContext.workspaceId !== workspace.id) {
    throw new Error('Checkout context does not belong to this workspace');
  }
  const environmentId = workspace.environmentId || 'local';
  if (checkoutContext.environmentId !== environmentId) {
    throw new Error('Checkout context belongs to a different environment');
  }

  const before = useWorkspaceStore.getState().getWorkspaceById(workspace.id);
  const pageId = options.pageId ?? before?.activePageId;
  if (!before || (pageId && before.activePageId !== pageId)) throw new Error('The destination page changed before launch');
  const reservedPaneId = useWorkspaceStore.getState().addPane(null, undefined, workspace.id);
  if (!reservedPaneId) throw new Error('Could not reserve the destination pane');
  const removeReservation = () => {
    const live = useWorkspaceStore.getState().getWorkspaceById(workspace.id);
    if (live?.panes.some((pane) => pane.id === reservedPaneId && pane.terminalId === null)) useWorkspaceStore.getState().removePane(reservedPaneId, workspace.id);
  };
  const info = await window.electronAPI.spawnTerminal(
    options.workingDir ?? checkoutContext.path,
    options.harness,
    options.model,
    options.initialCommand,
    undefined,
    workspace.id,
    environmentId,
    checkoutContext.id,
  ).catch((error: unknown) => { removeReservation(); throw error; });

  // From here a PTY exists in main. Every path that does not end with the terminal recorded on
  // its workspace must kill it, or it would run untracked.
  const abandon = async (message: string): Promise<never> => {
    await window.electronAPI.killTerminal(info.id).catch(() => undefined);
    removeReservation();
    throw new Error(message);
  };

  if (info.checkoutContextId !== checkoutContext.id) {
    // Main bound the process to some other root than the one requested: do not keep it.
    return abandon('Terminal was not launched in the requested checkout context');
  }

  // The spawn awaited; the workspace may have closed or lost the context meanwhile. Judge the
  // live store, not the snapshot this launch started from.
  const live = useWorkspaceStore.getState().getWorkspaceById(workspace.id);
  const liveContext = live ? getCheckoutContext(live, checkoutContext.id) : null;
  if (!live || !liveContext
    || (live.environmentId || 'local') !== environmentId
    || liveContext.workspaceId !== workspace.id
    || liveContext.environmentId !== checkoutContext.environmentId
    || liveContext.path !== checkoutContext.path) {
    return abandon('The workspace or checkout context was closed while the terminal was starting');
  }

  const terminal: Terminal = {
    id: info.id,
    pid: info.pid,
    workingDir: options.workingDir ?? checkoutContext.path,
    ...(options.displayName ? { displayName: options.displayName } : {}),
    workspaceId: workspace.id,
    checkoutContextId: checkoutContext.id,
    environmentId,
    harnessId: info.harnessId ?? options.harness ?? null,
    attentionEnabled: info.attentionEnabled === true,
  };
  try {
    useWorkspaceStore.getState().addTerminal(terminal, workspace.id, reservedPaneId, pageId);
  } catch (error) {
    return abandon(error instanceof Error ? error.message : 'The destination pane was closed');
  }

  // addTerminal is silent when it has no owning workspace; confirm it actually landed.
  const stored = useWorkspaceStore.getState().getWorkspaceById(workspace.id)?.terminals.find((entry) => entry.id === info.id);
  if (!stored) return abandon('The terminal could not be added to its workspace');
  return stored;
}
