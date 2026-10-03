import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { sanitizeWorkspace } from '../../../src/renderer/store/workspaceStoreHelpers';
import {
  backfillCheckoutContexts,
  bindTerminalToCheckoutContext,
  getCheckoutContext,
  upsertCheckoutContextList,
} from '../../../src/renderer/lib/checkoutContexts';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';

const mainContext = (workspaceId: string, path = '/workspace', environmentId = 'local'): CheckoutContext => ({
  id: mainCheckoutContextId(workspaceId), workspaceId, environmentId, path, kind: 'main',
});

/** addWorkspace input: a fixture without the identity/lifecycle fields the store assigns. */
function workspaceInput(overrides: Partial<WorkspaceTab> = {}): Omit<WorkspaceTab, 'id' | 'lifecycle'> {
  const { id: _id, lifecycle: _lifecycle, ...input } = createWorkspaceFixture(overrides);
  void _id; void _lifecycle;
  return input;
}

describe('checkout context backfill (legacy workspace data)', () => {
  it('derives a main context from a workspace that has none', () => {
    const workspace = createWorkspaceFixture({ id: 'ws-1', workspacePath: '/work/app', checkoutContexts: undefined });
    expect(backfillCheckoutContexts(workspace)).toEqual([mainContext('ws-1', '/work/app')]);
  });

  it('keeps the SSH environment and canonical POSIX path of a legacy remote workspace', () => {
    const workspace = createWorkspaceFixture({ id: 'ws-r', workspacePath: '/srv/app/', environmentId: 'vps' });
    expect(backfillCheckoutContexts(workspace)).toEqual([mainContext('ws-r', '/srv/app', 'vps')]);
  });

  it('treats a legacy linked-worktree workspace as its own worktree-kind root', () => {
    const workspace = createWorkspaceFixture({
      id: 'ws-wt', workspacePath: '/work/app-worktrees/task', isLinkedWorktree: true, gitCurrentBranch: 'task',
    });
    expect(backfillCheckoutContexts(workspace)).toEqual([
      { ...mainContext('ws-wt', '/work/app-worktrees/task'), kind: 'worktree', branch: 'task' },
    ]);
  });

  it('leaves a workspace that already has its main context untouched', () => {
    const recorded: CheckoutContext = { ...mainContext('ws-1', '/work/app'), kind: 'worktree', branch: 'x' };
    const workspace = createWorkspaceFixture({ id: 'ws-1', workspacePath: '/work/app', checkoutContexts: [recorded] });
    expect(backfillCheckoutContexts(workspace)).toEqual([recorded]);
  });

  it('adds the main context ahead of other contexts that were already recorded', () => {
    const extra: CheckoutContext = { id: 'ws-1::ckt-1', workspaceId: 'ws-1', environmentId: 'local', path: '/work/wt', kind: 'worktree' };
    const workspace = createWorkspaceFixture({ id: 'ws-1', workspacePath: '/work/app', checkoutContexts: [extra] });
    expect(backfillCheckoutContexts(workspace).map((context) => context.id)).toEqual([mainCheckoutContextId('ws-1'), 'ws-1::ckt-1']);
  });

  it('binds an unbound terminal to the main checkout and never rebinds a bound one', () => {
    const legacy = createTerminalFixture({ id: 't-legacy', checkoutContextId: undefined });
    const bound = createTerminalFixture({ id: 't-bound', checkoutContextId: 'ws-1::ckt-1' });
    expect(bindTerminalToCheckoutContext(legacy, 'ws-1').checkoutContextId).toBe(mainCheckoutContextId('ws-1'));
    expect(bindTerminalToCheckoutContext(bound, 'ws-1')).toBe(bound);
  });

  it('sanitizeWorkspace backfills contexts and terminal bindings, and is idempotent', () => {
    const workspace = createWorkspaceFixture({
      id: 'ws-1',
      terminals: [createTerminalFixture({ id: 'a', checkoutContextId: undefined }), createTerminalFixture({ id: 'b', checkoutContextId: 'ws-1::ckt-1' })],
    });
    const once = sanitizeWorkspace(workspace);
    expect(once.checkoutContexts).toEqual([mainContext('ws-1')]);
    expect(once.terminals.map((terminal) => terminal.checkoutContextId)).toEqual([mainCheckoutContextId('ws-1'), 'ws-1::ckt-1']);
    expect(sanitizeWorkspace(once).checkoutContexts).toEqual(once.checkoutContexts);
  });

  it('looks contexts up by id within a workspace only', () => {
    const workspace = createWorkspaceFixture({ checkoutContexts: [mainContext('workspace-1')] });
    expect(getCheckoutContext(workspace, mainCheckoutContextId('workspace-1'))).not.toBeNull();
    expect(getCheckoutContext(workspace, 'other::main')).toBeNull();
    expect(getCheckoutContext(workspace, undefined)).toBeNull();
  });
});

describe('workspace store checkout contexts', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null, terminals: [], panes: [] });
  });

  it('gives a workspace added without contexts a main context and binds its terminals', () => {
    const input = workspaceInput({ checkoutContexts: undefined });
    useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws-1', terminals: [createTerminalFixture({ id: 't1', checkoutContextId: undefined })] });

    const workspace = useWorkspaceStore.getState().getWorkspaceById('ws-1')!;
    expect(workspace.checkoutContexts).toEqual([mainContext('ws-1')]);
    expect(workspace.terminals[0].checkoutContextId).toBe(mainCheckoutContextId('ws-1'));
    // The active-workspace mirror agrees with the tab.
    expect(useWorkspaceStore.getState().terminals[0].checkoutContextId).toBe(mainCheckoutContextId('ws-1'));
  });

  it('keeps contexts supplied at registration (the registered root and kind)', () => {
    const input = workspaceInput();
    const registered = { ...mainContext('ws-1'), kind: 'worktree' as const, branch: 'task' };
    useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws-1', checkoutContexts: [registered] });
    expect(useWorkspaceStore.getState().getWorkspaceById('ws-1')?.checkoutContexts).toEqual([registered]);
  });

  it('binds terminals added later to the owning workspace\'s main checkout, scoped or active', () => {
    const input = workspaceInput({ terminals: [], panes: [], activeTerminalId: null });
    const store = useWorkspaceStore.getState();
    store.addWorkspace({ ...input, id: 'ws-1' });
    store.addWorkspace({ ...input, id: 'ws-2', workspacePath: '/other' });

    useWorkspaceStore.getState().addTerminal(createTerminalFixture({ id: 'scoped', checkoutContextId: undefined }), 'ws-1');
    useWorkspaceStore.getState().addTerminal(createTerminalFixture({ id: 'active', checkoutContextId: undefined }));

    const state = useWorkspaceStore.getState();
    expect(state.getWorkspaceById('ws-1')?.terminals[0]).toMatchObject({ id: 'scoped', checkoutContextId: mainCheckoutContextId('ws-1') });
    expect(state.getWorkspaceById('ws-2')?.terminals[0]).toMatchObject({ id: 'active', checkoutContextId: mainCheckoutContextId('ws-2') });
  });

  it('keeps an explicit terminal context and does not touch other terminals when one is closed', () => {
    const input = workspaceInput({ terminals: [], panes: [], activeTerminalId: null });
    useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws-1' });
    useWorkspaceStore.getState().addTerminal(createTerminalFixture({ id: 'wt', checkoutContextId: 'ws-1::ckt-1' }), 'ws-1');
    useWorkspaceStore.getState().addTerminal(createTerminalFixture({ id: 'main', checkoutContextId: undefined }), 'ws-1');

    useWorkspaceStore.getState().removeTerminal('main');

    const workspace = useWorkspaceStore.getState().getWorkspaceById('ws-1')!;
    expect(workspace.terminals.map((terminal) => [terminal.id, terminal.checkoutContextId])).toEqual([['wt', 'ws-1::ckt-1']]);
    // Closing a terminal never closes the workspace or its contexts.
    expect(workspace.checkoutContexts).toEqual([mainContext('ws-1')]);
  });

  it('selecting a workspace re-sanitizes without changing its contexts', () => {
    const input = workspaceInput();
    useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws-1' });
    useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws-2', workspacePath: '/other' });
    const before = useWorkspaceStore.getState().getWorkspaceById('ws-1')!.checkoutContexts;

    useWorkspaceStore.getState().selectWorkspace('ws-1');

    expect(useWorkspaceStore.getState().getWorkspaceById('ws-1')?.checkoutContexts).toEqual(before);
  });
});

describe('upserting an authoritative worktree context', () => {
  const worktree = (workspaceId: string, overrides: Partial<CheckoutContext> = {}): CheckoutContext => ({
    id: `${workspaceId}::ckt-1`, workspaceId, environmentId: 'local', path: '/work/app-worktrees/task',
    kind: 'worktree', branch: 'task', mainCheckoutPath: '/work/app', ...overrides,
  });

  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null, terminals: [], panes: [] });
    const input = workspaceInput({ workspacePath: '/work/app' });
    useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws-1' });
    useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws-2', workspacePath: '/elsewhere' });
  });

  const contextsOf = (id: string) => useWorkspaceStore.getState().getWorkspaceById(id)!.checkoutContexts!;

  it('adds the context to its owning workspace only, keeping the main context and the workspace root', () => {
    expect(useWorkspaceStore.getState().upsertCheckoutContext('ws-1', worktree('ws-1'))).toBe(true);

    expect(contextsOf('ws-1').map((context) => context.id)).toEqual([mainCheckoutContextId('ws-1'), 'ws-1::ckt-1']);
    expect(contextsOf('ws-2')).toEqual([mainContext('ws-2', '/elsewhere')]);
    expect(useWorkspaceStore.getState().getWorkspaceById('ws-1')?.workspacePath).toBe('/work/app');
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
  });

  it('is idempotent: applying the same authoritative context twice neither duplicates nor re-renders it', () => {
    useWorkspaceStore.getState().upsertCheckoutContext('ws-1', worktree('ws-1'));
    const first = contextsOf('ws-1');

    expect(useWorkspaceStore.getState().upsertCheckoutContext('ws-1', worktree('ws-1'))).toBe(true);

    expect(contextsOf('ws-1')).toHaveLength(2);
    expect(contextsOf('ws-1')).toBe(first);
  });

  it('updates descriptive fields (branch) of an existing context', () => {
    useWorkspaceStore.getState().upsertCheckoutContext('ws-1', worktree('ws-1'));
    useWorkspaceStore.getState().upsertCheckoutContext('ws-1', worktree('ws-1', { branch: 'renamed' }));
    expect(contextsOf('ws-1').find((context) => context.id === 'ws-1::ckt-1')?.branch).toBe('renamed');
    expect(contextsOf('ws-1')).toHaveLength(2);
  });

  it.each([
    ['another workspace\'s context', () => worktree('ws-2')],
    ['a context whose workspaceId names another workspace though its id is scoped here', () => worktree('ws-1', { workspaceId: 'ws-2' })],
    ['an unknown workspace id in the call', () => worktree('ws-1')],
    ['a context for a different environment', () => worktree('ws-1', { environmentId: 'vps' })],
    ['a second main context', () => worktree('ws-1', { id: mainCheckoutContextId('ws-1'), kind: 'main' })],
    ['a main-kind context under a fresh id', () => worktree('ws-1', { kind: 'main' })],
    ['an id that is not scoped to the workspace', () => worktree('ws-1', { id: 'ws-2::ckt-1' })],
    ['a relative path', () => worktree('ws-1', { path: 'relative/wt' })],
    ['a second id for the workspace root', () => worktree('ws-1', { path: '/work/app' })],
  ])('rejects %s and changes nothing', (label, build) => {
    const target = label === 'an unknown workspace id in the call' ? 'ghost' : 'ws-1';
    expect(useWorkspaceStore.getState().upsertCheckoutContext(target, build())).toBe(false);
    expect(contextsOf('ws-1')).toEqual([mainContext('ws-1', '/work/app')]);
    expect(contextsOf('ws-2')).toEqual([mainContext('ws-2', '/elsewhere')]);
  });

  it('never lets a context id be re-pointed at a different root', () => {
    useWorkspaceStore.getState().upsertCheckoutContext('ws-1', worktree('ws-1'));
    expect(useWorkspaceStore.getState().upsertCheckoutContext('ws-1', worktree('ws-1', { path: '/work/other-root' }))).toBe(false);
    expect(contextsOf('ws-1').find((context) => context.id === 'ws-1::ckt-1')?.path).toBe('/work/app-worktrees/task');
  });

  it('the pure helper reports rejection as null and does not mutate its input', () => {
    const workspace = createWorkspaceFixture({ id: 'ws-1', workspacePath: '/work/app', checkoutContexts: [mainContext('ws-1', '/work/app')] });
    expect(upsertCheckoutContextList(workspace, worktree('ws-2'))).toBeNull();
    expect(upsertCheckoutContextList(workspace, worktree('ws-1'))).toHaveLength(2);
    expect(workspace.checkoutContexts).toHaveLength(1);
  });
});
