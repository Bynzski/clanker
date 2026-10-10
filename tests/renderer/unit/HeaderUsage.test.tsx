import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Header from '../../../src/renderer/components/Header';
import UsageWidget from '../../../src/renderer/components/UsageWidget';
import { USAGE_POLL_INTERVAL_MS } from '../../../src/renderer/components/useHarnessUsage';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { HarnessUsageEntry, HarnessUsageRequest, HarnessUsageResponse } from '../../../src/shared/types/harnessUsage';

vi.mock('../../../src/renderer/components/GitButton', () => ({ default: () => null }));

type Deferred = { resolve: (response: HarnessUsageResponse) => void; reject: (error: unknown) => void; harnessId: string; force: boolean; workspaceId: string | null };
/** Usage-capable harnesses in launcher order, as the panel requests and renders them. */
const PANEL_IDS = ['codex', 'claude', 'omp', 'hermes', 'agy'];
const pct = (label: string, used: number) => ({ kind: 'rate-limit' as const, unit: 'percent', used, remaining: 100 - used, limit: 100, label });
const okEntry = (harnessId: string, label: string, used: number, extra: Partial<HarnessUsageEntry> = {}): HarnessUsageEntry =>
  ({ harnessId, status: 'ok', measurements: [pct(label, used)], checkedAt: Date.now(), ...extra });

let pending: Deferred[];
const calls = () => vi.mocked(window.electronAPI.getHarnessUsage).mock.calls as unknown as Array<[string | null, HarnessUsageRequest | undefined]>;
const respond = (d: Deferred, entry: HarnessUsageEntry) => act(async () => d.resolve({ workspaceId: d.workspaceId ?? undefined, environmentId: 'local', environmentGeneration: 0, entries: [entry] }));

/** Every request stays pending until the test resolves it, so progressive rendering is observable. */
/** Every usage-capable harness is installed locally unless a test says otherwise. */
const installedHarnesses = (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, { name: id, command: id, args: [], icon: 'terminal' }]));
const ALL_HARNESSES = ['codex', 'claude', 'opencode', 'pi', 'omp', 'hermes', 'agy'] as const;

beforeEach(() => {
  installElectronApiMock({ getHarnessOptions: vi.fn().mockResolvedValue(installedHarnesses(ALL_HARNESSES)) });
  pending = [];
  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-1', browserOverlayCount: 0,
    workspaces: [createWorkspaceFixture({ id: 'ws-1', workspacePath: '/workspace', terminals: [], panes: [] })],
  });
  useAssistantNavStore.setState({ activeAssistantId: null, openedAssistantIds: [] });
  vi.mocked(window.electronAPI.getHarnessUsage).mockImplementation((workspaceId: string | null, request?: HarnessUsageRequest) =>
    new Promise<HarnessUsageResponse>((resolve, reject) => {
      pending.push({ resolve, reject, harnessId: request?.harnessIds?.[0] ?? '', force: request?.force === true, workspaceId });
    }));
});
afterEach(() => { vi.useRealTimers(); });

/** Persisted preferences load asynchronously; the Usage control is disabled until they have. */
const renderReady = async () => {
  const view = render(<UsageWidget />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return view;
};
const openUsage = async () => {
  await renderReady();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usage' })); });
};
const panel = () => screen.getByRole('dialog', { name: 'Usage' });

describe('Usage panel loading', () => {
  it('requests every harness independently and concurrently on open, with ordinary reads', async () => {
    await openUsage();
    expect(calls().map(([, request]) => request)).toEqual(PANEL_IDS.map((id) => ({ harnessIds: [id] })));
    expect(calls().every(([id]) => id === null)).toBe(true);
    expect(calls().some(([, request]) => request?.force)).toBe(false);
    expect(within(panel()).getAllByText('Checking usage…')).toHaveLength(5);
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
    await act(async () => pending.find((d) => d.harnessId === 'agy')!.reject(new Error('ECONNRESET /home/me/.secret token=sk-abc')));
    const agy = within(panel()).getByRole('region', { name: 'Antigravity' });
    expect(within(agy).getByRole('img', { name: /Usage could not be read/ })).toBeInTheDocument();
    expect(panel().innerHTML).not.toMatch(/ECONNRESET|sk-abc|secret/);

    await respond(pending.find((d) => d.harnessId === 'codex')!, okEntry('codex', 'Codex · weekly', 40));
    // Next poll fails at the IPC level: the measurement stays, flagged stale.
    pending.length = 0;
    await act(async () => { vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS + 10); });
    await act(async () => pending.find((d) => d.harnessId === 'codex')!.reject(new Error('boom')));
    const codex = within(panel()).getByRole('region', { name: 'Codex' });
    expect(within(codex).getByText('60% remaining')).toBeInTheDocument();
    expect(within(codex).getByText('Stale')).toBeInTheDocument();
    expect(within(codex).getByRole('img', { name: /Stale usage data · Usage could not be read/ })).toBeInTheDocument();
  });
});

describe('Usage polling', () => {
  it('polls about once a minute with ordinary reads while open, skipping harnesses still in flight, and stops on close', async () => {
    vi.useFakeTimers();
    await renderReady();
    expect(calls()).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usage' })); });
    expect(calls()).toHaveLength(5);
    // Everything but codex resolves; codex stays in flight.
    for (const d of pending.filter((candidate) => candidate.harnessId !== 'codex')) await respond(d, okEntry(d.harnessId, `${d.harnessId} · x`, 1));
    await act(async () => { vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS + 100); });
    const second = calls().slice(5);
    expect(second.map(([, r]) => r?.harnessIds?.[0]).sort()).toEqual(PANEL_IDS.filter((id) => id !== 'codex').sort());
    expect(second.every(([, r]) => !r?.force)).toBe(true);
    // Close: no further polling.
    await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
    const before = calls().length;
    await act(async () => { vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS * 3); });
    expect(calls()).toHaveLength(before);
  });

  it('restarts on reopen with an immediate request and stops on unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = await renderReady();
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
    await renderReady();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usage' })); });
    act(() => useWorkspaceStore.getState().selectWorkspace('ws-2'));
    const before = calls().length;
    await act(async () => { vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS * 2); });
    const after = calls().slice(before);
    // Equivalent local navigation shares the already pending operations.
    expect(after).toHaveLength(0);
  });
});

describe('Usage manual refresh', () => {
  it('is disabled while the initial reads are in flight and enabled once they resolve', async () => {
    await openUsage();
    expect(calls()).toHaveLength(5);
    expect(within(panel()).getAllByText('Checking usage…')).toHaveLength(5);
    expect(within(panel()).getByRole('button', { name: 'Refresh usage' })).toBeDisabled();
    for (const d of pending.splice(0)) await respond(d, okEntry(d.harnessId, `${d.harnessId} · x`, 1, { refreshableAt: 0 }));
    expect(within(panel()).getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  });

  it('is disabled while an ordinary poll is in flight and enabled again when it resolves', async () => {
    vi.useFakeTimers();
    await openUsage();
    for (const d of pending.splice(0)) await respond(d, okEntry(d.harnessId, `${d.harnessId} · x`, 1, { refreshableAt: 0 }));
    expect(within(panel()).getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
    await act(async () => { vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS + 100); });
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((d) => !d.force)).toBe(true);
    expect(within(panel()).getByRole('button', { name: 'Refresh usage' })).toBeDisabled();
    for (const d of pending.splice(0)) await respond(d, okEntry(d.harnessId, `${d.harnessId} · y`, 2, { refreshableAt: 0 }));
    expect(within(panel()).getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  });

  it('sends forced requests per harness, shows a busy disabled state, and re-enables when done', async () => {
    await openUsage();
    for (const d of pending.splice(0)) await respond(d, okEntry(d.harnessId, `${d.harnessId} · x`, 1, { refreshableAt: 0 }));
    const button = within(panel()).getByRole('button', { name: 'Refresh usage' });
    expect(button).toBeEnabled();
    await act(async () => { fireEvent.click(button); });
    const forced = pending.splice(0);
    expect(forced.map((d) => [d.harnessId, d.force])).toEqual(PANEL_IDS.map((id) => [id, true]));
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
    await renderReady();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usage' })); });
    const soon = Date.now() + 40_000;
    for (const d of pending.splice(0)) await respond(d, okEntry(d.harnessId, `${d.harnessId} · x`, 1, { refreshableAt: d.harnessId === 'codex' ? soon : soon + 120_000 }));
    const button = within(panel()).getByRole('button', { name: 'Refresh usage' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/^Refresh available in \d+s$/);
    await act(async () => { vi.advanceTimersByTime(41_000); });
    expect(within(panel()).getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  });

  it('a resolved not-installed entry without refreshableAt makes Refresh available even while others are inside their window', async () => {
    vi.useFakeTimers();
    await renderReady();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usage' })); });
    const later = Date.now() + 60_000;
    // Hermes is still unresolved: it must not count as refreshable.
    for (const d of pending.filter((candidate) => candidate.harnessId !== 'hermes' && candidate.harnessId !== 'agy')) {
      await respond(d, okEntry(d.harnessId, `${d.harnessId} · x`, 1, { refreshableAt: later }));
    }
    await respond(pending.find((d) => d.harnessId === 'agy')!, okEntry('agy', 'agy · x', 1, { refreshableAt: later }));
    expect(within(panel()).getByRole('button', { name: 'Refresh usage' })).toBeDisabled();
    await respond(pending.find((d) => d.harnessId === 'hermes')!, { harnessId: 'hermes', status: 'not-installed', measurements: [], error: 'Not installed in this environment' });
    expect(within(panel()).getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  });

  it('plain unsupported/not-installed entries (no refreshableAt) never block manual refresh', async () => {
    await openUsage();
    for (const d of pending.splice(0)) await respond(d, { harnessId: d.harnessId, status: 'unsupported', measurements: [], error: 'No supported usage probe' });
    expect(within(panel()).getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  });
});

describe('Usage provider selection (Show in Usage)', () => {
  const defaults = (overrides: Record<string, Record<string, unknown>>) => Object.fromEntries(
    ['codex', 'opencode', 'pi', 'omp', 'hermes', 'claude', 'agy'].map((id) => [id, { model: '', favorites: [], flags: '', visible: true, ...overrides[id] }]));
  const useDefaults = (overrides: Record<string, Record<string, unknown>>) => vi.mocked(window.electronAPI.getHarnessDefaults).mockResolvedValue(defaults(overrides) as never);
  const requestedIds = () => calls().map(([, request]) => request?.harnessIds?.[0]);

  it('by default only the five supported harnesses appear and are requested; OpenCode and Pi never are', async () => {
    await openUsage();
    expect(requestedIds()).toEqual(['codex', 'claude', 'omp', 'hermes', 'agy']);
    const names = [...panel().querySelectorAll('.usage-harness-name')].map((node) => node.textContent);
    expect(names).toEqual(['Codex', 'Claude', 'Oh My Pi', 'Hermes', 'Antigravity']);
    expect(within(panel()).queryByRole('region', { name: 'OpenCode' })).not.toBeInTheDocument();
    expect(within(panel()).queryByRole('region', { name: 'Pi' })).not.toBeInTheDocument();
  });

  it('usageVisible=false removes the harness from the panel and from initial, polled and forced requests', async () => {
    vi.useFakeTimers();
    useDefaults({ codex: { usageVisible: false }, hermes: { usageVisible: false } });
    await renderReady();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usage' })); });
    expect(requestedIds()).toEqual(['claude', 'omp', 'agy']);
    expect(within(panel()).queryByRole('region', { name: 'Codex' })).not.toBeInTheDocument();
    for (const d of pending.splice(0)) await respond(d, okEntry(d.harnessId, `${d.harnessId} · x`, 1, { refreshableAt: 0 }));
    await act(async () => { vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS + 100); });
    for (const d of pending.splice(0)) await respond(d, okEntry(d.harnessId, `${d.harnessId} · x`, 1, { refreshableAt: 0 })); // the poll finishes first
    await act(async () => { fireEvent.click(within(panel()).getByRole('button', { name: 'Refresh usage' })); });
    for (const id of requestedIds()) expect(['claude', 'omp', 'agy']).toContain(id);
    expect(requestedIds().length).toBeGreaterThan(6);
  });

  it('never requests or lists a harness that is not installed in the workspace environment', async () => {
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue(installedHarnesses(['codex', 'omp']));
    await openUsage();
    expect(requestedIds()).toEqual(['codex', 'omp']);
    const names = [...panel().querySelectorAll('.usage-harness-name')].map((node) => node.textContent);
    expect(names).toEqual(['Codex', 'Oh My Pi']);
    expect(within(panel()).queryByText('Not installed in this environment')).not.toBeInTheDocument();
  });

  it('keeps the Usage control available and makes no requests when every provider is disabled', async () => {
    useDefaults(Object.fromEntries(['codex', 'claude', 'omp', 'hermes', 'agy'].map((id) => [id, { usageVisible: false }])));
    await renderReady();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usage' })); });
    expect(within(panel()).getByText('No usage providers available')).toBeInTheDocument();
    expect(within(panel()).getByText('Enable providers in Settings → Harness Defaults.')).toBeInTheDocument();
    expect(within(panel()).queryByText('Checking usage…')).not.toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Refresh usage' })).toBeDisabled();
    expect(calls()).toHaveLength(0);
  });

  it('toggling Show in Usage in Settings persists through setHarnessDefaults and drops the harness from the next Usage opening', async () => {
    const user = userEvent.setup();
    let stored = defaults({});
    vi.mocked(window.electronAPI.getHarnessDefaults).mockImplementation(async () => stored as never);
    vi.mocked(window.electronAPI.setHarnessDefaults).mockImplementation(async (next) => { stored = next as never; });
    render(<><Header /><UsageWidget /></>);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Legacy Settings' }));
    await user.click(await within(screen.getByRole('dialog', { name: 'Settings' })).findByRole('button', { name: 'Codex' }));
    await user.click(screen.getByRole('checkbox', { name: 'Show Codex in Usage' }));
    expect(window.electronAPI.setHarnessDefaults).toHaveBeenLastCalledWith(expect.objectContaining({ codex: expect.objectContaining({ usageVisible: false }) }));
    // Launcher visibility is untouched by this toggle.
    const saved = vi.mocked(window.electronAPI.setHarnessDefaults).mock.calls;
    expect(saved[saved.length - 1][0].codex.visible).not.toBe(false);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Usage' }));
    expect(requestedIds()).toEqual(['claude', 'omp', 'hermes', 'agy']);
    expect(within(panel()).queryByRole('region', { name: 'Codex' })).not.toBeInTheDocument();
  });

  it('never probes a persisted-hidden provider during the startup race, and fails closed if defaults cannot load', async () => {
    const user = userEvent.setup();
    let finish!: (value: never) => void;
    vi.mocked(window.electronAPI.getHarnessDefaults).mockReturnValueOnce(new Promise((resolve) => { finish = resolve as never; }));
    render(<UsageWidget />);
    const trigger = screen.getByRole('button', { name: 'Usage' });
    expect(trigger).toBeDisabled(); // neutral: not-yet-known preferences are not "no providers available"
    await user.click(trigger);
    expect(screen.queryByRole('dialog', { name: 'Usage' })).not.toBeInTheDocument();
    expect(calls()).toHaveLength(0);
    await act(async () => finish(defaults({ codex: { usageVisible: false } }) as never));
    expect(trigger).toBeEnabled();
    await user.click(trigger);
    expect(requestedIds()).toEqual(['claude', 'omp', 'hermes', 'agy']);
    expect(requestedIds()).not.toContain('codex');
    expect(within(panel()).queryByText('No usage providers available')).not.toBeInTheDocument();
  });

  it('fails closed (no probes at all) when harness defaults fail to load', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.getHarnessDefaults).mockRejectedValueOnce(new Error('store unavailable'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<UsageWidget />);
    await act(async () => { await Promise.resolve(); });
    await user.click(screen.getByRole('button', { name: 'Usage' }));
    expect(screen.queryByRole('dialog', { name: 'Usage' })).not.toBeInTheDocument();
    expect(calls()).toHaveLength(0);
    spy.mockRestore();
  });

  it('the header trigger is compact (icon only) but still named Usage; the popover keeps its USAGE heading', async () => {
    await openUsage();
    const trigger = screen.getByRole('button', { name: 'Usage' });
    expect(trigger).toHaveAttribute('title', 'Usage · Local');
    expect(trigger.textContent?.trim()).toBe('');
    expect(within(panel()).getByText('Usage')).toBeInTheDocument();
  });
});

describe('Usage in Assistant destinations', () => {
  it('renders UsageWidget in Assistant view without workspaces and queries with null workspaceId', async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: null, workspaces: [] });
    useAssistantNavStore.setState({ activeAssistantId: 'hermes:fred' });
    await openUsage();
    expect(calls().length).toBe(5);
    expect(calls().every(([wsId]) => wsId === null)).toBe(true);
    await respond(pending.find((d) => d.harnessId === 'claude')!, okEntry('claude', 'Claude · 5 hour', 40));
    expect(within(within(panel()).getByRole('region', { name: 'Claude' })).getByText('60% remaining')).toBeInTheDocument();
  });

  it('retains local readings across workspace and Assistant navigation', async () => {
    // 1. In local workspace ws-1, open Usage and populate Claude
    await openUsage();
    await respond(pending.find((d) => d.harnessId === 'claude')!, okEntry('claude', 'Claude · 5 hour', 30));
    expect(within(within(panel()).getByRole('region', { name: 'Claude' })).getByText('70% remaining')).toBeInTheDocument();

    // 2. Switch to Assistant: popover closes on destination switch
    act(() => useAssistantNavStore.setState({ activeAssistantId: 'hermes:fred' }));
    expect(screen.queryByRole('dialog', { name: 'Usage' })).not.toBeInTheDocument();

    // 3. Open Usage in Assistant: Claude reading is immediately visible without blanking
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usage' })); });
    expect(within(within(panel()).getByRole('region', { name: 'Claude' })).getByText('70% remaining')).toBeInTheDocument();
  });
});
