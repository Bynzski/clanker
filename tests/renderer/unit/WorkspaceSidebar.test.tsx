// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceSidebar from '../../../src/renderer/components/WorkspaceSidebar';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

vi.mock('../../../src/renderer/components/FileExplorer', () => ({
  default: ({ workspaceId }: { workspaceId: string }) => <div data-testid="files" data-ws={workspaceId} />,
}));

describe('WorkspaceSidebar global width', () => {
  beforeEach(() => {
    installElectronApiMock();
    useWorkspaceNavigationStore.setState({ mode: 'sidebar', sidebarWidth: 300, resolved: true });
    useWorkspaceStore.setState({
      workspaces: [
        createWorkspaceFixture({ id: 'a', name: 'a', explorerSidebarWidth: 200 }),
        createWorkspaceFixture({ id: 'b', name: 'b', lifecycle: 'parked', explorerSidebarWidth: 480 }),
      ],
      activeWorkspaceId: 'a',
    });
  });
  afterEach(() => { cleanup(); useWorkspaceNavigationStore.setState({ mode: 'tabs', sidebarWidth: 280 }); });

  it('uses the application-global width and ignores per-workspace explorer widths', async () => {
    render(<WorkspaceSidebar />);
    const sidebar = screen.getByTestId('workspace-sidebar');
    expect(sidebar.style.width).toBe('300px');
    act(() => { useWorkspaceStore.getState().selectWorkspace('b'); });
    expect(sidebar.style.width).toBe('300px');
    expect(await screen.findByTestId('files')).toHaveAttribute('data-ws', 'b');
    // Per-workspace widths (tabs mode) are untouched.
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.explorerSidebarWidth)).toEqual([200, 480]);
  });

  it('dragging the single handle updates and persists the global width, clamped', () => {
    const { container } = render(<WorkspaceSidebar />);
    const handles = container.querySelectorAll('.explorer-resize-handle');
    expect(handles).toHaveLength(1);
    fireEvent.mouseDown(handles[0], { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 360 });
    expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(360);
    fireEvent.mouseMove(document, { clientX: 5000 });
    expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(500);
    expect(window.electronAPI.setWorkspaceSidebarWidth).not.toHaveBeenCalled();
    fireEvent.mouseUp(document);
    expect(window.electronAPI.setWorkspaceSidebarWidth).toHaveBeenCalledWith(500);
    expect(useWorkspaceStore.getState().workspaces[0].explorerSidebarWidth).toBe(200);
  });
});
