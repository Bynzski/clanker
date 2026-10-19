import type { AgentAttentionSnapshot } from '../shared/types/agentAttention';
import type { GitWorktreeListResult } from '../shared/types/git';
import type { ObservedWorktreeResult } from '../shared/types/observedWorktree';
import { toPosixPath } from '../shared/pathNormalize';
import { isSameWorkspaceIdentity } from '../shared/workspaceIdentity';
import { locateCheckoutContext } from './agentLocation';
import { adoptListedWorktree } from './worktreeContextAttachment';
import { canonicalCheckoutDirectory, verifyListedWorktreeIdentity } from './worktreeIdentity';
import type { RegisteredWorkspace, WorkspaceRegistry } from './workspaceRegistry';

type ObservedTerminal = { workspaceId?: string; environmentId?: string };
interface Dependencies {
  registry: WorkspaceRegistry;
  getTerminal(id: string): ObservedTerminal | undefined;
  snapshot(id: string): AgentAttentionSnapshot | null;
  listWorktrees(workspace: RegisteredWorkspace): Promise<GitWorktreeListResult>;
  isAvailable?: () => boolean;
}

/** A bounded, read-only lookup plus a separate explicit attachment. Identity is derived from
 * main's live terminal/broker tables, never a renderer-supplied directory or workspace. */
export class ObservedWorktreeService {
  private readonly pending = new Map<string, Promise<ObservedWorktreeResult>>();
  private readonly attaching = new Set<string>();
  constructor(private readonly deps: Dependencies) {}

  inspect(terminalId: unknown, revision: unknown): Promise<ObservedWorktreeResult> {
    if (typeof terminalId !== 'string' || !terminalId || terminalId.length > 128 || !Number.isSafeInteger(revision)) {
      return Promise.resolve({ success: false, error: 'Invalid agent observation' });
    }
    const key = `${terminalId}:${revision}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.pending.size >= 16) return Promise.resolve({ success: false, error: 'Checkout discovery is busy; retry shortly' });
    const run = this.resolve(terminalId, revision, false).finally(() => this.pending.delete(key));
    this.pending.set(key, run);
    return run;
  }

  attach(terminalId: unknown, revision: unknown, expected: unknown): Promise<ObservedWorktreeResult> {
    // Expectations only reject stale confirmations; they never select a root. Main rediscovers it.
    if (!expected || typeof expected !== 'object' || !('path' in expected) || typeof expected.path !== 'string'
      || !('branch' in expected) || (expected.branch !== null && typeof expected.branch !== 'string')) {
      return Promise.resolve({ success: false, error: 'Discover and confirm the worktree first' });
    }
    if (typeof terminalId !== 'string' || terminalId.length > 128 || this.attaching.has(terminalId) || this.attaching.size >= 16) {
      return Promise.resolve({ success: false, error: 'Checkout attachment is busy; retry shortly' });
    }
    this.attaching.add(terminalId);
    return this.resolve(terminalId, revision, true, { path: expected.path, branch: expected.branch }).finally(() => this.attaching.delete(terminalId));
  }

  private async resolve(terminalId: unknown, revision: unknown, attach: boolean, expected?: { path: string; branch: string | null }): Promise<ObservedWorktreeResult> {
    const fail = (error: string): ObservedWorktreeResult => ({ success: false, error });
    const { registry } = this.deps;
    if (typeof terminalId !== 'string' || !terminalId || terminalId.length > 128 || !Number.isSafeInteger(revision)) return fail('Invalid agent observation');
    const terminal = this.deps.getTerminal(terminalId);
    const workspace = terminal?.workspaceId ? registry.getWorkspace(terminal.workspaceId) : null;
    const initial = this.deps.snapshot(terminalId);
    if (this.deps.isAvailable?.() === false || !terminal || !workspace || !initial?.location || initial.revision !== revision
      || initial.locationProvenance?.state !== 'current' || !initial.sessionId
      || initial.locationProvenance.sessionId !== initial.sessionId
      || (terminal.environmentId ?? 'local') !== workspace.location.environmentId) return fail('The current agent location is unavailable; refresh and retry');
    const isCurrent = () => {
      const now = this.deps.snapshot(terminalId);
      return this.deps.isAvailable?.() !== false && this.deps.getTerminal(terminalId) === terminal && registry.getWorkspace(workspace.workspaceId) === workspace
        && now?.revision === revision && now.sessionId === initial.sessionId
        && now.locationProvenance?.state === 'current' && now.locationProvenance.sessionId === initial.sessionId
        && now.location?.path === initial.location?.path && now.location?.checkoutContextId === initial.location?.checkoutContextId;
    };
    try {
      const listing = await this.deps.listWorktrees(workspace);
      if (!isCurrent()) return fail('The agent location changed; refresh and retry');
      if (!listing.success) return fail(listing.error || 'Git could not discover the agent checkout');
      if (listing.worktrees.length > 256) return fail('Checkout discovery exceeded its worktree limit');
      const location = await canonicalCheckoutDirectory(workspace, initial.location.path);
      // Check ALL listed roots, including main. An unregistered nested worktree must win over
      // main's containment match, but an ordinary subdirectory must never become a new root.
      const contexts = listing.worktrees.map((entry, index) => ({ id: String(index), workspaceId: workspace.workspaceId,
        environmentId: workspace.location.environmentId, path: toPosixPath(entry.path), kind: entry.isMain ? 'main' as const : 'worktree' as const }));
      const containing = locateCheckoutContext(location, contexts, workspace.location.environmentId === 'local' ? 'local' : 'remote');
      const listed = containing ? listing.worktrees[Number(containing.id)] : null;
      if (!listed || listed.isMain || listed.isPrunable || isSameWorkspaceIdentity(workspace.location,
        { environmentId: workspace.location.environmentId, path: toPosixPath(listed.path) })) return { success: true };
      const recorded = initial.location.checkoutContextId ? registry.resolveCheckoutContext(workspace.workspaceId, initial.location.checkoutContextId) : null;
      if (recorded && !recorded.missing && isSameWorkspaceIdentity(recorded,
        { environmentId: workspace.location.environmentId, path: toPosixPath(listed.path) })) return { success: true };
      if (registry.isCheckoutPathReserved(workspace.location.environmentId, listed.path)) return fail('This checkout is being removed or awaiting recovery');
      await verifyListedWorktreeIdentity(workspace, toPosixPath(listed.path));
      if (!isCurrent()) return fail('The agent location changed; refresh and retry');
      const candidate = { path: toPosixPath(listed.path), branch: listed.branch, locked: listed.isLocked, lockReason: listed.lockReason };
      if (!attach) return { success: true, candidate };
      if (expected?.path !== candidate.path || expected.branch !== candidate.branch) return fail('The worktree changed; discover it again before attaching');
      if (listed.isLocked) return fail('The worktree is locked. Clanker will not unlock a harness worktree to attach it.');
      const result = await adoptListedWorktree({ registry, workspace, worktreePath: candidate.path, expectedBranch: candidate.branch,
        isCurrent, listWorktrees: () => this.deps.listWorktrees(workspace) });
      return result;
    } catch (error) { return fail(error instanceof Error ? error.message : 'Checkout discovery failed'); }
  }
}
