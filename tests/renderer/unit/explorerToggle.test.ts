// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { isExplorerShown, toggleFocusedWorkspaceExplorer } from '../../../src/renderer/lib/explorerToggle';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

const explorerVisible = () => useWorkspaceStore.getState().workspaces[0].explorerVisible;

describe('explorer toggle', () => {
  beforeEach(() => {
    installElectronApiMock();
    useWorkspaceStore.setState({
      workspaces: [createWorkspaceFixture({ id: 'a', explorerVisible: false })],
      activeWorkspaceId: 'a',
    });
  });
  afterEach(() => {
    useWorkspaceNavigationStore.setState({ mode: 'tabs', sidebarWidth: 280, lastExpandedWidth: 280 });
  });

  it('treats FILES as hidden while the sidebar is collapsed to the rail', () => {
    expect(isExplorerShown(true, 'sidebar', 44)).toBe(false);
    expect(isExplorerShown(true, 'sidebar', 280)).toBe(true);
    expect(isExplorerShown(true, 'tabs', 44)).toBe(true);
    expect(isExplorerShown(false, 'sidebar', 280)).toBe(false);
  });

  it('toggles the focused workspace explorer', () => {
    useWorkspaceNavigationStore.setState({ mode: 'sidebar', sidebarWidth: 280 });
    toggleFocusedWorkspaceExplorer();
    expect(explorerVisible()).toBe(true);
    toggleFocusedWorkspaceExplorer();
    expect(explorerVisible()).toBe(false);
  });

  it('expands a collapsed rail and shows FILES instead of hiding it', () => {
    useWorkspaceNavigationStore.setState({ mode: 'sidebar', sidebarWidth: 44, lastExpandedWidth: 320 });
    useWorkspaceStore.getState().setExplorerVisible(true, 'a');
    toggleFocusedWorkspaceExplorer();
    expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(320);
    expect(explorerVisible()).toBe(true);
  });
});
