import type { CheckoutContext } from '../../shared/types/checkoutContext';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { Terminal, WorkspaceTab } from '../store/workspaceTypes';

export interface CheckoutContextLaunchOptions {
  harness?: string;
  model?: string;
  initialCommand?: string;
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

  const info = await window.electronAPI.spawnTerminal(
    checkoutContext.path,
    options.harness,
    options.model,
    options.initialCommand,
    undefined,
    workspace.id,
    environmentId,
    checkoutContext.id,
  );
  if (info.checkoutContextId !== checkoutContext.id) {
    // Main bound the process to some other root than the one requested: do not keep it.
    await window.electronAPI.killTerminal(info.id).catch(() => undefined);
    throw new Error('Terminal was not launched in the requested checkout context');
  }

  const terminal: Terminal = {
    id: info.id,
    pid: info.pid,
    workingDir: checkoutContext.path,
    workspaceId: workspace.id,
    checkoutContextId: checkoutContext.id,
    environmentId,
    harnessId: info.harnessId ?? options.harness ?? null,
    attentionEnabled: info.attentionEnabled === true,
  };
  useWorkspaceStore.getState().addTerminal(terminal, workspace.id);
  return useWorkspaceStore.getState().getWorkspaceById(workspace.id)?.terminals.find((entry) => entry.id === info.id) ?? terminal;
}
