/**
 * Keybinding Store
 * Renderer cache of the persisted keybinding overrides. Main owns persistence and
 * validation; this exists so terminals and the app dispatcher can resolve
 * bindings synchronously per keystroke.
 */

import { create } from 'zustand';
import { platformFromString, type KeybindingOverrides } from '../../shared/keybindings';

export const KEYBINDING_PLATFORM = platformFromString(typeof navigator === 'undefined' ? '' : navigator.platform);

export type SetKeybindingOverridesResult = { success: true } | { success: false; error: string };

interface KeybindingState {
  overrides: KeybindingOverrides;
  loaded: boolean;
  /** True while the shortcut dialog is recording a key; app dispatch must not run. */
  capturing: boolean;
  load: () => Promise<void>;
  /** Persist a complete override map; state only changes once main accepted it. */
  setOverrides: (overrides: KeybindingOverrides) => Promise<SetKeybindingOverridesResult>;
  setCapturing: (capturing: boolean) => void;
}

export const useKeybindingStore = create<KeybindingState>((set) => ({
  overrides: {},
  loaded: false,
  capturing: false,

  load: async () => {
    try {
      const overrides = await window.electronAPI.getKeybindingOverrides();
      set({ overrides: overrides ?? {}, loaded: true });
    } catch (error) {
      console.error('Failed to load keybinding overrides:', error);
      set({ loaded: true });
    }
  },

  setOverrides: async (overrides) => {
    try {
      const result = await window.electronAPI.setKeybindingOverrides(overrides);
      if (!result.success) return { success: false, error: result.error };
      set({ overrides: result.overrides });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Could not save keyboard shortcuts' };
    }
  },

  setCapturing: (capturing) => set({ capturing }),
}));
