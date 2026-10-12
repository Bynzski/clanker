import type { CheckoutContext } from '../../shared/types/checkoutContext';
import type { GitWorktree } from '../../shared/types/git';
import { isSameWorkspaceIdentity } from '../../shared/workspaceIdentity';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { findRegisteredWorktreeContext, isCheckoutContextInUse } from './worktreeAgents';

/** Why a listed worktree is or is not a usable destination, as the picker words it. */
export type WorktreeChoiceState = 'available' | 'in-use' | 'missing' | 'locked';

export interface WorktreeChoice {
  /** The path Git lists; the only thing sent back to main to select it. */
  path: string;
  branch: string | null;
  /** Branch, or the directory name for a detached checkout. */
  label: string;
  state: WorktreeChoiceState;
  /** Missing and locked checkouts are repaired in the Git menu, never launched into. */
  disabled: boolean;
  /** Descriptive registration for occupancy; selection always revalidates through main. */
  managed: CheckoutContext | null;
}

export interface SessionLaunchChoices {
  /** Local branches that have no worktree yet, so a new linked worktree can be created for them. */
  branches: string[];
  worktrees: WorktreeChoice[];
}

export const WORKTREE_STATE_LABEL: Record<WorktreeChoiceState, string> = {
  available: 'Available',
  'in-use': 'In use',
  missing: 'Missing',
  locked: 'Locked',
};

const baseName = (value: string): string => value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || value;

/**
 * Explicit session destinations, derived from Git's worktree list plus the
 * branch list. A branch that already has a worktree (main's current branch included) appears only
 * as that worktree, never also as a branch Git would refuse to check out a second time.
 */
export function buildSessionLaunchChoices(params: {
  workspace: Pick<WorkspaceTab, 'id' | 'environmentId' | 'workspacePath' | 'checkoutContexts' | 'terminals'>;
  branchNames: readonly string[];
  currentBranch: string | null;
  worktrees: readonly GitWorktree[];
}): SessionLaunchChoices {
  const { workspace, branchNames, currentBranch, worktrees } = params;
  const environmentId = workspace.environmentId || 'local';

  const taken = new Set<string>();
  if (currentBranch) taken.add(currentBranch);
  for (const entry of worktrees) if (entry.branch) taken.add(entry.branch);

  const choices: WorktreeChoice[] = [];
  for (const entry of worktrees) {
    if (entry.isMain) continue;
    // The workspace's own root (a legacy linked-worktree workspace) is not a separate destination.
    if (isSameWorkspaceIdentity({ environmentId, path: entry.path }, { environmentId, path: workspace.workspacePath })) continue;
    const managed = findRegisteredWorktreeContext(workspace, entry.path);
    const state: WorktreeChoiceState = entry.isPrunable ? 'missing'
      : entry.isLocked ? 'locked'
        : isCheckoutContextInUse(workspace, managed ?? { id: '', path: entry.path }) ? 'in-use'
          : 'available';
    choices.push({
      path: entry.path,
      branch: entry.branch,
      label: entry.branch ?? baseName(entry.path),
      state,
      disabled: state === 'missing' || state === 'locked',
      managed,
    });
  }

  return { branches: branchNames.filter((name) => !taken.has(name)), worktrees: choices };
}
