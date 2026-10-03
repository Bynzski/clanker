import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useConversationHistory } from '../../../src/renderer/components/useConversationHistory';
import { WARMUP_DELAY_MS } from '../../../src/renderer/lib/idleWarmup';
import { installElectronApiMock } from '../../setup/electron';
import type { HarnessSession } from '../../../src/shared/types/session';

const session = (id: string, title = id): HarnessSession => ({ id, harness: 'codex', title, cwd: '/workspace', timestamp: 1 });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => { installElectronApiMock(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useConversationHistory', () => {
  it('warms history only after the workspace has settled, then opens instantly from it', async () => {
    vi.mocked(window.electronAPI.discoverSessions).mockResolvedValue([session('a', 'Warm')]);
    const { result } = renderHook(() => useConversationHistory('ws-1'));
    act(() => { vi.advanceTimersByTime(WARMUP_DELAY_MS - 1); });
    expect(window.electronAPI.discoverSessions).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(window.electronAPI.discoverSessions).toHaveBeenCalledExactlyOnceWith('ws-1');
    await flush();
    let refresh!: (sessions: HarnessSession[]) => void;
    vi.mocked(window.electronAPI.discoverSessions).mockReturnValueOnce(new Promise((resolve) => { refresh = resolve; }));
    act(() => result.current.setOpen(true));
    // Remembered list shows immediately, with no loading state, while a refresh runs.
    expect(result.current.sessions.map((s) => s.title)).toEqual(['Warm']);
    expect(result.current.isLoading).toBe(false);
    await act(async () => refresh([session('a', 'Warm'), session('b', 'New')]));
    expect(result.current.sessions.map((s) => s.title)).toEqual(['Warm', 'New']);
  });

  it('loads normally when opened before any warm-up, and ignores answers for a workspace left behind', async () => {
    let finish!: (sessions: HarnessSession[]) => void;
    vi.mocked(window.electronAPI.discoverSessions).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(({ id }) => useConversationHistory(id), { initialProps: { id: 'ws-1' } });
    act(() => result.current.setOpen(true));
    expect(result.current.isLoading).toBe(true);
    rerender({ id: 'ws-2' });
    await act(async () => finish([session('old', 'Old workspace')]));
    expect(result.current.sessions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('keeps a failed refresh visible without dropping the remembered list', async () => {
    vi.mocked(window.electronAPI.discoverSessions).mockResolvedValueOnce([session('a', 'Kept')]).mockRejectedValueOnce(new Error('Host unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useConversationHistory('ws-1'));
    act(() => { vi.advanceTimersByTime(WARMUP_DELAY_MS); });
    await flush();
    act(() => result.current.setOpen(true));
    await flush();
    expect(result.current.sessions.map((s) => s.title)).toEqual(['Kept']);
    expect(result.current.error).toBe('Host unavailable');
  });
});
