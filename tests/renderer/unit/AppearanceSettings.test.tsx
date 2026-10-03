import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const themeRadio = (theme: string) => screen.getByRole('radio', { name: THEME_METADATA[theme as keyof typeof THEME_METADATA].label });

describe('Appearance settings integration', () => {
  it.each(THEME_IDS)('renders the current %s identity and canonical registry labels', (theme) => {
    useThemeStore.setState({ theme });
    const view = render(<AppearanceSettings />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(within(group).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label')))
      .toEqual(THEME_IDS.map((id) => THEME_METADATA[id].label));
    expect(themeRadio(theme)).toHaveAttribute('aria-checked', 'true');
    view.rerender(<AppearanceSettings />);
    expect(within(group).getAllByRole('radio', { checked: true })).toEqual([themeRadio(theme)]);
  });

  it('paints each swatch with its own theme tokens', () => {
    render(<AppearanceSettings />);
    for (const id of THEME_IDS) {
      expect(themeRadio(id).querySelector('[data-theme-preview]')).toHaveAttribute('data-theme-preview', id);
    }
  });

  it('updates the real store, DOM, native color scheme and persistence bridge immediately both ways', async () => {
    const setTheme = vi.spyOn(useThemeStore.getState(), 'setTheme');
    render(<AppearanceSettings />);
    const workspace = useWorkspaceStore.getState();
    for (const theme of ['light', 'slate', 'dark'] as const) {
      fireEvent.click(themeRadio(theme));
      expect(setTheme).toHaveBeenLastCalledWith(theme);
      expect(themeRadio(theme)).toHaveAttribute('aria-checked', 'true');
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
    fireEvent.click(themeRadio('light'));
    await act(async () => { await Promise.resolve(); });
    expect(themeRadio('light')).toHaveAttribute('aria-checked', 'true');
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
    fireEvent.click(themeRadio('light'));
    fireEvent.click(themeRadio('dark'));
    await act(async () => { finish[1](); finish[0](); await Promise.resolve(); });
    expect(persisted).toBe('dark');
    expect(themeRadio('dark')).toHaveAttribute('aria-checked', 'true');
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(vi.mocked(window.electronAPI.setTheme).mock.calls.map(([theme]) => theme)).toEqual(['light', 'dark']);
  });

  it('is keyboard accessible as a labeled radio group', async () => {
    const user = userEvent.setup(); render(<AppearanceSettings />);
    await user.tab();
    expect(themeRadio('dark')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(themeRadio('light')).toHaveFocus();
    await user.keyboard(' ');
    expect(themeRadio('light')).toHaveAttribute('aria-checked', 'true');
    expect(useThemeStore.getState().theme).toBe('light');
  });
});

describe('Appearance settings workspace navigation', () => {
  it('shows and persists the navigation mode', async () => {
    installElectronApiMock({ setWorkspaceNavigationMode: vi.fn().mockResolvedValue(undefined) });
    useWorkspaceNavigationStore.setState({ mode: 'tabs', resolved: true });
    render(<AppearanceSettings />);
    const group = screen.getByRole('radiogroup', { name: 'Workspaces' });
    expect(within(group).getByRole('radio', { name: 'Tabs' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(group).getByRole('radio', { name: 'Sidebar' }));
    expect(useWorkspaceNavigationStore.getState().mode).toBe('sidebar');
    expect(window.electronAPI.setWorkspaceNavigationMode).toHaveBeenCalledWith('sidebar');
    await act(async () => { await Promise.resolve(); });
    useWorkspaceNavigationStore.setState({ mode: 'tabs' });
  });
});
