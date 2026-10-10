import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Header from '../../../src/renderer/components/Header';
import { dispatchAppKeybinding, openSettings } from '../../../src/renderer/lib/keybindingDispatcher';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useKeybindingStore } from '../../../src/renderer/store/keybindingStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { useThemeStore } from '../../../src/renderer/theme/themeStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

vi.mock('../../../src/renderer/components/GitButton', () => ({ default: () => null }));

beforeEach(() => {
  installElectronApiMock();
  useWorkspaceStore.setState({ activeWorkspaceId: 'one', workspaces: [
    createWorkspaceFixture({ id: 'one', browserVisible: true, browserOverlayCount: 0 }),
    createWorkspaceFixture({ id: 'two', environmentId: 'ssh-two', lifecycle: 'parked', browserVisible: true, browserOverlayCount: 0 }),
  ] });
  useKeybindingStore.setState({ overrides: {}, loaded: true, capturing: false });
  useThemeStore.setState({ theme: 'dark', resolved: true });
  useWorkspaceNavigationStore.setState({ mode: 'tabs', resolved: true });
});

const count = (id: string) => useWorkspaceStore.getState().getWorkspaceById(id)?.browserOverlayCount;

describe('Settings management destination', () => {
  it('opens through the existing Ctrl+, dispatcher and closes via the shared backdrop', async () => {
    const user = userEvent.setup();
    render(<Header />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    trigger.focus();
    const event = new KeyboardEvent('keydown', { code: 'Comma', key: ',', ctrlKey: true, cancelable: true });
    act(() => {
      expect(dispatchAppKeybinding(event, { openSettings, fitAllPanes: vi.fn(), toggleExplorer: vi.fn(), saveActiveEditorFile: vi.fn(), zoomApp: vi.fn() })).toBe(true);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    expect(count('one')).toBe(1);
    await user.click(document.querySelector('.clanker-dialog-overlay')!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(count('one')).toBe(0);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('uses keyboard-operable navigation, preserves theme/layout persistence and resets the page on reopen', async () => {
    const user = userEvent.setup();
    render(<Header />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const appearance = within(nav).getByRole('button', { name: 'Appearance' });
    appearance.focus();
    expect(appearance).toHaveAttribute('aria-current', 'page');
    for (const [label, theme] of [['Light', 'light'], ['Slate', 'slate'], ['Dark', 'dark']]) {
      await user.click(screen.getByRole('radio', { name: label }));
      expect(window.electronAPI.setTheme).toHaveBeenLastCalledWith(theme);
      expect(document.documentElement).toHaveAttribute('data-theme', theme);
      expect(count('one')).toBe(1);
    }
    appearance.focus();
    await user.tab();
    expect(within(nav).getByRole('button', { name: 'Workspaces & Layout' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Workspaces & Layout' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('radio', { name: 'Sidebar' }));
    expect(window.electronAPI.setWorkspaceNavigationMode).toHaveBeenCalledWith('sidebar');
    await user.click(screen.getByRole('button', { name: 'Keyboard Shortcuts' }));
    expect(screen.getByRole('searchbox', { name: 'Search shortcuts' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Legacy Settings' }));
    expect(screen.getByRole('button', { name: 'Manage VCS credentials' })).toBeVisible();
    expect(screen.getByText(/Open Workspace → target settings/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close Settings' }));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps global preferences open across workspace changes while moving only its Browser lease', async () => {
    const user = userEvent.setup();
    render(<Header />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(count('one')).toBe(1);
    act(() => useWorkspaceStore.getState().selectWorkspace('two'));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
    expect(count('one')).toBe(0);
    expect(count('two')).toBe(1);
    const discoveryCalls = vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Keyboard Shortcuts' }));
    await user.click(screen.getByRole('button', { name: 'Edit Save File shortcut' }));
    expect(useKeybindingStore.getState().capturing).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    expect(useKeybindingStore.getState().capturing).toBe(false);
    fireEvent.click(screen.getByRole('radio', { name: 'Slate' }));
    expect(vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mock.calls.length).toBe(discoveryCalls);
    await user.keyboard('{Escape}');
    expect(count('two')).toBe(0);
  });
});
