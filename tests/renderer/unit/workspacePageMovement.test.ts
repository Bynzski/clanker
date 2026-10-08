// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore, validateWorkspaceConsistency } from '../../../src/renderer/store/workspaceStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { collectLeafPaneIds } from '../../../src/renderer/store/workspaceLayout';
import { workspaceBrowserPresented } from '../../../src/renderer/store/workspacePages';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

const store = () => useWorkspaceStore.getState();
const workspace = () => store().getWorkspaceById('w')!;
const members = () => workspace().pages!.flatMap(page => collectLeafPaneIds(page.layoutRoot));
function open() {
  store().addWorkspace(createWorkspaceFixture({ id: 'w', terminals: [
    { id: 't1', pid: 11, workingDir: '/workspace', checkoutContextId: 'w::main' },
    { id: 't2', pid: 12, workingDir: '/workspace', checkoutContextId: 'w::main' },
  ], panes: [{ id: 'p1', terminalId: 't1' }, { id: 'p2', terminalId: 't2' }], activeTerminalId: 't1' }));
  return workspace().activePageId!;
}
function destination() { store().addWorkspacePage('w'); return workspace().activePageId!; }
beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useAssistantNavStore.setState({ activeAssistantId: null });
  installElectronApiMock();
});

describe('pane movement between pages in one workspace', () => {
  it('moves to an empty page, selects/focuses the agent and keeps exact terminal/pane identity', () => {
    const source = open(); const terminals = workspace().terminals; const panes = workspace().panes;
    const target = destination(); store().selectWorkspacePage('w', source);
    store().movePaneToWorkspacePage('w', 'p1', target, source);
    expect(workspace().activePageId).toBe(target);
    expect(workspace().activeTerminalId).toBe('t1');
    expect(collectLeafPaneIds(workspace().layoutRoot)).toEqual(['p1']);
    expect(collectLeafPaneIds(workspace().pages!.find(page => page.id === source)!.layoutRoot)).toEqual(['p2']);
    expect(workspace().terminals).toBe(terminals); expect(workspace().panes).toBe(panes);
    expect(members().filter(id => id === 'p1')).toHaveLength(1);
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
    expect(window.electronAPI.killTerminal).not.toHaveBeenCalled();
    expect(validateWorkspaceConsistency(store())).toEqual([]);
  });
  it('inserts into a populated destination and clears only its presentation maximize state', () => {
    const source = open(); const target = destination();
    store().addTerminal({ id: 't3', pid: 13, workingDir: '/workspace' }, 'w');
    const p3 = workspace().panes.find(pane => pane.terminalId === 't3')!.id;
    store().toggleMaximizedPane('w', p3);
    store().selectWorkspacePage('w', source);
    store().movePaneToWorkspacePage('w', 'p1', target, source);
    expect(new Set(collectLeafPaneIds(workspace().layoutRoot))).toEqual(new Set(['p1', p3]));
    expect(workspace().pages!.find(page => page.id === target)!.maximizedPaneId).toBeUndefined();
    expect(workspace().terminals.map(terminal => terminal.pid)).toEqual([11, 12, 13]);
    store().selectWorkspacePage('w', source); store().undoLayout('w'); store().fitAllPanes();
    expect(collectLeafPaneIds(workspace().layoutRoot)).toEqual(['p2']);
    expect(members().filter(id => id === 'p1')).toHaveLength(1);
    expect(validateWorkspaceConsistency(store())).toEqual([]);
  });
  it('creates one destination page for a + drop and refuses a tenth without losing the source', () => {
    const source = open();
    store().movePaneToWorkspacePage('w', 'p1', undefined, source);
    expect(workspace().pages).toHaveLength(2); expect(workspace().activePageId).not.toBe(source);
    expect(collectLeafPaneIds(workspace().layoutRoot)).toEqual(['p1']);
    while (workspace().pages!.length < 9) store().addWorkspacePage('w');
    store().selectWorkspacePage('w', source);
    const root = workspace().layoutRoot;
    store().movePaneToWorkspacePage('w', 'p2', undefined, source);
    expect(workspace().pages).toHaveLength(9); expect(workspace().layoutRoot).toBe(root);
    expect(workspace().activePageId).toBe(source); expect(workspace().panes).toHaveLength(2);
    expect(validateWorkspaceConsistency(store())).toEqual([]);
  });
  it('preserves Browser tabs/native selection rather than creating or disposing any Browser resource', () => {
    const source = open(); store().toggleBrowser();
    const browser = workspace().browserPane!; const target = destination();
    store().selectWorkspacePage('w', source);
    store().movePaneToWorkspacePage('w', browser.id, target, source);
    expect(workspace().browserPane).toBe(browser); expect(workspace().browserVisible).toBe(true);
    expect(workspaceBrowserPresented(workspace())).toBe(true);
    expect(members().filter(id => id === browser.id)).toHaveLength(1);
    expect(window.electronAPI.browserCreateTab).not.toHaveBeenCalled();
    expect(window.electronAPI.browserDisposeWorkspace).not.toHaveBeenCalled();
    expect(validateWorkspaceConsistency(store())).toEqual([]);
  });
  it('preserves dirty pinned editor buffers and notes identity when moving utility panes', async () => {
    const source = open(); await store().openFileInEditor('/workspace/file.ts', 'w');
    store().updateEditorContent(workspace().editorTabs[0].id, 'unsaved', 'w');
    store().toggleNotesPane();
    const editor = workspace().editorPane!; const tabs = workspace().editorTabs; const notes = workspace().notesPane!;
    const target = destination(); store().selectWorkspacePage('w', source);
    store().movePaneToWorkspacePage('w', editor.id, target, source);
    expect(workspace().editorTabs).toBe(tabs); expect(workspace().editorTabs[0].isDirty).toBe(true);
    expect(workspace().fileSurfaceContextId).toBeUndefined(); // The editor reasserts pinned context on explicit focus.
    store().selectWorkspacePage('w', source);
    store().movePaneToWorkspacePage('w', notes.id, target, source);
    expect(workspace().notesPane).toBe(notes); expect(workspace().editorTabs).toBe(tabs);
    expect(members().filter(id => id === notes.id)).toHaveLength(1);
    expect(window.electronAPI.editorWriteFile).not.toHaveBeenCalled();
    expect(validateWorkspaceConsistency(store())).toEqual([]);
  });
  it('refuses stale, missing, foreign, minimized, pending and maximized sources', () => {
    const source = open(); const target = destination();
    store().movePaneToWorkspacePage('w', 'p1', target, source); // source is no longer selected
    expect(workspace().activePageId).toBe(target); expect(workspace().layoutRoot).toBeNull();
    store().selectWorkspacePage('w', source);
    store().movePaneToWorkspacePage('w', 'p1', 'another-workspace::page', source);
    store().movePaneToWorkspacePage('another-workspace', 'p1', target, source);
    expect(collectLeafPaneIds(workspace().layoutRoot)).toEqual(['p1', 'p2']);
    const pending = store().addPane(null, undefined, 'w')!;
    store().movePaneToWorkspacePage('w', pending, target, source);
    expect(collectLeafPaneIds(workspace().pages!.find(page => page.id === target)!.layoutRoot)).toEqual([]);
    store().minimizeWorkspacePane('w', 'p1'); store().movePaneToWorkspacePage('w', 'p1', target, source);
    expect(workspace().minimizedPanes?.[0].pageId).toBe(source);
    store().toggleMaximizedPane('w', 'p2'); store().movePaneToWorkspacePage('w', 'p2', target, source);
    expect(workspace().activePageId).toBe(source);
    useAssistantNavStore.setState({ activeAssistantId: 'hermes:bot' });
    store().movePaneToWorkspacePage('w', 'p2', target, source);
    expect(workspace().activePageId).toBe(source);
    expect(validateWorkspaceConsistency(store())).toEqual([]);
  });
});
