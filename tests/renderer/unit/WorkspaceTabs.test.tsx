// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import type { WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';
import WorkspaceTabs from '../../../src/renderer/components/WorkspaceTabs';
import { installElectronApiMock } from '../../setup/electron';
import { change, EMPTY_ATTENTION, snapshot } from '../../_helpers/attentionSnapshots';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';

// Platform-neutral path constants for test fixtures
const TEST_MY_PROJECT = path.join(path.sep === '\\' ? 'C:\\Users\\user' : '/home', 'user', 'my-project');
const TEST_ANOTHER_PROJECT = path.join(path.sep === '\\' ? 'C:\\Users\\user' : '/home', 'user', 'another-project');

// Mock the workspaceLifecycle module
vi.mock('../../../src/renderer/lib/workspaceLifecycle', () => ({
  disposeWorkspaceResources: vi.fn().mockResolvedValue(undefined),
}));

// Helper to create properly typed mock workspaces
function createMockWorkspace(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id: 'ws1',
    lifecycle: 'active',
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
    editorPane: null,
    editorVisible: false,
    editorTabs: [],
    activeEditorTabId: null,
    layoutRoot: null,
    explorerVisible: false,
    explorerSidebarWidth: 280,
    explorerExpandedPaths: [],
    explorerSelectedPath: null,
    explorerEntriesByPath: {},
    explorerLoadingPaths: [],
    explorerErrorsByPath: {},
    showHiddenFiles: true,
    gitChanges: [],
    gitCurrentBranch: null,
    gitIsRepo: false,
    gitIsDetached: false,
    runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
    ...overrides,
  };
}

describe('WorkspaceTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    installElectronApiMock();
    useAgentAttentionStore.setState(EMPTY_ATTENTION);
    
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
    it('renders no tabs (and no fake tab) when the workspaces array is empty', () => {
      useWorkspaceStore.setState({ workspaces: [] });

      render(<WorkspaceTabs />);

      expect(screen.queryAllByRole('tab')).toHaveLength(0);
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
    it('reorders tabs by dragging without selecting an inactive workspace', () => {
      const moveWorkspace = vi.fn();
      const selectWorkspace = vi.fn();
      useWorkspaceStore.setState({
        workspaces: [
          createMockWorkspace({ id: 'a', name: 'Alpha' }),
          createMockWorkspace({ id: 'b', name: 'Beta' }),
          createMockWorkspace({ id: 'c', name: 'Gamma' }),
        ],
        activeWorkspaceId: 'a',
        moveWorkspace,
        selectWorkspace,
      });
      render(<WorkspaceTabs onOpenWorkspace={vi.fn()} />);
      const [alpha, , gamma] = screen.getAllByRole('tab');
      const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };

      fireEvent.dragStart(gamma, { dataTransfer: transfer });
      fireEvent.dragOver(alpha, { dataTransfer: transfer });
      expect(alpha).toHaveClass('drop-left');
      fireEvent.drop(alpha, { dataTransfer: transfer });
      fireEvent.dragEnd(gamma, { dataTransfer: transfer });
      fireEvent.click(gamma);

      expect(moveWorkspace).toHaveBeenCalledWith('c', 'a');
      expect(selectWorkspace).not.toHaveBeenCalled();
      expect(alpha).not.toHaveClass('drop-left');
      expect(screen.getByRole('button', { name: 'Open Workspace' })).toBeTruthy();
      expect(screen.getByRole('tablist').lastElementChild).toBe(screen.getByRole('button', { name: 'Open Workspace' }));
    });

    it('supports keyboard reordering without changing the active workspace', () => {
      const moveWorkspace = vi.fn();
      const selectWorkspace = vi.fn();
      useWorkspaceStore.setState({
        workspaces: [createMockWorkspace({ id: 'a', name: 'Alpha' }), createMockWorkspace({ id: 'b', name: 'Beta' })],
        activeWorkspaceId: 'a',
        moveWorkspace,
        selectWorkspace,
      });
      render(<WorkspaceTabs />);
      const [alpha, beta] = screen.getAllByRole('tab');
      fireEvent.keyDown(alpha, { key: 'ArrowRight', altKey: true, shiftKey: true });
      fireEvent.keyDown(beta, { key: 'ArrowLeft', altKey: true, shiftKey: true });
      fireEvent.keyDown(alpha, { key: 'ArrowLeft', altKey: true, shiftKey: true });
      expect(moveWorkspace.mock.calls).toEqual([['a', 'b'], ['b', 'a']]);
      expect(selectWorkspace).not.toHaveBeenCalled();
    });

    it('does not reorder while editing a tab name', () => {
      const moveWorkspace = vi.fn();
      useWorkspaceStore.setState({
        workspaces: [createMockWorkspace({ id: 'a' }), createMockWorkspace({ id: 'b' })],
        activeWorkspaceId: 'a',
        moveWorkspace,
      });
      render(<WorkspaceTabs />);
      fireEvent.click(screen.getAllByTitle('Rename tab')[0]);
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowRight', altKey: true, shiftKey: true });
      expect(moveWorkspace).not.toHaveBeenCalled();
    });

    it.each([
      ['Close workspace', false], ['Close workspace', true], ['Rename tab', false], ['Rename tab', true],
    ])('does not start a drag from %s (SVG descendant: %s)', (label, svg) => {
      useWorkspaceStore.setState({ workspaces: [createMockWorkspace()], activeWorkspaceId: 'ws1' });
      render(<WorkspaceTabs />);
      const transfer = { effectAllowed: '', setData: vi.fn() };
      const control = label === 'Close workspace' ? screen.getByLabelText(label) : screen.getByTitle(label);
      const target = svg ? control.querySelector('svg path')! : control;
      expect(target).toBeTruthy();
      expect(fireEvent.dragStart(target, { dataTransfer: transfer })).toBe(false);
      expect(transfer.setData).not.toHaveBeenCalled();
    });

    it('starts a drag from normal tab content', () => {
      useWorkspaceStore.setState({ workspaces: [createMockWorkspace()], activeWorkspaceId: 'ws1' });
      render(<WorkspaceTabs />);
      const transfer = { effectAllowed: '', setData: vi.fn() };
      fireEvent.dragStart(screen.getByText('Test Workspace'), { dataTransfer: transfer });
      expect(transfer.setData).toHaveBeenCalledExactlyOnceWith('text/plain', 'ws1');
      expect(transfer.effectAllowed).toBe('move');
    });

    it('leaves local tabs unmarked and labels SSH tabs with the configured environment', () => {
      useWorkspaceStore.setState({
        workspaces: [
          createMockWorkspace({ id: 'local', name: 'Local Project', environmentId: 'local', environmentLabel: 'Local' }),
          createMockWorkspace({ id: 'remote', name: 'Remote Project', environmentId: 'ssh-opaque-id', environmentLabel: 'devbox', workspacePath: '/srv/projects/remote' }),
        ],
        activeWorkspaceId: 'local',
      });

      render(<WorkspaceTabs />);

      const [localTab, remoteTab] = screen.getAllByRole('tab');
      expect(localTab).toHaveTextContent('Local Project');
      expect(localTab.querySelector('.workspace-tab-remote')).toBeNull();
      expect(localTab).toHaveAttribute('title', 'Local Project\n/path/to/workspace');
      expect(remoteTab.querySelector('.workspace-tab-remote')).toHaveTextContent('SSH · devbox');
      expect(remoteTab).not.toHaveTextContent('ssh-opaque-id');
      expect(remoteTab).toHaveAttribute('title', 'SSH · devbox\nRemote Project\n/srv/projects/remote');
    });

    it('falls back to the environment ID when an SSH label is unavailable', () => {
      useWorkspaceStore.setState({
        workspaces: [createMockWorkspace({ environmentId: 'ssh-host-id' })],
        activeWorkspaceId: 'ws1',
      });

      render(<WorkspaceTabs />);
      expect(screen.getByRole('tab').querySelector('.workspace-tab-remote')).toHaveTextContent('SSH · ssh-host-id');
    });

    it('labels a linked worktree with its branch', () => {
      useWorkspaceStore.setState({
        workspaces: [createMockWorkspace({ isLinkedWorktree: true, gitCurrentBranch: 'task/example' })],
        activeWorkspaceId: 'ws1',
      });
      render(<WorkspaceTabs />);
      expect(screen.getByLabelText('Worktree on task/example')).toBeTruthy();
    });

    it('shows the source project and branch for a linked worktree with a generated checkout name', () => {
      const workspacePath = '/projects/build-it-worktrees/test-tree-5f66ef4178e31b5f4a9b';
      useWorkspaceStore.setState({
        workspaces: [createMockWorkspace({
          name: 'test-tree-5f66ef4178e31b5f4a9b',
          workspacePath,
          isLinkedWorktree: true,
          gitCurrentBranch: 'test-tree',
        })],
        activeWorkspaceId: 'ws1',
      });

      render(<WorkspaceTabs />);
      const tab = screen.getByRole('tab');
      expect(tab).toHaveTextContent('build-it');
      expect(tab).toHaveTextContent('test-tree');
      expect(tab).not.toHaveTextContent('5f66ef4178e31b5f4a9b');
      expect(tab).toHaveAttribute('title', expect.stringContaining(workspacePath));
      fireEvent.click(screen.getByTitle('Rename tab'));
      expect(screen.getByRole('textbox')).toHaveValue('build-it');
    });

    it('distinguishes detached worktrees from the same project', () => {
      useWorkspaceStore.setState({
        workspaces: [
          createMockWorkspace({ id: 'ws1', name: 'build-it', projectName: 'build-it', workspacePath: '/projects/build-it-worktrees/task-11111111111111111111', isLinkedWorktree: true, gitIsDetached: true }),
          createMockWorkspace({ id: 'ws2', name: 'build-it', projectName: 'build-it', workspacePath: '/projects/build-it-worktrees/task-22222222222222222222', isLinkedWorktree: true, gitIsDetached: true }),
        ],
        activeWorkspaceId: 'ws1',
      });

      render(<WorkspaceTabs />);
      const tabs = screen.getAllByRole('tab');
      expect(tabs[0]).toHaveTextContent('build-it / 11111111 task');
      expect(tabs[1]).toHaveTextContent('build-it / 22222222 task');
      expect(screen.getAllByLabelText('Worktree at detached HEAD')).toHaveLength(2);
    });

    const mockWorkspaces: WorkspaceTab[] = [
      createMockWorkspace({
        id: 'ws1',
        name: 'My Project',
        workspacePath: TEST_MY_PROJECT,
        terminals: [{ id: 't1', pid: 123, workingDir: '/workspace' }],
      }),
      createMockWorkspace({
        id: 'ws2',
        name: 'Another Project',
        workspacePath: TEST_ANOTHER_PROJECT,
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

    it('does not own the explorer watcher lifecycle', () => {
      const electronApi = installElectronApiMock();
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });

      const { unmount } = render(<WorkspaceTabs />);
      unmount();

      expect(electronApi.explorerStartWatching).not.toHaveBeenCalled();
      expect(electronApi.explorerStopWatching).not.toHaveBeenCalled();
    });

    it('displays workspace name in tab', () => {
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      expect(screen.getByText('My Project')).toBeTruthy();
    });

    it('does not display terminal count in tabs', () => {
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      expect(screen.queryByLabelText(/terminals$/i)).toBeNull();
      expect(document.querySelector('.workspace-tab-count')).toBeNull();
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
        workspacePath: TEST_MY_PROJECT,
      })];
      
      useWorkspaceStore.setState({
        workspaces: workspacesWithEmptyName,
        activeWorkspaceId: 'ws1',
      });
      
      render(<WorkspaceTabs />);
      
      // Should use the last segment of the path
      expect(screen.getByText('my-project')).toBeTruthy();
    });

    it('renders open workspace button when callback is provided', () => {
      const onOpenWorkspace = vi.fn();
      useWorkspaceStore.setState({
        workspaces: mockWorkspaces,
        activeWorkspaceId: 'ws1',
      });

      render(<WorkspaceTabs onOpenWorkspace={onOpenWorkspace} />);

      const openButton = screen.getByLabelText('Open Workspace');
      expect(openButton).toBeTruthy();

      fireEvent.click(openButton);
      expect(onOpenWorkspace).toHaveBeenCalled();
    });

    it('shows workspace attention and jumps to the waiting pane', () => {
      const selectWorkspace = vi.fn();
      useWorkspaceStore.setState({
        workspaces: [createMockWorkspace({
          id: 'ws1',
          terminals: [{ id: 't1', pid: 1, workingDir: '/', displayName: 'Samson', harnessId: 'pi' }],
          panes: [{ id: 'pane-1', terminalId: 't1' }],
          activeTerminalId: 't1',
        }), createMockWorkspace({
          id: 'ws2',
          name: 'Other',
          terminals: [{ id: 't2', pid: 2, workingDir: '/', displayName: 'Delilah', harnessId: 'claude' }],
          panes: [{ id: 'pane-2', terminalId: 't2' }],
          activeTerminalId: 't2',
        })],
        activeWorkspaceId: 'ws1',
        activeTerminalId: 't1',
        selectWorkspace,
      });
      useAgentAttentionStore.getState().applyChange(change(snapshot('t2', 'needs_input', 4)), false);
      render(<WorkspaceTabs />);
      expect(screen.getByLabelText('1 agents need input, 0 turns complete')).toBeTruthy();
      fireEvent.click(screen.getByLabelText('Jump to next agent needing attention'));
      expect(selectWorkspace).toHaveBeenCalledWith('ws2', 't2');
      expect(useAgentAttentionStore.getState().seenByTerminalId.t2).toEqual({ completion: 0, request: 4 });
      expect(useAgentAttentionStore.getState().byTerminalId.t2.pendingRequest).not.toBeNull();
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
      
      expect(input).toHaveClass('clanker-input');
      expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('clanker-icon-button');

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
      const { disposeWorkspaceResources } = await import('../../../src/renderer/lib/workspaceLifecycle');
      const electronApi = installElectronApiMock();
      
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
      
      expect(disposeWorkspaceResources).toHaveBeenCalledWith(mockWorkspaces[0], { isActiveWorkspace: true });
      expect(closeWorkspace).toHaveBeenCalledWith('ws1');
      expect(window.electronAPI.unregisterOpenWorkspace).toHaveBeenCalledWith('ws1');
      expect(electronApi.explorerStopWatching).not.toHaveBeenCalled();
      expect(electronApi.gitStopPolling).not.toHaveBeenCalled();
    });

    it('disposes a parked workspace without marking it active', async () => {
      const closeWorkspace = vi.fn();
      const { disposeWorkspaceResources } = await import('../../../src/renderer/lib/workspaceLifecycle');
      const parkedWorkspace = createMockWorkspace({
        id: 'ws1',
        lifecycle: 'parked',
        name: 'Workspace 1',
        workspacePath: '/path/ws1',
      });

      useWorkspaceStore.setState({
        workspaces: [parkedWorkspace, createMockWorkspace({ id: 'ws2', lifecycle: 'active' })],
        activeWorkspaceId: 'ws2',
        closeWorkspace,
      });

      render(<WorkspaceTabs />);

      const closeButton = screen.getAllByLabelText('Close workspace')[0];

      await act(async () => {
        fireEvent.click(closeButton);
        await vi.runAllTimersAsync();
      });

      expect(disposeWorkspaceResources).toHaveBeenCalledWith(parkedWorkspace, { isActiveWorkspace: false });
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

  // =========================================================================
  // Agent Selector and Tabs-Mode Recovery
  // =========================================================================
  describe('agent selector and tabs-mode minimize/restore', () => {
    it('renders agent trigger button when terminals exist and marks minimized agents', () => {
      const selectWorkspace = vi.fn();
      const ws = createMockWorkspace({
        id: 'ws1',
        name: 'Project 1',
        terminals: [
          { id: 't1', pid: 1, harnessId: 'codex', displayName: 'Agent 1', workingDir: '/workspace' },
          { id: 't2', pid: 2, harnessId: 'claude', displayName: 'Agent 2', workingDir: '/workspace' },
        ],
        panes: [
          { id: 'p1', terminalId: 't1' },
          { id: 'p2', terminalId: 't2' },
        ],
        minimizedPanes: [{ paneId: 'p2', pageId: 'pg1', placement: null }],
      });
      useWorkspaceStore.setState({
        workspaces: [ws],
        activeWorkspaceId: 'ws1',
        selectWorkspace,
      });

      render(<WorkspaceTabs />);
      const trigger = screen.getByRole('button', { name: /Agents in Project 1/i });
      expect(trigger).toHaveClass('has-minimized');

      // Click trigger to open popover
      fireEvent.click(trigger);

      // Verify both agents render in the menu
      expect(screen.getByText('Agent 1')).toBeTruthy();
      expect(screen.getByText('Agent 2')).toBeTruthy();

      // Click minimized agent 2
      const agent2Row = screen.getByText('Agent 2').closest('button')!;
      fireEvent.click(agent2Row);

      expect(selectWorkspace).toHaveBeenCalledWith('ws1', 't2');
    });

    it('restores multiple minimized agents independently from the agent dropdown', () => {
      const selectWorkspace = vi.fn();
      const ws = createMockWorkspace({
        id: 'ws1',
        name: 'Project Multi',
        terminals: [
          { id: 't1', pid: 1, harnessId: 'codex', displayName: 'Agent 1', workingDir: '/workspace' },
          { id: 't2', pid: 2, harnessId: 'claude', displayName: 'Agent 2', workingDir: '/workspace' },
        ],
        panes: [
          { id: 'p1', terminalId: 't1' },
          { id: 'p2', terminalId: 't2' },
        ],
        minimizedPanes: [
          { paneId: 'p1', pageId: 'pg1', placement: null },
          { paneId: 'p2', pageId: 'pg1', placement: null },
        ],
      });
      useWorkspaceStore.setState({
        workspaces: [ws],
        activeWorkspaceId: 'ws1',
        selectWorkspace,
      });

      render(<WorkspaceTabs />);
      const trigger = screen.getByRole('button', { name: /Agents in Project Multi/i });
      fireEvent.click(trigger);

      // Restore agent 1
      fireEvent.click(screen.getByText('Agent 1').closest('button')!);
      expect(selectWorkspace).toHaveBeenCalledWith('ws1', 't1');

      // Restore agent 2
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('Agent 2').closest('button')!);
      expect(selectWorkspace).toHaveBeenCalledWith('ws1', 't2');
    });

    it('recovers an agent when all panes on a page are minimized', () => {
      const selectWorkspace = vi.fn();
      const ws = createMockWorkspace({
        id: 'ws1',
        name: 'Empty Page WS',
        terminals: [
          { id: 't1', pid: 1, harnessId: 'codex', displayName: 'Sole Agent', workingDir: '/workspace' },
        ],
        panes: [
          { id: 'p1', terminalId: 't1' },
        ],
        layoutRoot: null,
        minimizedPanes: [
          { paneId: 'p1', pageId: 'pg1', placement: null },
        ],
      });
      useWorkspaceStore.setState({
        workspaces: [ws],
        activeWorkspaceId: 'ws1',
        selectWorkspace,
      });

      render(<WorkspaceTabs />);
      const trigger = screen.getByRole('button', { name: /Agents in Empty Page WS/i });
      fireEvent.click(trigger);

      const agentBtn = screen.getByText('Sole Agent').closest('button')!;
      fireEvent.click(agentBtn);

      expect(selectWorkspace).toHaveBeenCalledWith('ws1', 't1');
    });

    it('restores an agent from another page without requiring attention', () => {
      const selectWorkspace = vi.fn();
      const ws = createMockWorkspace({
        id: 'ws1',
        name: 'Cross Page WS',
        activePageId: 'pg2',
        pages: [
          { id: 'pg1', layoutRoot: null, layoutRevision: 1, layoutUndoStack: [], activeTerminalId: null },
          { id: 'pg2', layoutRoot: { type: 'leaf', nodeId: 'n3', paneId: 'p3' }, layoutRevision: 1, layoutUndoStack: [], activeTerminalId: null },
        ],
        terminals: [
          { id: 't1', pid: 1, harnessId: 'codex', displayName: 'Agent on Page 1', workingDir: '/workspace' },
          { id: 't3', pid: 3, harnessId: 'codex', displayName: 'Agent on Page 2', workingDir: '/workspace' },
        ],
        panes: [
          { id: 'p1', terminalId: 't1' },
          { id: 'p3', terminalId: 't3' },
        ],
        minimizedPanes: [
          { paneId: 'p1', pageId: 'pg1', placement: null },
        ],
      });
      useWorkspaceStore.setState({
        workspaces: [ws],
        activeWorkspaceId: 'ws1',
        selectWorkspace,
      });

      render(<WorkspaceTabs />);
      const trigger = screen.getByRole('button', { name: /Agents in Cross Page WS/i });
      fireEvent.click(trigger);

      const agentBtn = screen.getByText('Agent on Page 1').closest('button')!;
      fireEvent.click(agentBtn);

      expect(selectWorkspace).toHaveBeenCalledWith('ws1', 't1');
    });
  });
});
