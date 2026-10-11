import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useFileDiffReview } from '../../../../src/renderer/components/git/useFileDiffReview';
import { installElectronApiMock } from '../../../setup/electron';

let api: ReturnType<typeof installElectronApiMock>;
const diff = (text: string) => ({ success: true, oldContent: 'HEAD', newContent: text, oldPath: 'file', newPath: 'file', isBinary: false, hasDiff: true });
beforeEach(() => { api = installElectronApiMock(); });

it('clears displayed content immediately, switches pending requests monotonically and cannot reopen after closing', async () => {
  api.gitGetFileDiff.mockResolvedValueOnce(diff('first'));
  const { result } = renderHook(() => useFileDiffReview('/repo', 'ws', true, 'revision'));
  await act(async () => result.current.viewDiff('first.ts', 'working'));
  expect(result.current.diffState.newContent).toBe('first');
  let finishA!: (value: unknown) => void;
  let finishB!: (value: unknown) => void;
  api.gitGetFileDiff.mockImplementationOnce(() => new Promise((resolve) => { finishA = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishB = resolve; }));
  act(() => { void result.current.viewDiff('a.ts', 'staged'); });
  expect(result.current.diffState.newContent).toBe(''); expect(result.current.diffState.isLoading).toBe(true);
  act(() => { void result.current.viewDiff('b.ts', 'working'); });
  await act(async () => finishB(diff('latest')));
  await act(async () => finishA(diff('outdated')));
  expect(result.current.diffState.filePath).toBe('b.ts'); expect(result.current.diffState.newContent).toBe('latest');
  api.gitGetFileDiff.mockImplementationOnce(() => new Promise((resolve) => { finishA = resolve; }));
  act(() => { void result.current.viewDiff('a.ts', 'working'); });
  act(() => result.current.closeDiff());
  await act(async () => finishA(diff('late')));
  expect(result.current.diffState.isOpen).toBe(false);
  api.gitGetFileDiff.mockResolvedValueOnce(diff('fresh reopened'));
  await act(async () => result.current.viewDiff('a.ts', 'working'));
  expect(result.current.diffState.newContent).toBe('fresh reopened');
});

it.each(['root', 'workspace', 'revision', 'closed'])('invalidates pending requests when %s changes', async (change) => {
  let finish!: (value: unknown) => void;
  api.gitGetFileDiff.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const { result, rerender } = renderHook(({ root, workspace, enabled, revision }) => useFileDiffReview(root, workspace, enabled, revision),
    { initialProps: { root: '/repo', workspace: 'ws', enabled: true, revision: 'one' } });
  act(() => { void result.current.viewDiff('a.ts', 'working'); });
  rerender({ root: change === 'root' ? '/other' : '/repo', workspace: change === 'workspace' ? 'other' : 'ws', enabled: change !== 'closed', revision: change === 'revision' ? 'two' : 'one' });
  await act(async () => finish(diff('obsolete')));
  expect(result.current.diffState.isOpen).toBe(false); expect(result.current.diffState.newContent).toBe('');
});

it('reports errors, preserves remote workspace identity and recovers without stale contents', async () => {
  const { result } = renderHook(() => useFileDiffReview('/remote/repo', 'ssh-ws', true, 'revision'));
  api.gitGetFileDiff.mockResolvedValueOnce({ ...diff('invalid'), success: false, error: 'Permission denied' });
  await act(async () => result.current.viewDiff('file', 'working'));
  expect(api.gitGetFileDiff).toHaveBeenCalledWith('/remote/repo', 'file', 'working', 'ssh-ws');
  expect(result.current.diffState.error).toBe('Permission denied'); expect(result.current.diffState.newContent).toBe('');
  api.gitGetFileDiff.mockRejectedValueOnce(new Error('SSH unavailable'));
  await act(async () => result.current.viewDiff('file', 'staged'));
  expect(result.current.diffState.error).toBe('SSH unavailable');
  api.gitGetFileDiff.mockResolvedValueOnce(diff('recovered'));
  await act(async () => result.current.viewDiff('file', 'staged'));
  await waitFor(() => expect(result.current.diffState.newContent).toBe('recovered'));
});
