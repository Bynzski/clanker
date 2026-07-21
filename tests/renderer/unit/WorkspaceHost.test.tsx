// @vitest-environment jsdom

import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceHost from '../../../src/renderer/components/WorkspaceHost';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';

vi.mock('../../../src/renderer/components/DynamicPaneLayout', () => ({
  default: () => <div data-testid="dynamic-pane-layout">DynamicPaneLayout</div>,
}));

const mockBrowserHide = vi.fn();

describe('WorkspaceHost', () => {
  beforeEach(() => {
    window.electronAPI = {
      browserHide: mockBrowserHide,
    } as unknown as typeof window.electronAPI;
    mockBrowserHide.mockReset();
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when no workspaces exist', () => {
    const { container } = render(<WorkspaceHost />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the active workspace in the shared surfaces container', async () => {
    const workspace = createWorkspaceFixture({ id: 'ws-1', lifecycle: 'active' });
    useWorkspaceStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: 'ws-1',
    });

    render(<WorkspaceHost />);

    await screen.findByTestId('workspace-host');
    const surfacesContainer = document.querySelector('.workspace-surfaces-container');
    expect(surfacesContainer).toBeTruthy();
    expect(surfacesContainer?.querySelector('[data-workspace-id="ws-1"]')).toBeTruthy();
    expect(screen.getAllByTestId('dynamic-pane-layout')).toHaveLength(1);
  });

  it('renders parked workspace surfaces in the shared container with proper CSS hiding', async () => {
    const first = createWorkspaceFixture({ id: 'ws-1', name: 'first', lifecycle: 'parked' });
    const second = createWorkspaceFixture({ id: 'ws-2', name: 'second', lifecycle: 'active' });
    useWorkspaceStore.setState({
      workspaces: [first, second],
      activeWorkspaceId: 'ws-2',
    });

    render(<WorkspaceHost />);

    await screen.findByTestId('workspace-host');

    const surfacesContainer = document.querySelector('.workspace-surfaces-container');
    const activeSurface = surfacesContainer?.querySelector('[data-workspace-id="ws-2"]');
    const parkedSurface = surfacesContainer?.querySelector('[data-workspace-id="ws-1"]');

    expect(activeSurface).toHaveAttribute('data-workspace-visibility', 'active');
    expect(activeSurface).toHaveClass('active');
    expect(parkedSurface).toHaveAttribute('data-workspace-visibility', 'parked');
    expect(parkedSurface).toHaveClass('parked');
    // Parked surfaces are no longer hidden with HTML hidden attribute - CSS handles visibility
    expect(parkedSurface).toHaveAttribute('aria-hidden', 'true');
    expect(parkedSurface).toHaveAttribute('inert');
    // Both surfaces are in the same container
    expect(surfacesContainer?.contains(parkedSurface!)).toBe(true);
    expect(surfacesContainer?.contains(activeSurface!)).toBe(true);

    expect(screen.getAllByTestId('dynamic-pane-layout')).toHaveLength(2);
  });

  it('uses the lifecycle-active workspace when activeWorkspaceId is missing', async () => {
    const first = createWorkspaceFixture({ id: 'ws-1', lifecycle: 'parked' });
    const second = createWorkspaceFixture({ id: 'ws-2', lifecycle: 'active' });
    useWorkspaceStore.setState({
      workspaces: [first, second],
      activeWorkspaceId: null,
    });

    render(<WorkspaceHost />);

    const host = await screen.findByTestId('workspace-host');
    expect(host).toHaveAttribute('data-active-workspace-id', 'ws-2');

    // With all workspaces rendered, verify the active workspace surface exists
    const activeSurface = document.querySelector('[data-workspace-id="ws-2"]');
    expect(activeSurface).toBeTruthy();
    expect(activeSurface).toHaveClass('active');
  });

  it('hides parked browser views at the host lifecycle layer', async () => {
    const first = createWorkspaceFixture({
      id: 'ws-1',
      lifecycle: 'parked',
      browserVisible: true,
    });
    const second = createWorkspaceFixture({
      id: 'ws-2',
      lifecycle: 'active',
      browserVisible: true,
    });
    useWorkspaceStore.setState({
      workspaces: [first, second],
      activeWorkspaceId: 'ws-2',
      activeWorkspaceLifecycle: 'active',
    });

    render(<WorkspaceHost />);

    await screen.findByTestId('workspace-host');

    expect(mockBrowserHide).toHaveBeenCalledWith('ws-1');
    expect(mockBrowserHide).not.toHaveBeenCalledWith('ws-2');
  });
});
