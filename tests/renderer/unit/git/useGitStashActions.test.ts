// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStashActions } from '../../../../src/renderer/components/git/useGitStashActions';
import { installElectronApiMock } from '../../../setup/electron';
import type { GitStash } from '../../../../src/renderer/components/git/types';

describe('useGitStashActions', () => {
  let api: ReturnType<typeof installElectronApiMock>;
  const sampleStashes: GitStash[] = [
    { ref: 'stash@{0}', hash: 'hash000000000000000000000000000000000000', message: 'WIP on feature' },
    { ref: 'stash@{1}', hash: 'hash111111111111111111111111111111111111', message: 'WIP on bugfix' },
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

  it('applies stash passing verified commit identity', async () => {
    const { result, refreshAfterAction } = setup();

    await act(async () => {
      await result.current.handleApplyStash(sampleStashes[0]);
    });

    expect(api.gitApplyStash).toHaveBeenCalledWith('/repo', 'stash@{0}', sampleStashes[0].hash, 'ws');
    expect(api.gitDropStash).not.toHaveBeenCalled();
    expect(refreshAfterAction).toHaveBeenCalledOnce();
  });

  it('refuses to apply stash with empty or missing commit hash', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.handleApplyStash({ ref: 'stash@{0}', hash: '', message: 'empty' });
    });

    expect(api.gitApplyStash).not.toHaveBeenCalled();
    expect(result.current.stashError).toContain('without verified commit identity');
  });

  it('pops stash passing verified commit identity', async () => {
    const { result, refreshAfterAction } = setup();

    await act(async () => {
      await result.current.handlePopStash(sampleStashes[0]);
    });

    expect(api.gitPopStash).toHaveBeenCalledWith('/repo', 'stash@{0}', sampleStashes[0].hash, 'ws');
    expect(refreshAfterAction).toHaveBeenCalledOnce();
  });

  it('refuses to pop stash with empty or missing commit hash', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.handlePopStash({ ref: 'stash@{0}', hash: '   ', message: 'empty' });
    });

    expect(api.gitPopStash).not.toHaveBeenCalled();
    expect(result.current.stashError).toContain('without verified commit identity');
  });

  it('reports pop failure without claiming success', async () => {
    api.gitPopStash.mockResolvedValue({ success: false, error: 'Conflict applying stash' });
    const { result, refreshAfterAction } = setup();

    await act(async () => {
      await result.current.handlePopStash(sampleStashes[0]);
    });

    expect(result.current.stashError).toBe('Conflict applying stash');
    expect(refreshAfterAction).not.toHaveBeenCalled();
  });

  it('opens drop dialog without executing drop immediately', () => {
    const { result } = setup();

    act(() => {
      result.current.handleDropStash(sampleStashes[0]);
    });

    expect(result.current.dropDialog).toEqual(sampleStashes[0]);
    expect(api.gitDropStash).not.toHaveBeenCalled();

    act(() => {
      result.current.closeDropDialog();
    });

    expect(result.current.dropDialog).toBeNull();
    expect(api.gitDropStash).not.toHaveBeenCalled();
  });

  it('refuses to open drop dialog for stash with empty or missing hash', () => {
    const { result } = setup();

    act(() => {
      result.current.handleDropStash({ ref: 'stash@{0}', hash: '', message: 'unverified' });
    });

    expect(result.current.dropDialog).toBeNull();
    expect(result.current.stashError).toContain('without verified commit identity');
    expect(api.gitDropStash).not.toHaveBeenCalled();
  });

  it('drops stash passing expected commit hash and refreshes on success', async () => {
    const { result, refreshAfterAction } = setup();

    act(() => {
      result.current.handleDropStash(sampleStashes[0]);
    });

    await act(async () => {
      await result.current.performDropStash();
    });

    expect(api.gitDropStash).toHaveBeenCalledWith('/repo', 'stash@{0}', sampleStashes[0].hash, 'ws');
    expect(result.current.dropDialog).toBeNull();
    expect(refreshAfterAction).toHaveBeenCalledOnce();
  });

  it('reports backend drop refusal when stash reference shifted', async () => {
    api.gitDropStash.mockResolvedValue({
      success: false,
      error: "Stash reference 'stash@{0}' changed. The operation was cancelled to avoid acting on the wrong stash.",
    });

    const { result, refreshAfterAction } = setup();

    act(() => {
      result.current.handleDropStash(sampleStashes[0]);
    });

    await act(async () => {
      await result.current.performDropStash();
    });

    expect(result.current.stashError).toContain('Stash reference');
    expect(refreshAfterAction).not.toHaveBeenCalled();
  });

  it('opens clear dialog with exact stash count and collection hashes', async () => {
    const { result, refreshAfterAction } = setup();

    act(() => {
      result.current.handleClearStashes();
    });

    expect(result.current.clearDialog).toEqual({
      count: 2,
      hashes: [sampleStashes[0].hash, sampleStashes[1].hash],
    });
    expect(api.gitClearStashes).not.toHaveBeenCalled();

    // Cancel
    act(() => {
      result.current.closeClearDialog();
    });
    expect(result.current.clearDialog).toBeNull();
    expect(api.gitClearStashes).not.toHaveBeenCalled();

    // Reopen and confirm
    act(() => {
      result.current.handleClearStashes();
    });

    await act(async () => {
      await result.current.performClearStashes();
    });

    expect(api.gitClearStashes).toHaveBeenCalledWith(
      '/repo',
      [sampleStashes[0].hash, sampleStashes[1].hash],
      'ws'
    );
    expect(result.current.clearDialog).toBeNull();
    expect(refreshAfterAction).toHaveBeenCalledOnce();
  });

  it('reports backend clear refusal when collection changed while confirmation was pending', async () => {
    api.gitClearStashes.mockResolvedValue({
      success: false,
      error: 'Stash collection changed since confirmation was opened. Re-confirm to clear all stashes.',
    });

    const { result, refreshAfterAction } = setup();

    act(() => {
      result.current.handleClearStashes();
    });

    await act(async () => {
      await result.current.performClearStashes();
    });

    expect(result.current.stashError).toContain('Stash collection changed');
    expect(refreshAfterAction).not.toHaveBeenCalled();
  });

  it('discards results if scope becomes non-current while operation is pending', async () => {
    let current = true;
    const { result, refreshAfterAction } = setup({ isCurrent: () => current });

    act(() => {
      result.current.handleDropStash(sampleStashes[0]);
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
