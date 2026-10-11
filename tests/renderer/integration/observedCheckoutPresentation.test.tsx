import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GitButton from '../../../src/renderer/components/GitButton';
import FileExplorer from '../../../src/renderer/components/FileExplorer';
import ExplorerLifecycleCoordinator from '../../../src/renderer/components/ExplorerLifecycleCoordinator';
import StatusBar from '../../../src/renderer/components/StatusBar';
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
