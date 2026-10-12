// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GitButton from '../../../src/renderer/components/GitButton';
import NewSessionButton from '../../../src/renderer/components/NewSessionButton';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useCheckoutGitStore } from '../../../src/renderer/store/checkoutGitStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { GitStatusResult } from '../../../src/shared/types/git';

let api: ReturnType<typeof installElectronApiMock>;
let listeners: Array<(status: GitStatusResult) => void>;
function openWorkspace(environmentId: string, id = 'ws') {
  const { id: _id, lifecycle: _l, ...input } = createWorkspaceFixture({
    workspacePath: '/project', environmentId, gitIsRepo: false, terminals: [], panes: [], activeTerminalId: null,
  });
  void _id; void _l;
  useWorkspaceStore.getState().addWorkspace({ ...input, id });
}
function Controls() {
  const workspace = useWorkspaceStore(state => state.getActiveWorkspace())!;
  return <><GitButton workspacePath={workspace.workspacePath} workspaceId={workspace.id} /><NewSessionButton workspace={workspace} visibleHarnessIds={[]} /></>;
}
const status = (environmentId: string, overrides: Partial<GitStatusResult> = {}): GitStatusResult => ({
  success: true, isRepo: false, currentBranch: null, isDetached: false, changes: [], upstream: null, ahead: 0, behind: 0,
  workspaceId: 'ws', environmentId, workspacePath: '/project', ...overrides,
});
const emit = async (payload: GitStatusResult) => act(async () => { listeners[listeners.length - 1]!(payload); });
const overview = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Source Control' }));
  const button = await screen.findByRole('button', { name: 'Overview' });
  fireEvent.click(button);
};
beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null, terminals: [], panes: [], activeTerminalId: null, gitIsRepo: false, gitCurrentBranch: null });
  useCheckoutGitStore.setState({ active: null });
  listeners = [];
  api = installElectronApiMock({
    onGitStatusUpdate: vi.fn(listener => { listeners.push(listener); return vi.fn(); }),
    gitStartPolling: vi.fn().mockResolvedValue(undefined), gitStopPolling: vi.fn().mockResolvedValue(undefined),
    gitInit: vi.fn().mockResolvedValue({ success: true }), gitRefresh: vi.fn().mockResolvedValue(undefined),
    gitGetBranchState: vi.fn().mockResolvedValue({ success: true, isRepo: true, currentBranch: 'main', isDetached: false, branches: [] }),
    gitListWorktrees: vi.fn().mockResolvedValue({ success: true, worktrees: [] }),
  });
});
afterEach(() => cleanup());

for (const environmentId of ['local', 'ssh-fixture']) describe(`${environmentId} init UI`, () => {
  it('enables only confirmed absence, retries init failures and immediately enables worktree choices after success', async () => {
    openWorkspace(environmentId); render(<Controls />);
    await overview();
    expect(screen.getByRole('button', { name: 'Initialize Repository' })).toBeDisabled();
    for (const errorCode of ['git-not-found', 'unknown', 'not-a-repo'] as const) {
      await emit(status(environmentId, { success: false, errorCode, error: 'Unavailable' }));
      expect(screen.getByRole('button', { name: 'Initialize Repository' })).toBeDisabled();
    }
    await emit(status(environmentId));
    expect(screen.getByText('No git repository found')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Initial Branch' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Initialize Repository' })).toBeEnabled();
    api.gitInit.mockResolvedValueOnce({ success: false, error: 'Read-only filesystem' });
    fireEvent.click(screen.getByRole('button', { name: 'Initialize Repository' }));
    expect(await screen.findByText('Read-only filesystem')).toBeInTheDocument();
    expect(api.gitRefresh).not.toHaveBeenCalled();
    api.gitRefresh.mockImplementation(async () => { await emit(status(environmentId, { isRepo: true, currentBranch: 'main' })); });
    fireEvent.click(screen.getByRole('button', { name: 'Initialize Repository' }));
    await waitFor(() => expect(useWorkspaceStore.getState().getWorkspaceById('ws')?.gitIsRepo).toBe(true));
    expect(api.gitInit).toHaveBeenLastCalledWith('/project', 'main', 'ws');
    expect(api.gitRefresh).toHaveBeenCalledWith('ws');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Source Control' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'New Agent' }));
    expect(await screen.findByLabelText('New branch', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Terminal' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New Session' })).toBeNull();
  });

  it('rejects foreign identities, stale poll epochs and failed status after a known empty directory', async () => {
    openWorkspace(environmentId); render(<Controls />); await overview();
    for (const mismatch of [{ workspaceId: 'foreign' }, { environmentId: 'foreign' }, { workspacePath: '/foreign' }, { checkoutContextId: 'foreign::main' }, { presentationGeneration: -1 }]) {
      await emit(status(environmentId, mismatch));
      expect(screen.getByRole('button', { name: 'Initialize Repository' })).toBeDisabled();
    }
    await emit(status(environmentId));
    expect(screen.getByRole('button', { name: 'Initialize Repository' })).toBeEnabled();
    await emit(status(environmentId, { success: false, error: 'Disconnected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Initialize Repository' }));
    expect(api.gitInit).not.toHaveBeenCalled();
    await emit(status(environmentId));
    expect(screen.getByRole('button', { name: 'Initialize Repository' })).toBeEnabled();
  });

  it('ignores an initialization completion after switching workspaces', async () => {
    openWorkspace(environmentId); render(<Controls />); await overview(); await emit(status(environmentId));
    let resolve!: (result: { success: boolean }) => void;
    api.gitInit.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: 'Initialize Repository' }));
    await act(async () => { openWorkspace(environmentId, 'other'); });
    await overview(); await emit(status(environmentId, { workspaceId: 'other' }));
    await act(async () => { resolve({ success: true }); });
    expect(api.gitRefresh).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().getWorkspaceById('other')?.gitIsRepo).toBe(false);
    expect(screen.getByRole('button', { name: 'Initialize Repository' })).toBeEnabled();
  });
});
