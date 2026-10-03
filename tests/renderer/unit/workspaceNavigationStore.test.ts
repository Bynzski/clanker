// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import {
  DEFAULT_WORKSPACE_NAVIGATION_MODE,
  isWorkspaceNavigationMode,
  normalizeWorkspaceNavigationMode,
} from '../../../src/shared/types/workspaceNavigation';

function mockApi(persisted: unknown) {
  window.electronAPI = {
    getWorkspaceNavigationMode: vi.fn().mockResolvedValue(persisted),
    setWorkspaceNavigationMode: vi.fn().mockResolvedValue(undefined),
  } as unknown as typeof window.electronAPI;
}

describe('workspace navigation mode', () => {
  beforeEach(() => {
    useWorkspaceNavigationStore.setState({ mode: DEFAULT_WORKSPACE_NAVIGATION_MODE, resolved: false });
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
});
