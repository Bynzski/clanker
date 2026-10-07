// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resumeSessionInMeasuredPane } from '../../../src/renderer/lib/sessionResume';
import { publishTerminalPaneGeometry, clearTerminalPaneGeometry } from '../../../src/renderer/lib/terminalPaneGeometry';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import type { SessionInvokeResult } from '../../../src/shared/types/session';

const session = { id: 'native', harness: 'codex' as const, cwd: '/forged', title: 'Test', timestamp: 1 };
const start = (signal?: AbortSignal) => resumeSessionInMeasuredPane({ workspaceId: 'w', workspacePath: '/repo', environmentId: 'local', session, signal });
const workspace = () => useWorkspaceStore.getState().getWorkspaceById('w')!;
const reserved = () => workspace().panes.find((pane) => pane.terminalId === null)!.id;
async function measure() {
  publishTerminalPaneGeometry(reserved(), { cols: 110, rows: 33 });
  await vi.advanceTimersByTimeAsync(100);
}
beforeEach(() => {
  vi.useFakeTimers();
  installElectronApiMock({ invokeSession: vi.fn().mockResolvedValue({ id: 'real', pid: 3, workingDir: '/repo/src' }) });
  useAssistantNavStore.setState({ activeAssistantId: null });
  useWorkspaceStore.setState({ activeWorkspaceId: 'w', activeTerminalId: null, terminals: [], panes: [], layoutRoot: null,
    workspaces: [createWorkspaceFixture({ id: 'w', workspacePath: '/repo', terminals: [], panes: [], activeTerminalId: null, layoutRoot: null })] });
});
afterEach(() => {
  for (const pane of workspace()?.panes ?? []) clearTerminalPaneGeometry(pane.id);
  vi.useRealTimers();
});
describe('geometry-first history resume', () => {
  it('reserves an empty real split, waits for stable geometry and attaches without inserting another pane', async () => {
    const pending = start();
    const paneId = reserved();
    const layout = workspace().layoutRoot;
    expect(workspace().terminals).toEqual([]); // no fake terminal or process while measuring
    expect(window.electronAPI.invokeSession).not.toHaveBeenCalled();
    publishTerminalPaneGeometry(paneId, { cols: 80, rows: 24 });
    await vi.advanceTimersByTimeAsync(50);
    publishTerminalPaneGeometry(paneId, { cols: 110, rows: 33 });
    await vi.advanceTimersByTimeAsync(99);
    expect(window.electronAPI.invokeSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(window.electronAPI.invokeSession).toHaveBeenCalledWith('w', session, false, { initialGeometry: { cols: 110, rows: 33 } });
    expect(workspace().panes).toHaveLength(1);
    expect(workspace().panes[0]).toMatchObject({ id: paneId, terminalId: 'real' });
    expect(workspace().layoutRoot).toEqual(layout);
    expect(workspace().terminals[0]).toMatchObject({ id: 'real', workingDir: '/repo/src' });
  });
  it('preserves an existing split topology when filling the measured reservation', async () => {
    const existing = createWorkspaceFixture({ id: 'w', workspacePath: '/repo',
      terminals: [{ id: 'old', pid: 1, workingDir: '/repo' }], panes: [{ id: 'old-pane', terminalId: 'old' }], activeTerminalId: 'old',
      layoutRoot: { type: 'leaf', nodeId: 'old-node', paneId: 'old-pane' },
    });
    useWorkspaceStore.setState({ workspaces: [existing], terminals: existing.terminals, panes: existing.panes, activeTerminalId: 'old', layoutRoot: existing.layoutRoot });
    const pending = start();
    const topology = workspace().layoutRoot;
    expect(topology?.type).toBe('split');
    await measure(); await pending;
    expect(workspace().layoutRoot).toEqual(topology);
    expect(workspace().panes).toHaveLength(2);
    expect(workspace().terminals.map((terminal) => terminal.id)).toEqual(['old', 'real']);
  });

  it('does not dispatch after a workspace switch during preparation and cleans only the original reservation', async () => {
    const pending = start(); const rejected = expect(pending).rejects.toThrow('no longer available');
    const paneId = reserved();
    useWorkspaceStore.setState((state) => ({ workspaces: [...state.workspaces, createWorkspaceFixture({ id: 'other', lifecycle: 'parked' })] }));
    useWorkspaceStore.getState().selectWorkspace('other');
    const otherPanes = useWorkspaceStore.getState().panes;
    publishTerminalPaneGeometry(paneId, { cols: 110, rows: 33 });
    await vi.advanceTimersByTimeAsync(100); await rejected;
    expect(workspace().panes).toEqual([]);
    expect(useWorkspaceStore.getState().panes).toEqual(otherPanes);
    expect(window.electronAPI.invokeSession).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'abort', 'hidden'])('removes the reservation without invoking on %s during measurement', async (kind) => {
    const controller = new AbortController();
    const pending = start(controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    if (kind === 'abort') controller.abort();
    if (kind === 'hidden') clearTerminalPaneGeometry(reserved());
    if (kind === 'timeout') await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(workspace().panes).toEqual([]);
    expect(window.electronAPI.invokeSession).not.toHaveBeenCalled();
  });
  it('removes an empty pane on an offer or main error, with no terminal or process cleanup invented', async () => {
    vi.mocked(window.electronAPI.invokeSession).mockResolvedValueOnce({ recreateOffer: { branch: 'task', path: '/repo-worktrees/task' } });
    const offer = start(); await measure();
    expect(await offer).toHaveProperty('recreateOffer');
    expect(workspace().panes).toEqual([]);
    vi.mocked(window.electronAPI.invokeSession).mockRejectedValueOnce(new Error('Native selection vanished'));
    const failure = start(); const rejected = expect(failure).rejects.toThrow('Native selection vanished');
    await measure(); await rejected;
    expect(workspace().panes).toEqual([]);
    expect(window.electronAPI.killTerminal).not.toHaveBeenCalled();
  });
  it.each(['closed', 'removed pane', 'attachment refused'])('kills an already spawned PTY when %s prevents recording it', async (kind) => {
    let finish!: (result: SessionInvokeResult) => void;
    vi.mocked(window.electronAPI.invokeSession).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = start(); const rejected = expect(pending).rejects.toThrow();
    const paneId = reserved();
    await measure();
    expect(window.electronAPI.invokeSession).toHaveBeenCalledOnce();
    if (kind === 'closed') useWorkspaceStore.setState({ workspaces: [] });
    if (kind === 'removed pane') useWorkspaceStore.getState().removePane(paneId, 'w');
    if (kind === 'attachment refused') vi.spyOn(useWorkspaceStore.getState(), 'addTerminal').mockImplementationOnce(() => {});
    finish({ id: 'real', pid: 3 }); await rejected;
    expect(window.electronAPI.killTerminal).toHaveBeenCalledWith('real');
    expect(workspace()?.terminals ?? []).toEqual([]);
    expect(workspace()?.panes ?? []).toEqual([]);
    vi.restoreAllMocks();
  });
  it('records a dispatched resume in its original live workspace after switching, without disturbing the new workspace', async () => {
    let finish!: (result: SessionInvokeResult) => void;
    vi.mocked(window.electronAPI.invokeSession).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController(); const pending = start(controller.signal);
    const paneId = reserved(); await measure();
    useWorkspaceStore.setState((state) => ({ workspaces: [...state.workspaces, createWorkspaceFixture({ id: 'other', lifecycle: 'parked', terminals: [], panes: [] })] }));
    useWorkspaceStore.getState().selectWorkspace('other');
    controller.abort(); // dropdown unmount only cancels preparation, not an already dispatched launch
    finish({ id: 'real', pid: 3 }); await pending;
    expect(workspace().panes).toEqual([expect.objectContaining({ id: paneId, terminalId: 'real' })]);
    expect(useWorkspaceStore.getState().getWorkspaceById('other')?.panes).toEqual([]);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('other');
  });
  it('refuses to measure or launch into a parked workspace while an Assistant is active', async () => {
    useAssistantNavStore.setState({ activeAssistantId: 'assistant' });
    await expect(start()).rejects.toThrow('no longer active');
    expect(workspace().panes).toEqual([]);
    expect(window.electronAPI.invokeSession).not.toHaveBeenCalled();
  });
});
