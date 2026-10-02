import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import Header from '../../../src/renderer/components/Header';
import { USAGE_HARNESS_IDS, USAGE_POLL_INTERVAL_MS } from '../../../src/renderer/components/useHarnessUsage';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { HarnessUsageEntry, HarnessUsageRequest, HarnessUsageResponse } from '../../../src/shared/types/harnessUsage';

vi.mock('../../../src/renderer/components/GitButton', () => ({ default: () => null }));

type Deferred = { resolve: (response: HarnessUsageResponse) => void; reject: (error: unknown) => void; harnessId: string; force: boolean; workspaceId: string };
const pct = (label: string, used: number) => ({ kind: 'rate-limit' as const, unit: 'percent', used, remaining: 100 - used, limit: 100, label });
const okEntry = (harnessId: string, label: string, used: number, extra: Partial<HarnessUsageEntry> = {}): HarnessUsageEntry =>
  ({ harnessId, status: 'ok', measurements: [pct(label, used)], checkedAt: Date.now(), ...extra });

let pending: Deferred[];
const calls = () => vi.mocked(window.electronAPI.getHarnessUsage).mock.calls as unknown as Array<[string, HarnessUsageRequest | undefined]>;
const respond = (d: Deferred, entry: HarnessUsageEntry) => act(async () => d.resolve({ workspaceId: d.workspaceId, entries: [entry] }));

/** Every request stays pending until the test resolves it, so progressive rendering is observable. */
beforeEach(() => {
  installElectronApiMock();
  pending = [];
  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-1', browserOverlayCount: 0,
    workspaces: [createWorkspaceFixture({ id: 'ws-1', workspacePath: '/workspace', terminals: [], panes: [] })],
  });
  vi.mocked(window.electronAPI.getHarnessUsage).mockImplementation((workspaceId: string, request?: HarnessUsageRequest) =>
    new Promise<HarnessUsageResponse>((resolve, reject) => {
      pending.push({ resolve, reject, harnessId: request?.harnessIds?.[0] ?? '', force: request?.force === true, workspaceId });
    }));
});
afterEach(() => { vi.useRealTimers(); });

const openUsage = async () => {
  render(<Header />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usage' })); });
};
const panel = () => screen.getByRole('dialog', { name: 'Usage' });

describe('Usage panel loading', () => {
  it('requests every harness independently and concurrently on open, with ordinary reads', async () => {
    await openUsage();
    expect(calls().map(([, request]) => request)).toEqual(USAGE_HARNESS_IDS.map((id) => ({ harnessIds: [id] })));
    expect(calls().every(([id]) => id === 'ws-1')).toBe(true);
    expect(calls().some(([, request]) => request?.force)).toBe(false);
    expect(within(panel()).getAllByText('Checking usage…')).toHaveLength(7);
  });

  it('renders a fast provider immediately while a slow one still says Checking usage…', async () => {
    await openUsage();
    await respond(pending.find((d) => d.harnessId === 'claude')!, okEntry('claude', 'Claude · 5 hour', 31));
    const claude = within(panel()).getByRole('region', { name: 'Claude' });
    expect(within(claude).getByText('69% remaining')).toBeInTheDocument();
    expect(within(within(panel()).getByRole('region', { name: 'Codex' })).getByText('Checking usage…')).toBeInTheDocument();
  });

  it('shows safe text, never raw IPC errors, when a request is rejected; keeps a prior good reading as stale', async () => {
    vi.useFakeTimers();
    await openUsage();
    await act(async () => pending.find((d) => d.harnessId === 'pi')!.reject(new Error('ECONNRESET /home/me/.secret token=sk-abc')));
    const pi = within(panel()).getByRole('region', { name: 'Pi' });
    expect(within(pi).getByText('Usage could not be read')).toBeInTheDocument();
    expect(panel().textContent).not.toMatch(/ECONNRESET|sk-abc|secret/);

    await respond(pending.find((d) => d.harnessId === 'codex')!, okEntry('codex', 'Codex · weekly', 40));
    // Next poll fails at the IPC level: the measurement stays, flagged stale.
    pending.length = 0;
    await act(async () => { vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS + 10); });
    await act(async () => pending.find((d) => d.harnessId === 'codex')!.reject(new Error('boom')));
    const codex = within(panel()).getByRole('region', { name: 'Codex' });
    expect(within(codex).getByText('60% remaining')).toBeInTheDocument();
    expect(within(codex).getByText('Stale')).toBeInTheDocument();
    expect(within(codex).getByText('Usage could not be read')).toBeInTheDocument();
  });
});

describe('Usage polling', () => {
  it('polls about once a minute with ordinary reads while open, skipping harnesses still in flight, and stops on close', async () => {
    vi.useFakeTimers();
    render(<Header />);
    expect(calls()).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usage' })); });
    expect(calls()).toHaveLength(7);
    // Everything but codex resolves; codex stays in flight.
    for (const d of pending.filter((candidate) => candidate.harnessId !== 'codex')) await respond(d, okEntry(d.harnessId, `${d.harnessId} · x`, 1));
    await act(async () => { vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS + 100); });
    const second = calls().slice(7);
    expect(second.map(([, r]) => r?.harnessIds?.[0]).sort()).toEqual(USAGE_HARNESS_IDS.filter((id) => id !== 'codex').sort());
    expect(second.every(([, r]) => !r?.force)).toBe(true);
    // Close: no further polling.
    await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
    const before = calls().length;
    await act(async () => { vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS * 3); });
    expect(calls()).toHaveLength(before);
  });

  it('restarts on reopen with an immediate request and stops on unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<Header />);
    const trigger = screen.getByRole('button', { name: 'Usage' });
    await act(async () => { fireEvent.click(trigger); });
    for (const d of pending.splice(0)) await respond(d, okEntry(d.harnessId, `${d.harnessId} · x`, 1)); // nothing left in flight
    await act(async () => { fireEvent.click(trigger); });
    const afterClose = calls().length;
    await act(async () => { fireEvent.click(trigger); });
    expect(calls().length).toBeGreaterThan(afterClose);
    unmount();
    const atUnmount = calls().length;
    await act(async () => { vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS * 3); });
    expect(calls()).toHaveLength(atUnmount);
  });

  it('stops polling the old workspace when the workspace switches', async () => {
    vi.useFakeTimers();
    useWorkspaceStore.setState((state) => ({ workspaces: [...state.workspaces, createWorkspaceFixture({ id: 'ws-2', lifecycle: 'parked' })] }));
    render(<Header />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usage' })); });
    act(() => useWorkspaceStore.getState().selectWorkspace('ws-2'));
    const before = calls().length;
    await act(async () => { vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS * 2); });
    expect(calls()).toHaveLength(before);
  });
});

describe('Usage manual refresh', () => {
  it('sends forced requests per harness, shows a busy disabled state, and re-enables when done', async () => {
    await openUsage();
    for (const d of pending.splice(0)) await respond(d, okEntry(d.harnessId, `${d.harnessId} · x`, 1, { refreshableAt: 0 }));
    const button = within(panel()).getByRole('button', { name: 'Refresh usage' });
    expect(button).toBeEnabled();
    await act(async () => { fireEvent.click(button); });
    const forced = pending.splice(0);
    expect(forced.map((d) => [d.harnessId, d.force])).toEqual(USAGE_HARNESS_IDS.map((id) => [id, true]));
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Refreshing usage…');
    // Progressive: one resolves, the others stay busy.
    await respond(forced[0], okEntry(forced[0].harnessId, `${forced[0].harnessId} · y`, 2, { refreshableAt: Date.now() + 60_000 }));
    expect(button).toBeDisabled();
    for (const d of forced.slice(1)) await respond(d, okEntry(d.harnessId, `${d.harnessId} · y`, 2, { refreshableAt: Date.now() + 60_000 }));
    expect(button).toBeDisabled(); // nothing is eligible yet
  });

  it('uses refreshableAt to disable a pointless refresh and enables it once a provider becomes eligible', async () => {
    vi.useFakeTimers();
    render(<Header />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usage' })); });
    const soon = Date.now() + 40_000;
    for (const d of pending.splice(0)) await respond(d, okEntry(d.harnessId, `${d.harnessId} · x`, 1, { refreshableAt: d.harnessId === 'codex' ? soon : soon + 120_000 }));
    const button = within(panel()).getByRole('button', { name: 'Refresh usage' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/^Refresh available in \d+s$/);
    await act(async () => { vi.advanceTimersByTime(41_000); });
    expect(within(panel()).getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  });

  it('plain unsupported/not-installed entries (no refreshableAt) never block manual refresh', async () => {
    await openUsage();
    for (const d of pending.splice(0)) await respond(d, { harnessId: d.harnessId, status: 'unsupported', measurements: [], error: 'No supported usage probe' });
    expect(within(panel()).getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  });
});
