// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import {
  DEFAULT_WORKSPACE_NAVIGATION_MODE,
  DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
  WORKSPACE_SIDEBAR_RAIL_WIDTH,
  isWorkspaceSidebarCollapsed,
  normalizeWorkspaceSidebarWidth,
  isWorkspaceNavigationMode,
  normalizeWorkspaceNavigationMode,
} from '../../../src/shared/types/workspaceNavigation';

function mockApi(persisted: unknown, width: unknown = 280) {
  window.electronAPI = {
    getWorkspaceSidebarWidth: vi.fn().mockResolvedValue(width),
    setWorkspaceSidebarWidth: vi.fn().mockResolvedValue(undefined),
    getWorkspaceNavigationMode: vi.fn().mockResolvedValue(persisted),
    setWorkspaceNavigationMode: vi.fn().mockResolvedValue(undefined),
  } as unknown as typeof window.electronAPI;
}

describe('workspace navigation mode', () => {
  beforeEach(() => {
    useWorkspaceNavigationStore.setState({
      mode: DEFAULT_WORKSPACE_NAVIGATION_MODE,
      sidebarWidth: DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
      lastExpandedWidth: DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
      resolved: false,
    });
  });

  it('defaults to sidebar', () => {
    expect(DEFAULT_WORKSPACE_NAVIGATION_MODE).toBe('sidebar');
    expect(useWorkspaceNavigationStore.getState().mode).toBe('sidebar');
  });

  it('validates and normalizes', () => {
    expect(isWorkspaceNavigationMode('sidebar')).toBe(true);
    expect(isWorkspaceNavigationMode('rail')).toBe(false);
    expect(normalizeWorkspaceNavigationMode('rail')).toBe('sidebar');
    expect(normalizeWorkspaceNavigationMode(undefined)).toBe('sidebar');
  });

  it.each(['tabs', 'sidebar'] as const)('loads persisted %s', async (mode) => {
    mockApi(mode);
    await useWorkspaceNavigationStore.getState().initialize();
    expect(useWorkspaceNavigationStore.getState()).toMatchObject({ mode, resolved: true });
  });

  it('normalizes an invalid persisted value to sidebar', async () => {
    mockApi('garbage');
    await useWorkspaceNavigationStore.getState().initialize();
    expect(useWorkspaceNavigationStore.getState().mode).toBe('sidebar');
  });

  it('falls back to sidebar when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.electronAPI = {
      getWorkspaceNavigationMode: vi.fn().mockRejectedValue(new Error('x')),
    } as unknown as typeof window.electronAPI;
    await useWorkspaceNavigationStore.getState().initialize();
    expect(useWorkspaceNavigationStore.getState()).toMatchObject({ mode: 'sidebar', resolved: true });
  });

  it('persists a valid mode immediately and rejects invalid ones', async () => {
    mockApi('sidebar');
    await useWorkspaceNavigationStore.getState().setMode('tabs');
    expect(useWorkspaceNavigationStore.getState().mode).toBe('tabs');
    expect(window.electronAPI.setWorkspaceNavigationMode).toHaveBeenCalledWith('tabs');

    // @ts-expect-error invalid runtime value
    await useWorkspaceNavigationStore.getState().setMode('nope');
    expect(useWorkspaceNavigationStore.getState().mode).toBe('sidebar');
    expect(window.electronAPI.setWorkspaceNavigationMode).toHaveBeenLastCalledWith('sidebar');
  });

  describe('global sidebar width', () => {
    it('defaults to 280, clamps to 180–500 and snaps narrow widths to the rail', () => {
      expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(280);
      expect(normalizeWorkspaceSidebarWidth(10)).toBe(WORKSPACE_SIDEBAR_RAIL_WIDTH);
      expect(normalizeWorkspaceSidebarWidth(119)).toBe(WORKSPACE_SIDEBAR_RAIL_WIDTH);
      expect(normalizeWorkspaceSidebarWidth(120)).toBe(180);
      expect(normalizeWorkspaceSidebarWidth(150)).toBe(180);
      expect(isWorkspaceSidebarCollapsed(WORKSPACE_SIDEBAR_RAIL_WIDTH)).toBe(true);
      expect(isWorkspaceSidebarCollapsed(180)).toBe(false);
      expect(normalizeWorkspaceSidebarWidth(9999)).toBe(500);
      expect(normalizeWorkspaceSidebarWidth(333.4)).toBe(333);
      expect(normalizeWorkspaceSidebarWidth('300')).toBe(280);
      expect(normalizeWorkspaceSidebarWidth(Number.NaN)).toBe(280);
    });

    it('loads the persisted width, normalizing invalid values', async () => {
      mockApi('sidebar', 410);
      await useWorkspaceNavigationStore.getState().initialize();
      expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(410);
      mockApi('sidebar', 'bad');
      await useWorkspaceNavigationStore.getState().initialize();
      expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(280);
    });

    it('updates live while dragging and persists only when asked', async () => {
      mockApi('sidebar');
      useWorkspaceNavigationStore.getState().setSidebarWidth(350);
      useWorkspaceNavigationStore.getState().setSidebarWidth(9000);
      expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(500);
      expect(window.electronAPI.setWorkspaceSidebarWidth).not.toHaveBeenCalled();
      await useWorkspaceNavigationStore.getState().persistSidebarWidth();
      expect(window.electronAPI.setWorkspaceSidebarWidth).toHaveBeenCalledWith(500);
    });

    it('collapses to the rail and expands back to the last expanded width, persisting both', () => {
      mockApi('sidebar');
      useWorkspaceNavigationStore.setState({ sidebarWidth: 360, lastExpandedWidth: 360 });
      useWorkspaceNavigationStore.getState().collapseSidebar();
      expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(WORKSPACE_SIDEBAR_RAIL_WIDTH);
      expect(window.electronAPI.setWorkspaceSidebarWidth).toHaveBeenLastCalledWith(WORKSPACE_SIDEBAR_RAIL_WIDTH);
      useWorkspaceNavigationStore.getState().expandSidebar();
      expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(360);
      expect(window.electronAPI.setWorkspaceSidebarWidth).toHaveBeenLastCalledWith(360);
    });

    it('restores the default width when a collapsed rail was loaded from storage', async () => {
      mockApi('sidebar', WORKSPACE_SIDEBAR_RAIL_WIDTH);
      await useWorkspaceNavigationStore.getState().initialize();
      expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(WORKSPACE_SIDEBAR_RAIL_WIDTH);
      useWorkspaceNavigationStore.getState().expandSidebar();
      expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(DEFAULT_WORKSPACE_SIDEBAR_WIDTH);
    });

    it('never remembers the rail as the expanded width', () => {
      useWorkspaceNavigationStore.getState().rememberExpandedWidth(20);
      expect(useWorkspaceNavigationStore.getState().lastExpandedWidth).toBe(DEFAULT_WORKSPACE_SIDEBAR_WIDTH);
      useWorkspaceNavigationStore.getState().rememberExpandedWidth(420);
      expect(useWorkspaceNavigationStore.getState().lastExpandedWidth).toBe(420);
    });
  });
});
