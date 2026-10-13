import { beforeEach, describe, expect, it } from 'vitest';
import { checkoutGitAvailability, lastKnownCheckoutGit, matchingCheckoutGit, useCheckoutGitStore, type CheckoutGitIdentity } from '../../../src/renderer/store/checkoutGitStore';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { checkoutSelectionToken } from '../../../src/renderer/lib/checkoutSelectionRuntime';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import type { GitStatusResult } from '../../../src/shared/types/git';

const CHECKOUT_GIT_CACHE_LIMIT = 32; // Assert the documented presentation budget, not an exported implementation knob.
const git = () => useCheckoutGitStore.getState();
const ws = () => useWorkspaceStore.getState();
const A: CheckoutGitIdentity = { workspaceId: 'A', environmentId: 'local', root: '/same' };
const B: CheckoutGitIdentity = { workspaceId: 'B', environmentId: 'local', root: '/other' };
function select(identity = A) {
  if (!ws().getWorkspaceById(identity.workspaceId!)) ws().addWorkspace(createWorkspaceFixture({ id: identity.workspaceId!, environmentId: identity.environmentId,
    workspacePath: identity.root, terminals: [], panes: [], activeTerminalId: null }));
  const contextId = identity.contextId ?? `${identity.workspaceId}::main`;
  if (!ws().getWorkspaceById(identity.workspaceId!)!.checkoutContexts?.some(ctx => ctx.id === contextId)) {
    ws().upsertCheckoutContext(identity.workspaceId!, { id: contextId, workspaceId: identity.workspaceId!, environmentId: identity.environmentId, path: identity.root, kind: 'worktree' });
  }
  ws().selectWorkspace(identity.workspaceId!);
  useWorkspaceStore.setState(state => ({ workspaces: state.workspaces.map(workspace => workspace.id === identity.workspaceId ? { ...workspace, fileSurfaceContextId: contextId } : workspace) }));
  return { ...identity, selectionGeneration: checkoutSelectionToken(identity.workspaceId!) };
}
function begin(identity = A) { const selected = select(identity); return git().begin(selected); }
function result(identity: CheckoutGitIdentity, generation: number, count = 1, currentBranch = 'main'): GitStatusResult {
  return { success: true, isRepo: true, workspaceId: identity.workspaceId, environmentId: identity.environmentId, workspacePath: identity.root,
    checkoutContextId: identity.contextId, presentationGeneration: generation, currentBranch, isDetached: false,
    changes: Array.from({ length: count }, (_, index) => ({ path: `file-${index}`, status: 'modified', staged: false })), upstream: 'origin/main', ahead: 1, behind: 2 };
}
function acquire(identity = A, count = 1, branch = 'main') { const generation = begin(identity); git().apply(generation, result(identity, generation, count, branch)); return generation; }
const last = (identity = A) => lastKnownCheckoutGit(git().cache, identity);
beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useCheckoutGitStore.setState(useCheckoutGitStore.getInitialState(), true);
  installElectronApiMock();
});

describe('checkout-keyed descriptive Git LRU', () => {
  it('A→B→A reuses description, not authority, changes, workspace metadata or old generation', () => {
    const old = acquire(A, 3, 'a'); const description = last(); acquire(B, 2, 'b');
    const current = begin();
    expect(current).toBeGreaterThan(old); expect(last()).toBe(description);
    expect(git().active).toMatchObject({ generation: current, state: 'loading', result: null });
    expect(checkoutGitAvailability(git().active)).toBe('loading');
    expect(ws().getWorkspaceById('A')?.gitChanges).toEqual([]);
    expect(ws().getWorkspaceById('A')?.gitCurrentBranch).not.toBe('a');
    expect(description).toMatchObject({ currentBranch: 'a', changeCount: 3, upstream: 'origin/main', ahead: 1, behind: 2 });
    expect(description).not.toHaveProperty('changes'); expect(description).not.toHaveProperty('presentationGeneration');
    expect(description?.identity).not.toHaveProperty('selectionGeneration');
    expect(description?.acquiredAt).toBeGreaterThan(0);
    git().clear(old); expect(git().active?.generation).toBe(current);
  });

  it('rejects late old A and B answers and their cache updates after A→B→A', () => {
    const oldA = acquire(); const a = last(); const oldB = acquire(B); const b = last(B); const current = begin();
    git().apply(oldA, result(A, oldA, 7, 'wrong-a'));
    git().apply(oldB, result(B, oldB, 8, 'wrong-b'));
    git().apply(current, result(B, current, 9, 'wrong-scope'));
    expect(git().active?.state).toBe('loading'); expect(last()).toBe(a); expect(last(B)).toBe(b);
    git().apply(current, result(A, current, 2, 'new-a'));
    expect(last()).toMatchObject({ changeCount: 2, currentBranch: 'new-a' });
  });

  it('rejects a batched selection round trip before controller effects replace the old active generation', () => {
    const old = acquire(); const cached = last();
    select(B); select(A); // No begin/clear in between: React may batch both renders.
    git().apply(old, result(A, old, 99, 'obsolete'));
    expect(last()).toBe(cached); expect(git().active?.result?.currentBranch).toBe('main');
    expect(matchingCheckoutGit(git().active, { ...A, selectionGeneration: checkoutSelectionToken('A') })).toBeNull();
  });

  it('rejects an otherwise matched registered root with the new epoch but wrong live physical selection', () => {
    acquire(); const cached = last();
    const isolated = select({ ...A, contextId: 'A::isolated', root: '/isolated' });
    const wrong = git().begin({ ...A, selectionGeneration: isolated.selectionGeneration });
    git().apply(wrong, result(A, wrong, 99, 'wrong-root'));
    expect(git().active?.state).toBe('loading'); expect(last()).toBe(cached);
  });

  it('isolates same textual roots in local and two distinct SSH environments and workspaces', () => {
    const identities = [A, { ...A, workspaceId: 'SSH1', environmentId: 'ssh:one' }, { ...A, workspaceId: 'SSH2', environmentId: 'ssh:two' }, { ...A, workspaceId: 'OTHER' }];
    identities.forEach((identity, index) => acquire(identity, index, `branch-${index}`));
    identities.forEach((identity, index) => { begin(identity); expect(last(identity)).toMatchObject({ changeCount: index, currentBranch: `branch-${index}` }); });
    expect(last({ ...A, environmentId: 'ssh:one' })).toBeNull();
    expect(last({ ...A, contextId: 'foreign-context' })).toBeNull();
    expect(last({ ...A, root: '/unrelated' })).toBeNull();
    expect(git().cache).toHaveLength(4);
  });

  it('separates main and isolated contexts inside one workspace; epoch is not a cache key', () => {
    const isolated = { ...A, contextId: 'A::isolated', root: '/isolated' };
    acquire(A, 0, 'main'); acquire(isolated, 3, 'task'); const main = last(A); begin(A);
    expect(last(A)).toBe(main); expect(last(isolated)?.currentBranch).toBe('task');
    expect(last({ ...A, selectionGeneration: -999 })).toBe(main);
  });

  it('bounds entries, promotes hits and evicts least recently used descriptions; evicted selection reacquires', () => {
    acquire(A); acquire(B);
    for (let index = 2; index < CHECKOUT_GIT_CACHE_LIMIT; index++) acquire({ ...A, workspaceId: `ws-${index}` });
    begin(A); acquire({ ...A, workspaceId: 'overflow' });
    expect(git().cache).toHaveLength(CHECKOUT_GIT_CACHE_LIMIT); expect(last(A)).not.toBeNull(); expect(last(B)).toBeNull();
    const generation = begin(B); expect(checkoutGitAvailability(git().active)).toBe('loading'); expect(last(B)).toBeNull();
    git().apply(generation, result(B, generation)); expect(last(B)).not.toBeNull();
    expect(window.electronAPI.gitStartPolling).not.toHaveBeenCalled(); // Store never acquires or polls.
  });

  it.each([{ success: false }, { presentationGeneration: -1 }, { environmentId: 'wrong' }, { workspaceId: 'wrong' }, { workspacePath: '/wrong' }, { checkoutContextId: 'wrong' }])('does not poison a previous valid description with %j', override => {
    acquire(); const cached = last(); const generation = begin();
    git().apply(generation, { ...result(A, generation, 5, 'wrong'), ...override });
    expect(last()).toBe(cached);
  });

  it('keeps last-known description on failure/invalidation, but current availability is unavailable', () => {
    acquire(); const cached = last(); const generation = begin();
    git().apply(generation, { ...result(A, generation), success: false, error: 'SSH disconnected' });
    expect(checkoutGitAvailability(git().active)).toBe('unavailable'); expect(last()).toBe(cached);
    git().invalidate(generation); expect(last()).toBe(cached); expect(git().active?.result).toBeNull();
  });

  it.each([[0, 3], [3, 0]])('replaces parked dirty count %i with freshly acquired %i immediately', (oldCount, newCount) => {
    acquire(A, oldCount, 'old'); acquire(B); const generation = begin(A);
    expect(last(A)?.changeCount).toBe(oldCount);
    git().apply(generation, result(A, generation, newCount, 'new'));
    expect(git().active).toMatchObject({ state: 'ready', result: { currentBranch: 'new' } });
    expect(last()).toMatchObject({ currentBranch: 'new', changeCount: newCount });
  });

  it('caches confirmed non-repository, not a failed/unknown acquisition, and deduplicates partially staged file counts', () => {
    const generation = begin(); const payload = result(A, generation);
    git().apply(generation, { ...payload, changes: [payload.changes[0], { ...payload.changes[0], staged: true }] });
    expect(last()?.changeCount).toBe(1);
    git().apply(generation, { ...payload, success: false, isRepo: false }); expect(last()?.isRepo).toBe(true);
    git().apply(generation, { ...payload, isRepo: false, changes: [], currentBranch: null });
    expect(last()).toMatchObject({ isRepo: false, changeCount: 0, currentBranch: null });
  });

  it.each(['workspaceId', 'environmentId', 'workspacePath', 'presentationGeneration'])('requires the verified %s echo before creating history', field => {
    const generation = begin();
    git().apply(generation, { ...result(A, generation), [field]: undefined });
    expect(git().cache).toEqual([]); // Optional legacy fields may still satisfy the existing current-status contract.
  });

  it('does not cache legacy, unscoped or unregistered successful results without a verified echo/epoch', () => {
    const generation = begin(); git().apply(generation, { ...result(A, generation), presentationGeneration: undefined });
    expect(git().active?.state).toBe('ready'); expect(last()).toBeNull();
    const unregistered = git().begin({ ...A, contextId: 'A::unknown' });
    git().apply(unregistered, result({ ...A, contextId: 'A::unknown' }, unregistered)); expect(git().cache).toHaveLength(0);
  });

  it('prunes closed workspaces and never resurrects history after reopening an ID', () => {
    const generation = acquire(); ws().closeWorkspace('A'); expect(git().cache).toEqual([]);
    git().apply(generation, result(A, generation)); expect(git().cache).toEqual([]);
    begin(A); expect(last()).toBeNull();
  });

  it.each(['remove', 'missing'])('prunes a %s context, blocks description, and starts cold after re-adoption', action => {
    acquire(); const isolated = { ...A, contextId: 'A::isolated', root: '/isolated' }; const generation = acquire(isolated);
    if (action === 'remove') ws().removeCheckoutContext('A', isolated.contextId);
    else ws().upsertCheckoutContext('A', { id: isolated.contextId, workspaceId: 'A', environmentId: 'local', path: isolated.root, kind: 'worktree', missing: true });
    expect(last(isolated)).toBeNull(); expect(last(A)).not.toBeNull();
    git().apply(generation, result(isolated, generation, 8)); expect(last(isolated)).toBeNull();
    if (action === 'missing') ws().removeCheckoutContext('A', isolated.contextId);
    begin(isolated); expect(last(isolated)).toBeNull();
  });
});
