// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitMergeActions } from '../../../../src/renderer/components/git/useGitMergeActions';
import { installElectronApiMock } from '../../../setup/electron';
import type { GitOperationState } from '../../../../src/renderer/components/git/types';

describe('useGitMergeActions', () => {
  let api: ReturnType<typeof installElectronApiMock>;

  const cleanOperationState: GitOperationState = {
    success: true,
    isRepo: true,
    inProgress: false,
    mode: 'none',
    conflicts: [],
    message: 'No merge in progress',
  };

  const inProgressState: GitOperationState = {
    success: true,
    isRepo: true,
    inProgress: true,
    mode: 'merge',
    conflicts: ['file.ts'],
    message: 'Merge has 1 conflict',
  };

  beforeEach(() => {
    api = installElectronApiMock({
      gitMergeBranch: vi.fn().mockResolvedValue({ success: true }),
      gitAbortOperation: vi.fn().mockResolvedValue({ success: true }),
    });
  });

  function setup(options: {
    isCurrent?: () => boolean;
    operationState?: GitOperationState | null;
  } = {}) {
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
        operationState: 'operationState' in options ? options.operationState : cleanOperationState,
      })
    );
    return { ...hook, onSetActiveAction, refreshAfterAction };
  }

  it('fails closed when operationState is null (unknown state)', async () => {
    const { result } = setup({ operationState: null });

    act(() => {
      result.current.setMergeTargetBranch('feature');
    });

    await act(async () => {
      await result.current.handleMergeBranch();
    });

    expect(api.gitMergeBranch).not.toHaveBeenCalled();
    expect(result.current.mergeError).toContain('operation state is unknown');

    act(() => {
      result.current.handleRequestAbort('merge', []);
    });

    expect(result.current.abortDialog).toBeNull();
    expect(result.current.mergeError).toContain('operation state is unknown');
  });

  it('fails closed when operationState.success is false (unavailable discovery)', async () => {
    const { result } = setup({
      operationState: {
        success: false,
        isRepo: false,
        inProgress: false,
        mode: 'none',
        conflicts: [],
        message: 'Could not read operation state',
        error: 'git error',
      },
    });

    act(() => {
      result.current.setMergeTargetBranch('feature');
    });

    await act(async () => {
      await result.current.handleMergeBranch();
    });

    expect(api.gitMergeBranch).not.toHaveBeenCalled();
    expect(result.current.mergeError).toContain('Could not read operation state');

    act(() => {
      result.current.handleRequestAbort('merge', []);
    });

    expect(result.current.abortDialog).toBeNull();
  });

  it('fails closed and refuses merge when operation is already in progress', async () => {
    const { result } = setup({ operationState: inProgressState });

    act(() => {
      result.current.setMergeTargetBranch('feature');
    });

    await act(async () => {
      await result.current.handleMergeBranch();
    });

    expect(api.gitMergeBranch).not.toHaveBeenCalled();
    expect(result.current.mergeError).toContain('already in progress');
  });

  it('refuses to abort when no operation is confirmed in progress', () => {
    const { result } = setup({ operationState: cleanOperationState });

    act(() => {
      result.current.handleRequestAbort('merge', []);
    });

    expect(result.current.abortDialog).toBeNull();
    expect(result.current.mergeError).toContain('no merge or rebase operation is confirmed in progress');
  });

  it('merges selected target branch when clean and refreshes on success', async () => {
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

  it('opens abort dialog and aborts on confirmation when in progress', async () => {
    const { result, refreshAfterAction } = setup({ operationState: inProgressState });

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
      result.current.handleRequestAbort('merge', ['file.ts']);
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
