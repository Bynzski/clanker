// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { launchSession } from '../../../src/renderer/lib/sessionLaunch';
import { currentCheckoutSelection } from '../../../src/renderer/lib/checkoutSelection';
import { gitManagementScope } from '../../../src/renderer/components/git/gitManagementScope';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import { EMPTY_ATTENTION, snapshot, storeState } from '../../_helpers/attentionSnapshots';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';

const MAIN: CheckoutContext = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: '/repo', kind: 'main' };
const A: CheckoutContext = { ...MAIN, id: 'ws::a', kind: 'worktree', path: '/external/a', branch: 'task-a' };
const workspace = () => useWorkspaceStore.getState().getWorkspaceById('ws')!;
const request = { workspaceId: 'ws', harnessId: 'codex', visibleHarnessIds: ['codex'] };
let api: ReturnType<typeof installElectronApiMock>;
beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useAssistantNavStore.setState({ activeAssistantId: null });
  useAgentAttentionStore.setState(EMPTY_ATTENTION);
  useWorkspaceStore.getState().addWorkspace(createWorkspaceFixture({ id: 'ws', workspacePath: MAIN.path, gitIsRepo: true,
    checkoutContexts: [MAIN], terminals: [], panes: [], activeTerminalId: null }));
  useWorkspaceStore.getState().addTerminal(createTerminalFixture({ id: 'old', workingDir: MAIN.path, checkoutContextId: MAIN.id }), 'ws');
  useAgentAttentionStore.setState(storeState([snapshot('old', 'running', 5, {
    location: { path: '/unregistered/location', checkoutContextId: null }, locationProvenance: { state: 'current', sessionId: 'old-session' },
  })]));
  let index = 0;
  api = installElectronApiMock({
    spawnTerminal: vi.fn(async (_dir, _h, _m, _c, _r, _ws, _env, contextId) => ({ id: `new-${++index}`, pid: 50 + index, checkoutContextId: contextId ?? MAIN.id })),
    adoptWorktreeCheckoutContext: vi.fn(async () => ({ success: true, checkoutContext: A })),
    gitGetBranchState: vi.fn(async () => ({ success: true, isRepo: true, currentBranch: 'main', isDetached: false, branches: [{ name: 'main', isCurrent: true }] })),
    gitCreateWorktree: vi.fn(async () => ({ success: true, checkoutContext: A })),
  });
});

describe('#170 explicit launch identity without observed-location authority', () => {
  it.each(['main', 'worktree'] as const)('launches in %s while the old observation remains unavailable, then focus restores that truthful state', async (kind) => {
    const original = workspace().terminals[0];
    expect(currentCheckoutSelection(workspace())).toMatchObject({ availability: 'unavailable', reason: 'unregistered-observation' });
    expect(gitManagementScope(MAIN.path, 'ws')?.blocked).toBeTruthy();
    expect(await launchSession({ ...request, target: kind === 'main' ? { kind } : { kind, path: A.path, expectedBranch: A.branch } })).toEqual({ ok: true });
    expect(api.spawnTerminal.mock.calls[0][0]).toBe(kind === 'main' ? MAIN.path : A.path);
    expect(workspace().terminals.find((terminal) => terminal.id === 'old')).toEqual(original);
    expect(api.killTerminal).not.toHaveBeenCalled();
    useWorkspaceStore.getState().setActiveTerminal('old');
    expect(currentCheckoutSelection(workspace())).toMatchObject({ availability: 'unavailable', reason: 'unregistered-observation' });
    expect(workspace().checkoutContexts?.some((context) => context.path === '/unregistered/location')).toBe(false);
  });

  it('revalidates an already registered worktree and refuses a stale locked/changed Git entry', async () => {
    useWorkspaceStore.getState().upsertCheckoutContext('ws', A);
    api.adoptWorktreeCheckoutContext.mockResolvedValueOnce({ success: false, error: 'That worktree is locked' });
    const result = await launchSession({ ...request, target: { kind: 'worktree', path: A.path, expectedBranch: A.branch } });
    expect(result).toMatchObject({ ok: false, error: 'That worktree is locked' });
    expect(api.adoptWorktreeCheckoutContext).toHaveBeenCalledWith('ws', A.path, A.branch);
    expect(api.spawnTerminal).not.toHaveBeenCalled();
  });

  it('passes an explicit base worktree to main and supports create-only without touching the existing process', async () => {
    const original = workspace().terminals[0];
    expect(await launchSession({ ...request, createOnly: true, target: { kind: 'new-branch', branch: 'from-a', baseWorktree: { path: A.path, branch: A.branch! } } })).toEqual({ ok: true });
    expect(api.gitCreateWorktree).toHaveBeenCalledWith(MAIN.path, 'HEAD', 'from-a', 'ws', {
      attachCheckoutContext: true, newBranch: { baseWorktree: { path: A.path, branch: A.branch } },
    });
    expect(api.spawnTerminal).not.toHaveBeenCalled();
    expect(workspace().terminals).toEqual([original]);
  });

  it('after restart with main-only registration explicitly adopts the external worktree before spawning', async () => {
    expect(workspace().checkoutContexts).toEqual([MAIN]);
    expect(await launchSession({ ...request, target: { kind: 'worktree', path: A.path, expectedBranch: A.branch } })).toEqual({ ok: true });
    expect(api.adoptWorktreeCheckoutContext.mock.invocationCallOrder[0]).toBeLessThan(api.spawnTerminal.mock.invocationCallOrder[0]);
    expect(workspace().checkoutContexts).toContainEqual(A);
    expect(workspace().terminals[workspace().terminals.length - 1]?.checkoutContextId).toBe(A.id);
  });
});
