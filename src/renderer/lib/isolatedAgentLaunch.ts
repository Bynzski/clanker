import type { CheckoutContext } from '../../shared/types/checkoutContext';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { launchTerminalInCheckoutContext } from './checkoutContextLaunch';
import { resolveToolbarLaunch } from './toolbarLaunch';
import { findManagedWorktreeContext } from './worktreeAgents';

export type IsolatedAgentResult =
  | { ok: true }
  | {
    ok: false;
    error: string;
    /** A worktree checkout exists on disk even though no agent was launched into it. */
    checkoutCreated: boolean;
  };

/** Where the agent runs. Only identities cross here; main derives every root, branch and kind. */
export type IsolatedAgentTarget =
  /** A new branch from the current branch/HEAD, in a new linked worktree. */
  | { kind: 'new-branch'; branch: string }
  /** An existing local branch that has no worktree yet, in a new linked worktree. */
  | { kind: 'existing-branch'; branch: string }
  /** A linked worktree Git lists: reused if already attached, adopted through main otherwise. */
  | { kind: 'worktree'; path: string };

export interface LaunchIsolatedAgentRequest {
  /** The workspace the request was made from. */
  workspaceId: string;
  harnessId: string;
  target: IsolatedAgentTarget;
  visibleHarnessIds: readonly string[];
}

/** The original new-branch request shape, kept for callers that only create a task branch. */
export interface IsolatedAgentRequest {
  workspaceId: string;
  harnessId: string;
  taskBranch: string;
  visibleHarnessIds: readonly string[];
}

const FOCUS_CHANGED = 'The focused workspace changed; open the control again from the workspace you want';

/** The workspace exists in the live store and is the one the user is looking at. */
function isStillFocused(workspaceId: string): boolean {
  const state = useWorkspaceStore.getState();
  return state.getWorkspaceById(workspaceId) !== null && selectFocusedWorkspace(state)?.id === workspaceId;
}

const messageOf = (cause: unknown, fallback: string): string => (cause instanceof Error && cause.message ? cause.message : fallback);

type Resolved = { ok: true; context: CheckoutContext; label: string; created: boolean; attached: boolean } | { ok: false; error: string; created: boolean };

/**
 * Launches an agent in a linked worktree of the workspace, creating, reusing or adopting the
 * checkout as the target asks. It never creates a workspace and never switches the workspace's own
 * checkout.
 *
 * - `new-branch` / `existing-branch` create a worktree (main attaches the context);
 * - `worktree` reuses an attached context as is (a second agent shares it; the context is never
 *   duplicated) or asks main to adopt the listed worktree explicitly.
 *
 * Nothing is rolled back on failure. A checkout that was created stays on disk with its branch;
 * a context that was attached stays attached, so a failed launch leaves a visible, removable
 * inactive checkout instead of an invisible stranded one.
 */
export async function launchIsolatedAgent(request: LaunchIsolatedAgentRequest): Promise<IsolatedAgentResult> {
  const fail = (error: string, checkoutCreated = false): IsolatedAgentResult => ({ ok: false, error, checkoutCreated });
  const { target } = request;

  if (target.kind === 'new-branch' && !target.branch.trim()) return fail('Enter a task branch');
  if (target.kind === 'existing-branch' && !target.branch.trim()) return fail('Choose a branch');
  if (target.kind === 'worktree' && !target.path.trim()) return fail('Choose a worktree');

  // Judge the workspace as it is now, not as it was when the popover opened.
  const workspace = useWorkspaceStore.getState().getWorkspaceById(request.workspaceId);
  if (!workspace || !isStillFocused(workspace.id)) return fail(FOCUS_CHANGED);
  if (workspace.isLinkedWorktree) return fail('Isolated agents are created from the project workspace, not from a worktree workspace');

  const resolved = await resolveContext(workspace, target);
  if (!resolved.ok) return fail(resolved.error, resolved.created);
  const { context, label } = resolved;

  if (resolved.attached) {
    const store = useWorkspaceStore.getState();
    if (!store.upsertCheckoutContext(workspace.id, context)) {
      // Main registered it but this workspace no longer accepts it (e.g. it just closed). Do not leave
      // main holding a context nobody can see; the checkout itself is kept.
      await window.electronAPI.releaseCheckoutContext(workspace.id, context.id).catch(() => undefined);
      return fail(`The worktree for "${label}" ${resolved.created ? 'was created but ' : ''}could not be attached to this workspace.${resolved.created ? ' It was kept.' : ''}`, resolved.created);
    }
  }

  // Resolution awaited too. If the user moved on, an agent started now would appear in a workspace
  // they are not looking at. The checkout and its attached context are kept (nothing is deleted);
  // it is listed under its workspace as an inactive checkout.
  if (!isStillFocused(workspace.id)) {
    return fail(`The worktree for "${label}" is attached to its workspace, but focus moved to another workspace, so no agent was started. It is listed there as an inactive checkout.`, resolved.created);
  }

  const launch = resolveToolbarLaunch({
    harnessId: request.harnessId,
    visibleHarnessIds: request.visibleHarnessIds,
    workspaceHarness: workspace.harness,
    workspaceModel: workspace.model,
    environmentId: workspace.environmentId,
  });
  try {
    await launchTerminalInCheckoutContext(workspace, context, { harness: launch.harness, model: launch.model, pageId: workspace.activePageId });
  } catch (cause) {
    return fail(`The worktree for "${label}" ${resolved.created ? 'was created' : 'is attached'} but the agent could not be started: ${messageOf(cause, 'launch failed')}. It remains listed under the workspace.`, resolved.created);
  }
  return { ok: true };
}

async function resolveContext(workspace: WorkspaceTab, target: IsolatedAgentTarget): Promise<Resolved> {
  if (target.kind === 'worktree') {
    const existing = findManagedWorktreeContext(workspace, target.path);
    if (existing) return { ok: true, context: existing, label: existing.branch || 'HEAD', created: false, attached: false };
    try {
      const adopted = await window.electronAPI.adoptWorktreeCheckoutContext(workspace.id, target.path);
      if (!adopted.success || !adopted.checkoutContext) {
        return { ok: false, error: adopted.error || 'Could not use that worktree', created: false };
      }
      return { ok: true, context: adopted.checkoutContext, label: adopted.checkoutContext.branch || 'HEAD', created: false, attached: true };
    } catch (cause) {
      return { ok: false, error: messageOf(cause, 'Could not use that worktree'), created: false };
    }
  }

  const branch = target.branch.trim();
  // Read the branch state from Git now, not from what the popover showed.
  let baseRef: string;
  try {
    const branchState = await window.electronAPI.gitGetBranchState(workspace.workspacePath, workspace.id);
    if (!branchState.success || !branchState.isRepo) {
      return { ok: false, error: branchState.error || 'This workspace is not a Git repository', created: false };
    }
    if (target.kind === 'existing-branch') {
      if (!branchState.branches.some((entry: { name: string }) => entry.name === branch)) {
        return { ok: false, error: `Branch "${branch}" no longer exists`, created: false };
      }
      // For an existing branch main checks it out into the new worktree and ignores the base.
      baseRef = branch;
    } else {
      baseRef = !branchState.isDetached && branchState.currentBranch ? branchState.currentBranch : 'HEAD';
    }
  } catch (cause) {
    return { ok: false, error: messageOf(cause, 'Could not read the current branch'), created: false };
  }

  // The branch lookup awaited; do not create a checkout for a workspace the user has already left.
  if (!isStillFocused(workspace.id)) return { ok: false, error: FOCUS_CHANGED, created: false };

  let created;
  try {
    created = await window.electronAPI.gitCreateWorktree(
      workspace.workspacePath, baseRef, branch, workspace.id, { attachCheckoutContext: true },
    );
  } catch (cause) {
    return { ok: false, error: messageOf(cause, 'Could not create the worktree'), created: false };
  }
  // `created` with success false is the attach-failed case: report it, launch nothing, delete nothing.
  if (!created.success) return { ok: false, error: created.error || 'Could not create the worktree', created: created.created === true };
  if (!created.checkoutContext) {
    return {
      ok: false,
      error: `The worktree was created${created.worktree ? ` at ${created.worktree.path}` : ''} but was not attached to this workspace. It was kept.`,
      created: true,
    };
  }
  return { ok: true, context: created.checkoutContext, label: branch, created: true, attached: true };
}

/** Creates a worktree for a new task branch and launches an agent in it. */
export function createIsolatedAgent(request: IsolatedAgentRequest): Promise<IsolatedAgentResult> {
  return launchIsolatedAgent({
    workspaceId: request.workspaceId,
    harnessId: request.harnessId,
    visibleHarnessIds: request.visibleHarnessIds,
    target: { kind: 'new-branch', branch: request.taskBranch },
  });
}
