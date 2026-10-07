import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openSettings } from '../../../src/renderer/lib/keybindingDispatcher';
import Header from '../../../src/renderer/components/Header';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

vi.mock('../../../src/renderer/components/GitButton', () => ({ default: () => null }));
vi.mock('../../../src/renderer/lib/terminalPaneGeometry', async (original) => ({
  ...(await original<object>()), waitForTerminalPaneGeometry: vi.fn().mockResolvedValue({ cols: 120, rows: 40 }),
}));
const renderHeader = () => render(<Header />);

  describe('Header overlay interactions', () => {
    const count = () => useWorkspaceStore.getState().getWorkspaceById('ws-1')?.browserOverlayCount ?? 0;
    beforeEach(() => {
      installElectronApiMock();
      useWorkspaceStore.setState({
        activeWorkspaceId: 'ws-1', browserOverlayCount: 0,
        workspaces: [createWorkspaceFixture({ id: 'ws-1', workspacePath: '/workspace', browserVisible: true, browserOverlayCount: 0, terminals: [], panes: [] })],
      });
      vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({ codex: { name: 'Codex', command: 'codex', args: [], icon: 'terminal' } });
      useWorkspaceStore.setState((state) => ({
        browserOverlayCount: 0,
        workspaces: state.workspaces.map((workspace) => ({ ...workspace, browserVisible: true, browserOverlayCount: 0 })),
      }));
    });

    it.each(['Settings', 'Chat history', 'Usage'])('%s acquires a lease, dismisses on Escape and restores trigger focus', async (name) => {
      const user = userEvent.setup();
      renderHeader();
      const trigger = screen.getByRole('button', { name });
      expect(count()).toBe(0);
      await user.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('dialog', { name })).toBeInTheDocument();
      expect(count()).toBe(1);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name })).not.toBeInTheDocument();
      expect(count()).toBe(0);
      await waitFor(() => expect(trigger).toHaveFocus());
    });

    it.each(['Settings', 'Chat history', 'Usage'])('%s dismisses on outside interaction', async (name) => {
      const user = userEvent.setup();
      renderHeader();
      await user.click(screen.getByRole('button', { name }));
      await user.click(screen.getByRole('button', { name: 'Fit all panes' }));
      expect(screen.queryByRole('dialog', { name })).not.toBeInTheDocument();
      expect(count()).toBe(0);
    });

    it.each(['Settings', 'Chat history', 'Usage'])('%s releases only its own lease on unmount', async (name) => {
      const user = userEvent.setup();
      useWorkspaceStore.getState().pushBrowserOverlay('ws-1');
      const { unmount } = renderHeader();
      await user.click(screen.getByRole('button', { name }));
      expect(count()).toBe(2);
      unmount();
      expect(count()).toBe(1);
      useWorkspaceStore.getState().popBrowserOverlay('ws-1');
    });

    it('discovers once per opening, closes on second trigger activation and ignores a dismissed request', async () => {
      const user = userEvent.setup();
      let finish!: (sessions: import('../../../src/shared/types/session').HarnessSession[]) => void;
      vi.mocked(window.electronAPI.discoverSessions).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      renderHeader();
      const trigger = screen.getByRole('button', { name: 'Chat history' });
      await user.click(trigger);
      expect(window.electronAPI.discoverSessions).toHaveBeenCalledExactlyOnceWith('ws-1');
      await user.click(trigger);
      expect(count()).toBe(0);
      await user.click(trigger);
      await act(async () => finish([{ id: 'old', harness: 'codex', title: 'Dismissed request', cwd: '/workspace', timestamp: 0 }]));
      expect(window.electronAPI.discoverSessions).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('Dismissed request')).not.toBeInTheDocument();
    });

    it('shows provider warnings without hiding successful conversations', async () => {
      vi.mocked(window.electronAPI.discoverSessionHistory).mockResolvedValue({
        sessions: [{ id: 'good', harness: 'codex', title: 'Usable conversation', cwd: '/workspace', timestamp: 1 }],
        issues: [{ harness: 'pi', message: 'Pi history could not be read.' }],
      });
      const user = userEvent.setup(); renderHeader();
      await user.click(screen.getByRole('button', { name: 'Chat history' }));
      expect(await screen.findByText('Pi history could not be read.')).toBeVisible();
      await user.click(screen.getByRole('button', { name: /Codex.*1/ }));
      expect(screen.getByText('Usable conversation')).toBeVisible();
    });

    it('keeps discovery errors visible in Chat History', async () => {
      const user = userEvent.setup();
      vi.mocked(window.electronAPI.discoverSessions).mockRejectedValue(new Error('Host unavailable'));
      renderHeader();
      await user.click(screen.getByRole('button', { name: 'Chat history' }));
      expect(await screen.findByText('Host unavailable')).toBeVisible();
      expect(count()).toBe(1);
    });

    it('makes sibling popovers mutually exclusive in both directions', async () => {
      const user = userEvent.setup();
      renderHeader();
      await user.click(screen.getByRole('button', { name: 'Settings' }));
      await user.click(screen.getByRole('button', { name: 'Chat history' }));
      expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Chat history' })).toBeInTheDocument();
      expect(count()).toBe(1);
      await user.click(screen.getByRole('button', { name: 'Settings' }));
      expect(screen.queryByRole('dialog', { name: 'Chat history' })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
      expect(count()).toBe(1);
    });

    it('makes Chat history, Usage and Settings mutually exclusive in every direction, keeping exactly one lease', async () => {
      const user = userEvent.setup();
      renderHeader();
      const names = ['Chat history', 'Usage', 'Settings'];
      const counts: number[] = [];
      const unsubscribe = useWorkspaceStore.subscribe(() => counts.push(count()));
      try {
        for (const [from, to] of [[0, 1], [1, 2], [2, 0], [0, 2], [2, 1], [1, 0]]) {
          await user.click(screen.getByRole('button', { name: names[from] }));
          expect(screen.getByRole('dialog', { name: names[from] })).toBeInTheDocument();
          await user.click(screen.getByRole('button', { name: names[to] }));
          for (const name of names) {
            if (name === names[to]) expect(screen.getByRole('dialog', { name })).toBeInTheDocument();
            else expect(screen.queryByRole('dialog', { name })).not.toBeInTheDocument();
          }
          expect(count()).toBe(1);
          await user.click(screen.getByRole('button', { name: names[to] }));
          expect(count()).toBe(0);
        }
      } finally { unsubscribe(); }
      // A handoff never stacks two leases for the same overlay.
      expect(Math.max(...counts)).toBeLessThanOrEqual(1);
    });

    it('requests nothing before Usage opens, then queries only the focused workspace id', async () => {
      const user = userEvent.setup();
      renderHeader();
      expect(window.electronAPI.getHarnessUsage).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Usage' }));
      expect(window.electronAPI.getHarnessUsage).toHaveBeenCalled();
      for (const call of vi.mocked(window.electronAPI.getHarnessUsage).mock.calls) expect(call[0]).toBe('ws-1');
    });

    it('closes Usage and balances its lease on workspace switch, ignoring a stale response, and queries the new workspace id', async () => {
      const user = userEvent.setup();
      let finish!: (response: import('../../../src/shared/types/harnessUsage').HarnessUsageResponse) => void;
      vi.mocked(window.electronAPI.getHarnessUsage).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      useWorkspaceStore.setState((state) => ({ workspaces: [...state.workspaces, createWorkspaceFixture({ id: 'ws-2', lifecycle: 'parked' })] }));
      renderHeader();
      await user.click(screen.getByRole('button', { name: 'Usage' }));
      expect(count()).toBe(1);
      act(() => useWorkspaceStore.getState().selectWorkspace('ws-2'));
      expect(count()).toBe(0);
      expect(screen.queryByRole('dialog', { name: 'Usage' })).not.toBeInTheDocument();
      await act(async () => finish({ workspaceId: 'ws-1', entries: [{ harnessId: 'codex', status: 'ok', checkedAt: Date.now(), measurements: [{ kind: 'rate-limit', unit: 'percent', used: 5, remaining: 95, limit: 100, label: 'Codex · OLD WORKSPACE' }] }] }));
      vi.mocked(window.electronAPI.getHarnessUsage).mockClear();
      await user.click(screen.getByRole('button', { name: 'Usage' }));
      expect(screen.queryByText('OLD WORKSPACE')).not.toBeInTheDocument();
      for (const call of vi.mocked(window.electronAPI.getHarnessUsage).mock.calls) expect(call[0]).toBe('ws-2');
      expect(vi.mocked(window.electronAPI.getHarnessUsage).mock.calls.length).toBeGreaterThan(0);
    });

    it('opens the existing Settings popover from the keybinding dispatcher', async () => {
      renderHeader();
      expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
      act(() => openSettings());
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('hands Settings off to Keyboard Shortcuts and restores Settings trigger focus on close', async () => {
      const user = userEvent.setup();
      renderHeader();
      const trigger = screen.getByRole('button', { name: 'Settings' });
      await user.click(trigger);
      expect(count()).toBe(1);
      await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
      expect(screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
      expect(count()).toBe(1);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Keyboard Shortcuts' })).not.toBeInTheDocument();
      expect(count()).toBe(0);
      await waitFor(() => expect(trigger).toHaveFocus());
    });

    it.each([0, 1])('hands Settings off to Credentials without releasing browser suppression (other owners: %s)', async (otherOwners) => {
      const user = userEvent.setup();
      if (otherOwners) useWorkspaceStore.getState().pushBrowserOverlay('ws-1');
      renderHeader();
      const trigger = screen.getByRole('button', { name: 'Settings' });
      await user.click(trigger);
      expect(count()).toBe(otherOwners + 1);
      const counts: number[] = [];
      const unsubscribe = useWorkspaceStore.subscribe(() => counts.push(count()));
      const focusTargets: EventTarget[] = [];
      const recordFocus = (event: FocusEvent) => { if (event.target) focusTargets.push(event.target); };
      document.addEventListener('focusin', recordFocus);
      try {
        await user.click(screen.getByRole('button', { name: 'Manage VCS credentials' }));
        const dialog = screen.getByRole('dialog', { name: 'VCS Credentials' });
        expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
        expect(dialog.contains(document.activeElement)).toBe(true);
        expect(focusTargets).not.toContain(trigger);
        expect(count()).toBe(otherOwners + 1);
        expect(counts).toContain(otherOwners + 2);
        expect(Math.min(...counts)).toBe(otherOwners + 1);
        await user.keyboard('{Escape}');
        expect(count()).toBe(otherOwners);
        expect(screen.queryByRole('dialog', { name: 'VCS Credentials' })).not.toBeInTheDocument();
        await waitFor(() => expect(trigger).toHaveFocus());
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
      } finally {
        unsubscribe();
        document.removeEventListener('focusin', recordFocus);
        if (otherOwners) useWorkspaceStore.getState().popBrowserOverlay('ws-1');
      }
    });

    it.each(['close button', 'backdrop'])('Credentials closes via %s after handoff', async (method) => {
      const user = userEvent.setup();
      renderHeader();
      await user.click(screen.getByRole('button', { name: 'Settings' }));
      await user.click(screen.getByRole('button', { name: 'Manage VCS credentials' }));
      const dialog = screen.getByRole('dialog', { name: 'VCS Credentials' });
      expect(within(dialog).getByRole('heading', { name: 'VCS Credentials' })).toBeInTheDocument();
      if (method === 'close button') await user.click(within(dialog).getByRole('button', { name: 'Close VCS Credentials' }));
      else await user.click(document.querySelector('.credential-settings-overlay')!);
      expect(screen.queryByRole('dialog', { name: 'VCS Credentials' })).not.toBeInTheDocument();
      expect(count()).toBe(0);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus());
    });
    it('closes Chat History and balances its lease on workspace switch, ignoring stale discovery', async () => {
      const user = userEvent.setup();
      let finish!: (sessions: import('../../../src/shared/types/session').HarnessSession[]) => void;
      vi.mocked(window.electronAPI.discoverSessions).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      useWorkspaceStore.setState((state) => ({ workspaces: [...state.workspaces, createWorkspaceFixture({ id: 'ws-2', lifecycle: 'parked' })] }));
      renderHeader();
      await user.click(screen.getByRole('button', { name: 'Chat history' }));
      expect(count()).toBe(1);
      act(() => useWorkspaceStore.getState().selectWorkspace('ws-2'));
      expect(count()).toBe(0);
      expect(screen.queryByRole('dialog', { name: 'Chat history' })).not.toBeInTheDocument();
      await act(async () => finish([{ id: 'old', harness: 'codex', title: 'Old workspace', cwd: '/workspace', timestamp: 0 }]));
      await user.click(screen.getByRole('button', { name: 'Chat history' }));
      expect(window.electronAPI.discoverSessions).toHaveBeenLastCalledWith('ws-2');
      expect(screen.queryByText('Old workspace')).not.toBeInTheDocument();
    });

    it.each(['switch', 'remove'])('preserves async session ownership when the workspace changes: %s', async (change) => {
      const user = userEvent.setup();
      const session = { id: 's', harness: 'codex' as const, title: 'Resume me', cwd: '/workspace', timestamp: 0 };
      vi.mocked(window.electronAPI.discoverSessions).mockResolvedValue([session]);
      let finish!: (info: { id: string; pid: number }) => void;
      vi.mocked(window.electronAPI.invokeSession).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      useWorkspaceStore.setState((state) => ({ workspaces: [...state.workspaces, createWorkspaceFixture({ id: 'ws-2', lifecycle: 'parked', terminals: [], panes: [] })] }));
      renderHeader();
      await user.click(screen.getByRole('button', { name: 'Chat history' }));
      await user.click(await screen.findByRole('button', { name: /Codex.*1/ }));
      await user.click(screen.getByRole('button', { name: 'Resume me' }));
      expect(window.electronAPI.invokeSession).toHaveBeenCalledWith('ws-1', session, false, { initialGeometry: { cols: 120, rows: 40 } });
      act(() => {
        useWorkspaceStore.getState().selectWorkspace('ws-2');
        if (change === 'remove') useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.filter((workspace) => workspace.id !== 'ws-1') }));
      });
      await act(async () => finish({ id: 'resumed', pid: 12 }));
      expect(useWorkspaceStore.getState().getWorkspaceById('ws-2')?.terminals).toEqual([]);
      if (change === 'remove') expect(window.electronAPI.killTerminal).toHaveBeenCalledWith('resumed');
      else expect(useWorkspaceStore.getState().getWorkspaceById('ws-1')?.terminals).toEqual([expect.objectContaining({ id: 'resumed', workspaceId: 'ws-1' })]);
    });

    it('keeps resume errors visible, then closes after successful retry', async () => {
      const user = userEvent.setup();
      const session = { id: 's', harness: 'codex' as const, title: 'Resume me', cwd: '/workspace', timestamp: 0 };
      vi.mocked(window.electronAPI.discoverSessions).mockResolvedValue([session]);
      vi.mocked(window.electronAPI.invokeSession).mockRejectedValueOnce(new Error('Cannot resume')).mockResolvedValueOnce({ id: 'resumed', pid: 12 });
      renderHeader();
      await user.click(screen.getByRole('button', { name: 'Chat history' }));
      await user.click(await screen.findByRole('button', { name: /Codex.*1/ }));
      await user.click(screen.getByRole('button', { name: 'Resume me' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Cannot resume');
      expect(count()).toBe(1);
      await user.click(screen.getByRole('button', { name: 'Resume me' }));
      expect(screen.queryByRole('dialog', { name: 'Chat history' })).not.toBeInTheDocument();
      expect(count()).toBe(0);
      expect(useWorkspaceStore.getState().getWorkspaceById('ws-1')?.terminals).toEqual([expect.objectContaining({ id: 'resumed' })]);
    });

    it('keeps expanded harness controls interactive and persists changes inside Settings', async () => {
      const user = userEvent.setup();
      vi.mocked(window.electronAPI.getHarnessModels).mockResolvedValue([{ id: 'm', label: 'Model M' }]);
      renderHeader();
      await user.click(screen.getByRole('button', { name: 'Settings' }));
      const panel = screen.getByRole('dialog', { name: 'Settings' });
      await user.click(await within(panel).findByRole('button', { name: 'Codex' }));
      await user.click(within(panel).getByRole('checkbox', { name: 'Agent attention for Codex' }));
      expect(window.electronAPI.setHarnessDefaults).toHaveBeenLastCalledWith(expect.objectContaining({ codex: expect.objectContaining({ attentionEnabled: true }) }));
      await user.click(within(panel).getByRole('button', { name: 'Codex default model' }));
      expect(count()).toBe(2);
      await user.click(screen.getByRole('button', { name: 'Add Model M to favorites' }));
      expect(window.electronAPI.setHarnessDefaults).toHaveBeenLastCalledWith(expect.objectContaining({ codex: expect.objectContaining({ favorites: ['m'] }) }));
      expect(panel).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Models' })).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(within(panel).getByRole('button', { name: 'Codex default model' })).toHaveFocus());
      expect(count()).toBe(1);
      await user.click(within(panel).getByRole('button', { name: 'Codex default model' }));
      await user.click(screen.getByRole('button', { name: 'Model M' }));
      expect(window.electronAPI.setHarnessDefaults).toHaveBeenLastCalledWith(expect.objectContaining({ codex: expect.objectContaining({ model: 'm' }) }));
      expect(panel).toBeInTheDocument();
      expect(count()).toBe(1);
    });

  });

