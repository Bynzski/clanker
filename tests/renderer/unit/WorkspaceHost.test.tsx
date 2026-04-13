// @vitest-environment jsdom

import { render, screen, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceHost from '../../../src/renderer/components/WorkspaceHost';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';

vi.mock('../../../src/renderer/components/DynamicPaneLayout', () => ({
  default: () => <div data-testid="dynamic-pane-layout">DynamicPaneLayout</div>,
}));

vi.mock('../../../src/renderer/components/FileExplorer', () => ({
  default: () => <div data-testid="file-explorer">FileExplorer</div>,
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

  it('renders the active workspace in the visible viewport', async () => {
    const workspace = createWorkspaceFixture({ id: 'ws-1', lifecycle: 'active' });
    useWorkspaceStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: 'ws-1',
    });

    render(<WorkspaceHost />);

    await screen.findByTestId('workspace-host');
    const activeViewport = document.querySelector('.workspace-active-viewport');
    expect(activeViewport).toBeTruthy();
    expect(activeViewport?.querySelector('[data-workspace-id="ws-1"]')).toBeTruthy();
    expect(screen.getAllByTestId('dynamic-pane-layout')).toHaveLength(1);
    expect(screen.getAllByTestId('file-explorer')).toHaveLength(1);
  });

  it('renders parked workspace surfaces in the hidden parked container', async () => {
    const first = createWorkspaceFixture({ id: 'ws-1', name: 'first', lifecycle: 'parked' });
    const second = createWorkspaceFixture({ id: 'ws-2', name: 'second', lifecycle: 'active' });
    useWorkspaceStore.setState({
      workspaces: [first, second],
      activeWorkspaceId: 'ws-2',
    });

    render(<WorkspaceHost />);

    await screen.findByTestId('workspace-host');

    const activeSurface = document.querySelector('[data-workspace-id="ws-2"]');
    const parkedSurface = document.querySelector('[data-workspace-id="ws-1"]');
    const parkedContainer = document.querySelector('.workspace-parked-container');

    expect(activeSurface).toHaveAttribute('data-workspace-visibility', 'active');
    expect(parkedSurface).toHaveAttribute('data-workspace-visibility', 'parked');
    expect(parkedSurface).toHaveAttribute('hidden');
    expect(parkedSurface).toHaveAttribute('aria-hidden', 'true');
    expect(parkedSurface).toHaveAttribute('inert');
    expect(parkedContainer?.contains(parkedSurface)).toBe(true);

    expect(screen.getAllByTestId('dynamic-pane-layout')).toHaveLength(2);
    expect(screen.getAllByTestId('file-explorer')).toHaveLength(2);
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

    const activeViewport = document.querySelector('.workspace-active-viewport');
    expect(within(activeViewport as HTMLElement).getByTestId('dynamic-pane-layout')).toBeTruthy();
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
