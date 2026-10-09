import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import UsageWidget from '../../../src/renderer/components/UsageWidget';
import { useUsageWidgetStore } from '../../../src/renderer/store/usageWidgetStore';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useUsageStore } from '../../../src/renderer/store/usageStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import type { HarnessUsageEntry } from '../../../src/shared/types/harnessUsage';
import { formatResetShort, pickWidgetUsage, usageTone } from '../../../src/renderer/lib/usageFormat';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

const pct = (label: string, used: number, resetsAt?: number) => ({ kind: 'rate-limit' as const, unit: 'percent', used, remaining: 100 - used, limit: 100, label, resetsAt });

describe('widget formatting', () => {
  const now = 1_000_000;
  it('is coarse: minutes under an hour, hours under a day, whole days beyond', () => {
    expect(formatResetShort(now + 35 * 60_000, now)).toBe('35m');
    expect(formatResetShort(now + (3 * 60 + 40) * 60_000, now)).toBe('3h');
    expect(formatResetShort(now + (5 * 24 + 19) * 3_600_000, now)).toBe('5d');
  });
  it('prefers the five-hour limit, falls back to weekly, else nothing', () => {
    const week = pct('Claude · weekly', 36);
    const five = pct('Claude · 5 hour', 17);
    expect(pickWidgetUsage([week, five], 'Claude')?.percent).toBe(83);
    expect(pickWidgetUsage([week], 'Claude')?.percent).toBe(64);
    expect(pickWidgetUsage([pct('Claude · monthly', 10)], 'Claude')).toBeUndefined();
  });
  it('color-codes remaining capacity', () => {
    expect([0.9, 0.4, 0.1].map(usageTone)).toEqual(['ok', 'warn', 'low']);
  });
});

describe('UsageWidget', () => {
  beforeEach(() => useAssistantNavStore.setState({ activeAssistantId: null }));

  function setup(scope: 'local' | 'ssh' | 'assistant') {
    const entry: HarnessUsageEntry = { harnessId: 'claude', status: 'ok', measurements: [pct('Claude · 5 hour', 17)], checkedAt: Date.now(), nextRefreshAt: Date.now() + 60_000 };
    const options = { claude: { name: 'claude', command: 'claude', args: [], icon: 'terminal' } };
    const api = installElectronApiMock({
      getHarnessOptions: vi.fn().mockResolvedValue(options),
      getEnvironmentHarnessOptions: vi.fn().mockResolvedValue(options),
      getHarnessUsage: vi.fn(async (workspaceId: string | null) => ({ environmentId: workspaceId ? 'ssh-1' : 'local', environmentGeneration: 0, entries: [entry] })),
    });
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', workspaces: [createWorkspaceFixture({ id: 'ws-1', workspacePath: '/w', terminals: [], panes: [],
      environmentId: scope === 'local' ? 'local' : 'ssh-1', environmentLabel: scope === 'local' ? 'Local' : 'Staging',
    })] });
    if (scope === 'assistant') useAssistantNavStore.setState({ activeAssistantId: 'hermes:fred' });
    useUsageWidgetStore.setState({ ids: ['claude'] });
    render(<UsageWidget />);
    return { api, entry };
  }

  it.each([
    ['local', 'Local'], ['ssh', 'SSH · Staging'], ['assistant', 'Local'],
  ] as const)('%s displays its safe effective scope in the dropdown and pinned tooltip', async (scope, label) => {
    const { api } = setup(scope);
    const button = screen.getByRole('button', { name: 'Usage' });
    await waitFor(() => expect(button).toBeEnabled());
    await act(async () => fireEvent.click(button));
    expect(within(screen.getByRole('dialog', { name: 'Usage' })).getByText(label)).toHaveClass('usage-scope');
    const chip = button.querySelector('.usage-chip')!;
    await waitFor(() => expect(chip).toHaveTextContent('83%'));
    expect(chip).toHaveAttribute('title', expect.stringContaining(label));
    expect(chip).toHaveAttribute('aria-label', expect.stringContaining(label));
    expect(api.getHarnessUsage).toHaveBeenCalledWith(scope === 'ssh' ? 'ws-1' : null, { harnessIds: ['claude'] });
    if (scope === 'assistant') expect(chip.getAttribute('title')).not.toContain('Staging');
    expect(api.sshEnvironmentList).not.toHaveBeenCalled(); // reuses display-safe workspace metadata
  });

  it('retains the pinned percentage on probe failure, marks it stale, then clears the warning on success', async () => {
    const { api, entry } = setup('local');
    const button = screen.getByRole('button', { name: 'Usage' });
    await waitFor(() => expect(button.querySelector('.usage-chip')).toHaveTextContent('83%'));
    api.getHarnessUsage.mockRejectedValueOnce(new Error('probe failed'));
    await act(async () => useUsageStore.getState().request('local', null, 'claude', true));
    const chip = button.querySelector('.usage-chip')!;
    expect(chip).toHaveTextContent('83%');
    expect(chip).toHaveClass('usage-chip-problem');
    expect(chip.querySelector('.usage-chip-status')).toHaveClass('usage-status-error');
    expect(chip).toHaveAttribute('title', expect.stringContaining('Stale usage data · Usage could not be read'));
    expect(chip).toHaveAttribute('aria-label', expect.stringContaining('Stale usage data'));
    expect(chip.getAttribute('title')).toContain('last ');
    await act(async () => useUsageStore.getState().request('local', null, 'claude', true));
    expect(chip).toHaveTextContent('83%');
    expect(chip).not.toHaveClass('usage-chip-problem');
    expect(chip.querySelector('.usage-chip-status')).toBeNull();
    expect(chip.getAttribute('title')).not.toContain('Stale');
    // Being due for a future refresh is not a stale measurement.
    await act(async () => useUsageStore.getState().setEntry('local', 'claude', { ...entry, nextRefreshAt: Date.now() - 1 }));
    expect(chip).not.toHaveClass('usage-chip-problem');
  });

  it.each(['ok', 'unavailable'] as const)('indicates explicit stale %s readings without relying on quota color', async (status) => {
    const { entry } = setup('local');
    const button = screen.getByRole('button', { name: 'Usage' });
    await waitFor(() => expect(button.querySelector('.usage-chip')).toHaveTextContent('83%'));
    await act(async () => useUsageStore.getState().setEntry('local', 'claude', { ...entry, status, stale: true }));
    const chip = button.querySelector('.usage-chip')!;
    expect(chip).toHaveTextContent('83%');
    expect(chip.querySelector('.usage-chip-status')).toHaveClass('usage-status-warning');
    expect(chip).toHaveAttribute('aria-label', expect.stringContaining('Stale usage data'));
    if (status === 'unavailable') expect(chip.getAttribute('title')).toContain('Usage temporarily unavailable');
  });

  it('shows only the dial until a harness is pinned, then a chip with percent and time', async () => {
    const resetsAt = Date.now() + 3 * 3_600_000 + 60_000;
    installElectronApiMock({
      getHarnessOptions: vi.fn().mockResolvedValue({ claude: { name: 'claude', command: 'claude', args: [], icon: 'terminal' } }),
      getHarnessUsage: vi.fn().mockResolvedValue({ environmentId: 'local', environmentGeneration: 0, entries: [{ harnessId: 'claude', status: 'ok', measurements: [pct('Claude · 5 hour', 17, resetsAt)] }] }),
    });
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', workspaces: [createWorkspaceFixture({ id: 'ws-1', workspacePath: '/w', terminals: [], panes: [] })] });
    useUsageWidgetStore.setState({ ids: [] });
    render(<UsageWidget />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('button', { name: 'Usage' }).querySelector('.usage-chip')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usage' })); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Usage' })).getByRole('button', { name: 'Show Claude in status bar' })); });
    await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
    const chip = screen.getByRole('button', { name: 'Usage' }).querySelector('.usage-chip')!;
    expect(chip.textContent).toBe('83%3h');
    expect(chip.className).toContain('ok');
    const meter = chip.querySelector('.usage-chip-meter')!;
    expect(meter.children[0]).toHaveClass('usage-chip-percent');
    expect(meter.children[0]).toHaveTextContent('83%');
    expect(meter.children[1]).toHaveClass('usage-chip-bar');
    expect(chip.querySelector('.harness-logo-icon')).not.toBeNull();
    expect(chip.querySelector('.usage-chip-time')).toHaveTextContent('3h');
    expect(chip).toHaveAttribute('role', 'group');
    expect(chip.getAttribute('aria-label')).toContain('Claude');
    expect(chip.getAttribute('title')).toContain('resets in 3h');
    expect(chip.querySelector('.usage-chip-time svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
