// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../../src/renderer/App';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { launchTerminalInCheckoutContext } from '../../../src/renderer/lib/checkoutContextLaunch';
import { installElectronApiMock } from '../../setup/electron';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { GitWorktreeCreateResult } from '../../../src/shared/types/git';

const ROOT = '/projects/clanker';
const WORKTREE = '/projects/clanker-worktrees/issue-90-test';

function resetStore() {
  useWorkspaceStore.setState({
    workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null,
    terminals: [], panes: [], activeTerminalId: null, layoutRoot: null,
  });
}

/** Behaves like main: a context id (explicit) is echoed back; main resolves the rest. */
function spawnLikeMain() {
  let next = 0;
  return vi.fn().mockImplementation(async (_dir: string, harness?: string, _model?: string, _cmd?: string, _recipe?: boolean, workspaceId?: string, _env?: string, contextId?: string) => ({
    id: `terminal-${++next}`, pid: 1000 + next, harnessId: harness,
    checkoutContextId: contextId ?? (workspaceId ? `${workspaceId}::main` : undefined),
  }));
}

async function openWorkspace() {
  render(<App />);
  fireEvent.change(document.querySelector('.gate-input') as HTMLInputElement, { target: { value: ROOT } });
  const add = screen.getByRole('button', { name: 'Add plain terminal' });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeEnabled());
  fireEvent.click(screen.getByText('Launch Workspace'));
  await waitFor(() => expect(useWorkspaceStore.getState().workspaces).toHaveLength(1));
  return useWorkspaceStore.getState().workspaces[0];
}

describe('main and worktree agents in one workspace', () => {
  let spawnTerminal: ReturnType<typeof spawnLikeMain>;
  let registerOpenWorkspace: ReturnType<typeof vi.fn>;
  let gitCreateWorktree: ReturnType<typeof vi.fn>;
  let killTerminal: ReturnType<typeof vi.fn>;

  const worktreeContextFor = (workspaceId: string): CheckoutContext => ({
    id: `${workspaceId}::ckt-wt`, workspaceId, environmentId: 'local', path: WORKTREE,
    kind: 'worktree', branch: 'issue-90-test', mainCheckoutPath: ROOT,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() },
    });
    spawnTerminal = spawnLikeMain();
    killTerminal = vi.fn().mockResolvedValue({ success: true });
    registerOpenWorkspace = vi.fn().mockImplementation(async (id: string) => ({
      success: true,
      location: { environmentId: 'local', path: ROOT },
      checkoutContext: { id: `${id}::main`, workspaceId: id, environmentId: 'local', path: ROOT, kind: 'main' },
    }));
    gitCreateWorktree = vi.fn().mockImplementation(async (_path: string, _base: string, _branch: string, workspaceId?: string): Promise<GitWorktreeCreateResult> => ({
      success: true,
      worktree: { path: WORKTREE, branch: 'issue-90-test', isMain: false, isLocked: false, isPrunable: false },
      checkoutContext: worktreeContextFor(workspaceId!),
    }));
    installElectronApiMock({
      getLastWorkspace: vi.fn().mockResolvedValue(ROOT),
      getHarnessOptions: vi.fn().mockResolvedValue({ codex: true, '': true }),
      getHarnessModels: vi.fn().mockResolvedValue([]),
      getTerminalBuffer: vi.fn().mockResolvedValue(''),
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
      registerOpenWorkspace, spawnTerminal, gitCreateWorktree, killTerminal,
    });
  });

  async function setUpTwoAgents() {
    const workspace = await openWorkspace();
    const created = await window.electronAPI.gitCreateWorktree(workspace.workspacePath, 'main', 'issue-90-test', workspace.id, { attachCheckoutContext: true });
    expect(useWorkspaceStore.getState().upsertCheckoutContext(workspace.id, created.checkoutContext!)).toBe(true);
    const state = () => useWorkspaceStore.getState().getWorkspaceById(workspace.id)!;
    const mainContext = state().checkoutContexts!.find((context) => context.kind === 'main')!;
    const worktreeContext = state().checkoutContexts!.find((context) => context.kind === 'worktree')!;
    const agentA = await launchTerminalInCheckoutContext(state(), mainContext, { harness: 'codex' });
    const agentB = await launchTerminalInCheckoutContext(state(), worktreeContext, { harness: 'codex' });
    return { workspace, state, mainContext, worktreeContext, agentA, agentB };
  }

  it('holds a main-checkout agent and a worktree agent in exactly one workspace', async () => {
    const { workspace, state, mainContext, worktreeContext, agentA, agentB } = await setUpTwoAgents();

    // One WorkspaceTab, one registration, root unchanged.
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    expect(registerOpenWorkspace).toHaveBeenCalledTimes(1);
    expect(state().workspacePath).toBe(ROOT);
    expect(state().isLinkedWorktree).toBe(false);

    // Exactly two contexts: ws::main and the worktree.
    expect(state().checkoutContexts).toEqual([
      { id: `${workspace.id}::main`, workspaceId: workspace.id, environmentId: 'local', path: ROOT, kind: 'main' },
      worktreeContextFor(workspace.id),
    ]);
    expect(mainContext.path).toBe(ROOT);
    expect(worktreeContext.path).toBe(WORKTREE);

    // Both agents live in that workspace, each bound to its own context and directory.
    expect(agentA).toMatchObject({ workspaceId: workspace.id, checkoutContextId: mainContext.id, workingDir: ROOT, harnessId: 'codex' });
    expect(agentB).toMatchObject({ workspaceId: workspace.id, checkoutContextId: worktreeContext.id, workingDir: WORKTREE, harnessId: 'codex' });
    expect(agentA.workingDir).not.toBe(agentB.workingDir);
    const stored = state().terminals;
    expect(stored.map((terminal) => terminal.id)).toEqual(expect.arrayContaining([agentA.id, agentB.id]));
    expect(stored.every((terminal) => terminal.workspaceId === workspace.id)).toBe(true);
    // The launcher's own plain terminal stays on the main checkout.
    expect(stored[0].checkoutContextId).toBe(mainContext.id);
  });

  it('asks main for each launch with the owning workspace, environment and context id', async () => {
    const { workspace, mainContext, worktreeContext } = await setUpTwoAgents();
    const launches = spawnTerminal.mock.calls.slice(-2);

    expect(launches[0]).toEqual([ROOT, 'codex', undefined, undefined, undefined, workspace.id, 'local', mainContext.id]);
    expect(launches[1]).toEqual([WORKTREE, 'codex', undefined, undefined, undefined, workspace.id, 'local', worktreeContext.id]);
  });

  it('never registers the worktree as a workspace, and adding the second agent keeps the main context', async () => {
    const { state, mainContext } = await setUpTwoAgents();

    expect(registerOpenWorkspace).toHaveBeenCalledTimes(1);
    expect(registerOpenWorkspace).toHaveBeenCalledWith(expect.any(String), expect.stringContaining(ROOT));
    expect(registerOpenWorkspace).not.toHaveBeenCalledWith(expect.anything(), WORKTREE, expect.anything());
    expect(state().checkoutContexts![0]).toEqual(mainContext);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(state().id);
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
  });

  it('keeps the main context and workspace root when the worktree agent is closed', async () => {
    const { state, agentA, agentB, worktreeContext } = await setUpTwoAgents();

    useWorkspaceStore.getState().removeTerminal(agentB.id);

    expect(state().terminals.map((terminal) => terminal.id)).toContain(agentA.id);
    expect(state().terminals.map((terminal) => terminal.id)).not.toContain(agentB.id);
    // A context outlives the agent that used it (it may be reused; releasing is a later step).
    expect(state().checkoutContexts!.map((context) => context.id)).toContain(worktreeContext.id);
    expect(state().workspacePath).toBe(ROOT);
  });

  it('refuses to launch into another workspace\'s context without calling main', async () => {
    const { workspace, worktreeContext } = await setUpTwoAgents();
    spawnTerminal.mockClear();

    await expect(launchTerminalInCheckoutContext({ id: 'someone-else', environmentId: 'local' }, worktreeContext))
      .rejects.toThrow('does not belong to this workspace');
    await expect(launchTerminalInCheckoutContext({ id: workspace.id, environmentId: 'vps' }, worktreeContext))
      .rejects.toThrow('different environment');
    expect(spawnTerminal).not.toHaveBeenCalled();
  });

  it('discards a terminal that main did not bind to the requested context', async () => {
    const { state, worktreeContext } = await setUpTwoAgents();
    const before = state().terminals.length;
    spawnTerminal.mockResolvedValueOnce({ id: 'terminal-rogue', pid: 1, checkoutContextId: `${state().id}::main` });

    await expect(launchTerminalInCheckoutContext(state(), worktreeContext, { harness: 'codex' }))
      .rejects.toThrow('not launched in the requested checkout context');

    expect(killTerminal).toHaveBeenCalledWith('terminal-rogue');
    expect(state().terminals).toHaveLength(before);
  });

  it('propagates a launch rejection from main without adding a terminal', async () => {
    const { state, worktreeContext } = await setUpTwoAgents();
    const before = state().terminals.length;
    spawnTerminal.mockRejectedValueOnce(new Error('Terminal directory is outside the registered workspace'));

    await expect(launchTerminalInCheckoutContext(state(), worktreeContext)).rejects.toThrow('outside the registered workspace');
    expect(state().terminals).toHaveLength(before);
  });
});
