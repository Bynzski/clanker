// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import {
  DEFAULT_WORKSPACE_NAVIGATION_MODE,
  DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
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
    useWorkspaceNavigationStore.setState({ mode: DEFAULT_WORKSPACE_NAVIGATION_MODE, sidebarWidth: DEFAULT_WORKSPACE_SIDEBAR_WIDTH, resolved: false });
  });

  it('defaults to tabs', () => {
    expect(DEFAULT_WORKSPACE_NAVIGATION_MODE).toBe('tabs');
    expect(useWorkspaceNavigationStore.getState().mode).toBe('tabs');
  });

  it('validates and normalizes', () => {
    expect(isWorkspaceNavigationMode('sidebar')).toBe(true);
    expect(isWorkspaceNavigationMode('rail')).toBe(false);
    expect(normalizeWorkspaceNavigationMode('rail')).toBe('tabs');
    expect(normalizeWorkspaceNavigationMode(undefined)).toBe('tabs');
  });

  it.each(['tabs', 'sidebar'] as const)('loads persisted %s', async (mode) => {
    mockApi(mode);
    await useWorkspaceNavigationStore.getState().initialize();
    expect(useWorkspaceNavigationStore.getState()).toMatchObject({ mode, resolved: true });
  });

  it('normalizes an invalid persisted value to tabs', async () => {
    mockApi('garbage');
    await useWorkspaceNavigationStore.getState().initialize();
    expect(useWorkspaceNavigationStore.getState().mode).toBe('tabs');
  });

  it('falls back to tabs when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.electronAPI = {
      getWorkspaceNavigationMode: vi.fn().mockRejectedValue(new Error('x')),
    } as unknown as typeof window.electronAPI;
    await useWorkspaceNavigationStore.getState().initialize();
    expect(useWorkspaceNavigationStore.getState()).toMatchObject({ mode: 'tabs', resolved: true });
  });

  it('persists a valid mode immediately and rejects invalid ones', async () => {
    mockApi('tabs');
    await useWorkspaceNavigationStore.getState().setMode('sidebar');
    expect(useWorkspaceNavigationStore.getState().mode).toBe('sidebar');
    expect(window.electronAPI.setWorkspaceNavigationMode).toHaveBeenCalledWith('sidebar');

    // @ts-expect-error invalid runtime value
    await useWorkspaceNavigationStore.getState().setMode('nope');
    expect(useWorkspaceNavigationStore.getState().mode).toBe('tabs');
    expect(window.electronAPI.setWorkspaceNavigationMode).toHaveBeenLastCalledWith('tabs');
  });

  describe('global sidebar width', () => {
    it('defaults to 280 and clamps to 180–500', () => {
      expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(280);
      expect(normalizeWorkspaceSidebarWidth(10)).toBe(180);
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
  });
});
