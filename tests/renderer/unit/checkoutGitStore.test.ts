import { beforeEach, describe, expect, it } from 'vitest';
import { matchingCheckoutGit, useCheckoutGitStore } from '../../../src/renderer/store/checkoutGitStore';
import type { GitStatusResult } from '../../../src/shared/types/git';
const identity = { workspaceId: 'ws', environmentId: 'local', contextId: 'ws::a', root: '/repo-worktrees/a' };
const status = (changes: GitStatusResult['changes'] = []): GitStatusResult => ({ success: true, isRepo: true, workspaceId: 'ws', environmentId: 'local', checkoutContextId: 'ws::a', workspacePath: identity.root, currentBranch: 'a', isDetached: false, changes, upstream: null, ahead: 0, behind: 0 });
beforeEach(() => useCheckoutGitStore.setState({ active: null }));
describe('bounded single active Git snapshot', () => {
  it('only a successful matched snapshot is clean; loading/error/unavailable are distinct', () => {
    const store = useCheckoutGitStore.getState(); const generation = store.begin(identity);
    expect(useCheckoutGitStore.getState().active).toMatchObject({ state: 'loading', result: null });
    store.apply(generation, { ...status(), success: false, error: 'SSH disconnected' });
    expect(useCheckoutGitStore.getState().active?.state).toBe('error');
    store.apply(generation, status()); expect(useCheckoutGitStore.getState().active).toMatchObject({ state: 'ready', result: { changes: [] } });
    store.invalidate(generation); expect(useCheckoutGitStore.getState().active).toMatchObject({ state: 'error', result: null });
    store.clear(generation); expect(useCheckoutGitStore.getState().active).toBeNull();
  });
  it.each([
    { workspaceId: 'other' }, { environmentId: 'ssh' }, { checkoutContextId: 'ws::b' }, { workspacePath: '/other-root' }, { presentationGeneration: -1 },
  ])('rejects a different authoritative identity/epoch %j', (override) => {
    const generation = useCheckoutGitStore.getState().begin(identity);
    useCheckoutGitStore.getState().apply(generation, { ...status(), ...override });
    expect(useCheckoutGitStore.getState().active?.state).toBe('loading');
  });
  it('rejects A→B→A late responses/cleanup and retains only the active snapshot', () => {
    const store = useCheckoutGitStore.getState(); const old = store.begin(identity);
    store.apply(old, status([{ path: 'same.ts', status: 'modified', staged: false }]));
    store.begin({ ...identity, contextId: 'ws::b', root: '/repo-worktrees/b' });
    const current = store.begin(identity); store.apply(old, status()); store.clear(old);
    expect(useCheckoutGitStore.getState().active).toMatchObject({ generation: current, state: 'loading', result: null });
    expect(matchingCheckoutGit(useCheckoutGitStore.getState().active, { ...identity, root: '/different' })).toBeNull();
    store.apply(current, { ...status(), presentationGeneration: current });
    expect(useCheckoutGitStore.getState().active?.state).toBe('ready');
  });
});
