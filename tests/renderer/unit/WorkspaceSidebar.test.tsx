// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceSidebar from '../../../src/renderer/components/WorkspaceSidebar';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { WORKSPACE_SIDEBAR_RAIL_WIDTH } from '../../../src/shared/types/workspaceNavigation';
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
  afterEach(() => { cleanup(); useWorkspaceNavigationStore.setState({ mode: 'tabs', sidebarWidth: 280, lastExpandedWidth: 280 }); });

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

  it('collapses to the icon rail and expands back to the previous width', async () => {
    useWorkspaceNavigationStore.setState({ lastExpandedWidth: 300 });
    render(<WorkspaceSidebar onOpenWorkspace={() => undefined} />);
    const sidebar = screen.getByTestId('workspace-sidebar');
    expect(await screen.findByTestId('files')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    expect(sidebar.style.width).toBe(`${WORKSPACE_SIDEBAR_RAIL_WIDTH}px`);
    expect(screen.queryByTestId('files')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Workspaces' })).toBeTruthy();
    expect(window.electronAPI.setWorkspaceSidebarWidth).toHaveBeenLastCalledWith(WORKSPACE_SIDEBAR_RAIL_WIDTH);

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    expect(sidebar.style.width).toBe('300px');
    expect(window.electronAPI.setWorkspaceSidebarWidth).toHaveBeenLastCalledWith(300);
  });

  it('keeps navigator expansion while collapsed to the rail', () => {
    render(<WorkspaceSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand b' }));
    expect(screen.getByRole('button', { name: 'Collapse b' })).toBeTruthy();
    act(() => { useWorkspaceNavigationStore.getState().collapseSidebar(); });
    act(() => { useWorkspaceNavigationStore.getState().expandSidebar(); });
    expect(screen.getByRole('button', { name: 'Collapse b' })).toBeTruthy();
  });

  it('dragging narrow snaps to the rail, remembering the width the drag started from', () => {
    const { container } = render(<WorkspaceSidebar />);
    const handle = () => container.querySelector('.workspace-sidebar > .explorer-resize-handle')!;
    fireEvent.mouseDown(handle(), { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 60 });
    expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(WORKSPACE_SIDEBAR_RAIL_WIDTH);
    fireEvent.mouseUp(document);
    expect(window.electronAPI.setWorkspaceSidebarWidth).toHaveBeenLastCalledWith(WORKSPACE_SIDEBAR_RAIL_WIDTH);
    expect(useWorkspaceNavigationStore.getState().lastExpandedWidth).toBe(300);

    // Dragging the rail's edge outward opens it again.
    fireEvent.mouseDown(handle(), { clientX: 44 });
    fireEvent.mouseMove(document, { clientX: 100 });
    expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(WORKSPACE_SIDEBAR_RAIL_WIDTH);
    fireEvent.mouseMove(document, { clientX: 290 });
    expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(290);
    fireEvent.mouseUp(document);
    expect(screen.getByTestId('workspace-sidebar')).toHaveAttribute('data-collapsed', 'false');
  });
});
