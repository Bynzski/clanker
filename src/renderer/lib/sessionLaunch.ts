import { createMainCheckoutContext, mainCheckoutContextId } from '../../shared/checkoutContext';
import type { CheckoutContext } from '../../shared/types/checkoutContext';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { launchTerminalInCheckoutContext } from './checkoutContextLaunch';
import { launchWorkspaceTerminal } from './workspaceTerminalLaunch';
import { resolveToolbarLaunch } from './toolbarLaunch';
import { isWorktreeRemovalWorkspaceCurrent } from './worktreeRemovalScope';

export type SessionLaunchResult =
  | { ok: true }
  | {
    ok: false;
    error: string;
    /** A worktree checkout exists on disk even though no agent was launched into it. */
    checkoutCreated: boolean;
  };

/** Where the new session runs. Only identities cross here; main derives every root, branch and kind. */
export type SessionLaunchTarget =
  | { kind: 'main' }
  /** A new branch from the explicitly chosen committed HEAD, in a new linked worktree. */
  | { kind: 'new-branch'; branch: string; baseWorktree?: { path: string; branch: string | null } }
  /** An existing local branch that has no worktree yet, in a new linked worktree. */
  | { kind: 'existing-branch'; branch: string }
  /** A linked worktree Git lists: freshly validated by main, including an already registered root. */
  | { kind: 'worktree'; path: string; expectedBranch?: string | null };

export interface LaunchSessionRequest {
  /** Explicitly create a checkout ahead of time without starting any process. */
  createOnly?: boolean;
  /** The workspace the request was made from. */
  workspaceId: string;
  harnessId: string;
  target: SessionLaunchTarget;
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
 * Starts a new session at an explicit target without moving existing sessions. Main validates
 * every worktree selection; repeated selections share the same registered root. Creating a
 * worktree never switches the project checkout. Failed launches keep created checkouts/branches
 * for inspection and manual management in Source Control.
 */
export async function launchSession(request: LaunchSessionRequest): Promise<SessionLaunchResult> {
  const fail = (error: string, checkoutCreated = false): SessionLaunchResult => ({ ok: false, error, checkoutCreated });
  const { target } = request;
  if (request.createOnly && (target.kind === 'worktree' || target.kind === 'main')) return fail('Choose a new or existing branch to create a checkout');

  if (target.kind === 'new-branch' && !target.branch.trim()) return fail('Enter a task branch');
  if (target.kind === 'existing-branch' && !target.branch.trim()) return fail('Choose a branch');
  if (target.kind === 'worktree' && !target.path.trim()) return fail('Choose a worktree');

  // Judge the workspace as it is now, not as it was when the popover opened.
  const workspace = useWorkspaceStore.getState().getWorkspaceById(request.workspaceId);
  if (!workspace || !workspace.workspacePath || !isStillFocused(workspace.id)) return fail(FOCUS_CHANGED);
  if (workspace.isLinkedWorktree && target.kind !== 'main') return fail('Create worktrees from the project workspace');
  if (request.harnessId && !request.visibleHarnessIds.includes(request.harnessId)) return fail('That harness is no longer available');

  const resolved = await resolveContext(workspace, target);
  if (!resolved.ok) return fail(resolved.error, resolved.created);
  const { context, label } = resolved;
  if (!isWorktreeRemovalWorkspaceCurrent(workspace)) return fail(FOCUS_CHANGED, resolved.created);

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
  // it stays discoverable in New Agent and Source Control.
  if (!isStillFocused(workspace.id)) {
    if (target.kind === 'main') return fail(FOCUS_CHANGED);
    return fail(`The worktree for "${label}" is attached to its workspace, but focus moved to another workspace, so no agent was started. Find it in New Agent or Source Control → Worktrees.`, resolved.created);
  }

  if (request.createOnly) return { ok: true };

  const launch = resolveToolbarLaunch({
    harnessId: request.harnessId,
    visibleHarnessIds: request.visibleHarnessIds,
    workspaceHarness: workspace.harness,
    workspaceModel: workspace.model,
    environmentId: workspace.environmentId,
  });
  try {
    const options = { harness: launch.harness, model: launch.model, pageId: workspace.activePageId };
    if (target.kind === 'main') await launchWorkspaceTerminal(workspace, workspace.workspacePath, options);
    else await launchTerminalInCheckoutContext(workspace, context, options);
  } catch (cause) {
    if (target.kind === 'main') return fail(`Could not start a session in main: ${messageOf(cause, 'launch failed')}`);
    return fail(`The worktree for "${label}" ${resolved.created ? 'was created' : 'is attached'} but the agent could not be started: ${messageOf(cause, 'launch failed')}. Find it in New Agent or Source Control → Worktrees.`, resolved.created);
  }
  return { ok: true };
}

async function resolveContext(workspace: WorkspaceTab, target: SessionLaunchTarget): Promise<Resolved> {
  if (target.kind === 'main') {
    const context = workspace.checkoutContexts?.find((entry) => entry.id === mainCheckoutContextId(workspace.id))
      ?? createMainCheckoutContext({ workspaceId: workspace.id, environmentId: workspace.environmentId, path: workspace.workspacePath });
    return context ? { ok: true, context, label: 'main checkout', created: false, attached: false }
      : { ok: false, error: 'The main checkout is not registered', created: false };
  }
  if (target.kind === 'worktree') {
    try {
      const adopted = await window.electronAPI.adoptWorktreeCheckoutContext(workspace.id, target.path, target.expectedBranch);
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
      baseRef = 'HEAD';
    }
  } catch (cause) {
    return { ok: false, error: messageOf(cause, 'Could not read the current branch'), created: false };
  }

  // The branch lookup awaited; do not create a checkout for a workspace the user has already left.
  if (!isStillFocused(workspace.id)) return { ok: false, error: FOCUS_CHANGED, created: false };

  let created;
  try {
    created = await window.electronAPI.gitCreateWorktree(
      workspace.workspacePath, baseRef, branch, workspace.id, { attachCheckoutContext: true,
        ...(target.kind === 'new-branch' ? { newBranch: { ...(target.baseWorktree ? { baseWorktree: target.baseWorktree } : {}) } } : { requireExistingBranch: true }),
      },
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
