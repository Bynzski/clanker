import type { DevServiceCommand } from '../../shared/types/workspaceServices';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { launchTerminalInCheckoutContext } from './checkoutContextLaunch';

/** Fixed commands only. Never derive a shell line from project script text or a diagnostic hint. */
export function devDependencyInstallCommand(manager: DevServiceCommand['packageManager']): string {
  switch (manager) {
    case 'npm': return 'npm install';
    case 'pnpm': return 'pnpm install';
    case 'yarn': return 'yarn install';
    case 'bun': return 'bun install';
    default: throw new Error('Unsupported package manager');
  }
}

/** Explicit, confirmed setup in a visible checkout-bound shell, not a hidden background task. */
export async function installDevServiceDependencies(terminalId: string, expected: DevServiceCommand): Promise<void> {
  const findTarget = () => {
    const workspace = useWorkspaceStore.getState().getWorkspaceById(expected.workspaceId);
    const context = workspace?.checkoutContexts?.find((entry) => entry.id === expected.checkoutContextId);
    if (!workspace || (workspace.environmentId || 'local') !== 'local' || !context || context.missing || context.path !== expected.checkoutRoot
      || !workspace.terminals.some((terminal) => terminal.id === terminalId)) throw new Error('The workspace, conversation or checkout is no longer available');
    return { workspace, context };
  };
  findTarget();
  useWorkspaceStore.getState().selectWorkspace(expected.workspaceId, terminalId);
  const result = await window.electronAPI.workspaceServiceDiscover({ workspaceId: expected.workspaceId, terminalId });
  const current = result.command;
  if (!result.success || !current) throw new Error(result.error || 'Dev command is no longer available');
  if (current.workspaceId !== expected.workspaceId || current.checkoutContextId !== expected.checkoutContextId || current.checkoutRoot !== expected.checkoutRoot
    || current.cwd !== expected.cwd || current.packageManager !== expected.packageManager || current.command !== expected.command) {
    throw new Error('Checkout or package manager changed; review the new command before installing');
  }
  const { workspace, context } = findTarget();
  if (useWorkspaceStore.getState().activeWorkspaceId !== workspace.id || useAssistantNavStore.getState().activeAssistantId) {
    throw new Error('Workspace selection changed; try Install dependencies again');
  }
  await launchTerminalInCheckoutContext(workspace, context, {
    initialCommand: devDependencyInstallCommand(current.packageManager),
    workingDir: current.cwd,
    displayName: 'Install dependencies',
  });
  // addTerminal exposes the shell and selects it only if its workspace is still foreground.
  // The existing TerminalPane handshake starts the confirmed command once the shell is visible.
  // No automatic dev-server start, dependency-success inference, or persisted task state.
}
