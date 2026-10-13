import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import GitButton from '../../../src/renderer/components/GitButton';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { checkoutGitAvailability, useCheckoutGitStore } from '../../../src/renderer/store/checkoutGitStore';
import type { GitStatusResult } from '../../../src/shared/types/git';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

let api: ReturnType<typeof installElectronApiMock>;
let listeners: Set<(status: GitStatusResult) => void>;
function HeaderGit() {
  const workspace = useWorkspaceStore(state => state.workspaces.find(ws => ws.id === state.activeWorkspaceId));
  return workspace ? <GitButton key={workspace.id} workspaceId={workspace.id} workspacePath={workspace.workspacePath} /> : null;
}
const button = () => screen.getByRole('button', { name: 'Source Control', hidden: true });
function switchTo(id: string) { act(() => useWorkspaceStore.getState().selectWorkspace(id)); }
function emit(count = 3, branch = 'main', overrides: Partial<GitStatusResult> = {}) {
  const current = useCheckoutGitStore.getState().active!;
  const result: GitStatusResult = { success: true, isRepo: true, workspaceId: current.identity.workspaceId, environmentId: current.identity.environmentId,
    checkoutContextId: current.identity.contextId, workspacePath: current.identity.root, presentationGeneration: current.generation,
    currentBranch: branch, isDetached: false, upstream: null, ahead: 0, behind: 0,
    changes: Array.from({ length: count }, (_, index) => ({ path: `file-${index}`, status: 'modified', staged: false })), ...overrides };
  act(() => listeners.forEach(listener => listener(result)));
  return result;
}
beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useCheckoutGitStore.setState(useCheckoutGitStore.getInitialState(), true);
  listeners = new Set(); api = installElectronApiMock();
  api.onGitStatusUpdate.mockImplementation(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; });
  for (const id of ['A', 'B']) useWorkspaceStore.getState().addWorkspace(createWorkspaceFixture({ id, workspacePath: `/${id}`, terminals: [], panes: [], activeTerminalId: null }));
  useWorkspaceStore.getState().selectWorkspace('A');
});
afterEach(cleanup);

describe('last-known toolbar is descriptive, never actionable', () => {
  it('renders A→B→A stale branch/count immediately with a new generation and disabled initialization; fresh data replaces it', async () => {
    render(<HeaderGit />); emit(3, 'old-a'); const old = useCheckoutGitStore.getState().active!;
    switchTo('B'); emit(1, 'b'); switchTo('A');
    expect(button()).toHaveTextContent('old-a · 3 changes · Last known');
    expect(button()).toHaveAccessibleDescription('old-a · 3 changes · Last known (not current). Refreshing Git…');
    expect(document.querySelector('.git-badge')).toBeNull();
    expect(useCheckoutGitStore.getState().active).toMatchObject({ state: 'loading', result: null });
    expect(useCheckoutGitStore.getState().active!.generation).toBeGreaterThan(old.generation);
    const calls = api.gitStartPolling.mock.calls.length;
    fireEvent.click(button());
    expect(screen.getByRole('button', { name: 'Initialize Repository' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Initial Branch' })).toBeDisabled();
    for (const action of ['Stage All', 'Commit Staged', 'Stage All & Commit', 'Branches', 'Merge']) expect(screen.queryByRole('button', { name: action })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Initialize Repository' }));
    expect(api.gitInit).not.toHaveBeenCalled(); expect(api.gitStage).not.toHaveBeenCalled(); expect(api.gitCommit).not.toHaveBeenCalled();
    expect(api.gitStartPolling).toHaveBeenCalledTimes(calls); expect(api.gitRefresh).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    emit(1, 'new-a'); expect(button()).toHaveAttribute('title', 'Git - new-a');
    expect(button()).not.toHaveTextContent('Last known'); expect(document.querySelector('.git-badge')).toHaveTextContent('1');
    expect(checkoutGitAvailability(useCheckoutGitStore.getState().active)).toBe('ready');
    expect(api.gitStartPolling).toHaveBeenCalledTimes(3);
    expect(api.gitStopPolling).toHaveBeenCalledWith('A', undefined, old.generation);
  });

  it.each([[0, 2], [2, 0]])('labels previously %i dirty files stale until the new %i count arrives', (oldCount, nextCount) => {
    render(<HeaderGit />); emit(oldCount); switchTo('B'); emit(); switchTo('A');
    expect(button()).toHaveTextContent(`${oldCount} changes · Last known`); expect(document.querySelector('.git-badge')).toBeNull();
    emit(nextCount, 'changed-branch'); expect(button()).not.toHaveTextContent('Last known');
    expect(document.querySelector('.git-badge')?.textContent ?? '0').toBe(String(nextCount));
  });

  it('labels detached HEAD and upstream history as descriptive, not actionable', () => {
    render(<HeaderGit />); emit(1, 'abc123', { isDetached: true, upstream: 'origin/task', ahead: 2, behind: 1 });
    switchTo('B'); emit(); switchTo('A');
    expect(button()).toHaveTextContent('Detached HEAD · abc123 · 1 change · Last known');
    expect(button().title).toContain('origin/task (2 ahead, 1 behind)');
    expect(checkoutGitAvailability(useCheckoutGitStore.getState().active)).toBe('loading');
    expect(document.querySelector('.git-badge')).toBeNull();
  });

  it('preserves stale description on failed reacquisition and reports unavailable, not clean or ready', () => {
    render(<HeaderGit />); emit(0); switchTo('B'); emit(); switchTo('A');
    emit(0, 'wrong', { success: false, error: 'SSH disconnected', errorCode: 'unknown' });
    expect(button()).toHaveTextContent('main · 0 changes · Last known · Git unavailable');
    expect(button().title).toContain('SSH disconnected'); expect(checkoutGitAvailability(useCheckoutGitStore.getState().active)).toBe('unavailable');
    fireEvent.click(button()); expect(screen.getByRole('button', { name: 'Initialize Repository' })).toBeDisabled();
    expect(document.querySelector('.git-badge')).toBeNull();
  });

  it('does not initialize from cached confirmed non-repository until current polling verifies it again', () => {
    render(<HeaderGit />); emit(0, '', { isRepo: false, currentBranch: null }); switchTo('B'); emit(); switchTo('A');
    expect(button()).toHaveTextContent('Not a repository · Last known');
    fireEvent.click(button()); expect(screen.getByRole('button', { name: 'Initialize Repository' })).toBeDisabled();
    emit(0, '', { isRepo: false, currentBranch: null }); expect(screen.getByRole('button', { name: 'Initialize Repository' })).toBeEnabled();
    expect(button()).not.toHaveTextContent('Last known');
  });

  it('dismisses the Source Control dialog on selection, and rejects batched A→B→A old replies', async () => {
    render(<HeaderGit />); const old = emit();
    fireEvent.click(button()); await screen.findByRole('dialog', { name: 'Source Control' });
    const generation = old.presentationGeneration!;
    act(() => { useWorkspaceStore.getState().selectWorkspace('B'); useWorkspaceStore.getState().selectWorkspace('A'); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveTextContent('Last known');
    act(() => listeners.forEach(listener => listener({ ...old, currentBranch: 'obsolete', changes: [] })));
    expect(button()).not.toHaveTextContent('obsolete'); expect(useCheckoutGitStore.getState().active?.state).toBe('loading');
    expect(useCheckoutGitStore.getState().active!.generation).toBeGreaterThan(generation);
    expect(api.gitRefresh).not.toHaveBeenCalled();
  });

  it('checkout-unavailable takes precedence, prunes its history and requests no poll for a missing root', () => {
    const store = useWorkspaceStore.getState();
    store.upsertCheckoutContext('A', { id: 'A::task', workspaceId: 'A', environmentId: 'local', kind: 'worktree', path: '/isolated' });
    useWorkspaceStore.setState(state => ({ workspaces: state.workspaces.map(ws => ws.id === 'A' ? { ...ws, fileSurfaceContextId: 'A::task' } : ws) }));
    render(<HeaderGit />); emit();
    const starts = api.gitStartPolling.mock.calls.length;
    act(() => useWorkspaceStore.getState().upsertCheckoutContext('A', { id: 'A::task', workspaceId: 'A', environmentId: 'local', kind: 'worktree', path: '/isolated', missing: true }));
    expect(button()).toHaveTextContent('Checkout unavailable'); expect(button()).not.toHaveTextContent('Last known');
    expect(useCheckoutGitStore.getState().cache).toEqual([]); expect(api.gitStartPolling).toHaveBeenCalledTimes(starts);
    expect(api.gitStopPolling).toHaveBeenCalledTimes(1);
  });
});
