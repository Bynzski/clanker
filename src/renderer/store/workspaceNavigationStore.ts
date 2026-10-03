/**
 * Renderer Workspace Navigation Store
 *
 * Application-global navigation preferences: where open workspaces are listed
 * and how wide the sidebar shell is in sidebar mode. Persisted to electron-store
 * via the preload bridge (never per-workspace state). Tabs-mode Explorer width
 * stays per-workspace in `workspaceStore`.
 */

import { create } from 'zustand';
import {
  type WorkspaceNavigationMode,
  DEFAULT_WORKSPACE_NAVIGATION_MODE,
  DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
  normalizeWorkspaceNavigationMode,
  normalizeWorkspaceSidebarWidth,
} from '../../shared/types/workspaceNavigation';

export interface WorkspaceNavigationStoreState {
  mode: WorkspaceNavigationMode;
  sidebarWidth: number;
  resolved: boolean;
  setMode: (mode: WorkspaceNavigationMode) => Promise<void>;
  /** Updates the live width (e.g. during a drag) without persisting. */
  setSidebarWidth: (width: number) => void;
  /** Persists the current width; call when a resize gesture ends. */
  persistSidebarWidth: () => Promise<void>;
  initialize: () => Promise<WorkspaceNavigationMode>;
}

export const useWorkspaceNavigationStore = create<WorkspaceNavigationStoreState>((set, get) => ({
  mode: DEFAULT_WORKSPACE_NAVIGATION_MODE,
  sidebarWidth: DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
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
  setSidebarWidth: (width) => set({ sidebarWidth: normalizeWorkspaceSidebarWidth(width) }),
  persistSidebarWidth: async () => {
    if (typeof window !== 'undefined' && window.electronAPI?.setWorkspaceSidebarWidth) {
      try {
        await window.electronAPI.setWorkspaceSidebarWidth(get().sidebarWidth);
      } catch (error) {
        console.error('[clanker-grid] Failed to persist workspace sidebar width:', error);
      }
    }
  },
  initialize: async () => {
    let mode: WorkspaceNavigationMode = DEFAULT_WORKSPACE_NAVIGATION_MODE;
    let sidebarWidth = DEFAULT_WORKSPACE_SIDEBAR_WIDTH;
    if (typeof window !== 'undefined' && window.electronAPI) {
      const api = window.electronAPI;
      try {
        if (api.getWorkspaceNavigationMode) mode = normalizeWorkspaceNavigationMode(await api.getWorkspaceNavigationMode());
      } catch (error) {
        console.error('[clanker-grid] Failed to load workspace navigation mode:', error);
      }
      try {
        if (api.getWorkspaceSidebarWidth) sidebarWidth = normalizeWorkspaceSidebarWidth(await api.getWorkspaceSidebarWidth());
      } catch (error) {
        console.error('[clanker-grid] Failed to load workspace sidebar width:', error);
      }
    }
    set({ mode, sidebarWidth, resolved: true });
    return mode;
  },
}));
