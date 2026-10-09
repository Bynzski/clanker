import type { CheckoutContext } from '../../shared/types/checkoutContext';
import type { Terminal, WorkspaceTab } from '../store/workspaceTypes';
import { launchWorkspaceTerminal, type WorkspaceTerminalLaunchOptions } from './workspaceTerminalLaunch';

export type CheckoutContextLaunchOptions = WorkspaceTerminalLaunchOptions;

/**
 * Main resolves and confines this launch to the registered context's root. The shared launch
 * transaction reserves its initiating page and checks ownership/registration after the await.
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
  if (checkoutContext.environmentId !== (workspace.environmentId || 'local')) {
    throw new Error('Checkout context belongs to a different environment');
  }
  return launchWorkspaceTerminal(workspace, checkoutContext.path, options, checkoutContext);
}
