import type { GitWorktreeCreateResult, GitWorktreeListResult } from '../shared/types/git';
import type { CheckoutContext } from '../shared/types/checkoutContext';
import type { RecreateCheckoutOffer } from '../shared/types/session';
import { toPosixPath } from '../shared/pathNormalize';
import { findHarnessProvider } from './harnesses/registry';
import type { RegisteredWorkspace, WorkspaceRegistry } from './workspaceRegistry';
import { adoptListedWorktree } from './worktreeContextAttachment';
import {
  findRegisteredContext, generatedWorktreePath, routeSessionResume, type SessionCheckoutPlan, type SessionCheckoutRoot,
} from './sessionWorktrees';

export type SessionResumeTarget =
  | { kind: 'launch'; target: 'main' | 'worktree'; context: CheckoutContext | null; notice?: string }
  | { kind: 'offer'; offer: RecreateCheckoutOffer };

export interface SessionResumeTargetParams {
  registry: WorkspaceRegistry | undefined;
  workspace: RegisteredWorkspace;
  plan: SessionCheckoutPlan;
  harness: string;
  /** The session's recorded cwd as main rediscovered it (POSIX). */
  cwd: string;
  mainContext: CheckoutContext | null;
  listWorktrees?: () => Promise<GitWorktreeListResult>;
  /** Creates (and attaches) the worktree for an existing branch at its generated path. */
  recreateWorktree?: (branch: string) => Promise<GitWorktreeCreateResult>;
  recreateRequested?: boolean;
  /**
   * Re-finds the conversation in main's own history. Required before a removed worktree is offered
   * or recreated, so a renderer-named cwd cannot trigger a checkout for a conversation that does not exist.
   */
  confirmSession?: () => Promise<boolean>;
  /** Local callers confirm the directory still exists before launching into it. */
  isUsable?: (context: CheckoutContext) => boolean;
}

const label = (root: SessionCheckoutRoot): string => root.branch ?? root.path;
const harnessName = (harness: string): string => findHarnessProvider(harness)?.descriptor.name ?? harness;

/**
 * Decides where a conversation resumes, for local and SSH alike, from main's own evidence only.
 * A live worktree resumes into its registered (or Git-adopted) checkout context. A removed one
 * resumes in the main checkout when its harness is proven to cope (and says so), otherwise the
 * worktree is offered for recreation from its branch; a removed path is never the launch directory.
 */
export async function resolveSessionResumeTarget(params: SessionResumeTargetParams): Promise<SessionResumeTarget> {
  const { registry, workspace, plan, harness, mainContext } = params;
  const route = routeSessionResume(plan, params.cwd);
  if (route.kind === 'outside') throw new Error('Session working directory is outside the workspace');
  if (route.kind === 'main') return { kind: 'launch', target: 'main', context: mainContext };

  const portable = findHarnessProvider(harness)?.sessions?.resumesWithoutOriginalDirectory === true;
  const toMain = (notice: string): SessionResumeTarget => ({ kind: 'launch', target: 'main', context: mainContext, notice });
  const needsOriginal = (root: SessionCheckoutRoot, why: string): Error => new Error(
    `This conversation ran in the worktree ${label(root)}, but ${why}. ${harnessName(harness)} can only resume in the directory it started in, `
    + 'so it was not resumed in another checkout.');

  if (route.kind === 'worktree') {
    let context = registry ? findRegisteredContext(registry, workspace, plan, route.root.path) : null;
    let reason = 'its checkout could not be attached';
    if (!context && registry && params.listWorktrees) {
      const adopted = await adoptListedWorktree({ registry, workspace, worktreePath: route.root.path, listWorktrees: params.listWorktrees });
      if (adopted.success && adopted.checkoutContext) context = adopted.checkoutContext;
      else reason = adopted.error ?? reason;
    }
    if (registry?.getWorkspace(workspace.workspaceId) !== workspace) throw new Error('Workspace closed while resuming');
    if (context && (params.isUsable?.(context) ?? true)) return { kind: 'launch', target: 'worktree', context };
    if (context) reason = 'its directory is missing';
    if (!portable) throw needsOriginal(route.root, `that worktree could not be used (${reason})`);
    return toMain(`The worktree for ${label(route.root)} could not be used (${reason}), so it resumed in the main checkout.`);
  }

  // The worktree is gone.
  if (portable) {
    return toMain(`The worktree this conversation ran in (${label(route.root)}) was removed, so it resumed in the main checkout.`);
  }
  const { root } = route;
  const branch = root.branch;
  if (!branch) throw needsOriginal(root, 'that worktree was removed and its branch is not known, so it cannot be recreated');
  if (!plan.localBranches.has(branch)) throw needsOriginal(root, `that worktree was removed and its branch "${branch}" no longer exists, so it cannot be recreated`);
  const expected = plan.container ? generatedWorktreePath(plan.container, branch) : null;
  if (!expected || toPosixPath(expected) !== root.path) {
    throw needsOriginal(root, 'that worktree was removed and was not one Clanker generated, so its original directory cannot be recreated');
  }
  if (params.confirmSession && !(await params.confirmSession())) throw new Error('Session was not found in this workspace');
  if (params.recreateRequested !== true) return { kind: 'offer', offer: { branch, path: root.path } };
  if (!params.recreateWorktree) throw needsOriginal(root, 'recreating worktrees is unavailable here');
  const created = await params.recreateWorktree(branch);
  if (registry?.getWorkspace(workspace.workspaceId) !== workspace) throw new Error('Workspace closed while resuming');
  if (!created.success || !created.checkoutContext || !created.worktree
    || plan.canonical(toPosixPath(created.worktree.path)) !== root.path || plan.canonical(created.checkoutContext.path) !== root.path) {
    throw new Error(created.error || `The worktree for ${branch} could not be recreated at its original location`);
  }
  if (params.isUsable && !params.isUsable(created.checkoutContext)) throw new Error('The recreated worktree directory is missing');
  return {
    kind: 'launch', target: 'worktree', context: created.checkoutContext,
    notice: `Recreated the worktree for ${branch} and resumed there.`,
  };
}

/**
 * Whether `context` is still the registered checkout it was resolved to. Compared by identity
 * fields, not object identity: attaching and recreating hand back a copy of the registered context.
 */
export function isCurrentCheckoutContext(registry: WorkspaceRegistry | undefined, context: CheckoutContext | null): boolean {
  if (!registry || !context) return true;
  const current = registry.getCheckoutContext(context.id);
  return Boolean(current) && current!.workspaceId === context.workspaceId && current!.environmentId === context.environmentId
    && current!.path === context.path && current!.kind === context.kind;
}
