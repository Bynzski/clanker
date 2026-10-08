import type { CheckoutContext } from '../../shared/types/checkoutContext';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
import type { Terminal, WorkspaceTab } from '../store/workspaceTypes';
import { useWorkspaceStore } from '../store/workspaceStore';
import { getCheckoutContext } from './checkoutContexts';

export interface WorkspaceTerminalLaunchOptions {
  harness?: string;
  model?: string;
  initialCommand?: string;
  workingDir?: string;
  displayName?: string;
  /** Capture before any asynchronous work leading to the launch. */
  pageId?: string;
}

/** Shared launch transaction: reserve presentation first; never leave a returned PTY untracked. */
export async function launchWorkspaceTerminal(
  workspace: Pick<WorkspaceTab, 'id' | 'environmentId'>,
  root: string,
  options: WorkspaceTerminalLaunchOptions = {},
  checkoutContext?: CheckoutContext,
): Promise<Terminal> {
  const environmentId = workspace.environmentId || 'local';
  const before = useWorkspaceStore.getState().getWorkspaceById(workspace.id);
  const pageId = options.pageId ?? before?.activePageId;
  if (!before || (before.environmentId || 'local') !== environmentId
    || (pageId && !before.pages?.some((page) => page.id === pageId))
    || (!checkoutContext && before.workspacePath !== root)) throw new Error('The launch destination changed before launch');
  const reservedPaneId = useWorkspaceStore.getState().addPane(null, undefined, workspace.id, pageId);
  if (!reservedPaneId) throw new Error('Could not reserve the destination pane');
  const removeReservation = () => {
    const live = useWorkspaceStore.getState().getWorkspaceById(workspace.id);
    if (live?.panes.some((pane) => pane.id === reservedPaneId && pane.terminalId === null)) {
      useWorkspaceStore.getState().removePane(reservedPaneId, workspace.id);
    }
  };
  // Preserve the ordinary launch's implicit main-context IPC contract.
  const args = [options.workingDir ?? root, options.harness, options.model, options.initialCommand,
    undefined, workspace.id, environmentId] as const;
  const info = await (checkoutContext
    ? window.electronAPI.spawnTerminal(...args, checkoutContext.id)
    : window.electronAPI.spawnTerminal(...args)).catch((error: unknown) => { removeReservation(); throw error; });

  const abandon = async (message: string): Promise<never> => {
    try {
      const result = await window.electronAPI.killTerminal(info.id);
      if (!result.success) throw new Error(result.error || 'Terminal retirement request failed');
    } catch (error) {
      // The IPC acknowledgment accepts retirement; it does not prove that the process has exited.
      console.error(`Failed to clean up unregistered terminal ${info.id}:`, error);
    }
    removeReservation();
    throw new Error(message);
  };
  const expectedContextId = checkoutContext?.id ?? mainCheckoutContextId(workspace.id);
  if ((checkoutContext && info.checkoutContextId !== expectedContextId)
    || (info.checkoutContextId && info.checkoutContextId !== expectedContextId)) {
    return abandon('Terminal was not launched in the requested checkout context');
  }
  const live = useWorkspaceStore.getState().getWorkspaceById(workspace.id);
  const liveContext = live && checkoutContext ? getCheckoutContext(live, checkoutContext.id) : null;
  if (!live || (live.environmentId || 'local') !== environmentId || live.workspacePath !== before.workspacePath
    || (checkoutContext && (!liveContext || liveContext.workspaceId !== workspace.id
      || liveContext.environmentId !== checkoutContext.environmentId || liveContext.path !== checkoutContext.path))) {
    return abandon('The workspace or checkout context was closed while the terminal was starting');
  }
  const terminal: Terminal = {
    id: info.id, pid: info.pid, workingDir: options.workingDir ?? root,
    ...(options.displayName ? { displayName: options.displayName } : {}),
    workspaceId: workspace.id,
    checkoutContextId: checkoutContext?.id ?? info.checkoutContextId,
    environmentId,
    harnessId: info.harnessId ?? options.harness ?? null,
    attentionEnabled: info.attentionEnabled === true,
  };
  try {
    useWorkspaceStore.getState().addTerminal(terminal, workspace.id, reservedPaneId, pageId);
  } catch (error) {
    return abandon(error instanceof Error ? error.message : 'The destination pane was closed');
  }
  const stored = useWorkspaceStore.getState().getWorkspaceById(workspace.id)?.terminals.find((entry) => entry.id === info.id);
  if (!stored) return abandon('The terminal could not be added to its workspace');
  return stored;
}
