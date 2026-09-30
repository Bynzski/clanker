// @vitest-environment jsdom

/**
 * Renderer Theme Store Tests
 *
 * Verifies renderer theme state, DOM root synchronization (`data-theme`, `color-scheme`),
 * and persistence via preload bridge.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  useThemeStore,
  applyThemeToDocument,
} from '../../../src/renderer/theme/themeStore';
import { DEFAULT_THEME_ID } from '../../../src/shared/types/theme';

describe('themeStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';

    // Reset store state
    useThemeStore.setState({
      theme: DEFAULT_THEME_ID,
      resolved: false,
    });

    window.electronAPI = {
      getTheme: vi.fn().mockResolvedValue('dark'),
      setTheme: vi.fn().mockResolvedValue(undefined),
    } as unknown as typeof window.electronAPI;
  });

  describe('applyThemeToDocument', () => {
    it('sets data-theme and colorScheme for dark theme', () => {
      applyThemeToDocument('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });

    it('sets data-theme and colorScheme for light theme', () => {
      applyThemeToDocument('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(document.documentElement.style.colorScheme).toBe('light');
    });
  });

  describe('useThemeStore.setTheme', () => {
    it('updates store, document attributes, and calls electronAPI.setTheme', async () => {
      await useThemeStore.getState().setTheme('light');

      expect(useThemeStore.getState().theme).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(document.documentElement.style.colorScheme).toBe('light');
      expect(window.electronAPI.setTheme).toHaveBeenCalledWith('light');
    });

    it('normalizes invalid theme values to dark', async () => {
      // @ts-expect-error Testing invalid runtime value
      await useThemeStore.getState().setTheme('invalid-theme');

      expect(useThemeStore.getState().theme).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(document.documentElement.style.colorScheme).toBe('dark');
      expect(window.electronAPI.setTheme).toHaveBeenCalledWith('dark');
    });

    it('handles electronAPI.setTheme rejection gracefully without throwing', async () => {
      vi.mocked(window.electronAPI.setTheme).mockRejectedValueOnce(new Error('IPC failed'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(useThemeStore.getState().setTheme('light')).resolves.not.toThrow();
      expect(useThemeStore.getState().theme).toBe('light');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('useThemeStore.initializeTheme', () => {
    it('loads persisted theme, applies it to DOM, and marks resolved', async () => {
      vi.mocked(window.electronAPI.getTheme).mockResolvedValueOnce('light');

      const theme = await useThemeStore.getState().initializeTheme();

      expect(theme).toBe('light');
      expect(useThemeStore.getState().theme).toBe('light');
      expect(useThemeStore.getState().resolved).toBe(true);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(document.documentElement.style.colorScheme).toBe('light');
    });

    it('falls back to dark if electronAPI.getTheme rejects', async () => {
      vi.mocked(window.electronAPI.getTheme).mockRejectedValueOnce(new Error('Store inaccessible'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const theme = await useThemeStore.getState().initializeTheme();

      expect(theme).toBe('dark');
      expect(useThemeStore.getState().theme).toBe('dark');
      expect(useThemeStore.getState().resolved).toBe(true);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(document.documentElement.style.colorScheme).toBe('dark');

      consoleErrorSpy.mockRestore();
    });

    it('normalizes invalid returned theme from IPC to dark', async () => {
      vi.mocked(window.electronAPI.getTheme).mockResolvedValueOnce('corrupt-string' as unknown as 'dark');

      const theme = await useThemeStore.getState().initializeTheme();

      expect(theme).toBe('dark');
      expect(useThemeStore.getState().theme).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });
});
