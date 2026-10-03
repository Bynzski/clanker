/**
 * Renderer Workspace Navigation Store
 *
 * Application-global preference for where open workspaces are listed. Persisted
 * to electron-store via the preload bridge (never per-workspace state).
 */

import { create } from 'zustand';
import {
  type WorkspaceNavigationMode,
  DEFAULT_WORKSPACE_NAVIGATION_MODE,
  normalizeWorkspaceNavigationMode,
} from '../../shared/types/workspaceNavigation';

export interface WorkspaceNavigationStoreState {
  mode: WorkspaceNavigationMode;
  resolved: boolean;
  setMode: (mode: WorkspaceNavigationMode) => Promise<void>;
  initialize: () => Promise<WorkspaceNavigationMode>;
}

export const useWorkspaceNavigationStore = create<WorkspaceNavigationStoreState>((set) => ({
  mode: DEFAULT_WORKSPACE_NAVIGATION_MODE,
  resolved: false,
  setMode: async (newMode) => {
    const mode = normalizeWorkspaceNavigationMode(newMode);
    set({ mode });
    if (typeof window !== 'undefined' && window.electronAPI?.setWorkspaceNavigationMode) {
      try {
        await window.electronAPI.setWorkspaceNavigationMode(mode);
      } catch (error) {
        console.error('[clanker-grid] Failed to persist workspace navigation mode:', error);
      }
    }
  },
  initialize: async () => {
    let mode: WorkspaceNavigationMode = DEFAULT_WORKSPACE_NAVIGATION_MODE;
    if (typeof window !== 'undefined' && window.electronAPI?.getWorkspaceNavigationMode) {
      try {
        mode = normalizeWorkspaceNavigationMode(await window.electronAPI.getWorkspaceNavigationMode());
      } catch (error) {
        console.error('[clanker-grid] Failed to load workspace navigation mode:', error);
      }
    }
    set({ mode, resolved: true });
    return mode;
  },
}));
