// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import App from '../../../src/renderer/App';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { WorkspaceRecipe } from '../../../src/shared/types/recipes';

vi.mock('../../../src/renderer/lib/terminalPaneGeometry', async (original) => ({
  ...(await original<object>()), waitForTerminalPaneGeometry: vi.fn().mockResolvedValue({ cols: 120, rows: 40 }),
}));

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

describe('Workspace Recipes and Conversation Resume Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    useWorkspaceNavigationStore.setState({ mode: 'tabs', resolved: true });
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
        registerOpenWorkspace: vi.fn(async (_id: string, path: string, environmentId = 'local') => ({
          success: true, location: { path, environmentId },
        })),
        getLastWorkspace: vi.fn().mockResolvedValue('/projects/split-app'),
      });

      useWorkspaceStore.getState().addWorkspace(createWorkspaceFixture({
        workspacePath: recipeWithLayout.workspacePath, terminals: [], panes: [], activeTerminalId: null, layoutRoot: null,
      }));
      render(<App />);

      fireEvent.click(screen.getByRole('button', { name: /Recipes/i }));
      fireEvent.click(await screen.findByRole('button', { name: 'Launch Recipe' }));


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

    it.each([false, true])('keeps preview visible when saved layout includes browser: %s', async (layoutHasBrowser) => {
      const recipe: WorkspaceRecipe = {
        id: 'recipe-browser-layout', name: 'Browser Layout Recipe', workspacePath: '/projects/browser-app',
        launches: [{ id: 'shell', type: 'shell' }],
        browser: { url: 'https://example.com' },
        layout: {
          root: layoutHasBrowser
            ? { type: 'split', orientation: 'horizontal', ratio: 0.5,
              first: { type: 'leaf', paneKey: 'terminal:0' },
              second: { type: 'leaf', paneKey: 'browser' } }
            : { type: 'leaf', paneKey: 'terminal:0' },
          terminalCount: 1,
        },
        createdAt: 1, updatedAt: 1, version: 1,
      };
      const browserNavigate = vi.fn().mockResolvedValue(true);
      installElectronApiMock({
        recipeGetAll: vi.fn().mockResolvedValue([recipe]),
        getLastWorkspace: vi.fn().mockResolvedValue('/projects/browser-app'),
        registerOpenWorkspace: vi.fn(async (_id: string, path: string, environmentId = 'local') => ({
          success: true, location: { path, environmentId },
        })),
        spawnTerminal: vi.fn().mockResolvedValue({ id: 'term-browser', pid: 1001 }),
        probeRecipePreview: vi.fn().mockResolvedValue({ status: 'remote' }),
        browserNavigate,
      });
      useWorkspaceStore.getState().addWorkspace(createWorkspaceFixture({
        workspacePath: recipe.workspacePath, terminals: [], panes: [], activeTerminalId: null, layoutRoot: null,
      }));
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /Recipes/i }));
      fireEvent.click(await screen.findByRole('button', { name: 'Launch Recipe' }));
      await waitFor(() => {
        const workspace = useWorkspaceStore.getState().workspaces.find((entry) => entry.workspacePath === '/projects/browser-app');
        expect(workspace?.browserVisible).toBe(true);
        expect(workspace?.browserPane).toBeDefined();
        expect(workspace?.panes).toHaveLength(1);
        expect(browserNavigate).toHaveBeenCalledOnce();
      });
      expect(browserNavigate).toHaveBeenCalledWith(expect.any(String), 'https://example.com', undefined, true);
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
        registerOpenWorkspace: vi.fn(async (_id: string, path: string, environmentId = 'local') => ({
          success: true, location: { path, environmentId },
        })),
        spawnTerminal,
        waitRecipeCommand: vi.fn().mockResolvedValue({ status: 'failed', error: 'Command exited immediately with code 127' }),
      });
      useWorkspaceStore.getState().addWorkspace(createWorkspaceFixture({
        workspacePath: recipe.workspacePath, terminals: [], panes: [], activeTerminalId: null, layoutRoot: null,
      }));
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /Recipes/i }));
      fireEvent.click(await screen.findByRole('button', { name: 'Launch Recipe' }));
      expect(await screen.findByText('Command exited immediately with code 127')).toBeInTheDocument();
      const ws = useWorkspaceStore.getState().workspaces.find((workspace) => workspace.workspacePath === '/projects/partial');
      expect(ws?.terminals.map((terminal) => terminal.id)).toEqual(['shell-term', 'command-term']);
      expect(spawnTerminal).toHaveBeenCalledTimes(2);
    });
  });

  describe('Conversation History Workflow', () => {
    it('resumes a native conversation from Chat history without replaying prompts', async () => {
      const invokeSessionMock = vi.fn().mockResolvedValue({
        id: 'term-new-resume',
        pid: 3001,
        harnessId: 'codex',
      });

      installElectronApiMock({
        invokeSession: invokeSessionMock,
        discoverSessions: vi.fn().mockResolvedValue([{
          id: 'codex-sess-999',
          harness: 'codex',
          title: 'Refactor Auth Service',
          cwd: '/projects/my-app',
          timestamp: 2000,
        }]),
        getLastWorkspace: vi.fn().mockResolvedValue('/projects/my-app'),
        spawnTerminal: vi.fn().mockResolvedValue({ id: 'term-1', pid: 1001 }),
      });

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

      const chatBtn = screen.getByRole('button', { name: /chat history/i });
      fireEvent.click(chatBtn);

      fireEvent.click(await screen.findByRole('button', { name: /Codex/i }));
      fireEvent.click(screen.getByRole('button', { name: /Refactor Auth Service/i }));

      await waitFor(() => {
        expect(invokeSessionMock).toHaveBeenCalledWith(
          'ws-active',
          expect.objectContaining({
            id: 'codex-sess-999',
            harness: 'codex',
            cwd: '/projects/my-app',
          }),
          false,
          { initialGeometry: { cols: 120, rows: 40 } },
        );
      });

      const activeWorkspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === 'ws-active');
      expect(activeWorkspace?.terminals.some((t) => t.id === 'term-new-resume')).toBe(true);
      expect(screen.queryByText('Workspace Tasks')).toBeNull();
    });

    it('reports an empty native history without a task list', async () => {
      installElectronApiMock({
        discoverSessions: vi.fn().mockResolvedValue([]),
        getLastWorkspace: vi.fn().mockResolvedValue('/projects/my-app'),
      });

      useWorkspaceStore.getState().addWorkspace(createWorkspaceFixture({
        id: 'ws-empty',
        name: 'my-app',
        workspacePath: '/projects/my-app',
      }));

      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /chat history/i }));

      expect(await screen.findByText('No sessions for this workspace')).toBeInTheDocument();
      expect(screen.queryByText('Workspace Tasks')).toBeNull();
    });
  });
});
