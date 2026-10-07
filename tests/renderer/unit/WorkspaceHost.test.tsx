// @vitest-environment jsdom

import { act, fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceHost from '../../../src/renderer/components/WorkspaceHost';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { MAX_WARM_WORKSPACE_SURFACES } from '../../../src/renderer/lib/workspaceWarmth';

vi.mock('../../../src/renderer/components/DynamicPaneLayout', () => ({
  default: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="dynamic-pane-layout" data-layout-workspace-id={workspaceId}>DynamicPaneLayout</div>
  ),
}));

vi.mock('../../../src/renderer/components/FileExplorer', () => ({
  default: ({ workspaceId, variant }: { workspaceId: string; variant?: string }) => (
    <aside data-testid="explorer-dock" data-explorer-workspace-id={workspaceId} data-explorer-variant={variant ?? 'dock'} />
  ),
}));

const mockBrowserHide = vi.fn();

describe('WorkspaceHost', () => {
  beforeEach(() => {
    installElectronApiMock({ browserHide: mockBrowserHide });
    mockBrowserHide.mockReset();
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
    });
  });

  afterEach(() => {
    cleanup();
    useWorkspaceNavigationStore.setState({ mode: 'tabs' });
  });

  it('renders normal navigation and a simple empty state with no workspaces', async () => {
    useWorkspaceNavigationStore.setState({ mode: 'sidebar' });
    render(<WorkspaceHost onOpenWorkspace={vi.fn()} />);
    expect(await screen.findByText('No workspace open')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Open Workspace/i }).length).toBeGreaterThan(0);
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
    expect(screen.getByTestId('explorer-dock').nextElementSibling).toHaveAttribute('data-testid', 'dynamic-pane-layout');
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

  it('caps mounted renderer surfaces and remounts a cold workspace on activation', async () => {
    const workspaces = [1, 2, 3, 4, 5].map((index) => createWorkspaceFixture({
      id: `ws-${index}`,
      lifecycle: index === 5 ? 'active' : 'parked',
    }));
    useWorkspaceStore.setState({
      workspaces,
      activeWorkspaceId: 'ws-5',
      activeWorkspaceLifecycle: 'active',
    });

    render(<WorkspaceHost />);

    await waitFor(() => {
      expect(screen.getAllByTestId('dynamic-pane-layout')).toHaveLength(3);
    });
    expect(document.querySelector('[data-workspace-id="ws-5"]')).toHaveAttribute('data-workspace-residency', 'warm');
    expect(document.querySelector('[data-workspace-id="ws-4"]')).toHaveAttribute('data-workspace-residency', 'warm');
    expect(document.querySelector('[data-workspace-id="ws-3"]')).toHaveAttribute('data-workspace-residency', 'warm');
    expect(document.querySelector('[data-workspace-id="ws-1"]')).toHaveAttribute('data-workspace-residency', 'cold');
    expect(document.querySelector('[data-layout-workspace-id="ws-1"]')).toBeNull();

    act(() => useWorkspaceStore.getState().selectWorkspace('ws-1'));

    await waitFor(() => {
      expect(document.querySelector('[data-workspace-id="ws-1"]')).toHaveAttribute('data-workspace-residency', 'warm');
      expect(document.querySelector('[data-layout-workspace-id="ws-1"]')).toBeTruthy();
      expect(screen.getAllByTestId('dynamic-pane-layout')).toHaveLength(3);
    });
    expect(document.querySelector('[data-workspace-id="ws-3"]')).toHaveAttribute('data-workspace-residency', 'cold');

    await waitFor(() => {
      const state = useWorkspaceStore.getState();
      expect(state.workspaces.find((workspace) => workspace.id === 'ws-1')?.runtimeState.residencyState).toBe('warm');
      expect(state.workspaces.find((workspace) => workspace.id === 'ws-3')?.runtimeState.residencyState).toBe('cold');
      expect(state.workspaces.find((workspace) => workspace.id === 'ws-3')?.runtimeState.resourcePolicy.terminals).toBe('warm');
    });
  });

  describe('sidebar navigation mode', () => {
    function seedFour(overrides: Record<string, Partial<ReturnType<typeof createWorkspaceFixture>>> = {}) {
      const ids = ['ws-1', 'ws-2', 'ws-3', 'ws-4'];
      useWorkspaceStore.setState({
        workspaces: ids.map((id, i) => createWorkspaceFixture({
          id, name: id, lifecycle: i === 0 ? 'active' : 'parked', explorerVisible: true, ...overrides[id],
        })),
        activeWorkspaceId: 'ws-1',
      });
    }

    it('tabs mode keeps per-surface explorer docks and renders no sidebar', async () => {
      seedFour();
      render(<WorkspaceHost />);
      await screen.findByTestId('workspace-host');
      expect(screen.queryByTestId('workspace-sidebar')).toBeNull();
      expect(screen.getAllByTestId('explorer-dock').length).toBe(MAX_WARM_WORKSPACE_SURFACES);
    });

    it('renders exactly one sidebar and one active-scoped Files section, with no surface docks', async () => {
      useWorkspaceNavigationStore.setState({ mode: 'sidebar' });
      seedFour();
      render(<WorkspaceHost />);
      await screen.findByTestId('workspace-sidebar');
      expect(screen.getAllByTestId('workspace-sidebar')).toHaveLength(1);
      const docks = await screen.findAllByTestId('explorer-dock');
      expect(docks).toHaveLength(1);
      expect(docks[0]).toHaveAttribute('data-explorer-workspace-id', 'ws-1');
      expect(docks[0].closest('[data-testid="workspace-sidebar"]')).toBeTruthy();
      expect(docks[0]).toHaveAttribute('data-explorer-variant', 'section');
      expect(screen.getByTestId('workspace-host')).toHaveAttribute('data-navigation-mode', 'sidebar');

      act(() => { useWorkspaceStore.setState({ activeWorkspaceId: 'ws-2' }); });
      await waitFor(() => {
        expect(screen.getByTestId('explorer-dock')).toHaveAttribute('data-explorer-workspace-id', 'ws-2');
      });
    });

    it('keeps the warm cap at three and unaffected by sidebar expansion or rows', async () => {
      useWorkspaceNavigationStore.setState({ mode: 'sidebar' });
      seedFour();
      render(<WorkspaceHost />);
      await screen.findByTestId('workspace-sidebar');
      expect(MAX_WARM_WORKSPACE_SURFACES).toBe(3);
      expect(screen.getAllByTestId('dynamic-pane-layout')).toHaveLength(3);
      expect(document.querySelectorAll('[data-workspace-residency="warm"]')).toHaveLength(3);
      const cold = document.querySelector('[data-workspace-id="ws-2"]');
      expect(cold).toHaveAttribute('data-workspace-residency', 'cold');

      // Expanding every workspace row must not warm anything.
      for (const toggle of screen.getAllByRole('button', { name: /^Expand / })) fireEvent.click(toggle);
      expect(document.querySelectorAll('[data-workspace-residency="warm"]')).toHaveLength(3);
      expect(cold).toHaveAttribute('data-workspace-residency', 'cold');
    });

    it('keeps WORKSPACES visible when the active workspace has Files collapsed', async () => {
      useWorkspaceNavigationStore.setState({ mode: 'sidebar' });
      seedFour({ 'ws-2': { explorerVisible: false } });
      render(<WorkspaceHost />);
      await screen.findByTestId('workspace-sidebar');
      act(() => { useWorkspaceStore.getState().selectWorkspace('ws-2'); });
      await waitFor(() => expect(screen.getByTestId('workspace-host')).toHaveAttribute('data-active-workspace-id', 'ws-2'));
      // Sidebar and WORKSPACES stay; FILES stays scoped to the new active workspace
      // (it collapses itself from explorerVisible, covered in FileExplorer tests).
      expect(screen.getByTestId('workspace-sidebar')).toBeTruthy();
      expect(screen.getByRole('region', { name: 'Workspaces' })).toBeTruthy();
      expect(screen.getByTestId('explorer-dock')).toHaveAttribute('data-explorer-workspace-id', 'ws-2');
    });

    it('passes Open Workspace through to the sidebar', async () => {
      useWorkspaceNavigationStore.setState({ mode: 'sidebar' });
      seedFour();
      const onOpen = vi.fn();
      render(<WorkspaceHost onOpenWorkspace={onOpen} />);
      fireEvent.click(await screen.findByLabelText('Open Workspace'));
      expect(onOpen).toHaveBeenCalledTimes(1);
    });
  });
});
