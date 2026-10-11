import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GitButton from '../../../src/renderer/components/GitButton';
import FileExplorer from '../../../src/renderer/components/FileExplorer';
import ExplorerLifecycleCoordinator from '../../../src/renderer/components/ExplorerLifecycleCoordinator';
import StatusBar from '../../../src/renderer/components/StatusBar';
import { AgentRow } from '../../../src/renderer/components/WorkspaceNavigatorSection';
import { buildIsolatedAgentChoices } from '../../../src/renderer/lib/isolatedAgentChoices';
import { gitManagementScope } from '../../../src/renderer/components/git/gitManagementScope';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { useCheckoutGitStore } from '../../../src/renderer/store/checkoutGitStore';
import { getUnusedWorktreeContexts, getAgentWorktreeContext } from '../../../src/renderer/lib/worktreeAgents';
import { checkoutSelectionToken } from '../../../src/renderer/lib/checkoutSelectionRuntime';
import { selectCheckout } from '../../../src/renderer/lib/checkoutSelection';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture, createTerminalFixture } from '../../setup/fixtures';
import { snapshot, EMPTY_ATTENTION } from '../../_helpers/attentionSnapshots';
import type { GitStatusResult, GitStatus } from '../../../src/shared/types/git';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { FileListDirectoryRequest, FileListDirectoryResult } from '../../../src/shared/types/fileExplorer';

vi.mock('../../../src/renderer/components/UsageWidget', () => ({ default: () => null }));
const MAIN: CheckoutContext = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: '/repo', kind: 'main', branch: 'main' };
const A: CheckoutContext = { ...MAIN, id: 'ws::a', path: '/repo-worktrees/a', kind: 'worktree', branch: 'a' };
const B: CheckoutContext = { ...A, id: 'ws::b', path: '/repo-worktrees/b', branch: 'b' };
const workspace = () => useWorkspaceStore.getState().getWorkspaceById('ws')!;
let api: ReturnType<typeof installElectronApiMock>;
let listeners: Set<(status: GitStatusResult) => void>;
let changes: Record<string, GitStatus[]>;
let automatic: boolean;
let revision: number;
const report = (context: CheckoutContext, state: 'current' | 'last-reported' | 'unavailable' = 'current', id = 'agent') => act(() => {
  const value = snapshot(id, 'running', ++revision, { location: { path: `${context.path}/src`, checkoutContextId: context.id }, locationProvenance: { state, sessionId: 'S' } });
  useAgentAttentionStore.getState().applyChange({ terminalId: id, revision: value.revision, snapshot: value }, false);
});
const result = (root: string, contextId: string | undefined, generation: number): GitStatusResult => ({ success: true, isRepo: true, workspaceId: 'ws', environmentId: 'local', workspacePath: root, checkoutContextId: contextId, presentationGeneration: generation, currentBranch: `git-${root.split('/').pop()}`, isDetached: false, changes: changes[root] ?? [], upstream: null, ahead: 0, behind: 0 });
const publish = () => {
  const active = useCheckoutGitStore.getState().active!;
  act(() => listeners.forEach((callback) => callback(result(active.identity.root, active.identity.contextId, active.generation))));
};
const mount = () => render(<><GitButton workspacePath={MAIN.path} workspaceId="ws" /><ExplorerLifecycleCoordinator /><FileExplorer workspaceId="ws" /><StatusBar /></>);
const ready = async (root: string) => waitFor(() => {
  expect(useCheckoutGitStore.getState().active).toMatchObject({ state: 'ready', identity: { root } });
  expect(workspace().explorerEntriesByPath[root]).toBeDefined();
});
beforeEach(() => {
  revision = 0; automatic = true; changes = {}; listeners = new Set();
  useAgentAttentionStore.setState(EMPTY_ATTENTION); useCheckoutGitStore.setState({ active: null });
  api = installElectronApiMock({
    onGitStatusUpdate: vi.fn((callback) => { listeners.add(callback); return () => listeners.delete(callback); }),
    gitStartPolling: vi.fn(async (root, _ws, contextId, generation) => { if (automatic) queueMicrotask(() => listeners.forEach((callback) => callback(result(root, contextId, generation!)))); }),
    fileListDirectory: vi.fn(async (request: FileListDirectoryRequest) => ({ success: true, entries: ['same.ts', 'other.ts', 'new.ts'].map((name) => ({ name, path: `${request.directoryPath}/${name}`, isDirectory: false, size: 0, modified: 0 })) })),
    editorReadFile: vi.fn(async (request) => ({ success: true, content: request.filePath })),
  });
  const ws = createWorkspaceFixture({ id: 'ws', workspacePath: MAIN.path, checkoutContexts: [MAIN, A, B], explorerVisible: true, explorerEntriesByPath: {}, editorTabs: [],
    terminals: [createTerminalFixture({ id: 'agent', checkoutContextId: MAIN.id }), createTerminalFixture({ id: 'other', checkoutContextId: MAIN.id })], activeTerminalId: 'agent' });
  useWorkspaceStore.setState({ workspaces: [ws], activeWorkspaceId: 'ws', pendingEditorOperations: {} });
});
afterEach(cleanup);
describe('one observed-checkout interpretation across workspace surfaces', () => {
  it('keeps Darling/Pi test1 and Dozin/OpenCode main aligned through sidebar focus, loading, failure, stale replies and provenance recovery', async () => {
    automatic = false;
    const test1 = { ...A, branch: 'test1' };
    const ws = { ...workspace(), name: 'worktree-tests', checkoutContexts: [MAIN, test1, B], gitIsRepo: true, gitCurrentBranch: 'main',
      editorTabs: [{ id: 'main-pin', filePath: `${MAIN.path}/same.ts`, fileName: 'same.ts', content: '', originalContent: '', isDirty: false, checkoutContextId: MAIN.id, checkoutRoot: MAIN.path }],
      terminals: [createTerminalFixture({ id: 'agent', displayName: 'Darling', harnessId: 'pi', checkoutContextId: A.id }), createTerminalFixture({ id: 'other', displayName: 'Dozin', harnessId: 'opencode', checkoutContextId: MAIN.id })],
      panes: [{ id: 'pi-pane', terminalId: 'agent' }, { id: 'oc-pane', terminalId: 'other' }] };
    useWorkspaceStore.setState({ workspaces: [ws], activeTerminalId: 'agent' });
    changes[A.path] = [{ path: 'same.ts', status: 'modified', staged: true }, { path: 'new.ts', status: 'untracked', staged: false }];
    changes[MAIN.path] = [{ path: 'other.ts', status: 'modified', staged: false }];
    api.gitGetBranchState.mockImplementation(async (root) => ({ success: true, isRepo: true, currentBranch: root === A.path ? 'test1' : 'main', isDetached: false, branches: [] }));
    function Rows() {
      const current = useWorkspaceStore((state) => state.getWorkspaceById('ws')!);
      return <ul>{current.terminals.map((terminal) => <AgentRow key={terminal.id} workspace={current} terminal={terminal} isCurrent={current.activeTerminalId === terminal.id} />)}</ul>;
    }
    render(<><Rows /><GitButton workspacePath={MAIN.path} workspaceId="ws" /><ExplorerLifecycleCoordinator /><FileExplorer workspaceId="ws" /><StatusBar /></>);
    const selected = (root: string, contextId: string) => {
      expect(selectCheckout(workspace(), useAgentAttentionStore.getState().byTerminalId[workspace().activeTerminalId!])).toMatchObject({ availability: 'available', root, contextId });
      expect(gitManagementScope(MAIN.path, 'ws')).toMatchObject({ path: root, checkoutContextId: contextId === MAIN.id ? undefined : contextId, blocked: null });
      expect(useCheckoutGitStore.getState().active?.identity).toMatchObject({ root });
      expect(document.querySelector('.status-project')).toHaveAttribute('title', root);
      expect(document.querySelector('.status-checkout-unavailable')).toBeNull();
      expect(workspace().activeTerminalId).toBe(useWorkspaceStore.getState().activeTerminalId);
    };
    const loading = () => {
      expect(document.querySelector('.status-git-availability')).toHaveTextContent('Git loading…');
      expect(screen.getByText('Loading Git status…')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Source Control' })).toHaveAttribute('title', 'Git loading…');
      expect(document.querySelector('.git-badge')).toBeNull();
    };
    const complete = async (root: string, count: number, branch: string) => {
      const current = useCheckoutGitStore.getState().active!;
      act(() => listeners.forEach((callback) => callback({ ...result(root, current.identity.contextId, current.generation), currentBranch: branch })));
      await ready(root);
      expect(document.querySelector('.status-branch')).toHaveTextContent(branch);
      expect(document.querySelector('.status-git-availability')).toBeNull();
      expect(document.querySelector('.git-badge')).toHaveTextContent(String(count));
      expect(document.querySelectorAll('.git-status-indicator')).toHaveLength(count);
      fireEvent.click(screen.getByRole('button', { name: 'Source Control' }));
      expect(await screen.findByText(new RegExp(`${count} changed ${count === 1 ? 'file' : 'files'}`))).toBeVisible();
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Source Control' })).toBeNull());
    };
    // Both sidebar rows/panes exist; no native location is required for a valid launch selection.
    selected(A.path, A.id); loading();
    const polls = api.gitStartPolling.mock.calls.length;
    report(test1); selected(A.path, A.id); loading();
    expect(api.gitStartPolling).toHaveBeenCalledTimes(polls);
    await complete(A.path, 2, 'test1');
    const current = useCheckoutGitStore.getState().active!;
    act(() => listeners.forEach((callback) => callback({ ...result(A.path, A.id, current.generation), success: false, error: 'fixture Git failure' })));
    selected(A.path, A.id);
    expect(document.querySelector('.status-git-availability')).toHaveTextContent('Git status unavailable');
    expect(document.querySelector('.status-branch')).toHaveTextContent('test1');
    expect(screen.getByText('Git unavailable')).toBeVisible();
    expect(document.querySelectorAll('.git-status-indicator')).toHaveLength(0);
    await complete(A.path, 2, 'test1');
    fireEvent.click(screen.getByRole('button', { name: /Dozin/ }));
    selected(MAIN.path, MAIN.id); loading(); await complete(MAIN.path, 1, 'main');
    const mainStatus = useCheckoutGitStore.getState().active!;
    act(() => listeners.forEach((callback) => callback({ ...result(MAIN.path, MAIN.id, mainStatus.generation), success: false, error: 'main Git refresh failed' })));
    selected(MAIN.path, MAIN.id);
    expect(document.querySelector('.status-branch')).toHaveTextContent('main');
    expect(document.querySelector('.status-git-availability')).toHaveTextContent('Git status unavailable');
    expect(document.querySelector('.git-badge')).toBeNull();
    await complete(MAIN.path, 1, 'main');
    expect(screen.getByRole('button', { name: /Darling/ }).querySelector('.ws-agent-branch')).toHaveTextContent('test1');
    const oldMain = useCheckoutGitStore.getState().active!;
    fireEvent.click(screen.getByRole('button', { name: /Darling/ }));
    selected(A.path, A.id); loading();
    act(() => listeners.forEach((callback) => callback(result(MAIN.path, MAIN.id, oldMain.generation))));
    selected(A.path, A.id); loading(); await complete(A.path, 2, 'test1');
    report(test1, 'last-reported');
    expect(document.querySelector('.status-checkout-unavailable')).toHaveTextContent('historical location');
    expect(document.querySelector('.status-git-availability')).toBeNull();
    expect(api.gitStartPolling).toHaveBeenLastCalledWith(A.path, 'ws', A.id, expect.any(Number));
    act(() => useWorkspaceStore.getState().toggleEditorPane());
    act(() => useWorkspaceStore.getState().setActiveEditorTab('main-pin', 'ws'));
    selected(MAIN.path, MAIN.id); loading(); await complete(MAIN.path, 1, 'main');
    report(test1); // Restore authenticated evidence while explicit pin still wins.
    fireEvent.click(screen.getByRole('button', { name: /Darling/ }));
    selected(A.path, A.id); loading(); await complete(A.path, 2, 'test1');
    expect(workspace().terminals.map((terminal) => terminal.checkoutContextId)).toEqual([A.id, MAIN.id]);
    expect(workspace().panes).toHaveLength(2);
  });

  it('does not mistake an occupied unregistered worktree for authorized surface selection', () => {
    useWorkspaceStore.setState({ workspaces: [{ ...workspace(), checkoutContexts: [MAIN], gitIsRepo: true }] });
    const value = snapshot('agent', 'running', ++revision, { location: { path: A.path, checkoutContextId: null } });
    useAgentAttentionStore.getState().applyChange({ terminalId: 'agent', revision, snapshot: value }, false);
    mount();
    expect(selectCheckout(workspace(), value)).toMatchObject({ availability: 'unavailable', reason: 'unregistered-observation' });
    expect(buildIsolatedAgentChoices({ workspace: workspace(), currentBranch: 'main', branchNames: [], worktrees: [{ path: A.path, branch: 'test1', isMain: false, isLocked: false, isPrunable: false }] }).worktrees[0].state).toBe('in-use');
    expect(document.querySelector('.status-checkout-unavailable')).toHaveTextContent('unregistered location');
    expect(screen.getByText(/outside this workspace’s registered checkouts/)).toBeVisible();
    expect(api.gitStartPolling).not.toHaveBeenCalled(); expect(api.fileListDirectory).not.toHaveBeenCalled();
  });

  it.each([[3, 0, 0], [0, 2, 0], [3, 2, 0], [1, 2, 3]])('keeps the main/A/B dirty matrix isolated (%j)', async (main, a, b) => {
    for (const [context, count] of [[MAIN, main], [A, a], [B, b]] as Array<[CheckoutContext, number]>) {
      changes[context.path] = ['same.ts', 'other.ts', 'new.ts'].slice(0, count).map((path, index) => ({ path, staged: index === 0, status: index === 2 ? 'untracked' : 'modified' }));
    }
    mount();
    for (const [context, count] of [[MAIN, main], [A, a], [B, b], [MAIN, main]] as Array<[CheckoutContext, number]>) {
      report(context); await ready(context.path);
      expect(document.querySelector('.git-badge')?.textContent ?? '0').toBe(String(count));
      expect(document.querySelectorAll('.git-status-indicator')).toHaveLength(count);
      expect(document.querySelectorAll('.git-staged')).toHaveLength(count ? 1 : 0);
      expect(document.querySelector('.status-project')).toHaveAttribute('title', context.path);
      expect(document.querySelector('.status-branch')).toHaveTextContent(`git-${context.path.split('/').pop()}`);
      expect(workspace().terminals.every((terminal) => terminal.checkoutContextId === MAIN.id)).toBe(true);
    }
  });

  it('shares one poller/watch among agents in the same resolved checkout and keeps explicit pins independent of agent labels', async () => {
    report(A); report(A, 'current', 'other'); mount(); await ready(A.path);
    const polls = api.gitStartPolling.mock.calls.length, watches = api.explorerStartWatching.mock.calls.length;
    act(() => useWorkspaceStore.getState().setActiveTerminal('other'));
    await act(async () => {});
    expect(api.gitStartPolling).toHaveBeenCalledTimes(polls); expect(api.explorerStartWatching).toHaveBeenCalledTimes(watches);
    act(() => useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.map((ws) => ({ ...ws, activePageId: 'another-page-same-checkout' })) })));
    await act(async () => {});
    expect(api.gitStartPolling).toHaveBeenCalledTimes(polls); expect(api.explorerStartWatching).toHaveBeenCalledTimes(watches);
    act(() => useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.map((ws) => ({ ...ws, fileSurfaceContextId: B.id })) })));
    await ready(B.path);
    expect(document.querySelector('.status-project')).toHaveAttribute('title', B.path);
    expect(getAgentWorktreeContext(workspace(), workspace().terminals[1], useAgentAttentionStore.getState().byTerminalId.other.location)?.id).toBe(A.id);
    expect(selectCheckout(workspace(), useAgentAttentionStore.getState().byTerminalId.other).source).toBe('explicit');
  });

  it('does not render unavailable snapshots as clean and conservatively excludes historical observed occupancy', async () => {
    changes[A.path] = [{ path: 'same.ts', status: 'modified', staged: false }];
    report(A); mount(); await ready(A.path);
    report(A, 'last-reported');
    expect(screen.getByText(/last-reported from an earlier session/)).toBeVisible();
    expect(document.querySelector('.git-badge')).toBeNull();
    expect(getUnusedWorktreeContexts(workspace()).map((context) => context.id)).not.toContain(A.id);
    expect(api.explorerStopWatching).toHaveBeenCalled();
    act(() => useAgentAttentionStore.getState().applyChange({ terminalId: 'agent', revision: ++revision, snapshot: null }, false));
    await ready(MAIN.path);
    expect(getUnusedWorktreeContexts(workspace()).map((context) => context.id)).toContain(A.id);
  });

  it('rejects delayed A snapshots after A→B→A, including the same-root return, and does not reuse an old count', async () => {
    automatic = false; report(A); mount();
    await waitFor(() => expect(api.gitStartPolling).toHaveBeenCalled());
    const old = useCheckoutGitStore.getState().active!;
    report(B); report(A);
    await waitFor(() => expect(useCheckoutGitStore.getState().active?.generation).not.toBe(old.generation));
    act(() => listeners.forEach((callback) => callback({ ...result(A.path, A.id, old.generation), changes: [{ path: 'same.ts', status: 'modified', staged: false }] })));
    expect(useCheckoutGitStore.getState().active?.state).toBe('loading');
    expect(document.querySelector('.git-badge')).toBeNull();
    expect(screen.getByText('Loading Git status…')).toBeVisible();
    publish(); await ready(A.path);
    expect(screen.queryByText('Loading Git status…')).toBeNull();
  });

  it('rejects A→B→A directory replies and preserves pinned dirty buffers while observations move', async () => {
    let finish!: (result: FileListDirectoryResult) => void;
    const normal = api.fileListDirectory.getMockImplementation()!;
    api.fileListDirectory.mockImplementationOnce(() => new Promise<FileListDirectoryResult>((resolve) => { finish = resolve; }));
    report(A); mount(); await waitFor(() => expect(api.fileListDirectory).toHaveBeenCalled());
    const token = checkoutSelectionToken('ws'); report(B); report(A);
    expect(checkoutSelectionToken('ws')).not.toBe(token);
    api.fileListDirectory.mockImplementation(normal);
    await act(async () => finish({ success: true, entries: [{ name: 'stale.ts', path: `${A.path}/stale.ts`, isDirectory: false, size: 0, modified: 0 }] }));
    await ready(A.path);
    expect(screen.queryByText('stale.ts')).toBeNull();
    await act(async () => useWorkspaceStore.getState().openFileInEditor(`${A.path}/same.ts`, 'ws'));
    const tab = workspace().editorTabs[0];
    act(() => useWorkspaceStore.getState().updateEditorContent(tab.id, 'unsaved A', 'ws'));
    report(B); await ready(B.path);
    await act(async () => useWorkspaceStore.getState().openFileInEditor(`${B.path}/same.ts`, 'ws'));
    expect(workspace().editorTabs).toHaveLength(2);
    expect(workspace().editorTabs.find((entry) => entry.id === tab.id)).toMatchObject({ content: 'unsaved A', isDirty: true, checkoutContextId: A.id, checkoutRoot: A.path });
  });
});
