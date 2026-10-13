import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GitButton from '../../../src/renderer/components/GitButton';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useCheckoutGitStore } from '../../../src/renderer/store/checkoutGitStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { GitBranchStateResult, GitDiffResult, GitHistoryEntry, GitStatusResult } from '../../../src/shared/types/git';

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
let api: ReturnType<typeof installElectronApiMock>;
let listeners: Set<(value: GitStatusResult) => void>;
function Header() { const ws = useWorkspaceStore(s => s.workspaces.find(w => w.id === s.activeWorkspaceId)); return ws ? <GitButton workspaceId={ws.id} workspacePath={ws.workspacePath} /> : null; }
function status(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  const active = useCheckoutGitStore.getState().active!;
  return { success: true, isRepo: true, currentBranch: 'main', isDetached: false, upstream: null, ahead: 0, behind: 0,
    workspaceId: active.identity.workspaceId, environmentId: active.identity.environmentId, checkoutContextId: active.identity.contextId,
    workspacePath: active.identity.root, presentationGeneration: active.generation, acquisitionSequence: 1,
    changes: [{ path: 'one.txt', status: 'modified', staged: false }], ...overrides };
}
function emit(value = status()) { act(() => listeners.forEach(fn => fn(value))); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const branch = (name: string): GitBranchStateResult => ({ success: true, isRepo: true, currentBranch: 'main', isDetached: false, branches: [{ name, isCurrent: false }] });
const commit = (hash: string): GitHistoryEntry => ({ hash, shortHash: hash.slice(0, 7), subject: `commit-${hash}`, author: 'Fixture', date: '2026-01-01' });
const dialog = () => within(screen.getByRole('dialog', { name: 'Source Control' }));
async function click(name: string) { await act(async () => { fireEvent.click(dialog().getByRole('button', { name })); }); }
async function open() { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Source Control' })); }); }
function switchTo(id: string) { act(() => useWorkspaceStore.getState().selectWorkspace(id)); }
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useCheckoutGitStore.setState(useCheckoutGitStore.getInitialState(), true);
  api = installElectronApiMock(); listeners = new Set();
  api.onGitStatusUpdate.mockImplementation(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; });
  api.gitGetBranchState.mockResolvedValue(branch('feature'));
  api.gitGetHistory.mockResolvedValue([commit('abc1234')]);
  api.gitGetStashes.mockResolvedValue([{ ref: 'stash@{0}', hash: 'a'.repeat(40), message: 'saved-fixture' }]);
  api.gitGetOperationState.mockResolvedValue({ success: true, isRepo: true, mode: 'none', inProgress: false, conflicts: [], message: '' });
  api.gitGetRemotes.mockResolvedValue({ success: true, provider: 'unknown', remotes: [{ name: 'origin', fetchUrl: 'https://example.invalid/r', pushUrl: '' }] });
  api.vcsGetContext.mockResolvedValue({ success: true, provider: { provider: 'github', owner: 'owner', repo: 'repo', baseUrl: 'https://github.com', defaultBranch: 'main' }, pullRequest: { exists: false, outcome: 'none' }, deepLinks: [] });
  for (const [id, environmentId] of [['A', 'local'], ['B', 'ssh-fixture']]) useWorkspaceStore.getState().addWorkspace(createWorkspaceFixture({ id, environmentId, workspacePath: '/same', terminals: [], panes: [], activeTerminalId: null }));
  useWorkspaceStore.getState().selectWorkspace('A'); render(<Header />); emit();
});
afterEach(() => {
  cleanup();
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

describe('Source Control independent resources', () => {
  it('opens Changes without metadata reads, loads demanded sections once, and selectively forces refresh', async () => {
    await open(); expect(dialog().getByRole('button', { name: 'Stage one.txt' })).toBeEnabled();
    for (const read of [api.gitGetHistory, api.gitGetStashes, api.gitGetBranchState, api.gitGetOperationState, api.gitGetRemotes, api.vcsGetContext]) expect(read).not.toHaveBeenCalled();
    await click('History'); expect(dialog().getByText('commit-abc1234')).toBeVisible();
    await click('Changes'); await click('History'); expect(api.gitGetHistory).toHaveBeenCalledTimes(1);
    await click('Refresh history'); expect(api.gitGetHistory).toHaveBeenCalledTimes(2);
    expect(api.gitGetBranchState).not.toHaveBeenCalled(); expect(api.gitGetStashes).not.toHaveBeenCalled(); expect(api.gitRefresh).not.toHaveBeenCalled();
    await click('Merge'); expect(dialog().getByRole('button', { name: 'Merge feature into main' })).toBeEnabled();
    expect(api.gitGetOperationState).toHaveBeenCalledTimes(1); expect(api.gitGetBranchState).toHaveBeenCalledTimes(1);
  });
  it('fast branches settle while history is slow; fast history remains usable when stashes fail', async () => {
    const slow = deferred<GitHistoryEntry[]>(); api.gitGetHistory.mockReturnValueOnce(slow.promise);
    await open(); await click('History'); await click('Branches');
    expect(dialog().getByRole('button', { name: 'Switch to branch feature' })).toBeEnabled();
    expect(useCheckoutGitStore.getState().active?.state).toBe('ready');
    await act(async () => slow.resolve([commit('fast123')]));
    api.gitGetStashes.mockRejectedValueOnce(new Error('SSH stash read failed'));
    await click('Stashes'); expect(dialog().getByText(/SSH stash read failed/)).toBeVisible();
    await click('History'); expect(dialog().getByText('commit-fast123')).toBeVisible(); expect(api.gitGetHistory).toHaveBeenCalledTimes(1);
  });
  it('retains explicit last-known rows after refresh failure and retries only that resource', async () => {
    await open(); await click('Stashes'); expect(dialog().getByText('saved-fixture')).toBeVisible();
    api.gitGetStashes.mockRejectedValueOnce(new Error('Disconnected'));
    await click('Refresh stashes'); expect(dialog().getByText('saved-fixture')).toBeVisible();
    expect(dialog().getByText(/Last known \/ partial/)).toBeVisible(); expect(dialog().getByRole('button', { name: 'Apply stash@{0}' })).toBeDisabled();
    await click('Retry stash'); expect(dialog().getByRole('button', { name: 'Apply stash@{0}' })).toBeEnabled();
    expect(api.gitGetStashes).toHaveBeenCalledTimes(3); expect(api.gitGetHistory).not.toHaveBeenCalled();
  });
  it('isolates remotes/provider failure from branches, history and current status', async () => {
    await open(); await click('History'); await click('Branches');
    api.gitGetRemotes.mockRejectedValueOnce(new Error('Remote unavailable'));
    await click('Remotes'); expect(dialog().getByText(/Remote unavailable/)).toBeVisible();
    api.vcsGetContext.mockRejectedValueOnce(new Error('Provider unavailable'));
    await click('Branches'); await click('View on GitHub'); await click('Refresh'); // Provider's own refresh, not branch refresh.
    expect(dialog().getByText(/Provider unavailable/)).toBeVisible();
    expect(dialog().getByRole('button', { name: 'Switch to branch feature' })).toBeEnabled();
    expect(useCheckoutGitStore.getState().active?.state).toBe('ready');
    await click('History'); expect(dialog().getByText('commit-abc1234')).toBeVisible();
  });
  it('stash drop reloads only its list; commit invalidates history for its next visit, not Changes', async () => {
    await open(); await click('History'); await click('Stashes');
    await click('Drop stash@{0}');
    await act(async () => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Drop stash' })));
    expect(api.gitGetStashes).toHaveBeenCalledTimes(2); expect(api.gitGetHistory).toHaveBeenCalledTimes(1);
    expect(api.gitGetOperationState).not.toHaveBeenCalled(); expect(api.gitRefresh).not.toHaveBeenCalled();
    await click('Changes'); emit(status({ acquisitionSequence: 2, changes: [{ path: 'one.txt', status: 'modified', staged: true }] }));
    api.gitCommit.mockResolvedValueOnce({ success: true, status: status({ acquisitionSequence: 3, changes: [] }) });
    fireEvent.change(dialog().getByRole('textbox', { name: 'Commit Message' }), { target: { value: 'intent' } });
    await click('Commit Staged'); expect(api.gitGetHistory).toHaveBeenCalledTimes(1);
    await click('History'); expect(api.gitGetHistory).toHaveBeenCalledTimes(2);
    expect(api.gitGetStashes).toHaveBeenCalledTimes(2); expect(api.gitGetRemotes).not.toHaveBeenCalled(); expect(api.vcsGetContext).not.toHaveBeenCalled();
  });
  it('manual refresh supersedes an older branch read without coupling another resource', async () => {
    const old = deferred<GitBranchStateResult>(); api.gitGetBranchState.mockReturnValueOnce(old.promise);
    await open(); await click('Branches');
    api.gitGetBranchState.mockResolvedValueOnce(branch('newer'));
    await click('Refresh branches'); expect(dialog().getByRole('button', { name: 'Switch to branch newer' })).toBeEnabled();
    await act(async () => old.resolve(branch('obsolete')));
    expect(dialog().queryByRole('button', { name: 'Switch to branch obsolete' })).toBeNull();
    expect(api.vcsGetContext).toHaveBeenCalledTimes(1);
  });
  it('close/reopen invalidates outstanding callbacks and reopens Changes without eagerly reading', async () => {
    const old = deferred<GitHistoryEntry[]>(); api.gitGetHistory.mockReturnValueOnce(old.promise);
    await open(); await click('History'); await click('Close Source Control'); await open();
    await act(async () => old.resolve([commit('obsolete')]));
    expect(dialog().getByRole('heading', { name: 'Changes' })).toBeVisible(); expect(api.gitGetHistory).toHaveBeenCalledTimes(1);
    await click('History'); expect(dialog().getByText('commit-abc1234')).toBeVisible(); expect(dialog().queryByText('commit-obsolete')).toBeNull();
  });
  it('A→B→A rejects old same-path local/SSH and previous-A replies', async () => {
    const oldA = deferred<GitHistoryEntry[]>(); api.gitGetHistory.mockReturnValueOnce(oldA.promise);
    await open(); await click('History'); switchTo('B'); emit();
    const oldB = deferred<GitHistoryEntry[]>(); api.gitGetHistory.mockReturnValueOnce(oldB.promise);
    await open(); await click('History'); switchTo('A'); emit(); await open(); await click('History');
    await act(async () => { oldA.resolve([commit('old-a')]); oldB.resolve([commit('old-b')]); });
    expect(dialog().getByText('commit-abc1234')).toBeVisible(); expect(dialog().queryByText('commit-old-a')).toBeNull(); expect(dialog().queryByText('commit-old-b')).toBeNull();
    expect(api.gitStartPolling).toHaveBeenCalledTimes(3);
  });
  it('workspace closure and missing checkout cannot resurrect a loading resource', async () => {
    const old = deferred<GitHistoryEntry[]>(); api.gitGetHistory.mockReturnValueOnce(old.promise);
    await open(); await click('History');
    act(() => useWorkspaceStore.setState(s => ({ workspaces: s.workspaces.filter(w => w.id !== 'A'), activeWorkspaceId: 'B' })));
    emit(); await open(); await click('History'); await act(async () => old.resolve([commit('retired')]));
    expect(dialog().queryByText('commit-retired')).toBeNull();
    act(() => useWorkspaceStore.setState(s => ({ workspaces: s.workspaces.map(w => w.id === 'B' ? { ...w, checkoutContexts: w.checkoutContexts?.map(c => ({ ...c, missing: true })) } : w) })));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('button', { name: 'Source Control' })).toHaveTextContent('Checkout unavailable');
  });
  it('old history cannot change explicit diff selection; same-selection diff failure retains marked content', async () => {
    const oldHistory = deferred<GitHistoryEntry[]>(); await open(); await click('History');
    const oldDiff = deferred<GitDiffResult>(); api.gitGetDiff.mockReturnValueOnce(oldDiff.promise);
    await click('View summary for commit abc1234: commit-abc1234');
    api.gitGetDiff.mockResolvedValueOnce({ success: true, output: 'latest-working', title: 'Working' }); await click('Working Tree');
    await act(async () => oldDiff.resolve({ success: true, output: 'obsolete-commit', title: 'Old' }));
    expect(dialog().getByText('latest-working')).toBeVisible();
    api.gitGetHistory.mockReturnValueOnce(oldHistory.promise); api.gitGetDiff.mockRejectedValueOnce(new Error('Diff failed'));
    await click('Refresh history'); expect(dialog().getByText('latest-working')).toBeVisible(); expect(dialog().getByText(/Last known summary/)).toBeVisible();
    api.gitGetDiff.mockResolvedValueOnce({ success: true, output: 'new-staged', title: 'Staged' }); await click('Staged');
    await act(async () => oldHistory.resolve([commit('not-selected')])); expect(dialog().getByText('new-staged')).toBeVisible();
  });
});

describe('single post-mutation response and truthful outcomes', () => {
  it('stages exactly once, uses returned status for toolbar/Explorer and never invokes gitRefresh', async () => {
    await open(); const next = status({ acquisitionSequence: 2, changes: [{ path: 'one.txt', status: 'modified', staged: true }] });
    api.gitStage.mockResolvedValueOnce({ success: true, status: next }); await click('Stage one.txt');
    expect(dialog().getByRole('button', { name: 'Unstage one.txt' })).toBeEnabled(); expect(useCheckoutGitStore.getState().active?.result?.changes[0].staged).toBe(true);
    expect(useWorkspaceStore.getState().getWorkspaceById('A')!.gitChanges[0].staged).toBe(true);
    expect(api.gitStage).toHaveBeenCalledTimes(1); expect(api.gitRefresh).not.toHaveBeenCalled();
    emit(status({ acquisitionSequence: 1, changes: [] })); expect(dialog().getByRole('button', { name: 'Unstage one.txt' })).toBeEnabled();
  });
  it('notification plus identical mutation response publishes a sequenced snapshot once', async () => {
    await open(); const next = status({ acquisitionSequence: 2, changes: [{ path: 'one.txt', status: 'modified', staged: true }] });
    const pending = deferred<{ success: boolean; status: GitStatusResult }>(); api.gitStage.mockReturnValueOnce(pending.promise);
    let accepted = 0; const off = useCheckoutGitStore.subscribe(s => { if (s.active?.acquisitionSequence === 2) accepted++; });
    await click('Stage one.txt'); emit(next); await act(async () => pending.resolve({ success: true, status: { ...next } }));
    off(); expect(accepted).toBe(1); expect(dialog().getByRole('button', { name: 'Unstage one.txt' })).toBeEnabled();
    expect(api.gitRefresh).not.toHaveBeenCalled();
  });
  it('successful stage with failed reacquisition remains success, unverified, recoverable and never repeated', async () => {
    await open(); const cached = useCheckoutGitStore.getState().cache[0];
    api.gitStage.mockResolvedValueOnce({ success: true, status: status({ success: false, acquisitionSequence: 2, changes: [], error: 'SSH failed' }), refreshError: 'SSH failed' });
    await click('Stage All'); expect(dialog().getByText(/Stage succeeded, but status could not be refreshed/)).toBeVisible();
    expect(useCheckoutGitStore.getState().active?.state).toBe('error'); expect(useCheckoutGitStore.getState().cache[0]).toBe(cached);
    expect(dialog().getByRole('button', { name: 'Commit Staged' })).toBeDisabled(); expect(api.gitRefresh).not.toHaveBeenCalled();
    emit(status({ acquisitionSequence: 1 })); expect(useCheckoutGitStore.getState().active?.state).toBe('error');
    api.gitRefresh.mockResolvedValueOnce(status({ acquisitionSequence: 3 })); await click('Refresh changes');
    expect(dialog().getByRole('button', { name: 'Stage one.txt' })).toBeEnabled(); expect(api.gitStage).toHaveBeenCalledTimes(1);
  });
  it('stage-all-and-commit preserves staged partial success on failed commit and has no duplicate renderer refresh', async () => {
    await open(); const staged = status({ acquisitionSequence: 2, changes: [{ path: 'one.txt', status: 'modified', staged: true }] });
    api.gitStage.mockResolvedValueOnce({ success: true, status: staged });
    api.gitCommit.mockResolvedValueOnce({ success: false, error: 'Hook failed', status: { ...staged, acquisitionSequence: 3 } });
    fireEvent.change(dialog().getByRole('textbox', { name: 'Commit Message' }), { target: { value: 'intent' } });
    await click('Stage All & Commit'); expect(dialog().getByText(/Staging succeeded, but commit failed: Hook failed/)).toBeVisible();
    expect(dialog().getByRole('textbox', { name: 'Commit Message' })).toHaveValue('intent'); expect(dialog().getByRole('button', { name: 'Unstage one.txt' })).toBeEnabled();
    expect(api.gitStage).toHaveBeenCalledTimes(1); expect(api.gitCommit).toHaveBeenCalledTimes(1); expect(api.gitRefresh).not.toHaveBeenCalled();
  });
  it('successful commit clears draft but separately reports failed refresh without repeating it', async () => {
    emit(status({ acquisitionSequence: 2, changes: [{ path: 'one.txt', status: 'modified', staged: true }] })); await open();
    api.gitCommit.mockResolvedValueOnce({ success: true, status: status({ success: false, acquisitionSequence: 3, error: 'Read failed' }), refreshError: 'Read failed' });
    fireEvent.change(dialog().getByRole('textbox', { name: 'Commit Message' }), { target: { value: 'intent' } }); await click('Commit Staged');
    expect(dialog().getByRole('textbox', { name: 'Commit Message' })).toHaveValue(''); expect(dialog().getAllByText(/Commit succeeded, but status could not be refreshed/).length).toBeGreaterThan(0);
    expect(api.gitCommit).toHaveBeenCalledTimes(1); expect(api.gitRefresh).not.toHaveBeenCalled(); expect(useCheckoutGitStore.getState().active?.state).toBe('error');
  });
});
