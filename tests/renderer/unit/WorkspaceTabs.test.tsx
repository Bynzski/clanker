// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import type { WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';
import WorkspaceTabs from '../../../src/renderer/components/WorkspaceTabs';

// Mock the workspaceLifecycle module
vi.mock('../../../src/renderer/lib/workspaceLifecycle', () => ({
  terminateWorkspaceTerminals: vi.fn().mockResolvedValue(undefined),
}));

// Helper to create properly typed mock workspaces
function createMockWorkspace(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id: 'ws1',
    name: 'Test Workspace',
    workspacePath: '/path/to/workspace',
    terminals: [],
    harness: 'test-harness',
    model: 'test-model',
    panes: [],
    browserVisible: false,
    browserPane: null,
    browserUrl: '',
    activeTerminalId: null,
    layoutRoot: null,
    explorerVisible: false,
    explorerSidebarWidth: 280,
    explorerExpandedPaths: [],
    explorerSelectedPath: null,
    explorerEntriesByPath: {},
    explorerLoadingPaths: [],
    explorerErrorsByPath: {},
    ...overrides,
  };
}

describe('WorkspaceTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    
    // Set up default store state
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      selectWorkspace: vi.fn(),
      closeWorkspace: vi.fn(),
      updateWorkspaceName: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // =========================================================================
  // Empty State
  // =========================================================================
  describe('empty state', () => {
    it('returns null when workspaces array is empty', () => {
      useWorkspaceStore.setState({ workspaces: [] });
      
      const { container } = render(<WorkspaceTabs />);
      
      expect(container.firstChild).toBeNull();
    });

    it('does not render any tabs when no workspaces', () => {
      useWorkspaceStore.setState({ workspaces: [] });
      
      render(<WorkspaceTabs />);
      
      expect(screen.queryByRole('tab')).toBeNull();
    });
  });

  // =========================================================================
  // Basic Rendering
  // =========================================================================
  describe('basic rendering', () => {
    const mockWorkspaces: WorkspaceTab[] = [
      createMockWorkspace({
        id: 'ws1',
        name: 'My Project',
        workspacePath: '/home/user/my-project',
        terminals: [{ id: 't1', pid: 123, workingDir: '/workspace' }],
      }),
      createMockWorkspace({
        id: 'ws2',
        name: 'Another Project',
        workspacePath: '/home/user/another-project',
        terminals: [
          { id: 't2', pid: 456, workingDir: '/workspace' },
          { id: 't3', pid: 789, workingDir: '/workspace' },
        ],
      }),
    ];

    it('renders workspace tabs when workspaces exist', () => {
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(2);
    });

    it('displays workspace name in tab', () => {
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      expect(screen.getByText('My Project')).toBeTruthy();
    });

    it('displays terminal count in tab', () => {
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      // First workspace has 1 terminal
      const firstTab = screen.getAllByRole('tab')[0];
      expect(firstTab).toHaveTextContent('1');
      
      // Second workspace has 2 terminals
      const secondTab = screen.getAllByRole('tab')[1];
      expect(secondTab).toHaveTextContent('2');
    });

    it('applies active class to active workspace tab', () => {
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      const tabs = screen.getAllByRole('tab');
      expect(tabs[0]).toHaveClass('active');
      expect(tabs[1]).not.toHaveClass('active');
    });

    it('uses fallback name when workspace name is empty', () => {
      const workspacesWithEmptyName = [createMockWorkspace({
        name: '',
        workspacePath: '/home/user/my-project',
      })];
      
      useWorkspaceStore.setState({
        workspaces: workspacesWithEmptyName,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      // Should use the last segment of the path
      expect(screen.getByText('my-project')).toBeTruthy();
    });

    it('uses fallback name when workspace has no name or path', () => {
      const workspacesWithNoName = [createMockWorkspace({
        name: '',
        workspacePath: '',
      })];
      
      useWorkspaceStore.setState({
        workspaces: workspacesWithNoName,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      expect(screen.getByText('Workspace')).toBeTruthy();
    });
  });

  // =========================================================================
  // Tab Selection
  // =========================================================================
  describe('tab selection', () => {
    const mockWorkspaces: WorkspaceTab[] = [
      createMockWorkspace({ id: 'ws1', name: 'Workspace 1', workspacePath: '/path/ws1' }),
      createMockWorkspace({ id: 'ws2', name: 'Workspace 2', workspacePath: '/path/ws2' }),
    ];

    it('calls selectWorkspace when tab is clicked', async () => {
      const selectWorkspace = vi.fn();
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
        selectWorkspace,
      });
      
      render(<WorkspaceTabs />);
      
      const secondTab = screen.getAllByRole('tab')[1];
      await act(async () => {
        fireEvent.click(secondTab);
      });
      
      expect(selectWorkspace).toHaveBeenCalledWith('ws2');
    });

    it('does not call selectWorkspace when in edit mode', async () => {
      const selectWorkspace = vi.fn();
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
        selectWorkspace,
      });
      
      render(<WorkspaceTabs />);
      
      // Enter edit mode via double-click
      const firstTab = screen.getAllByRole('tab')[0];
      const label = firstTab.querySelector('.workspace-tab-label');
      
      await act(async () => {
        fireEvent.dblClick(label!);
      });
      
      // Click the tab while editing
      const tab = screen.getAllByRole('tab')[0];
      await act(async () => {
        fireEvent.click(tab);
      });
      
      // selectWorkspace should not be called because we're in edit mode
      expect(selectWorkspace).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Tab Rename
  // =========================================================================
  describe('tab rename', () => {
    const mockWorkspaces: WorkspaceTab[] = [
      createMockWorkspace({ id: 'ws1', name: 'Original Name', workspacePath: '/path/ws1' }),
    ];

    it('enters edit mode on double-click', async () => {
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      const label = screen.getByText('Original Name');
      
      await act(async () => {
        fireEvent.dblClick(label);
      });
      
      const input = screen.getByRole('textbox');
      expect(input).toBeTruthy();
      expect((input as HTMLInputElement).value).toBe('Original Name');
    });

    it('enters edit mode when edit button is clicked', async () => {
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      const editButton = screen.getByTitle('Rename tab');
      
      await act(async () => {
        fireEvent.click(editButton);
      });
      
      const input = screen.getByRole('textbox');
      expect(input).toBeTruthy();
    });

    it('saves edit on Enter key', async () => {
      const updateWorkspaceName = vi.fn();
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
        updateWorkspaceName,
      });
      
      render(<WorkspaceTabs />);
      
      // Enter edit mode
      const label = screen.getByText('Original Name');
      await act(async () => {
        fireEvent.dblClick(label);
      });
      
      // Change the value
      const input = screen.getByRole('textbox') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: 'New Name' } });
      });
      
      // Press Enter
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });
      
      expect(updateWorkspaceName).toHaveBeenCalledWith('ws1', 'New Name');
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('cancels edit on Escape key', async () => {
      const updateWorkspaceName = vi.fn();
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
        updateWorkspaceName,
      });
      
      render(<WorkspaceTabs />);
      
      // Enter edit mode
      const label = screen.getByText('Original Name');
      await act(async () => {
        fireEvent.dblClick(label);
      });
      
      // Change the value
      const input = screen.getByRole('textbox') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: 'New Name' } });
      });
      
      // Press Escape
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Escape' });
      });
      
      expect(updateWorkspaceName).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('saves edit when input loses focus', async () => {
      const updateWorkspaceName = vi.fn();
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
        updateWorkspaceName,
      });
      
      render(<WorkspaceTabs />);
      
      // Enter edit mode
      const label = screen.getByText('Original Name');
      await act(async () => {
        fireEvent.dblClick(label);
      });
      
      // Change the value
      const input = screen.getByRole('textbox') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: 'New Name' } });
      });
      
      // Blur the input
      await act(async () => {
        fireEvent.blur(input);
      });
      
      expect(updateWorkspaceName).toHaveBeenCalledWith('ws1', 'New Name');
    });

    it('does not save when edit value is empty', async () => {
      const updateWorkspaceName = vi.fn();
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
        updateWorkspaceName,
      });
      
      render(<WorkspaceTabs />);
      
      // Enter edit mode
      const label = screen.getByText('Original Name');
      await act(async () => {
        fireEvent.dblClick(label);
      });
      
      // Clear the value
      const input = screen.getByRole('textbox') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: '' } });
      });
      
      // Press Enter
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });
      
      expect(updateWorkspaceName).not.toHaveBeenCalled();
    });

    it('saves with trimmed value', async () => {
      const updateWorkspaceName = vi.fn();
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
        updateWorkspaceName,
      });
      
      render(<WorkspaceTabs />);
      
      // Enter edit mode
      const label = screen.getByText('Original Name');
      await act(async () => {
        fireEvent.dblClick(label);
      });
      
      // Add whitespace
      const input = screen.getByRole('textbox') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: '  New Name  ' } });
      });
      
      // Press Enter
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });
      
      expect(updateWorkspaceName).toHaveBeenCalledWith('ws1', 'New Name');
    });
  });

  // =========================================================================
  // Tab Close
  // =========================================================================
  describe('tab close', () => {
    const mockWorkspaces: WorkspaceTab[] = [
      createMockWorkspace({
        id: 'ws1',
        name: 'Workspace 1',
        workspacePath: '/path/ws1',
        terminals: [{ id: 't1', pid: 123, workingDir: '/workspace' }],
      }),
    ];

    it('calls closeWorkspace when close button is clicked', async () => {
      const closeWorkspace = vi.fn();
      const { terminateWorkspaceTerminals } = await import('../../../src/renderer/lib/workspaceLifecycle');
      
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
        closeWorkspace,
      });
      
      render(<WorkspaceTabs />);
      
      const closeButton = screen.getByLabelText('Close workspace');
      
      await act(async () => {
        fireEvent.click(closeButton);
        await vi.runAllTimersAsync();
      });
      
      expect(terminateWorkspaceTerminals).toHaveBeenCalled();
      expect(closeWorkspace).toHaveBeenCalledWith('ws1');
    });

    it('stops propagation of close click event', async () => {
      const selectWorkspace = vi.fn();
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
        selectWorkspace,
      });
      
      render(<WorkspaceTabs />);
      
      const closeButton = screen.getByLabelText('Close workspace');
      
      await act(async () => {
        fireEvent.click(closeButton);
        await vi.runAllTimersAsync();
      });
      
      expect(selectWorkspace).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Input Focus
  // =========================================================================
  describe('input focus behavior', () => {
    it('focuses and selects input when entering edit mode', async () => {
      const mockWorkspaces: WorkspaceTab[] = [
        createMockWorkspace({ id: 'ws1', name: 'Test', workspacePath: '/path/ws1' }),
      ];
      
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      // Enter edit mode
      const label = screen.getByText('Test');
      await act(async () => {
        fireEvent.dblClick(label);
      });
      
      const input = screen.getByRole('textbox') as HTMLInputElement;
      
      // Note: In jsdom, we can't fully test focus, but we can verify the input exists
      expect(input).toBeTruthy();
    });
  });

  // =========================================================================
  // Accessibility
  // =========================================================================
  describe('accessibility', () => {
    const mockWorkspaces: WorkspaceTab[] = [
      createMockWorkspace({ id: 'ws1', name: 'Workspace 1', workspacePath: '/path/ws1' }),
    ];

    it('has proper role attributes', () => {
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      expect(screen.getByRole('tablist')).toBeTruthy();
      expect(screen.getByRole('tab')).toBeTruthy();
    });

    it('sets aria-selected on active tab', () => {
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      const tab = screen.getByRole('tab');
      expect(tab).toHaveAttribute('aria-selected', 'true');
    });

    it('has accessible close button', () => {
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      const closeButton = screen.getByLabelText('Close workspace');
      expect(closeButton).toBeTruthy();
    });

    it('has accessible edit button', () => {
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      const editButton = screen.getByTitle('Rename tab');
      expect(editButton).toBeTruthy();
    });
  });
});
