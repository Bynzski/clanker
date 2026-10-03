import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import { launchTerminalInCheckoutContext } from './checkoutContextLaunch';
import { resolveToolbarLaunch } from './toolbarLaunch';

export type IsolatedAgentResult =
  | { ok: true }
  | {
    ok: false;
    error: string;
    /** A worktree checkout exists on disk even though no agent was launched into it. */
    checkoutCreated: boolean;
  };

export interface IsolatedAgentRequest {
  /** The workspace the request was made from. */
  workspaceId: string;
  harnessId: string;
  taskBranch: string;
  visibleHarnessIds: readonly string[];
}

const messageOf = (cause: unknown, fallback: string): string => (cause instanceof Error && cause.message ? cause.message : fallback);

/**
 * Creates a worktree for a task branch, attaches it to the workspace as a checkout context and
 * launches an agent in it. It never creates a workspace.
 *
 * Nothing is rolled back on failure. A checkout that was created stays on disk with its branch;
 * a context that was attached stays attached, so a failed launch leaves a visible, removable
 * inactive checkout instead of an invisible stranded one.
 */
export async function createIsolatedAgent(request: IsolatedAgentRequest): Promise<IsolatedAgentResult> {
  const fail = (error: string, checkoutCreated = false): IsolatedAgentResult => ({ ok: false, error, checkoutCreated });

  const taskBranch = request.taskBranch.trim();
  if (!taskBranch) return fail('Enter a task branch');

  // Judge the workspace as it is now, not as it was when the popover opened.
  const state = useWorkspaceStore.getState();
  const workspace = state.getWorkspaceById(request.workspaceId);
  if (!workspace || selectFocusedWorkspace(state)?.id !== workspace.id) {
    return fail('The focused workspace changed; open the control again from the workspace you want');
  }
  if (workspace.isLinkedWorktree) return fail('Isolated agents are created from the project workspace, not from a worktree workspace');

  // The base is the branch actually checked out now, from Git rather than from displayed state.
  let baseRef: string;
  try {
    const branchState = await window.electronAPI.gitGetBranchState(workspace.workspacePath, workspace.id);
    if (!branchState.success || !branchState.isRepo) return fail(branchState.error || 'This workspace is not a Git repository');
    baseRef = !branchState.isDetached && branchState.currentBranch ? branchState.currentBranch : 'HEAD';
  } catch (cause) {
    return fail(messageOf(cause, 'Could not read the current branch'));
  }

  let created;
  try {
    created = await window.electronAPI.gitCreateWorktree(
      workspace.workspacePath, baseRef, taskBranch, workspace.id, { attachCheckoutContext: true },
    );
  } catch (cause) {
    return fail(messageOf(cause, 'Could not create the worktree'));
  }
  // `created` with success false is the attach-failed case: report it, launch nothing, delete nothing.
  if (!created.success) return fail(created.error || 'Could not create the worktree', created.created === true);
  const checkoutContext = created.checkoutContext;
  if (!checkoutContext) {
    return fail(`The worktree was created${created.worktree ? ` at ${created.worktree.path}` : ''} but was not attached to this workspace. It was kept.`, true);
  }

  const store = useWorkspaceStore.getState();
  if (!store.upsertCheckoutContext(workspace.id, checkoutContext)) {
    // Main registered it but this workspace no longer accepts it (e.g. it just closed). Do not leave
    // main holding a context nobody can see; the checkout itself is kept.
    await window.electronAPI.releaseCheckoutContext(workspace.id, checkoutContext.id).catch(() => undefined);
    return fail('The worktree was created but could not be attached to this workspace. It was kept.', true);
  }

  const launch = resolveToolbarLaunch({
    harnessId: request.harnessId,
    visibleHarnessIds: request.visibleHarnessIds,
    workspaceHarness: workspace.harness,
    workspaceModel: workspace.model,
    environmentId: workspace.environmentId,
  });
  try {
    await launchTerminalInCheckoutContext(workspace, checkoutContext, { harness: launch.harness, model: launch.model });
  } catch (cause) {
    return fail(`The worktree for "${taskBranch}" was created but the agent could not be started: ${messageOf(cause, 'launch failed')}. It remains listed under the workspace.`, true);
  }
  return { ok: true };
}
