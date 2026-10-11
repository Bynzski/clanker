import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installElectronApiMock } from '../../../setup/electron';
import { useGitRemoteActions } from '../../../../src/renderer/components/git/useGitRemoteActions';
import { useGitBranchActions } from '../../../../src/renderer/components/git/useGitBranchActions';

let api: ReturnType<typeof installElectronApiMock>;
beforeEach(() => {
  api = installElectronApiMock({
    gitPush: vi.fn().mockResolvedValue({ success: true }),
    gitPull: vi.fn().mockResolvedValue({ success: true }),
    gitFetch: vi.fn().mockResolvedValue({ success: true }),
    gitCreateBranch: vi.fn().mockResolvedValue({ success: true }),
  });
});

function setup() {
  let current = true;
  const refreshAfterAction = vi.fn().mockResolvedValue(undefined);
  const loadRemotes = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(({ checkoutContextId }) => useGitRemoteActions({
    isCurrent: () => current,
    workspacePath: '/repo', workspaceId: 'ws', checkoutContextId,
    currentBranch: 'feature-a', remotes: [], refreshAfterAction, loadRemotes,
  }), { initialProps: { checkoutContextId: 'a' } });
  return { ...hook, refreshAfterAction, loadRemotes, retire: () => { current = false; } };
}

describe('checkout-bound remote actions', () => {
  it('passes the originating identity to push, publish, pull and repository-wide fetch', async () => {
    const { result } = setup();
    await act(() => result.current.handlePush());
    expect(api.gitPush).toHaveBeenLastCalledWith('/repo', undefined, undefined, undefined, undefined, 'ws', 'a');
    await act(() => result.current.handlePublish());
    expect(api.gitPush).toHaveBeenLastCalledWith('/repo', 'origin', 'feature-a', false, true, 'ws', 'a');
    await act(() => result.current.handlePull());
    expect(api.gitPull).toHaveBeenCalledWith('/repo', undefined, 'ws', 'a');
    await act(() => result.current.handleFetch());
    expect(api.gitFetch).toHaveBeenCalledWith('/repo', undefined, 'ws', 'a');
  });

  it.each(['success', 'failure', 'throw'] as const)('discards stale %s completions and blocks overlapping operations', async (outcome) => {
    let resolve!: (value: { success: boolean; error?: string }) => void;
    let reject!: (error: Error) => void;
    vi.mocked(api.gitPush).mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
    const { result, rerender, refreshAfterAction, loadRemotes } = setup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.handlePublish(); });
    await act(() => result.current.handleFetch());
    expect(api.gitFetch).not.toHaveBeenCalled();
    rerender({ checkoutContextId: 'b' });
    await act(async () => {
      if (outcome === 'throw') reject(new Error('Old rejection'));
      else resolve({ success: outcome === 'success', error: 'Old failure' });
      await pending;
    });
    expect(refreshAfterAction).not.toHaveBeenCalled();
    expect(loadRemotes).not.toHaveBeenCalled();
    expect(result.current.remoteError).toBeNull();
  });

  it('does not revive an old request after A → B → A', async () => {
    let finish!: (value: { success: boolean }) => void;
    vi.mocked(api.gitPush).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result, rerender, refreshAfterAction } = setup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.handlePush(); });
    rerender({ checkoutContextId: 'b' });
    rerender({ checkoutContextId: 'a' });
    await act(async () => { finish({ success: true }); await pending; });
    expect(refreshAfterAction).not.toHaveBeenCalled();
    expect(result.current.remoteAction).toBeNull();
  });

  it('does not start publish follow-up loading after a scope change during refresh', async () => {
    let finish!: () => void;
    const { result, retire, refreshAfterAction, loadRemotes } = setup();
    refreshAfterAction.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.handlePublish(); await Promise.resolve(); });
    retire();
    await act(async () => { finish(); await pending; });
    expect(loadRemotes).not.toHaveBeenCalled();
  });
});

it('passes the selected checkout identity when creating a branch', async () => {
  const hook = renderHook(() => useGitBranchActions({
    activeAction: null, currentBranch: 'feature-a', onSetActiveAction: vi.fn(),
    refreshAfterAction: vi.fn().mockResolvedValue(undefined),
    workspacePath: '/repo', workspaceId: 'ws', checkoutContextId: 'a',
  }));
  act(() => hook.result.current.setNewBranchName('new-a'));
  await act(() => hook.result.current.handleCreateBranch({ preventDefault: vi.fn() } as unknown as React.FormEvent));
  expect(api.gitCreateBranch).toHaveBeenCalledWith('/repo', 'new-a', 'feature-a', 'ws', 'a');
});
