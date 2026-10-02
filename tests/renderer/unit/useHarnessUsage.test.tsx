import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHarnessUsage } from '../../../src/renderer/components/useHarnessUsage';
import { installElectronApiMock } from '../../setup/electron';
import type { HarnessUsageEntry, HarnessUsageRequest, HarnessUsageResponse } from '../../../src/shared/types/harnessUsage';

type Pending = { harnessId: string; force: boolean; workspaceId: string; resolve: (r: HarnessUsageResponse) => void };
let pending: Pending[];
const entry = (harnessId: string): HarnessUsageEntry => ({ harnessId, status: 'ok', measurements: [{ kind: 'rate-limit', unit: 'percent', used: 1 }], checkedAt: 1 });
const resolve = (p: Pending) => act(async () => p.resolve({ workspaceId: p.workspaceId, entries: [entry(p.harnessId)] }));

beforeEach(() => {
  installElectronApiMock();
  pending = [];
  vi.mocked(window.electronAPI.getHarnessUsage).mockImplementation((workspaceId: string, request?: HarnessUsageRequest) =>
    new Promise<HarnessUsageResponse>((res) => { pending.push({ harnessId: request?.harnessIds?.[0] ?? '', force: request?.force === true, workspaceId, resolve: res }); }));
});
const requested = () => vi.mocked(window.electronAPI.getHarnessUsage).mock.calls.map(([, request]) => request?.harnessIds?.[0]);

describe('useHarnessUsage selected harness set', () => {
  it('requests, polls and force-refreshes only the selected harnesses', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useHarnessUsage({ workspaceId: 'w', open: true, harnessIds: ['claude', 'agy'] }));
      expect(requested()).toEqual(['claude', 'agy']);
      act(() => result.current.refreshAll(true));
      act(() => { vi.advanceTimersByTime(61_000); });
      expect(new Set(requested())).toEqual(new Set(['claude', 'agy']));
      expect(requested()).not.toContain('opencode');
      expect(requested()).not.toContain('pi');
      expect(requested()).not.toContain('codex');
    } finally { vi.useRealTimers(); }
  });

  it('makes no requests and reports an empty set when nothing is selected', () => {
    const { result } = renderHook(() => useHarnessUsage({ workspaceId: 'w', open: true, harnessIds: [] }));
    act(() => result.current.refreshAll(true));
    expect(window.electronAPI.getHarnessUsage).not.toHaveBeenCalled();
    expect(result.current.harnessIds).toEqual([]);
    expect(result.current.pending).toEqual({});
    expect(result.current.canManualRefresh).toBe(false);
  });

  it('a late response from a newly hidden harness cannot restore its row or pending flag', async () => {
    const { result, rerender } = renderHook((props: { ids: string[] }) => useHarnessUsage({ workspaceId: 'w', open: true, harnessIds: props.ids }), { initialProps: { ids: ['codex', 'claude'] } });
    const codex = pending.find((p) => p.harnessId === 'codex')!;
    expect(result.current.pending.codex).toBe(true);
    rerender({ ids: ['claude'] });
    expect(result.current.pending.codex).toBeUndefined();
    await resolve(codex);
    expect(result.current.entries.codex).toBeUndefined();
    expect(result.current.pending.codex).toBeUndefined();
    await resolve(pending.find((p) => p.harnessId === 'claude')!);
    expect(result.current.entries.claude).toBeDefined();
  });

  it('removes a hidden harness entry, and a re-enabled harness participates again with a fresh request', async () => {
    const { result, rerender } = renderHook((props: { ids: string[] }) => useHarnessUsage({ workspaceId: 'w', open: true, harnessIds: props.ids }), { initialProps: { ids: ['codex', 'claude'] } });
    for (const p of pending.splice(0)) await resolve(p);
    expect(result.current.entries.codex).toBeDefined();
    rerender({ ids: ['claude'] });
    expect(result.current.entries.codex).toBeUndefined();
    rerender({ ids: ['codex', 'claude'] });
    expect(requested().filter((id) => id === 'codex')).toHaveLength(2);
  });

  it('still protects against stale responses across workspace changes', async () => {
    const { result, rerender } = renderHook((props: { ws: string }) => useHarnessUsage({ workspaceId: props.ws, open: true, harnessIds: ['claude'] }), { initialProps: { ws: 'a' } });
    const old = pending[0];
    rerender({ ws: 'b' });
    await resolve(old);
    expect(result.current.entries.claude).toBeUndefined();
    const calls = vi.mocked(window.electronAPI.getHarnessUsage).mock.calls;
    expect(calls[calls.length - 1][0]).toBe('b');
  });
});
