import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { formatCheckoutRemovalFailure, removeWorktreeCheckout } from '../../../src/renderer/lib/worktreeCheckoutRemoval';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';

const ROOT = '/projects/clanker';
const wtContext = (workspaceId: string, suffix: string, environmentId = 'local'): CheckoutContext => ({
  id: `${workspaceId}::ckt-${suffix}`, workspaceId, environmentId,
  path: `/projects/clanker-worktrees/${suffix}`, kind: 'worktree', branch: suffix, mainCheckoutPath: ROOT,
});
const listing = (path: string, branch: string | null) => ({ path, branch, isMain: false, isLocked: false, isPrunable: false });

describe('removeWorktreeCheckout', () => {
  let order: string[];
  let api: Record<string, ReturnType<typeof vi.fn>>;
  const contextIds = (workspaceId = 'ws') => useWorkspaceStore.getState().getWorkspaceById(workspaceId)!.checkoutContexts!.map((context) => context.id);
  const workspaceOf = (id = 'ws') => useWorkspaceStore.getState().getWorkspaceById(id)!;

  function open(environmentId = 'local') {
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null, terminals: [], panes: [] });
    const { id: _id, lifecycle: _lifecycle, ...input } = createWorkspaceFixture({
      workspacePath: ROOT, environmentId, terminals: [], panes: [], activeTerminalId: null,
    });
    void _id; void _lifecycle;
    useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws' });
    useWorkspaceStore.getState().addWorkspace({ ...input, id: 'peer', workspacePath: '/projects/other', environmentId: 'local' });
    for (const suffix of ['task', 'other']) useWorkspaceStore.getState().upsertCheckoutContext('ws', wtContext('ws', suffix, environmentId));
    return workspaceOf();
  }

  beforeEach(() => {
    order = [];
    api = {
      releaseCheckoutContext: vi.fn(async () => { order.push('release'); return { success: true }; }),
      gitInspectWorktree: vi.fn(async (_repo: string, path: string) => {
        order.push('inspect');
        return { success: true, hasChanges: false, worktree: listing(path, 'task') };
      }),
      gitRemoveWorktree: vi.fn(async () => { order.push('remove'); return { success: true }; }),
    };
    installElectronApiMock(api);
  });

  it('releases, then inspects, then removes, using the inspected branch, and reports success', async () => {
    const workspace = open();
    const context = wtContext('ws', 'task');

    const result = await removeWorktreeCheckout(workspace, context);

    expect(result).toEqual({ success: true, warning: undefined, recoveryPath: undefined });
    expect(order).toEqual(['release', 'inspect', 'remove']);
    expect(api.releaseCheckoutContext).toHaveBeenCalledWith('ws', context.id);
    expect(api.gitInspectWorktree).toHaveBeenCalledWith(ROOT, context.path, [ROOT, '/projects/other'], 'ws');
    expect(api.gitRemoveWorktree).toHaveBeenCalledWith(ROOT, context.path, 'task', [ROOT, '/projects/other'], 'ws');
  });

  it.each(['environmentId', 'workspacePath'])('does not dispatch inspection into a replacement %s after release', async (field) => {
    const workspace = open(); let finish!: (value: unknown) => void;
    api.releaseCheckoutContext.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = removeWorktreeCheckout(workspace, wtContext('ws', 'task'));
    useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.map((entry) => entry.id === 'ws' ? { ...entry, [field]: field === 'environmentId' ? 'ssh-other' : '/other-repo' } : entry) }));
    finish({ success: true }); const result = await pending;
    expect(result.success).toBe(false); expect(api.gitInspectWorktree).not.toHaveBeenCalled(); expect(api.gitRemoveWorktree).not.toHaveBeenCalled(); expect(contextIds()).toContain('ws::ckt-task');
  });
  it('does not remove after inspection if the workspace root changed during the request', async () => {
    const workspace = open(); let finish!: (value: unknown) => void;
    api.gitInspectWorktree.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = removeWorktreeCheckout(workspace, wtContext('ws', 'task')); await vi.waitFor(() => expect(api.gitInspectWorktree).toHaveBeenCalled());
    useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.map((entry) => entry.id === 'ws' ? { ...entry, workspacePath: '/other-repo' } : entry) }));
    finish({ success: true, hasChanges: false, worktree: listing(wtContext('ws', 'task').path, 'task') }); expect((await pending).success).toBe(false); expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
  });
  it('forgets the context only after main confirms the release', async () => {
    const workspace = open();
    let confirm!: () => void;
    api.releaseCheckoutContext.mockImplementationOnce(() => new Promise((done) => { confirm = () => done({ success: true }); }));

    const pending = removeWorktreeCheckout(workspace, wtContext('ws', 'task'));
    await vi.waitFor(() => expect(api.releaseCheckoutContext).toHaveBeenCalled());
    expect(contextIds()).toContain('ws::ckt-task');
    expect(api.gitInspectWorktree).not.toHaveBeenCalled();

    confirm();
    await pending;
    expect(contextIds()).not.toContain('ws::ckt-task');
  });

  it('keeps the workspace root, its main and other contexts, and other workspaces when it succeeds', async () => {
    const workspace = open();
    await removeWorktreeCheckout(workspace, wtContext('ws', 'task'));

    expect(contextIds()).toEqual([mainCheckoutContextId('ws'), 'ws::ckt-other']);
    expect(workspaceOf().workspacePath).toBe(ROOT);
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
  });

  describe('when main refuses the release', () => {
    it.each([
      ['a refusal', () => api.releaseCheckoutContext.mockResolvedValueOnce({ success: false, error: '1 running terminal is still using this checkout; close it first', activeTerminals: 1 })],
      ['a thrown error', () => api.releaseCheckoutContext.mockRejectedValueOnce(new Error('ipc failed'))],
    ])('leaves renderer state unchanged and never inspects or removes (%s)', async (_label, fail) => {
      const workspace = open();
      const before = workspaceOf().checkoutContexts;
      fail();

      const result = await removeWorktreeCheckout(workspace, wtContext('ws', 'task'));

      expect(result).toMatchObject({ success: false, stage: 'release', released: false });
      expect(workspaceOf().checkoutContexts).toEqual(before);
      expect(api.gitInspectWorktree).not.toHaveBeenCalled();
      expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
    });

    it('surfaces main\'s reason', async () => {
      const workspace = open();
      api.releaseCheckoutContext.mockResolvedValueOnce({ success: false, error: 'close it first' });
      expect(await removeWorktreeCheckout(workspace, wtContext('ws', 'task'))).toMatchObject({ error: 'close it first' });
    });
  });

  describe('when it is not a removable worktree checkout of this workspace', () => {
    it.each([
      ['the main context', () => workspaceOf().checkoutContexts![0]],
      ['another workspace\'s context', () => wtContext('peer', 'task')],
      ['a context the workspace does not have', () => wtContext('ws', 'never-registered')],
      ['a context with a different path than the one recorded', () => ({ ...wtContext('ws', 'task'), path: '/projects/somewhere/else' })],
      ['a context from another environment', () => wtContext('ws', 'task', 'vps')],
    ])('refuses %s without calling main', async (_label, context) => {
      const workspace = open();
      const before = workspaceOf().checkoutContexts;

      expect(await removeWorktreeCheckout(workspace, context())).toMatchObject({ success: false, stage: 'validate', released: false });

      expect(api.releaseCheckoutContext).not.toHaveBeenCalled();
      expect(workspaceOf().checkoutContexts).toEqual(before);
    });
  });

  describe('after the release has succeeded', () => {
    it('stops at a dirty checkout, keeps the context released, and never removes', async () => {
      const workspace = open();
      api.gitInspectWorktree.mockResolvedValueOnce({ success: true, hasChanges: true, worktree: listing('/x', 'task') });

      const result = await removeWorktreeCheckout(workspace, wtContext('ws', 'task'));

      expect(result).toMatchObject({ success: false, stage: 'inspect', released: true, error: expect.stringContaining('uncommitted') });
      expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
      expect(contextIds()).toEqual([mainCheckoutContextId('ws'), 'ws::ckt-other']);
    });

    it('surfaces an inspection failure and does not remove', async () => {
      const workspace = open();
      api.gitInspectWorktree.mockResolvedValueOnce({ success: false, error: 'Close this workspace tab before removing its worktree' });
      expect(await removeWorktreeCheckout(workspace, wtContext('ws', 'task')))
        .toMatchObject({ success: false, stage: 'inspect', released: true, error: 'Close this workspace tab before removing its worktree' });
      expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
    });

    it('surfaces the existing removal error unchanged and does not re-register the context', async () => {
      const workspace = open();
      api.gitRemoveWorktree.mockResolvedValueOnce({ success: false, error: 'Worktree branch changed; inspect it again' });

      const result = await removeWorktreeCheckout(workspace, wtContext('ws', 'task'));

      expect(result).toEqual({ success: false, stage: 'remove', released: true, error: 'Worktree branch changed; inspect it again' });
      expect(contextIds()).not.toContain('ws::ckt-task');
      expect(api.releaseCheckoutContext).toHaveBeenCalledTimes(1);
    });

    it('reports a thrown inspection or removal as that stage, still released', async () => {
      const workspace = open();
      api.gitInspectWorktree.mockRejectedValueOnce(new Error('git unavailable'));
      expect(await removeWorktreeCheckout(workspace, wtContext('ws', 'task'))).toMatchObject({ stage: 'inspect', released: true, error: 'git unavailable' });

      open();
      api.gitRemoveWorktree.mockRejectedValueOnce(new Error('connection lost'));
      expect(await removeWorktreeCheckout(workspaceOf(), wtContext('ws', 'task'))).toMatchObject({ stage: 'remove', released: true, error: 'connection lost' });
    });

    it('passes through the removal warning and recovery path (SSH keeps files in a recovery folder)', async () => {
      const workspace = open('vps');
      api.gitRemoveWorktree.mockResolvedValueOnce({ success: true, warning: 'kept', recoveryPath: '/recovery/task' });

      expect(await removeWorktreeCheckout(workspace, wtContext('ws', 'task', 'vps')))
        .toEqual({ success: true, warning: 'kept', recoveryPath: '/recovery/task' });
    });
  });

  it('for SSH sends no desktop paths and always names the workspace so main applies host protections', async () => {
    const workspace = open('vps');
    await removeWorktreeCheckout(workspace, wtContext('ws', 'task', 'vps'));

    expect(api.gitInspectWorktree).toHaveBeenCalledWith(ROOT, '/projects/clanker-worktrees/task', [], 'ws');
    expect(api.gitRemoveWorktree).toHaveBeenCalledWith(ROOT, '/projects/clanker-worktrees/task', 'task', [], 'ws');
  });
});

describe('formatCheckoutRemovalFailure', () => {
  const base = { branch: 'feature/foo', path: '/projects/clanker-worktrees/foo' };

  it('after a release says the checkout is on disk and no longer attached, without claiming where else it is listed', () => {
    const message = formatCheckoutRemovalFailure({ ...base, error: 'Worktree has uncommitted files', released: true });

    expect(message).toBe(
      'Could not remove the checkout for branch "feature/foo": Worktree has uncommitted files. '
      + 'It was left on disk at /projects/clanker-worktrees/foo and is no longer attached to this workspace. The branch was not deleted.',
    );
    expect(message).not.toContain('listed');
  });

  it('without a release claims nothing was detached', () => {
    const message = formatCheckoutRemovalFailure({ ...base, error: 'Worktree branch changed; inspect it again', released: false });

    expect(message).toBe(
      'Could not remove the checkout for branch "feature/foo": Worktree branch changed; inspect it again. '
      + 'It was left on disk. The branch was not deleted.',
    );
    expect(message).not.toContain('attached');
  });

  it('does not double the punctuation of an error that is already a sentence', () => {
    expect(formatCheckoutRemovalFailure({ ...base, error: 'Save or remove them first.', released: false }))
      .toContain('Save or remove them first. It was left on disk.');
  });
});
