import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useWorkspaceStore, validateWorkspaceConsistency } from '../../../src/renderer/store/workspaceStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { collectLeafPaneIds } from '../../../src/renderer/store/workspaceLayout';
import { activePage, workspaceBrowserPresented } from '../../../src/renderer/store/workspacePages';
import { WorkspacePageSwitcher } from '../../../src/renderer/components/WorkspacePageControls';
import BrowserLifecycleCoordinator from '../../../src/renderer/components/BrowserLifecycleCoordinator';
import { useKeybindingStore } from '../../../src/renderer/store/keybindingStore';
import { dispatchAppKeybinding } from '../../../src/renderer/lib/keybindingDispatcher';
import { startTerminalSessionBridge } from '../../../src/renderer/lib/terminalSessionBridge';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { nextAttentionTarget } from '../../../src/renderer/lib/agentAttentionNavigation';
import { change, EMPTY_ATTENTION, snapshot } from '../../_helpers/attentionSnapshots';
import type { AgentAttentionChange } from '../../../src/shared/types/agentAttention';
import { executeWorkspacePageCommand } from '../../../src/renderer/lib/workspacePageCommands';
import { launchTerminalInCheckoutContext } from '../../../src/renderer/lib/checkoutContextLaunch';
import { closeWorkspaceTerminal } from '../../../src/renderer/lib/workspaceTerminalClose';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import { clearTerminalCache } from '../../../src/renderer/lib/terminalRuntimeCache';
import type { WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';

const store = () => useWorkspaceStore.getState();
const workspace = () => store().getWorkspaceById('w')!;
const firstPage = () => workspace().pages![0];
function PageSwitcherUI() {
  const selected = useWorkspaceStore((state) => state.workspaces.find((entry) => entry.id === 'w'))!;
  return <WorkspacePageSwitcher workspace={selected} />;
}
function open(overrides: Partial<WorkspaceTab> = {}) {
  store().addWorkspace(createWorkspaceFixture({ id: 'w', terminals: [{ id: 't1', pid: 1, workingDir: '/workspace' }, { id: 't2', pid: 2, workingDir: '/workspace' }],
    panes: [{ id: 'p1', terminalId: 't1' }, { id: 'p2', terminalId: 't2' }], activeTerminalId: 't1', ...overrides }));
}
beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useAssistantNavStore.setState({ activeAssistantId: null });
  installElectronApiMock();
  useKeybindingStore.setState({ overrides: {}, capturing: false });
  useAgentAttentionStore.setState(EMPTY_ATTENTION);
  clearTerminalCache();
});

describe('workspace page ownership', () => {
  it('backfills one page from the existing topology, keeping terminal identities', () => {
    open();
    expect(workspace().pages).toHaveLength(1);
    expect(firstPage().layoutRoot).toBe(workspace().layoutRoot);
    expect(collectLeafPaneIds(workspace().layoutRoot)).toEqual(['p1', 'p2']);
    expect(workspace().terminals.map(({ id, pid }) => ({ id, pid }))).toEqual([{ id: 't1', pid: 1 }, { id: 't2', pid: 2 }]);
    expect(validateWorkspaceConsistency(store())).toEqual([]);
  });
  it('renders compact page controls and disables removing pages with minimized panes', () => {
    open(); render(<PageSwitcherUI />);
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Page 1' }));
    expect(screen.getByRole('button', { name: 'Remove empty page' })).toBeDisabled();
    act(() => store().minimizeWorkspacePane('w', 'p1'));
    // Minimized pane footer menu has been removed: no details element or overlay suppression lease.
    expect(document.querySelector('details')).toBeNull();
    expect(workspace().browserOverlayCount).toBe(0);
    // Page with minimized pane cannot be removed
    expect(screen.getByRole('button', { name: 'Remove empty page' })).toBeDisabled();
    // Restoring via canonical workspace navigation restores the pane and sets active terminal
    act(() => store().selectWorkspace('w', 't1'));
    expect(workspace().minimizedPanes).toEqual([]);
    expect(workspace().browserOverlayCount).toBe(0);
    expect(workspace().activeTerminalId).toBe('t1');
  });
  it('adds an empty active page and does not retile other-page agents on fit, reset, or selection', () => {
    open(); const original = workspace().layoutRoot;
    store().addWorkspacePage('w');
    expect(workspace().layoutRoot).toBeNull();
    expect(store().activeTerminalId).toBeNull();
    store().fitAllPanes(); store().resetLayout(); store().selectWorkspace('w');
    expect(workspace().layoutRoot).toBeNull();
    expect(firstPage().layoutRoot).toBe(original);
    expect(validateWorkspaceConsistency(store())).toEqual([]);
    expect(window.electronAPI.killTerminal).not.toHaveBeenCalled();
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
  });
  it('only removes empty pages, never the last page or minimized restore destinations', () => {
    open(); const id = firstPage().id;
    store().removeWorkspacePage('w', id); expect(workspace().pages).toHaveLength(1);
    store().minimizeWorkspacePane('w', 'p1'); store().minimizeWorkspacePane('w', 'p2');
    store().addWorkspacePage('w');
    store().removeWorkspacePage('w', id); expect(workspace().pages).toHaveLength(2);
    store().removeWorkspacePage('w', workspace().activePageId!);
    expect(workspace().pages).toHaveLength(1); expect(workspace().activePageId).toBe(id);
  });
  it('scopes split ratios, moves and undo without resurrecting a minimized agent', () => {
    open(); const original = workspace().layoutRoot!;
    expect(original.type).toBe('split');
    store().setSplitRatio(original.nodeId, .7, 'w');
    const firstEdited = workspace().layoutRoot;
    store().addWorkspacePage('w');
    store().addTerminal({ id: 't3', pid: 3, workingDir: '/workspace' }, 'w');
    store().addTerminal({ id: 't4', pid: 4, workingDir: '/workspace' }, 'w');
    const secondRoot = workspace().layoutRoot!;
    store().setSplitRatio(secondRoot.nodeId, .6, 'w');
    store().undoLayout('w'); expect(workspace().layoutRoot).toEqual(secondRoot);
    expect(firstPage().layoutRoot).toBe(firstEdited);
    store().selectWorkspacePage('w', firstPage().id);
    store().minimizeWorkspacePane('w', 'p2'); store().undoLayout('w');
    expect(collectLeafPaneIds(workspace().layoutRoot)).toEqual(['p1']);
    store().fitAllPanes(); expect(collectLeafPaneIds(workspace().layoutRoot)).toEqual(['p1']);
    expect(validateWorkspaceConsistency(store())).toEqual([]);
  });
  it('restores to the original page and exact sibling placement without changing processes', () => {
    open(); const original = workspace().layoutRoot!;
    store().minimizeWorkspacePane('w', 'p1');
    expect(workspace().terminals).toHaveLength(2);
    store().addWorkspacePage('w'); store().restoreWorkspacePane('w', 'p1');
    expect(workspace().activePageId).toBe(firstPage().id);
    const restored = workspace().layoutRoot!;
    expect(restored.type).toBe('split');
    if (restored.type === 'split' && original.type === 'split') {
      expect(restored.ratio).toBe(original.ratio);
      expect(restored.orientation).toBe(original.orientation);
      expect(restored.second).toEqual(original.second);
    }
    expect(collectLeafPaneIds(restored)).toEqual(['p1', 'p2']);
    expect(window.electronAPI.killTerminal).not.toHaveBeenCalled();
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
  });
  it('falls back safely when the restore anchor has closed', () => {
    open(); store().minimizeWorkspacePane('w', 'p1'); store().removeTerminal('t2');
    store().restoreWorkspacePane('w', 'p1');
    expect(collectLeafPaneIds(workspace().layoutRoot)).toEqual(['p1']);
    expect(validateWorkspaceConsistency(store())).toEqual([]);
  });
  it('maximizes per page without changing topology, ratios, revision, or undo', () => {
    open(); store().setActiveTerminal('t2'); const before = workspace();
    store().toggleMaximizedPane('w', 'p1');
    expect(workspace().layoutRoot).toBe(before.layoutRoot);
    expect(workspace().layoutRevision).toBe(before.layoutRevision);
    expect(workspace().layoutUndoStack).toBe(before.layoutUndoStack);
    expect(workspace().activeTerminalId).toBe('t1');
    store().fitAllPanes(); store().undoLayout('w'); expect(workspace().layoutRoot).toBe(before.layoutRoot);
    store().addWorkspacePage('w'); store().selectWorkspacePage('w', firstPage().id);
    expect(activePage(workspace())?.maximizedPaneId).toBe('p1');
    store().toggleMaximizedPane('w', 'p1');
    expect(workspace().layoutRoot).toBe(before.layoutRoot); expect(workspace().activeTerminalId).toBe('t2');
  });
  it('reveals other-page and minimized agents via the existing workspace navigation', () => {
    open(); const pageId = firstPage().id; store().minimizeWorkspacePane('w', 'p1'); store().addWorkspacePage('w');
    store().selectWorkspace('w', 't1');
    expect(workspace().activePageId).toBe(pageId);
    expect(workspace().minimizedPanes).toEqual([]);
    expect(store().activeTerminalId).toBe('t1');
  });
  it('replaces a minimized native conversation without changing its pane or membership', () => {
    open(); store().minimizeWorkspacePane('w', 'p1'); const before = workspace().minimizedPanes;
    expect(store().replaceTerminal('w', 't1', { id: 'new', pid: 3, workingDir: '/workspace', workspaceId: 'w' })).toBe(true);
    expect(workspace().minimizedPanes).toEqual(before);
    store().selectWorkspace('w', 'new'); expect(store().activeTerminalId).toBe('new');
    expect(workspace().panes.find((pane) => pane.id === 'p1')?.terminalId).toBe('new');
  });
  it('ignores stale source-pane docking and split callbacks after switching pages', () => {
    open(); const root = workspace().layoutRoot!; store().addWorkspacePage('w');
    store().movePane('p1', { kind: 'workspace-edge', edge: 'left' }, 'w');
    store().setSplitRatio(root.nodeId, .8, 'w');
    expect(workspace().layoutRoot).toBeNull(); expect(firstPage().layoutRoot).toBe(root);
  });
  it('refuses other-page sources in every legacy docking/swap route', () => {
    open(); store().addWorkspacePage('w');
    store().addTerminal({ id: 'other-page-agent', pid: 99, workingDir: '/workspace' }, 'w');
    const source = workspace().panes.find((pane) => pane.terminalId === 'other-page-agent')!.id;
    const otherRoot = workspace().layoutRoot;
    store().selectWorkspacePage('w', firstPage().id); const original = workspace().layoutRoot;
    store().dockPaneToEdge(source, 'left', 'w');
    store().swapPanes('p1', source, 'w');
    store().insertPaneAtEdgeGap(source, 'left', 0, 'w');
    store().insertPaneAtEdgeSegment(source, 'left', 'p1', 'w');
    store().setSplitRatio(original!.nodeId, Number.NaN, 'w');
    expect(workspace().layoutRoot).toBe(original); expect(workspace().pages![1].layoutRoot).toBe(otherRoot);
    expect(validateWorkspaceConsistency(store())).toEqual([]);
  });
  it('does not act on a parked workspace while an Assistant is selected', () => {
    open(); useAssistantNavStore.setState({ activeAssistantId: 'assistant' });
    store().addWorkspacePage('w'); store().minimizeWorkspacePane('w', 'p1'); executeWorkspacePageCommand('workspace.pageNext');
    expect(workspace().pages).toHaveLength(1); expect(workspace().minimizedPanes).toEqual([]);
  });
  it('dispatches overridden page commands canonically, respecting capture and modal suppression', () => {
    open(); store().addWorkspacePage('w'); const second = workspace().activePageId;
    executeWorkspacePageCommand('workspace.page1');
    const actions = { openSettings: vi.fn(), fitAllPanes: vi.fn(), toggleExplorer: vi.fn(), saveActiveEditorFile: vi.fn(), zoomApp: vi.fn() };
    useKeybindingStore.setState({ overrides: { 'workspace.pageNext': { code: 'KeyJ', primary: true, ctrl: false, shift: true, alt: false } } });
    const event = () => new KeyboardEvent('keydown', { code: 'KeyJ', ctrlKey: true, shiftKey: true, cancelable: true });
    expect(dispatchAppKeybinding(event(), actions)).toBe(true); expect(workspace().activePageId).toBe(second);
    useKeybindingStore.setState({ capturing: true }); expect(dispatchAppKeybinding(event(), actions)).toBe(false);
    useKeybindingStore.setState({ capturing: false });
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.append(dialog);
    const modalEvent = event(); Object.defineProperty(modalEvent, 'target', { value: dialog });
    expect(dispatchAppKeybinding(modalEvent, actions)).toBe(false); expect(workspace().activePageId).toBe(second); dialog.remove();
  });
  it('rejects stale native Browser page commands for another owner or a hidden Browser', () => {
    open(); store().setBrowserVisible(true, 'w'); store().addWorkspacePage('w'); const selected = workspace().activePageId;
    executeWorkspacePageCommand('workspace.page1', 'w'); expect(workspace().activePageId).toBe(selected);
    executeWorkspacePageCommand('workspace.page1', 'other'); expect(workspace().activePageId).toBe(selected);
  });
  it('keeps hidden/minimized attention unseen and navigable while output continues independently', () => {
    open();
    let attentionChanged!: (value: AgentAttentionChange) => void;
    vi.mocked(window.electronAPI.onAgentAttentionChanged).mockImplementation((callback) => { attentionChanged = callback; return () => {}; });
    const dispose = startTerminalSessionBridge();
    try {
      store().minimizeWorkspacePane('w', 'p1'); store().addWorkspacePage('w');
      attentionChanged(change(snapshot('t1', 'completed', 5)));
      const attention = useAgentAttentionStore.getState();
      expect(attention.seenByTerminalId.t1?.completion ?? 0).toBeLessThan(5);
      expect(nextAttentionTarget(store().workspaces, attention.byTerminalId, attention.seenByTerminalId, null)).toEqual({ workspaceId: 'w', terminalId: 't1' });
      store().selectWorkspace('w', 't1');
      expect(useAgentAttentionStore.getState().seenByTerminalId.t1.completion).toBe(5);
      expect(workspace().minimizedPanes).toEqual([]);
    } finally { dispose(); }
  });
  it('caps page creation and direct missing-page commands are harmless', () => {
    open(); for (let i = 0; i < 20; i++) store().addWorkspacePage('w');
    expect(workspace().pages).toHaveLength(9);
    executeWorkspacePageCommand('workspace.page1'); expect(workspace().activePageId).toBe(firstPage().id);
    executeWorkspacePageCommand('workspace.pagePrevious'); expect(workspace().activePageId).toBe(workspace().pages![8].id);
    executeWorkspacePageCommand('workspace.pageNext'); expect(workspace().activePageId).toBe(firstPage().id);
  });
});

describe('page-aware Browser and asynchronous resource ownership', () => {
  it('hides the native Browser on inactive/minimized/occluded pages without losing tabs', () => {
    open(); store().setBrowserVisible(true, 'w'); const browser = workspace().browserPane!;
    const { rerender } = render(<BrowserLifecycleCoordinator activeOwnerId="w" />);
    expect(workspaceBrowserPresented(workspace())).toBe(true);
    act(() => store().addWorkspacePage('w')); rerender(<BrowserLifecycleCoordinator activeOwnerId="w" />);
    expect(window.electronAPI.browserHide).toHaveBeenCalledWith('w');
    expect(workspace().browserPane).toBe(browser);
    act(() => store().toggleBrowser('w')); expect(workspaceBrowserPresented(workspace())).toBe(true);
    act(() => store().toggleMaximizedPane('w', 'p1')); expect(workspaceBrowserPresented(workspace())).toBe(false);
    act(() => store().toggleMaximizedPane('w', 'p1'));
    act(() => store().minimizeWorkspacePane('w', browser.id)); expect(workspaceBrowserPresented(workspace())).toBe(false);
    act(() => store().restoreWorkspacePane('w', browser.id)); expect(workspaceBrowserPresented(workspace())).toBe(true);
    expect(workspace().browserPane).toBe(browser);
    expect(window.electronAPI.browserDisposeWorkspace).not.toHaveBeenCalled();
  });
  it('keeps pending launch occupancy and attaches into the initiating page after switching', async () => {
    open({ terminals: [], panes: [], activeTerminalId: null }); const pageId = firstPage().id;
    const context = workspace().checkoutContexts![0];
    let finish!: (value: { id: string; pid: number; checkoutContextId: string }) => void;
    vi.mocked(window.electronAPI.spawnTerminal).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const launch = launchTerminalInCheckoutContext(workspace(), context, { harness: 'codex' });
    expect(firstPage().layoutRoot).not.toBeNull();
    store().addWorkspacePage('w'); const activeId = workspace().activePageId;
    store().removeWorkspacePage('w', pageId); expect(workspace().pages).toHaveLength(2);
    finish({ id: 'spawned', pid: 42, checkoutContextId: context.id }); await launch;
    expect(workspace().activePageId).toBe(activeId); expect(workspace().layoutRoot).toBeNull();
    expect(firstPage().layoutRoot?.type).toBe('leaf');
    expect(workspace().panes).toEqual([expect.objectContaining({ terminalId: 'spawned' })]);
    expect(validateWorkspaceConsistency(store())).toEqual([]);
  });
  it('retains a minimized entry when explicit process cleanup fails', async () => {
    open(); store().minimizeWorkspacePane('w', 'p1');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(window.electronAPI.killTerminal).mockRejectedValueOnce(new Error('cleanup failed'));
    try {
      await closeWorkspaceTerminal('w', 't1');
      expect(workspace().terminals.some((terminal) => terminal.id === 't1')).toBe(true);
      expect(workspace().minimizedPanes?.map((entry) => entry.paneId)).toEqual(['p1']);
      expect(window.electronAPI.releaseCheckoutContext).not.toHaveBeenCalled();
    } finally { error.mockRestore(); }
  });
  it('cleans failed spawn reservations without changing another page', async () => {
    open({ terminals: [], panes: [], activeTerminalId: null });
    vi.mocked(window.electronAPI.spawnTerminal).mockRejectedValueOnce(new Error('spawn failed'));
    const pending = launchTerminalInCheckoutContext(workspace(), workspace().checkoutContexts![0]);
    store().addWorkspacePage('w'); await expect(pending).rejects.toThrow('spawn failed');
    expect(workspace().panes).toEqual([]); expect(firstPage().layoutRoot).toBeNull();
  });
  it('closes a minimized terminal in its original workspace after switching during kill', async () => {
    open(); store().minimizeWorkspacePane('w', 'p1');
    let finish!: () => void;
    vi.mocked(window.electronAPI.killTerminal).mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ success: true }); }));
    const closing = closeWorkspaceTerminal('w', 't1');
    store().addWorkspace(createWorkspaceFixture({ id: 'other' })); const other = store().getWorkspaceById('other')!;
    finish(); await closing;
    expect(workspace().terminals.map((terminal) => terminal.id)).toEqual(['t2']);
    expect(workspace().minimizedPanes).toEqual([]);
    expect(store().getWorkspaceById('other')!.terminals).toEqual(other.terminals);
    expect(store().activeWorkspaceId).toBe('other');
  });

  it('manages multiple minimized agents and restores them independently', () => {
    open();
    store().minimizeWorkspacePane('w', 'p1');
    store().minimizeWorkspacePane('w', 'p2');
    expect(workspace().minimizedPanes).toHaveLength(2);
    expect(workspace().minimizedPanes?.map((e) => e.paneId)).toEqual(['p1', 'p2']);

    // Restore t2 first
    store().selectWorkspace('w', 't2');
    expect(workspace().minimizedPanes?.map((e) => e.paneId)).toEqual(['p1']);
    expect(collectLeafPaneIds(workspace().layoutRoot)).toContain('p2');
    expect(workspace().activeTerminalId).toBe('t2');

    // Restore t1 next
    store().selectWorkspace('w', 't1');
    expect(workspace().minimizedPanes).toEqual([]);
    expect(collectLeafPaneIds(workspace().layoutRoot)).toContain('p1');
    expect(workspace().activeTerminalId).toBe('t1');
  });

  it('restores minimized utility panes (Browser, Editor, Notes) via their toggle actions', () => {
    open();
    // Browser restoration
    store().setBrowserVisible(true, 'w');
    const browserId = workspace().browserPane!.id;
    expect(workspaceBrowserPresented(workspace())).toBe(true);
    store().minimizeWorkspacePane('w', browserId);
    expect(workspaceBrowserPresented(workspace())).toBe(false);
    expect(workspace().browserVisible).toBe(true);
    store().toggleBrowser('w');
    expect(workspaceBrowserPresented(workspace())).toBe(true);
    expect(workspace().minimizedPanes?.some((e) => e.paneId === browserId)).toBe(false);

    // Notes restoration
    store().toggleNotesPane();
    const notesId = workspace().notesPane!.id;
    expect(collectLeafPaneIds(workspace().layoutRoot)).toContain(notesId);
    store().minimizeWorkspacePane('w', notesId);
    expect(collectLeafPaneIds(workspace().layoutRoot)).not.toContain(notesId);
    expect(workspace().notesVisible).toBe(true);
    store().toggleNotesPane();
    expect(collectLeafPaneIds(workspace().layoutRoot)).toContain(notesId);
    expect(workspace().minimizedPanes?.some((e) => e.paneId === notesId)).toBe(false);

    // Editor restoration
    const editorId = 'ed-test';
    useWorkspaceStore.setState((state) => ({
      ...state,
      workspaces: state.workspaces.map((ws) => ws.id === 'w' ? {
        ...ws,
        editorVisible: true,
        editorPane: { id: editorId },
        editorTabs: [{ id: 'tab1', filePath: '/test.ts', fileName: 'test.ts', isDirty: false, content: '', originalContent: '' }],
        layoutRoot: {
          type: 'split',
          nodeId: 'split-ed',
          orientation: 'horizontal',
          ratio: 0.5,
          first: ws.layoutRoot!,
          second: { type: 'leaf', nodeId: 'leaf-ed', paneId: editorId },
        },
      } : ws),
    }));
    expect(collectLeafPaneIds(workspace().layoutRoot)).toContain(editorId);
    store().minimizeWorkspacePane('w', editorId);
    expect(collectLeafPaneIds(workspace().layoutRoot)).not.toContain(editorId);
    expect(workspace().editorVisible).toBe(true);
    store().toggleEditorPane();
    expect(collectLeafPaneIds(workspace().layoutRoot)).toContain(editorId);
    expect(workspace().minimizedPanes?.some((e) => e.paneId === editorId)).toBe(false);
  });

  it('keeps native Browser visible when another pane is minimized or restored', () => {
    open();
    store().setBrowserVisible(true, 'w');
    const browserId = workspace().browserPane!.id;
    render(<BrowserLifecycleCoordinator activeOwnerId="w" />);
    vi.mocked(window.electronAPI.browserHide).mockClear();

    expect(workspaceBrowserPresented(workspace())).toBe(true);
    // Minimize agent pane p1
    act(() => store().minimizeWorkspacePane('w', 'p1'));
    expect(workspaceBrowserPresented(workspace())).toBe(true);
    // browserHide must NOT be called for workspace 'w' because Browser is still presented
    expect(vi.mocked(window.electronAPI.browserHide)).not.toHaveBeenCalledWith('w');

    // Restore agent pane p1
    act(() => store().selectWorkspace('w', 't1'));
    expect(workspaceBrowserPresented(workspace())).toBe(true);
    expect(collectLeafPaneIds(workspace().layoutRoot)).toContain('p1');
    expect(collectLeafPaneIds(workspace().layoutRoot)).toContain(browserId);
    expect(vi.mocked(window.electronAPI.browserHide)).not.toHaveBeenCalledWith('w');
  });

  it('handles maximize and minimize transitions without stale presentation state', () => {
    open();
    store().setBrowserVisible(true, 'w');
    expect(workspaceBrowserPresented(workspace())).toBe(true);

    // Maximize agent pane p1 occludes browser
    store().toggleMaximizedPane('w', 'p1');
    expect(workspaceBrowserPresented(workspace())).toBe(false);

    // Minimizing p1 while maximized clears maximize state and unhides browser
    store().minimizeWorkspacePane('w', 'p1');
    expect(activePage(workspace())?.maximizedPaneId).toBeUndefined();
    expect(workspaceBrowserPresented(workspace())).toBe(true);
    expect(collectLeafPaneIds(workspace().layoutRoot)).not.toContain('p1');

    // Restoring p1 returns it to layout without maximizing it
    store().selectWorkspace('w', 't1');
    expect(workspaceBrowserPresented(workspace())).toBe(true);
    expect(activePage(workspace())?.maximizedPaneId).toBeUndefined();
    expect(collectLeafPaneIds(workspace().layoutRoot)).toContain('p1');
  });

  it('minimizes and restores an empty Editor pane without tabs or duplicate panes', () => {
    open();
    // Open an empty Editor pane
    store().toggleEditorPane();
    const edId = workspace().editorPane!.id;
    expect(collectLeafPaneIds(workspace().layoutRoot)).toContain(edId);
    expect(workspace().editorTabs).toEqual([]);

    // Minimize empty Editor pane
    store().minimizeWorkspacePane('w', edId);
    expect(collectLeafPaneIds(workspace().layoutRoot)).not.toContain(edId);
    expect(workspace().minimizedPanes?.some((e) => e.paneId === edId)).toBe(true);
    expect(workspace().editorVisible).toBe(true);

    // Restore empty Editor pane via toggleEditorPane
    store().toggleEditorPane();
    expect(collectLeafPaneIds(workspace().layoutRoot)).toContain(edId);
    expect(workspace().editorPane?.id).toBe(edId);
    expect(workspace().minimizedPanes?.some((e) => e.paneId === edId)).toBe(false);
  });

  it('preserves dirty editor buffers through minimize and restore', () => {
    open();
    const editorId = 'ed-dirty';
    useWorkspaceStore.setState((state) => ({
      ...state,
      workspaces: state.workspaces.map((ws) => ws.id === 'w' ? {
        ...ws,
        editorVisible: true,
        editorPane: { id: editorId },
        editorTabs: [{ id: 'tab1', filePath: '/test.ts', fileName: 'test.ts', isDirty: true, content: 'modified text', originalContent: 'original text' }],
        activeEditorTabId: 'tab1',
        layoutRoot: {
          type: 'split',
          nodeId: 'split-dirty',
          orientation: 'horizontal',
          ratio: 0.5,
          first: ws.layoutRoot!,
          second: { type: 'leaf', nodeId: 'leaf-dirty', paneId: editorId },
        },
      } : ws),
    }));

    // Minimize
    store().minimizeWorkspacePane('w', editorId);
    expect(collectLeafPaneIds(workspace().layoutRoot)).not.toContain(editorId);

    // Restore
    store().toggleEditorPane();
    expect(collectLeafPaneIds(workspace().layoutRoot)).toContain(editorId);
    const tab = workspace().editorTabs.find((t) => t.id === 'tab1');
    expect(tab).toBeDefined();
    expect(tab?.isDirty).toBe(true);
    expect(tab?.content).toBe('modified text');
    expect(tab?.originalContent).toBe('original text');
  });

  it('verifies Browser overlay count and visibility during and after minimize and restore', () => {
    open();
    store().setBrowserVisible(true, 'w');
    const browserId = workspace().browserPane!.id;
    expect(workspaceBrowserPresented(workspace())).toBe(true);
    expect(workspace().browserOverlayCount).toBe(0);

    // Minimize browser
    store().minimizeWorkspacePane('w', browserId);
    expect(workspaceBrowserPresented(workspace())).toBe(false);
    expect(workspace().browserOverlayCount).toBe(0);

    // Restore browser
    store().toggleBrowser('w');
    expect(workspaceBrowserPresented(workspace())).toBe(true);
    expect(workspace().browserOverlayCount).toBe(0);
  });
});
