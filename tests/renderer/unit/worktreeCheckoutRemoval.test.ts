import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { formatCheckoutRemovalFailure, removeWorktreeCheckout } from '../../../src/renderer/lib/worktreeCheckoutRemoval';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';

const ROOT = '/projects/clanker';
const checkout = { id: 'ws::task', workspaceId: 'ws', environmentId: 'local', path: '/projects/task', kind: 'worktree' as const, branch: 'task' };
const workspace = () => useWorkspaceStore.getState().getWorkspaceById('ws')!;
let api: ReturnType<typeof installElectronApiMock>;
beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
  useWorkspaceStore.getState().addWorkspace(createWorkspaceFixture({ id: 'ws', workspacePath: ROOT, terminals: [], panes: [] }));
  useWorkspaceStore.getState().upsertCheckoutContext('ws', checkout);
  api = installElectronApiMock();
});
describe('one renderer removal request', () => {
  it.each([true, false])('retains the association on preflight failure (attached: %s)', async (attached) => {
    if (!attached) useWorkspaceStore.getState().removeCheckoutContext('ws', checkout.id);
    api.gitRemoveCheckout.mockResolvedValue({ success: false, outcome: 'unchanged', error: 'Checkout has ignored files' });
    const before = workspace().checkoutContexts;
    expect(await removeWorktreeCheckout(workspace(), checkout)).toMatchObject({ success: false, outcome: 'unchanged' });
    expect(api.gitRemoveCheckout).toHaveBeenCalledExactlyOnceWith('ws', checkout.path, 'task');
    expect(workspace().checkoutContexts).toBe(before);
    expect(api.releaseCheckoutContext).not.toHaveBeenCalled();
    expect(api.gitInspectWorktree).not.toHaveBeenCalled();
    expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
  });
  it('applies only the confirmed reconciliation and preserves dirty editor buffers', async () => {
    const buffer = { id: 'dirty', filePath: checkout.path + '/same.ts', fileName: 'same.ts', content: 'unsaved', originalContent: '', isDirty: true, checkoutContextId: checkout.id, checkoutRoot: checkout.path };
    useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.map((entry) => ({ ...entry, editorTabs: [buffer] })) }));
    api.gitRemoveCheckout.mockResolvedValue({ success: true, reconciliation: { success: true, contexts: [], dropped: [checkout.id] } });
    await removeWorktreeCheckout(workspace(), checkout);
    expect(workspace().checkoutContexts?.map((entry) => entry.id)).toEqual([mainCheckoutContextId('ws')]);
    expect(workspace().editorTabs[0]).toEqual(buffer);
    expect(api.gitDeleteBranch).not.toHaveBeenCalled();
  });
  it('does not apply late reconciliation to a replacement workspace', async () => {
    let finish!: (result: unknown) => void;
    api.gitRemoveCheckout.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = removeWorktreeCheckout(workspace(), checkout);
    useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.map((entry) => ({ ...entry, workspacePath: '/projects/other' })) }));
    finish({ success: true, reconciliation: { success: true, contexts: [], dropped: [checkout.id] } });
    await pending;
    expect(workspace().checkoutContexts?.some((entry) => entry.id === checkout.id)).toBe(true);
  });
  it('rejects main and closed-workspace requests before dispatch', async () => {
    expect((await removeWorktreeCheckout(workspace(), { path: ROOT, isMain: true })).success).toBe(false);
    expect((await removeWorktreeCheckout({ ...workspace(), id: 'closed' }, checkout)).success).toBe(false);
    expect(api.gitRemoveCheckout).not.toHaveBeenCalled();
  });
  it('reports an unknown transport outcome without releasing anything', async () => {
    api.gitRemoveCheckout.mockRejectedValue(new Error('Disconnected'));
    expect(await removeWorktreeCheckout(workspace(), checkout)).toMatchObject({ success: false, outcome: 'unknown' });
    expect(workspace().checkoutContexts?.some((entry) => entry.id === checkout.id)).toBe(true);
  });
  it('never manufactures disk existence from an error', () => {
    const message = formatCheckoutRemovalFailure({ branch: 'task', path: checkout.path, error: 'Checkout is in Trash; Git cleanup failed' });
    expect(message).toContain('Checkout is in Trash');
    expect(message).not.toMatch(/left on disk|no longer attached/);
    expect(message).toContain('branch was not deleted');
  });
});
