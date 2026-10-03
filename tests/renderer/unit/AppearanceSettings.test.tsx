import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppearanceSettings from '../../../src/renderer/components/settings/AppearanceSettings';
import { useThemeStore } from '../../../src/renderer/theme/themeStore';
import { THEME_IDS, THEME_METADATA } from '../../../src/shared/types/theme';
import { installElectronApiMock } from '../../setup/electron';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';

const originalSetTheme = useThemeStore.getState().setTheme;

beforeEach(() => {
  installElectronApiMock({ setTheme: vi.fn().mockResolvedValue(undefined) });
  useThemeStore.setState({ theme: 'dark', resolved: true, setTheme: originalSetTheme });
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.style.colorScheme = 'dark';
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); useThemeStore.setState({ setTheme: originalSetTheme }); });

describe('Appearance settings integration', () => {
  it.each(THEME_IDS)('renders the current %s identity and canonical registry labels', (theme) => {
    useThemeStore.setState({ theme });
    const view = render(<AppearanceSettings />);
    const select = screen.getByRole('combobox', { name: 'Theme' });
    expect(select).toHaveValue(theme);
    expect([...select.querySelectorAll('option')].map((option) => ({ id: option.value, label: option.textContent })))
      .toEqual(THEME_IDS.map((id) => ({ id, label: THEME_METADATA[id].label })));
    view.rerender(<AppearanceSettings />);
    expect(select).toHaveValue(theme);
    expect(screen.getByLabelText('Theme')).toBe(select);
  });

  it('updates the real store, DOM, native color scheme and persistence bridge immediately both ways', async () => {
    const setTheme = vi.spyOn(useThemeStore.getState(), 'setTheme');
    render(<AppearanceSettings />);
    const workspace = useWorkspaceStore.getState();
    const select = screen.getByLabelText('Theme');
    for (const theme of ['light', 'slate', 'dark'] as const) {
      fireEvent.change(select, { target: { value: theme } });
      expect(setTheme).toHaveBeenLastCalledWith(theme);
      expect(select).toHaveValue(theme);
      expect(useThemeStore.getState().theme).toBe(theme);
      expect(document.documentElement.dataset.theme).toBe(theme);
      expect(document.documentElement.style.colorScheme).toBe(THEME_METADATA[theme].colorScheme);
      expect(window.electronAPI.setTheme).toHaveBeenLastCalledWith(theme);
      expect(useWorkspaceStore.getState()).toBe(workspace);
      await act(async () => { await Promise.resolve(); });
    }
  });

  it('remains valid on persistence failure and produces no rejected store promise', async () => {
    vi.mocked(window.electronAPI.setTheme).mockRejectedValueOnce(new Error('store unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AppearanceSettings />);
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'light' } });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText('Theme')).toHaveValue('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(log).toHaveBeenCalledWith('[clanker-grid] Failed to persist theme:', expect.any(Error));
  });

  it('settles rapid changes even when persistence acknowledgements complete in reverse order', async () => {
    let persisted = 'dark';
    const finish: (() => void)[] = [];
    vi.mocked(window.electronAPI.setTheme).mockImplementation((theme) => {
      // Main's handler commits synchronously when each ordered message arrives.
      persisted = theme;
      return new Promise<void>((resolve) => finish.push(resolve));
    });
    render(<AppearanceSettings />);
    const select = screen.getByLabelText('Theme');
    fireEvent.change(select, { target: { value: 'light' } });
    fireEvent.change(select, { target: { value: 'dark' } });
    await act(async () => { finish[1](); finish[0](); await Promise.resolve(); });
    expect(persisted).toBe('dark');
    expect(select).toHaveValue('dark');
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(vi.mocked(window.electronAPI.setTheme).mock.calls.map(([theme]) => theme)).toEqual(['light', 'dark']);
  });

  it('is keyboard accessible through a labeled native select', async () => {
    const user = userEvent.setup(); render(<AppearanceSettings />);
    await user.tab();
    const select = screen.getByRole('combobox', { name: 'Theme' });
    expect(select).toHaveFocus();
    await user.selectOptions(select, 'light');
    expect(select).toHaveValue('light');
  });
});

describe('Appearance settings workspace navigation', () => {
  it('shows and persists the navigation mode', async () => {
    installElectronApiMock({ setWorkspaceNavigationMode: vi.fn().mockResolvedValue(undefined) });
    useWorkspaceNavigationStore.setState({ mode: 'tabs', resolved: true });
    render(<AppearanceSettings />);
    const select = screen.getByLabelText('Workspace navigation');
    expect(select).toHaveValue('tabs');
    fireEvent.change(select, { target: { value: 'sidebar' } });
    expect(useWorkspaceNavigationStore.getState().mode).toBe('sidebar');
    expect(window.electronAPI.setWorkspaceNavigationMode).toHaveBeenCalledWith('sidebar');
    await act(async () => { await Promise.resolve(); });
    useWorkspaceNavigationStore.setState({ mode: 'tabs' });
  });
});
