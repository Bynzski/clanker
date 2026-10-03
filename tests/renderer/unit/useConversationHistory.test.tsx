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
  it('warms history only after the warm-up delay, then opens instantly from it', async () => {
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

  it('never warms in the background when warm-up is disabled (SSH workspaces)', () => {
    renderHook(() => useConversationHistory('ws-ssh', { warmup: false }));
    act(() => { vi.advanceTimersByTime(WARMUP_DELAY_MS * 3); });
    expect(window.electronAPI.discoverSessions).not.toHaveBeenCalled();
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

  it('caps the remembered workspaces at 8, evicting the least recently used', async () => {
    vi.mocked(window.electronAPI.discoverSessions).mockImplementation(async (id: string) => [session(id, `list-${id}`)]);
    const { result, rerender } = renderHook(({ id }) => useConversationHistory(id, { warmup: false }), { initialProps: { id: 'ws-0' } });
    for (let i = 0; i < 9; i++) {
      rerender({ id: `ws-${i}` });
      act(() => result.current.setOpen(true));
      await flush();
      if (i === 1) { // touch ws-0 again so ws-1 becomes the oldest
        rerender({ id: 'ws-0' });
        act(() => result.current.setOpen(true));
        await flush();
      }
    }
    // 9 distinct workspaces were seen; ws-1 (oldest, untouched) was evicted, ws-0 (touched) was kept.
    vi.mocked(window.electronAPI.discoverSessions).mockReturnValue(new Promise(() => undefined));
    rerender({ id: 'ws-1' });
    act(() => result.current.setOpen(true));
    expect(result.current.isLoading).toBe(true);
    rerender({ id: 'ws-0' });
    act(() => result.current.setOpen(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.sessions.map((x) => x.title)).toEqual(['list-ws-0']);
  });

  it('still opens and loads manually when background warm-up is disabled', async () => {
    vi.mocked(window.electronAPI.discoverSessions).mockResolvedValue([session('a', 'Manual')]);
    const { result } = renderHook(() => useConversationHistory('ws-ssh', { warmup: false }));
    act(() => { vi.advanceTimersByTime(WARMUP_DELAY_MS * 3); });
    expect(window.electronAPI.discoverSessions).not.toHaveBeenCalled();
    act(() => result.current.setOpen(true));
    await flush();
    expect(result.current.sessions.map((x) => x.title)).toEqual(['Manual']);
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
