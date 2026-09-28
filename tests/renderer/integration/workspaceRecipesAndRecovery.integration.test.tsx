// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../../../src/renderer/App';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { WorkspaceRecipe } from '../../../src/shared/types/recipes';
import type { TaskSessionRecord } from '../../../src/shared/types/taskSessions';

function resetStore() {
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    terminals: [],
    panes: [],
    browserVisible: false,
    activeTerminalId: null,
  });
}

describe('Workspace Recipes and Task Recovery Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    });
  });
  describe('Recipe Workflow (#42)', () => {
    it('shows saved recipes in launcher, requires explicit click, and launches all steps', async () => {
      const mockRecipe: WorkspaceRecipe = {
        id: 'recipe-dev',
        name: 'Full Stack App',
        workspacePath: '/projects/my-web-app',
        description: 'Frontend and agent',
        launches: [
          { id: 'step-1', type: 'harness', harnessId: 'codex', modelId: 'gpt-5' },
          { id: 'step-2', type: 'command', command: 'npm run dev' },
        ],
        browser: { url: 'http://localhost:5173' },
        createdAt: 1000,
        updatedAt: 1000,
        version: 1,
      };

      const spawnTerminalMock = vi.fn()
        .mockResolvedValueOnce({ id: 'term-agent', pid: 1001, harnessId: 'codex' })
        .mockResolvedValueOnce({ id: 'term-server', pid: 1002 });

      const registerOpenWorkspaceMock = vi.fn().mockResolvedValue({ success: true });
      const browserNavigateMock = vi.fn().mockResolvedValue(true);

      installElectronApiMock({
        recipeGetAll: vi.fn().mockResolvedValue([mockRecipe]),
        spawnTerminal: spawnTerminalMock,
        registerOpenWorkspace: registerOpenWorkspaceMock,
        browserNavigate: browserNavigateMock,
        getLastWorkspace: vi.fn().mockResolvedValue('/projects/my-web-app'),
      });

      render(<App />);

      // Verify the launcher shows the recipe chip
      const recipeChip = await screen.findByRole('button', { name: /Full Stack App/i });
      expect(recipeChip).toBeInTheDocument();

      // Verify NO terminal has been spawned yet (no auto-execution!)
      expect(spawnTerminalMock).not.toHaveBeenCalled();

      // Click the recipe chip to inspect
      fireEvent.click(recipeChip);

      // Verify inspection modal opens with commands clearly displayed
      expect(await screen.findByText('Will launch:')).toBeInTheDocument();
      expect(screen.getByText(/Codex/)).toBeInTheDocument();
      expect(screen.getByText('npm run dev')).toBeInTheDocument();
      expect(screen.getByText('http://localhost:5173')).toBeInTheDocument();

      // Still no execution prior to explicit user action
      expect(spawnTerminalMock).not.toHaveBeenCalled();

      // Click explicit Launch Recipe button
      const launchBtn = screen.getByRole('button', { name: /launch recipe/i });
      fireEvent.click(launchBtn);

      // Verify workspace opened and all steps executed
      await waitFor(() => {
        expect(registerOpenWorkspaceMock).toHaveBeenCalled();
        expect(spawnTerminalMock).toHaveBeenCalledTimes(2);
        expect(spawnTerminalMock).toHaveBeenNthCalledWith(1, '/projects/my-web-app', 'codex', 'gpt-5');
        expect(spawnTerminalMock).toHaveBeenNthCalledWith(2, '/projects/my-web-app', undefined, undefined, 'npm run dev', true);
        expect(browserNavigateMock).toHaveBeenCalledWith(expect.any(String), 'http://localhost:5173', undefined, true);
      });
    });
    it('restores saved recipe layout topology onto newly spawned panes', async () => {
      const recipeWithLayout: WorkspaceRecipe = {
        id: 'recipe-layout',
        name: 'Split Layout Recipe',
        workspacePath: '/projects/split-app',
        terminalCount: 2,
        launches: [
          { id: 's1', type: 'shell' },
          { id: 's2', type: 'harness', harnessId: 'codex' },
        ],
        layout: {
          root: {
            type: 'split',
            orientation: 'horizontal',
            ratio: 0.5,
            first: { type: 'leaf', paneKey: 'terminal:0' },
            second: { type: 'leaf', paneKey: 'terminal:1' },
          },
          terminalCount: 2,
        },
        createdAt: 1000,
        updatedAt: 1000,
        version: 1,
      };

      const spawnTerminal = vi.fn()
        .mockResolvedValueOnce({ id: 'term-split-1', pid: 2001 })
        .mockResolvedValueOnce({ id: 'term-split-2', pid: 2002, harnessId: 'codex' });
      installElectronApiMock({
        recipeGetAll: vi.fn().mockResolvedValue([recipeWithLayout]),
        spawnTerminal,
        registerOpenWorkspace: vi.fn().mockResolvedValue({ success: true }),
        getLastWorkspace: vi.fn().mockResolvedValue('/projects/split-app'),
      });

      render(<App />);

      const chip = await screen.findByRole('button', { name: /Split Layout Recipe/i });
      fireEvent.click(chip);

      const launchBtn = screen.getByRole('button', { name: /launch recipe/i });
      fireEvent.click(launchBtn);

      await waitFor(() => {
        const store = useWorkspaceStore.getState();
        const activeWs = store.workspaces.find((w) => w.workspacePath === '/projects/split-app');
        expect(activeWs).toBeDefined();
        expect(activeWs?.panes.length).toBe(2);
        expect(activeWs?.layoutRoot).not.toBeNull();
        expect(activeWs?.layoutRoot?.type).toBe('split');
        expect(activeWs?.terminals.map((terminal) => terminal.harnessId)).toEqual([null, 'codex']);
      });
      expect(spawnTerminal).toHaveBeenNthCalledWith(1, '/projects/split-app');
      expect(spawnTerminal).toHaveBeenNthCalledWith(2, '/projects/split-app', 'codex', undefined);
    });

    it('keeps prior terminals usable and reports a command startup failure after opening a workspace', async () => {
      const recipe: WorkspaceRecipe = {
        id: 'recipe-partial', name: 'Partial Recipe', workspacePath: '/projects/partial',
        launches: [{ id: 'shell', type: 'shell' }, { id: 'command', type: 'command', command: 'missing-tool' }],
        createdAt: 1, updatedAt: 1, version: 1,
      };
      const spawnTerminal = vi.fn()
        .mockResolvedValueOnce({ id: 'shell-term', pid: 1001 })
        .mockResolvedValueOnce({ id: 'command-term', pid: 1002 });
      installElectronApiMock({
        recipeGetAll: vi.fn().mockResolvedValue([recipe]),
        getLastWorkspace: vi.fn().mockResolvedValue('/projects/partial'),
        registerOpenWorkspace: vi.fn().mockResolvedValue({ success: true }),
        spawnTerminal,
        waitRecipeCommand: vi.fn().mockResolvedValue({ status: 'failed', error: 'Command exited immediately with code 127' }),
      });
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /Partial Recipe/i }));
      fireEvent.click(screen.getByRole('button', { name: /launch recipe/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Command exited immediately with code 127');
      const ws = useWorkspaceStore.getState().workspaces.find((workspace) => workspace.workspacePath === '/projects/partial');
      expect(ws?.terminals.map((terminal) => terminal.id)).toEqual(['shell-term', 'command-term']);
      expect(spawnTerminal).toHaveBeenCalledTimes(2);
    });
  });

  describe('Task Recovery Workflow (#43)', () => {
    it('restores previous tasks after restart and resumes via native session invoke without replaying prompts', async () => {
      const recoveredTask: TaskSessionRecord = {
        id: 'task-refactor',
        workspacePath: '/projects/my-app',
        harnessId: 'codex',
        modelId: 'gpt-5',
        title: 'Refactor Auth Service',
        nativeSessionId: 'codex-sess-999',
        state: 'resumable',
        createdAt: 1000,
        updatedAt: 2000,
        version: 1,
      };

      const invokeSessionMock = vi.fn().mockResolvedValue({
        id: 'term-new-resume',
        pid: 3001,
        harnessId: 'codex',
      });

      installElectronApiMock({
        taskSessionList: vi.fn().mockResolvedValue([recoveredTask]),
        invokeSession: invokeSessionMock,
        discoverSessions: vi.fn().mockResolvedValue([]),
        getLastWorkspace: vi.fn().mockResolvedValue('/projects/my-app'),
        spawnTerminal: vi.fn().mockResolvedValue({ id: 'term-1', pid: 1001 }),
      });

      // Render workspace
      useWorkspaceStore.getState().addWorkspace(createWorkspaceFixture({
        id: 'ws-active',
        name: 'my-app',
        workspacePath: '/projects/my-app',
        harness: 'codex',
        model: 'gpt-5',
        terminals: [{ id: 'term-1', pid: 1001, workingDir: '/projects/my-app' }],
        panes: [{ id: 'pane-1', terminalId: 'term-1' }],
        activeTerminalId: 'term-1',
      }));

      render(<App />);

      // Open Chat History / Task Recovery dropdown
      const chatBtn = screen.getByRole('button', { name: /chat history/i });
      fireEvent.click(chatBtn);

      // Verify the prior task is displayed with 'Resumable' state
      expect(await screen.findByText('Refactor Auth Service')).toBeInTheDocument();
      expect(screen.getByText('Resumable')).toBeInTheDocument();

      // Click Resume
      const resumeBtn = screen.getByRole('button', { name: /resume/i });
      fireEvent.click(resumeBtn);

      // Verify invokeSession is called with the native conversation session and NO prompt re-execution
      await waitFor(() => {
        expect(invokeSessionMock).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'codex-sess-999',
            harness: 'codex',
            cwd: '/projects/my-app',
          }),
        );
      });

      // Verify the new terminal is added to the workspace
      const storeState = useWorkspaceStore.getState();
      const activeWorkspace = storeState.workspaces.find((w) => w.id === 'ws-active');
      expect(activeWorkspace?.terminals.some((t) => t.id === 'term-new-resume')).toBe(true);
    });
    it('handles deleted native sessions by displaying unavailable status and explanation', async () => {
      const deletedTask: TaskSessionRecord = {
        id: 'task-deleted',
        workspacePath: '/projects/my-app',
        harnessId: 'codex',
        nativeSessionId: 'deleted-session-id',
        title: 'Deleted Task',
        state: 'unavailable',
        stateReason: 'Native conversation session was not found on disk',
        createdAt: 1000,
        updatedAt: 2000,
        version: 1,
      };

      installElectronApiMock({
        taskSessionList: vi.fn().mockResolvedValue([deletedTask]),
        discoverSessions: vi.fn().mockResolvedValue([]),
        getLastWorkspace: vi.fn().mockResolvedValue('/projects/my-app'),
      });

      useWorkspaceStore.getState().addWorkspace(createWorkspaceFixture({
        id: 'ws-active-2',
        name: 'my-app',
        workspacePath: '/projects/my-app',
      }));

      render(<App />);

      const chatBtn = screen.getByRole('button', { name: /chat history/i });
      fireEvent.click(chatBtn);

      expect(await screen.findByText('Deleted Task')).toBeInTheDocument();
      expect(screen.getByText('Unavailable')).toBeInTheDocument();
      expect(screen.getByText(/Native conversation session was not found on disk/i)).toBeInTheDocument();
    });
  });
});
