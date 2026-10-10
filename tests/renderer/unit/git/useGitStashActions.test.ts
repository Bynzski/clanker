// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStashActions } from '../../../../src/renderer/components/git/useGitStashActions';
import { installElectronApiMock } from '../../../setup/electron';
import type { GitStash } from '../../../../src/renderer/components/git/types';

describe('useGitStashActions', () => {
  let api: ReturnType<typeof installElectronApiMock>;
  const sampleStashes: GitStash[] = [
    { ref: 'stash@{0}', hash: 'hash0', message: 'WIP on feature' },
    { ref: 'stash@{1}', hash: 'hash1', message: 'WIP on bugfix' },
  ];

  beforeEach(() => {
    api = installElectronApiMock({
      gitStash: vi.fn().mockResolvedValue({ success: true }),
      gitApplyStash: vi.fn().mockResolvedValue({ success: true }),
      gitPopStash: vi.fn().mockResolvedValue({ success: true }),
      gitDropStash: vi.fn().mockResolvedValue({ success: true }),
      gitClearStashes: vi.fn().mockResolvedValue({ success: true }),
      gitGetStashes: vi.fn().mockResolvedValue(sampleStashes),
    });
  });

  function setup(options: { isCurrent?: () => boolean } = {}) {
    const onSetActiveAction = vi.fn();
    const refreshAfterAction = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(() =>
      useGitStashActions({
        isCurrent: options.isCurrent ?? (() => true),
        onSetActiveAction,
        refreshAfterAction,
        workspacePath: '/repo',
        workspaceId: 'ws',
        stashes: sampleStashes,
      })
    );
    return { ...hook, onSetActiveAction, refreshAfterAction };
  }

  it('creates stash with message and untracked option', async () => {
    const { result, onSetActiveAction, refreshAfterAction } = setup();

    act(() => {
      result.current.setStashMessage('My WIP');
      result.current.setIncludeUntracked(true);
    });

    await act(async () => {
      await result.current.handleStash();
    });

    expect(api.gitStash).toHaveBeenCalledWith('/repo', 'My WIP', true, 'ws');
    expect(result.current.stashMessage).toBe('');
    expect(refreshAfterAction).toHaveBeenCalledOnce();
    expect(onSetActiveAction).toHaveBeenCalledWith('stash');
    expect(onSetActiveAction).toHaveBeenLastCalledWith(null);
  });

  it('applies stash without dropping it', async () => {
    const { result, refreshAfterAction } = setup();

    await act(async () => {
      await result.current.handleApplyStash('stash@{0}');
    });

    expect(api.gitApplyStash).toHaveBeenCalledWith('/repo', 'stash@{0}', 'ws');
    expect(api.gitDropStash).not.toHaveBeenCalled();
    expect(refreshAfterAction).toHaveBeenCalledOnce();
  });

  it('pops stash and refreshes on success', async () => {
    const { result, refreshAfterAction } = setup();

    await act(async () => {
      await result.current.handlePopStash('stash@{0}');
    });

    expect(api.gitPopStash).toHaveBeenCalledWith('/repo', 'stash@{0}', 'ws');
    expect(refreshAfterAction).toHaveBeenCalledOnce();
  });

  it('reports pop failure without claiming success', async () => {
    api.gitPopStash.mockResolvedValue({ success: false, error: 'Conflict applying stash' });
    const { result, refreshAfterAction } = setup();

    await act(async () => {
      await result.current.handlePopStash('stash@{0}');
    });

    expect(result.current.stashError).toBe('Conflict applying stash');
    expect(refreshAfterAction).not.toHaveBeenCalled();
  });

  it('opens drop dialog without executing drop immediately', () => {
    const { result } = setup();

    act(() => {
      result.current.handleDropStash('stash@{0}');
    });

    expect(result.current.dropDialog).toEqual(sampleStashes[0]);
    expect(api.gitDropStash).not.toHaveBeenCalled();

    act(() => {
      result.current.closeDropDialog();
    });

    expect(result.current.dropDialog).toBeNull();
    expect(api.gitDropStash).not.toHaveBeenCalled();
  });

  it('drops stash after verifying identity matches', async () => {
    const { result, refreshAfterAction } = setup();

    act(() => {
      result.current.handleDropStash('stash@{0}');
    });

    await act(async () => {
      await result.current.performDropStash();
    });

    expect(api.gitGetStashes).toHaveBeenCalledWith('/repo', 'ws');
    expect(api.gitDropStash).toHaveBeenCalledWith('/repo', 'stash@{0}', 'ws');
    expect(result.current.dropDialog).toBeNull();
    expect(refreshAfterAction).toHaveBeenCalledOnce();
  });

  it('refuses to drop if positional stash reference shifted while confirmation was pending', async () => {
    // When drop is confirmed, latest stashes return a different hash for stash@{0}
    api.gitGetStashes.mockResolvedValue([
      { ref: 'stash@{0}', hash: 'differentHash', message: 'New stash added' },
      { ref: 'stash@{1}', hash: 'hash0', message: 'WIP on feature' },
    ]);

    const { result, refreshAfterAction } = setup();

    act(() => {
      result.current.handleDropStash(sampleStashes[0]);
    });

    await act(async () => {
      await result.current.performDropStash();
    });

    expect(api.gitDropStash).not.toHaveBeenCalled();
    expect(result.current.dropDialog).toBeNull();
    expect(result.current.stashError).toContain('Stash reference changed');
    expect(refreshAfterAction).not.toHaveBeenCalled();
  });

  it('opens clear dialog, cancels without mutation, and clears on confirm', async () => {
    const { result, refreshAfterAction } = setup();

    act(() => {
      result.current.handleClearStashes();
    });

    expect(result.current.clearDialog).toBe(true);
    expect(api.gitClearStashes).not.toHaveBeenCalled();

    // Cancel
    act(() => {
      result.current.closeClearDialog();
    });
    expect(result.current.clearDialog).toBe(false);
    expect(api.gitClearStashes).not.toHaveBeenCalled();

    // Reopen and confirm
    act(() => {
      result.current.handleClearStashes();
    });

    await act(async () => {
      await result.current.performClearStashes();
    });

    expect(api.gitClearStashes).toHaveBeenCalledWith('/repo', 'ws');
    expect(result.current.clearDialog).toBe(false);
    expect(refreshAfterAction).toHaveBeenCalledOnce();
  });

  it('discards results if scope becomes non-current while operation is pending', async () => {
    let current = true;
    const { result, refreshAfterAction } = setup({ isCurrent: () => current });

    act(() => {
      result.current.handleDropStash('stash@{0}');
    });

    let finishDrop!: (val: unknown) => void;
    api.gitDropStash.mockReturnValue(new Promise((r) => { finishDrop = r; }));

    const dropPromise = act(async () => {
      await result.current.performDropStash();
    });

    current = false;
    finishDrop({ success: true });
    await dropPromise;

    expect(refreshAfterAction).not.toHaveBeenCalled();
  });
});
