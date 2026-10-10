// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitMergeActions } from '../../../../src/renderer/components/git/useGitMergeActions';
import { installElectronApiMock } from '../../../setup/electron';

describe('useGitMergeActions', () => {
  let api: ReturnType<typeof installElectronApiMock>;

  beforeEach(() => {
    api = installElectronApiMock({
      gitMergeBranch: vi.fn().mockResolvedValue({ success: true }),
      gitAbortOperation: vi.fn().mockResolvedValue({ success: true }),
    });
  });

  function setup(options: { isCurrent?: () => boolean } = {}) {
    const onSetActiveAction = vi.fn();
    const refreshAfterAction = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(() =>
      useGitMergeActions({
        isCurrent: options.isCurrent ?? (() => true),
        activeAction: null,
        onSetActiveAction,
        refreshAfterAction,
        workspacePath: '/repo',
        workspaceId: 'ws',
      })
    );
    return { ...hook, onSetActiveAction, refreshAfterAction };
  }

  it('merges selected target branch and refreshes on success', async () => {
    const { result, refreshAfterAction, onSetActiveAction } = setup();

    act(() => {
      result.current.setMergeTargetBranch('feature');
    });

    await act(async () => {
      await result.current.handleMergeBranch();
    });

    expect(api.gitMergeBranch).toHaveBeenCalledWith('/repo', 'feature', 'ws');
    expect(refreshAfterAction).toHaveBeenCalledOnce();
    expect(onSetActiveAction).toHaveBeenCalledWith('merge:feature');
    expect(onSetActiveAction).toHaveBeenLastCalledWith(null);
  });

  it('fails cleanly without merge target selected', async () => {
    const { result, refreshAfterAction } = setup();

    await act(async () => {
      await result.current.handleMergeBranch();
    });

    expect(api.gitMergeBranch).not.toHaveBeenCalled();
    expect(result.current.mergeError).toBe('Select a branch to merge');
    expect(refreshAfterAction).not.toHaveBeenCalled();
  });

  it('reports merge failure when backend returns error', async () => {
    api.gitMergeBranch.mockResolvedValue({ success: false, error: 'Automatic merge failed; fix conflicts' });
    const { result, refreshAfterAction } = setup();

    act(() => {
      result.current.setMergeTargetBranch('feature');
    });

    await act(async () => {
      await result.current.handleMergeBranch();
    });

    expect(result.current.mergeError).toBe('Automatic merge failed; fix conflicts');
    expect(refreshAfterAction).not.toHaveBeenCalled();
  });

  it('opens abort dialog and aborts on confirmation', async () => {
    const { result, refreshAfterAction } = setup();

    act(() => {
      result.current.handleRequestAbort('merge', ['file.ts']);
    });

    expect(result.current.abortDialog).toEqual({ mode: 'merge', conflicts: ['file.ts'] });
    expect(api.gitAbortOperation).not.toHaveBeenCalled();

    // Cancel
    act(() => {
      result.current.closeAbortDialog();
    });
    expect(result.current.abortDialog).toBeNull();
    expect(api.gitAbortOperation).not.toHaveBeenCalled();

    // Reopen and confirm
    act(() => {
      result.current.handleRequestAbort('rebase', []);
    });

    await act(async () => {
      await result.current.performAbortOperation();
    });

    expect(api.gitAbortOperation).toHaveBeenCalledWith('/repo', 'ws');
    expect(result.current.abortDialog).toBeNull();
    expect(refreshAfterAction).toHaveBeenCalledOnce();
  });

  it('discards results if scope becomes non-current while merge is pending', async () => {
    let current = true;
    const { result, refreshAfterAction } = setup({ isCurrent: () => current });

    act(() => {
      result.current.setMergeTargetBranch('feature');
    });

    let finishMerge!: (val: unknown) => void;
    api.gitMergeBranch.mockReturnValue(new Promise((r) => { finishMerge = r; }));

    const mergePromise = act(async () => {
      await result.current.handleMergeBranch();
    });

    current = false;
    finishMerge({ success: true });
    await mergePromise;

    expect(refreshAfterAction).not.toHaveBeenCalled();
  });
});
