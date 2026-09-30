/**
 * Renderer Theme Store
 *
 * Single source of truth for renderer-level theme identity and propagation.
 * Persists theme changes to electron-store via the preload bridge and synchronizes
 * document root attributes (`data-theme` and `color-scheme`).
 */

import { create } from 'zustand';
import {
  type ThemeId,
  DEFAULT_THEME_ID,
  normalizeThemeId,
  getThemeMetadata,
} from '../../shared/types/theme';

export interface ThemeStoreState {
  theme: ThemeId;
  resolved: boolean;
  setTheme: (theme: ThemeId) => Promise<void>;
  initializeTheme: () => Promise<ThemeId>;
}

export function applyThemeToDocument(theme: ThemeId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  const metadata = getThemeMetadata(theme);
  root.style.colorScheme = metadata.colorScheme;
}

export const useThemeStore = create<ThemeStoreState>((set) => ({
  theme: DEFAULT_THEME_ID,
  resolved: false,
  setTheme: async (newTheme: ThemeId) => {
    const validTheme = normalizeThemeId(newTheme);
    applyThemeToDocument(validTheme);
    set({ theme: validTheme });
    if (typeof window !== 'undefined' && window.electronAPI?.setTheme) {
      try {
        await window.electronAPI.setTheme(validTheme);
      } catch (error) {
        console.error('[clanker-grid] Failed to persist theme:', error);
      }
    }
  },
  initializeTheme: async () => {
    let initialTheme: ThemeId = DEFAULT_THEME_ID;
    if (typeof window !== 'undefined' && window.electronAPI?.getTheme) {
      try {
        const persisted = await window.electronAPI.getTheme();
        initialTheme = normalizeThemeId(persisted);
      } catch (error) {
        console.error('[clanker-grid] Failed to load theme from store:', error);
      }
    }
    applyThemeToDocument(initialTheme);
    set({ theme: initialTheme, resolved: true });
    return initialTheme;
  },
}));
