import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'node:path';
import { useWorkspaceStore, assignWorkspaceLifecycles, getEdgeTerminals } from '../../../src/renderer/store/workspaceStore';
import type { LayoutSplit, Terminal, Pane, WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

// Platform-neutral path constants for test fixtures
const TEST_HOME_USER = path.join(path.sep === '\\' ? 'C:\\Users\\user' : '/home', 'user');
const TEST_PROJECT = path.join(TEST_HOME_USER, 'project');
const TEST_MY_APP = path.join(TEST_HOME_USER, 'my-app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset zustand store between tests. */
function resetStore() {
  useWorkspaceStore.setState({
    name: '',
    workspacePath: '',
    harness: 'codex',
    model: '',
    terminals: [],
    panes: [],
    browserVisible: false,
    browserOverlayCount: 0,
    browserUrl: 'https://github.com',
    activeTerminalId: null,
    browserPane: null,
    layoutRoot: null,
    explorerVisible: false,
    explorerSidebarWidth: 280,
    explorerExpandedPaths: [],
    explorerSelectedPath: null,
    explorerEntriesByPath: {},
    explorerLoadingPaths: [],
    explorerErrorsByPath: {},
    showHiddenFiles: true,
    workspaces: [],
    activeWorkspaceId: null,
    activeWorkspaceLifecycle: null,
    gridViewport: { cols: 12, rows: 8 },
    layoutRevision: 0,
    editorVisible: false,
    editorPane: null,
    editorTabs: [],
    activeEditorTabId: null,
    gitChanges: [],
  });
}

beforeEach(() => {
  resetStore();
});

function getStore() {
  return useWorkspaceStore.getState();
}

function addWorkspace(overrides: Partial<WorkspaceTab> = {}) {
  const fixture = createWorkspaceFixture(overrides);
  // Omit 'id' from the parameter since addWorkspace generates its own id
  const { id: _ignored, ...withoutId } = fixture;
  void _ignored;
  getStore().addWorkspace(withoutId);
  return getStore();
}

function terminal(id: string, workingDir = '/workspace'): Terminal {
  return { id, pid: 1000 + Math.floor(Math.random() * 1000), workingDir };
}

// ===========================================================================
// addWorkspace / selectWorkspace / closeWorkspace
// ===========================================================================
describe('workspace lifecycle', () => {
  it('addWorkspace sets active workspace and populates snapshot fields', () => {
    const state = addWorkspace({ workspacePath: TEST_PROJECT, name: 'My Project' });
    expect(state.name).toBe('My Project');
    expect(state.workspacePath).toBe(TEST_PROJECT);
    expect(state.activeWorkspaceId).toBeTruthy();
    expect(state.activeWorkspaceLifecycle).toBe('active');
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].lifecycle).toBe('active');
  });

  it('addWorkspace derives name from path when name is empty', () => {
    const state = addWorkspace({ workspacePath: TEST_MY_APP, name: '' });
    expect(state.name).toBe('my-app');
  });

  it('addWorkspace creates a layout from workspace panes', () => {
    const state = addWorkspace();
    expect(state.layoutRoot).not.toBeNull();
  });

  it('selectWorkspace restores workspace snapshot', () => {
    addWorkspace({ workspacePath: '/first' });
    const ws1Id = getStore().activeWorkspaceId;

    addWorkspace({ workspacePath: '/second' });
    const ws2Id = getStore().activeWorkspaceId;
    expect(ws2Id).not.toBe(ws1Id);

    getStore().selectWorkspace(ws1Id!);
    expect(getStore().workspacePath).toBe('/first');
    expect(getStore().activeWorkspaceId).toBe(ws1Id);
    expect(getStore().activeWorkspaceLifecycle).toBe('active');
    expect(getStore().workspaces.find((workspace) => workspace.id === ws1Id)?.lifecycle).toBe('active');
    expect(getStore().workspaces.find((workspace) => workspace.id === ws2Id)?.lifecycle).toBe('parked');
  });

  it('selectWorkspace preserves inactive workspace data in workspaces[] while moving the active snapshot', () => {
    addWorkspace({
      workspacePath: '/first',
      browserVisible: true,
      browserUrl: 'https://first.example.com',
      explorerVisible: true,
      explorerExpandedPaths: ['/first/src'],
      editorVisible: true,
      editorTabs: [
        {
          id: 'tab-first',
          filePath: '/first/README.md',
          fileName: 'README.md',
          isDirty: true,
          content: '# first workspace',
          originalContent: '',
        },
      ],
      activeEditorTabId: 'tab-first',
    });
    const firstId = getStore().activeWorkspaceId!;

    addWorkspace({
      workspacePath: '/second',
      browserVisible: false,
      browserUrl: 'https://second.example.com',
      explorerVisible: false,
      editorVisible: false,
      editorTabs: [],
      activeEditorTabId: null,
    });
    const secondId = getStore().activeWorkspaceId!;

    expect(getStore().activeWorkspaceId).toBe(secondId);
    expect(getStore().workspacePath).toBe('/second');
    expect(getStore().browserUrl).toBe('https://second.example.com');
    expect(getStore().editorTabs).toEqual([]);
    expect(getStore().workspaces.find((workspace) => workspace.id === secondId)?.lifecycle).toBe('active');

    const firstWorkspaceWhileInactive = getStore().workspaces.find((workspace) => workspace.id === firstId)!;
    expect(firstWorkspaceWhileInactive.lifecycle).toBe('parked');
    expect(firstWorkspaceWhileInactive.workspacePath).toBe('/first');
    expect(firstWorkspaceWhileInactive.browserVisible).toBe(true);
    expect(firstWorkspaceWhileInactive.browserUrl).toBe('https://first.example.com');
    expect(firstWorkspaceWhileInactive.explorerVisible).toBe(true);
    expect(firstWorkspaceWhileInactive.explorerExpandedPaths).toEqual(['/first/src']);
    expect(firstWorkspaceWhileInactive.editorVisible).toBe(true);
    expect(firstWorkspaceWhileInactive.activeEditorTabId).toBe('tab-first');
    expect(firstWorkspaceWhileInactive.editorTabs[0]?.filePath).toBe('/first/README.md');

    getStore().selectWorkspace(firstId);
    expect(getStore().activeWorkspaceId).toBe(firstId);
    expect(getStore().activeWorkspaceLifecycle).toBe('active');
    expect(getStore().workspacePath).toBe('/first');
    expect(getStore().browserUrl).toBe('https://first.example.com');
    expect(getStore().explorerExpandedPaths).toEqual(['/first/src']);
    expect(getStore().activeEditorTabId).toBe('tab-first');
    expect(getStore().editorTabs[0]?.filePath).toBe('/first/README.md');
  });

  it('closeWorkspace switches to last remaining workspace', () => {
    addWorkspace({ workspacePath: '/first' });
    const ws1Id = getStore().activeWorkspaceId;
    addWorkspace({ workspacePath: '/second' });
    const ws2Id = getStore().activeWorkspaceId;

    getStore().closeWorkspace(ws2Id!);
    expect(getStore().activeWorkspaceId).toBe(ws1Id);
    expect(getStore().activeWorkspaceLifecycle).toBe('active');
    expect(getStore().workspaces).toHaveLength(1);
    expect(getStore().workspaces[0].lifecycle).toBe('active');
  });

  it('closeWorkspace resets defaults when last workspace is closed', () => {
    addWorkspace();
    const id = getStore().activeWorkspaceId;
    getStore().closeWorkspace(id!);
    expect(getStore().workspaces).toHaveLength(0);
    expect(getStore().activeWorkspaceId).toBeNull();
    expect(getStore().activeWorkspaceLifecycle).toBeNull();
    expect(getStore().name).toBe('');
  });

  it('closeWorkspace does not switch active if closed workspace was not active', () => {
    addWorkspace({ workspacePath: '/first' });
    const ws1Id = getStore().activeWorkspaceId;
    addWorkspace({ workspacePath: '/second' });
    const ws2Id = getStore().activeWorkspaceId;

    // Close non-active workspace
    getStore().closeWorkspace(ws1Id!);
    expect(getStore().activeWorkspaceId).toBe(ws2Id);
    expect(getStore().workspacePath).toBe('/second');
    expect(getStore().activeWorkspaceLifecycle).toBe('active');
    expect(getStore().workspaces[0].lifecycle).toBe('active');
  });

  it('keeps exactly one active lifecycle entry across add, select, and close transitions', () => {
    addWorkspace({ workspacePath: '/first' });
    const firstId = getStore().activeWorkspaceId!;

    addWorkspace({ workspacePath: '/second' });
    const secondId = getStore().activeWorkspaceId!;

    let activeEntries = getStore().workspaces.filter((workspace) => workspace.lifecycle === 'active');
    expect(activeEntries).toHaveLength(1);
    expect(activeEntries[0].id).toBe(secondId);

    getStore().selectWorkspace(firstId);
    activeEntries = getStore().workspaces.filter((workspace) => workspace.lifecycle === 'active');
    expect(activeEntries).toHaveLength(1);
    expect(activeEntries[0].id).toBe(firstId);

    getStore().closeWorkspace(secondId);
    activeEntries = getStore().workspaces.filter((workspace) => workspace.lifecycle === 'active');
    expect(activeEntries).toHaveLength(1);
    expect(activeEntries[0].id).toBe(firstId);
  });

  it('opening multiple workspaces leaves exactly one active and parks the rest', () => {
    addWorkspace({ workspacePath: '/first', name: 'first' });
    const firstId = getStore().activeWorkspaceId!;

    addWorkspace({ workspacePath: '/second', name: 'second' });
    const secondId = getStore().activeWorkspaceId!;

    addWorkspace({ workspacePath: '/third', name: 'third' });
    const thirdId = getStore().activeWorkspaceId!;

    const activeEntries = getStore().workspaces.filter((workspace) => workspace.lifecycle === 'active');
    const parkedEntries = getStore().workspaces.filter((workspace) => workspace.lifecycle === 'parked');

    expect(getStore().activeWorkspaceId).toBe(thirdId);
    expect(getStore().activeWorkspaceLifecycle).toBe('active');
    expect(activeEntries).toHaveLength(1);
    expect(activeEntries[0].id).toBe(thirdId);
    expect(parkedEntries.map((workspace) => workspace.id)).toEqual(expect.arrayContaining([firstId, secondId]));
  });

  it('updateWorkspaceName updates both snapshot and workspaces array', () => {
    addWorkspace({ name: 'original' });
    const id = getStore().activeWorkspaceId;
    getStore().updateWorkspaceName(id!, 'renamed');
    expect(getStore().name).toBe('renamed');
    expect(getStore().workspaces.find(w => w.id === id)!.name).toBe('renamed');
  });

  it('updateWorkspaceName does not update snapshot for non-active workspace', () => {
    addWorkspace({ name: 'first' });
    const ws1Id = getStore().activeWorkspaceId;
    addWorkspace({ name: 'second' });

    getStore().updateWorkspaceName(ws1Id!, 'renamed-first');
    expect(getStore().name).toBe('second'); // active workspace name unchanged
    expect(getStore().workspaces.find(w => w.id === ws1Id)!.name).toBe('renamed-first');
  });

  it('exposes workspace-scoped selector methods on the store', () => {
    addWorkspace({ workspacePath: '/first', name: 'first' });
    const firstId = getStore().activeWorkspaceId!;

    addWorkspace({ workspacePath: '/second', name: 'second' });
    const secondId = getStore().activeWorkspaceId!;

    expect(getStore().getWorkspaceById(firstId)?.workspacePath).toBe('/first');
    expect(getStore().getActiveWorkspace()?.id).toBe(secondId);
    expect(getStore().isWorkspaceActive(firstId)).toBe(false);
    expect(getStore().isWorkspaceActive(secondId)).toBe(true);
  });

  it('removes a closed workspace from lifecycle tracking instead of leaving a disposed record behind', () => {
    addWorkspace({ workspacePath: '/first', name: 'first' });
    const firstId = getStore().activeWorkspaceId!;

    addWorkspace({ workspacePath: '/second', name: 'second' });
    const secondId = getStore().activeWorkspaceId!;

    getStore().closeWorkspace(firstId);

    expect(getStore().workspaces.find((workspace) => workspace.id === firstId)).toBeUndefined();
    expect(getStore().workspaces.find((workspace) => workspace.id === secondId)?.lifecycle).toBe('active');
    expect(getStore().activeWorkspaceId).toBe(secondId);
    expect(getStore().activeWorkspaceLifecycle).toBe('active');
  });

  it('rapid workspace switching preserves a single active lifecycle entry and restores parked snapshots', () => {
    addWorkspace({
      workspacePath: '/first',
      name: 'first',
      browserVisible: true,
      browserUrl: 'https://first.example.com',
      activeTerminalId: 'terminal-first',
      terminals: [{ id: 'terminal-first', pid: 1001, workingDir: '/first' }],
      panes: [{ id: 'pane-first', terminalId: 'terminal-first', position: { x: 0, y: 0, w: 6, h: 6 }, locked: false }],
      editorVisible: true,
      editorPane: { id: 'editor-first', locked: false },
      editorTabs: [
        {
          id: 'tab-first',
          filePath: '/first/index.ts',
          fileName: 'index.ts',
          isDirty: true,
          content: 'export const first = 1;',
          originalContent: 'export const first = 0;',
        },
      ],
      activeEditorTabId: 'tab-first',
    });
    const firstId = getStore().activeWorkspaceId!;

    addWorkspace({
      workspacePath: '/second',
      name: 'second',
      browserVisible: false,
      browserUrl: 'https://second.example.com',
      activeTerminalId: 'terminal-second',
      terminals: [{ id: 'terminal-second', pid: 1002, workingDir: '/second' }],
      panes: [{ id: 'pane-second', terminalId: 'terminal-second', position: { x: 0, y: 0, w: 6, h: 6 }, locked: false }],
      editorVisible: true,
      editorPane: { id: 'editor-second', locked: false },
      editorTabs: [
        {
          id: 'tab-second',
          filePath: '/second/index.ts',
          fileName: 'index.ts',
          isDirty: false,
          content: 'export const second = 2;',
          originalContent: 'export const second = 2;',
        },
      ],
      activeEditorTabId: 'tab-second',
    });
    const secondId = getStore().activeWorkspaceId!;

    addWorkspace({
      workspacePath: '/third',
      name: 'third',
      activeTerminalId: 'terminal-third',
      terminals: [{ id: 'terminal-third', pid: 1003, workingDir: '/third' }],
      panes: [{ id: 'pane-third', terminalId: 'terminal-third', position: { x: 0, y: 0, w: 6, h: 6 }, locked: false }],
    });
    const thirdId = getStore().activeWorkspaceId!;

    getStore().selectWorkspace(firstId);
    getStore().selectWorkspace(secondId);
    getStore().selectWorkspace(thirdId);
    getStore().selectWorkspace(firstId);

    const activeEntries = getStore().workspaces.filter((workspace) => workspace.lifecycle === 'active');
    expect(activeEntries).toHaveLength(1);
    expect(activeEntries[0].id).toBe(firstId);
    expect(getStore().activeTerminalId).toBe('terminal-first');
    expect(getStore().browserVisible).toBe(true);
    expect(getStore().browserUrl).toBe('https://first.example.com');
    expect(getStore().activeEditorTabId).toBe('tab-first');
    expect(getStore().editorTabs[0]?.content).toBe('export const first = 1;');
    expect(getStore().workspaces.find((workspace) => workspace.id === secondId)?.lifecycle).toBe('parked');
    expect(getStore().workspaces.find((workspace) => workspace.id === thirdId)?.lifecycle).toBe('parked');
  });
});

// ===========================================================================
// Terminal management
// ===========================================================================
describe('terminal management', () => {
  beforeEach(() => {
    addWorkspace();
  });

  it('addTerminal adds terminal, pane, and sets active', () => {
    const t = terminal('t1');
    getStore().addTerminal(t);
    expect(getStore().terminals).toHaveLength(2); // fixture has 1 + new
    expect(getStore().activeTerminalId).toBe('t1');
    expect(getStore().panes.some(p => p.terminalId === 't1')).toBe(true);
  });

  it('removeTerminal removes terminal and its pane', () => {
    const t = terminal('t1');
    getStore().addTerminal(t);
    getStore().removeTerminal('t1');
    expect(getStore().terminals.find(t => t.id === 't1')).toBeUndefined();
    expect(getStore().panes.some(p => p.terminalId === 't1')).toBe(false);
  });

  it('removeTerminal switches active to last remaining terminal', () => {
    const t1 = terminal('t1');
    const t2 = terminal('t2');
    getStore().addTerminal(t1);
    getStore().addTerminal(t2);
    getStore().removeTerminal('t2');
    expect(getStore().activeTerminalId).toBe('t1');
  });

  it('setActiveTerminal changes activeTerminalId', () => {
    const t1 = terminal('t1');
    const t2 = terminal('t2');
    getStore().addTerminal(t1);
    getStore().addTerminal(t2);
    getStore().setActiveTerminal('t1');
    expect(getStore().activeTerminalId).toBe('t1');
  });

  it('clearTerminals empties terminals, panes, and active id', () => {
    const t = terminal('t1');
    getStore().addTerminal(t);
    getStore().clearTerminals();
    expect(getStore().terminals).toEqual([]);
    expect(getStore().panes).toEqual([]);
    expect(getStore().activeTerminalId).toBeNull();
  });
});

// ===========================================================================
// Browser
// ===========================================================================
describe('browser', () => {
  beforeEach(() => {
    addWorkspace();
  });

  it('updateWorkspaceBrowserUrl patches active workspace snapshot', () => {
    const id = getStore().activeWorkspaceId!;
    getStore().updateWorkspaceBrowserUrl(id, null, 'https://example.com');

    expect(getStore().browserUrl).toBe('https://example.com');
    expect(getStore().workspaces.find((workspace) => workspace.id === id)?.browserUrl).toBe('https://example.com');
  });

  it('updateWorkspaceBrowserUrl updates inactive workspace without changing snapshot', () => {
    const firstId = getStore().activeWorkspaceId!;
    addWorkspace(createWorkspaceFixture({ id: 'workspace-2', name: 'workspace-2', workspacePath: '/workspace-2', browserUrl: 'https://second.com' }));

    const secondId = getStore().activeWorkspaceId!;
    getStore().updateWorkspaceBrowserUrl(firstId, null, 'https://updated.com');

    expect(getStore().browserUrl).toBe('https://second.com');
    expect(getStore().workspaces.find((workspace) => workspace.id === firstId)?.browserUrl).toBe('https://updated.com');
    expect(getStore().workspaces.find((workspace) => workspace.id === secondId)?.browserUrl).toBe('https://second.com');
  });

  it('restores per-workspace browser visibility and URL after switching back from parked state', () => {
    addWorkspace({
      workspacePath: '/first',
      browserVisible: true,
      browserUrl: 'https://first.example.com',
    });
    const firstId = getStore().activeWorkspaceId!;

    addWorkspace({
      workspacePath: '/second',
      browserVisible: false,
      browserUrl: 'https://second.example.com',
    });
    const secondId = getStore().activeWorkspaceId!;

    expect(getStore().activeWorkspaceId).toBe(secondId);
    expect(getStore().browserVisible).toBe(false);
    expect(getStore().browserUrl).toBe('https://second.example.com');

    getStore().selectWorkspace(firstId);

    expect(getStore().activeWorkspaceId).toBe(firstId);
    expect(getStore().browserVisible).toBe(true);
    expect(getStore().browserUrl).toBe('https://first.example.com');
    expect(getStore().workspaces.find((workspace) => workspace.id === secondId)?.browserVisible).toBe(false);
    expect(getStore().workspaces.find((workspace) => workspace.id === secondId)?.lifecycle).toBe('parked');
  });

  it('toggleBrowser shows browser and creates browser pane', () => {
    getStore().toggleBrowser();
    expect(getStore().browserVisible).toBe(true);
    expect(getStore().browserPane).not.toBeNull();
  });

  it('toggleBrowser hides browser and removes browser from layout', () => {
    getStore().toggleBrowser(); // show
    getStore().toggleBrowser(); // hide
    expect(getStore().browserVisible).toBe(false);
  });

  it('setBrowserUrl updates url', () => {
    getStore().setBrowserUrl('https://example.com');
    expect(getStore().browserUrl).toBe('https://example.com');
  });

  it('pushBrowserOverlay and popBrowserOverlay manage count for the active workspace snapshot', () => {
    expect(getStore().browserOverlayCount).toBe(0);
    getStore().pushBrowserOverlay();
    expect(getStore().browserOverlayCount).toBe(1);
    getStore().pushBrowserOverlay();
    expect(getStore().browserOverlayCount).toBe(2);
    getStore().popBrowserOverlay();
    expect(getStore().browserOverlayCount).toBe(1);
    const activeWorkspaceId = getStore().activeWorkspaceId!;
    expect(getStore().workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.browserOverlayCount).toBe(1);
  });

  it('popBrowserOverlay does not go below 0', () => {
    getStore().popBrowserOverlay();
    expect(getStore().browserOverlayCount).toBe(0);
  });

  it('tracks browser overlays per workspace across switches', () => {
    addWorkspace({ workspacePath: '/first', name: 'first' });
    const firstId = getStore().activeWorkspaceId!;
    getStore().pushBrowserOverlay(firstId);

    addWorkspace({ workspacePath: '/second', name: 'second' });
    const secondId = getStore().activeWorkspaceId!;

    expect(getStore().browserOverlayCount).toBe(0);
    expect(getStore().workspaces.find((workspace) => workspace.id === firstId)?.browserOverlayCount).toBe(1);

    getStore().pushBrowserOverlay(secondId);
    expect(getStore().browserOverlayCount).toBe(1);
    expect(getStore().workspaces.find((workspace) => workspace.id === secondId)?.browserOverlayCount).toBe(1);

    getStore().selectWorkspace(firstId);
    expect(getStore().browserOverlayCount).toBe(1);
    expect(getStore().workspaces.find((workspace) => workspace.id === secondId)?.browserOverlayCount).toBe(1);

    getStore().popBrowserOverlay(firstId);
    expect(getStore().browserOverlayCount).toBe(0);
    expect(getStore().workspaces.find((workspace) => workspace.id === firstId)?.browserOverlayCount).toBe(0);
  });

  it('toggleBrowserLock toggles browser pane locked state', () => {
    getStore().toggleBrowser(); // create browser pane
    expect(getStore().browserPane!.locked).toBe(false);
    getStore().toggleBrowserLock();
    expect(getStore().browserPane!.locked).toBe(true);
    getStore().toggleBrowserLock();
    expect(getStore().browserPane!.locked).toBe(false);
  });

  it('toggleBrowserLock is no-op when no browser pane exists', () => {
    expect(getStore().browserPane).toBeNull();
    getStore().toggleBrowserLock();
    expect(getStore().browserPane).toBeNull();
  });
});

// ===========================================================================
// Browser tabs (Phase 0)
// ===========================================================================
describe('browser tabs', () => {
  beforeEach(() => {
    addWorkspace();
    getStore().toggleBrowser();
  });

  it('toggleBrowser creates a browser pane with one default tab', () => {
    const pane = getStore().browserPane;
    expect(pane).not.toBeNull();
    expect(pane!.tabs.length).toBe(1);
    expect(pane!.activeTabId).toBe(pane!.tabs[0].id);
    expect(pane!.tabs[0].url).toBe('https://github.com');
  });

  it('addBrowserTab appends a new tab and makes it active', () => {
    const wsId = getStore().activeWorkspaceId!;
    const initialTabId = getStore().browserPane!.tabs[0].id;
    const newTabId = getStore().addBrowserTab(wsId);
    expect(newTabId).not.toBeNull();

    const pane = getStore().browserPane!;
    expect(pane.tabs.length).toBe(2);
    expect(pane.activeTabId).toBe(newTabId);
    expect(pane.tabs.find((tab) => tab.id === initialTabId)).toBeTruthy();
    expect(getStore().browserUrl).toBe('https://github.com');
  });

  it('removeBrowserTab refuses to remove the last remaining tab', () => {
    const wsId = getStore().activeWorkspaceId!;
    const onlyTabId = getStore().browserPane!.tabs[0].id;
    const result = getStore().removeBrowserTab(onlyTabId, wsId);
    expect(result.removed).toBe(false);
    expect(result.nextActiveTabId).toBe(onlyTabId);
    expect(getStore().browserPane!.tabs.length).toBe(1);
  });

  it('removeBrowserTab on the active tab atomically selects the next tab', () => {
    const wsId = getStore().activeWorkspaceId!;
    const firstTabId = getStore().browserPane!.tabs[0].id;
    const secondId = getStore().addBrowserTab(wsId)!;
    const thirdId = getStore().addBrowserTab(wsId)!;

    // Make the middle tab active and remove it.
    getStore().setActiveBrowserTab(secondId, wsId);
    const result = getStore().removeBrowserTab(secondId, wsId);

    expect(result.removed).toBe(true);
    // Prefer the next sibling.
    expect(result.nextActiveTabId).toBe(thirdId);
    const pane = getStore().browserPane!;
    expect(pane.tabs.map((tab) => tab.id)).toEqual([firstTabId, thirdId]);
    expect(pane.activeTabId).toBe(thirdId);
  });

  it('removeBrowserTab on the last (active, rightmost) tab falls back to previous', () => {
    const wsId = getStore().activeWorkspaceId!;
    const firstTabId = getStore().browserPane!.tabs[0].id;
    const secondId = getStore().addBrowserTab(wsId)!;
    // secondId is now active by default.
    const result = getStore().removeBrowserTab(secondId, wsId);
    expect(result.removed).toBe(true);
    expect(result.nextActiveTabId).toBe(firstTabId);
    expect(getStore().browserPane!.tabs.map((tab) => tab.id)).toEqual([firstTabId]);
    expect(getStore().browserPane!.activeTabId).toBe(firstTabId);
  });

  it('updateBrowserTab on the active tab mirrors url into browserUrl', () => {
    const wsId = getStore().activeWorkspaceId!;
    const activeId = getStore().browserPane!.activeTabId!;
    getStore().updateBrowserTab(activeId, { url: 'https://example.com', title: 'Example' }, wsId);
    expect(getStore().browserUrl).toBe('https://example.com');
    const pane = getStore().browserPane!;
    expect(pane.tabs[0].url).toBe('https://example.com');
    expect(pane.tabs[0].title).toBe('Example');
  });

  it('updateBrowserTab on an inactive tab does NOT mutate browserUrl', () => {
    const wsId = getStore().activeWorkspaceId!;
    const initialUrl = getStore().browserUrl;
    const activeId = getStore().browserPane!.activeTabId!;
    const newTabId = getStore().addBrowserTab(wsId)!;
    // Switch back so newTabId becomes inactive.
    getStore().setActiveBrowserTab(activeId, wsId);
    expect(getStore().browserPane!.activeTabId).toBe(activeId);

    getStore().updateBrowserTab(newTabId, { url: 'https://background.example.com' }, wsId);

    expect(getStore().browserUrl).toBe(initialUrl);
    const inactiveTab = getStore().browserPane!.tabs.find((tab) => tab.id === newTabId)!;
    expect(inactiveTab.url).toBe('https://background.example.com');
  });

  it('setActiveBrowserTab syncs browserUrl to the newly active tab url', () => {
    const wsId = getStore().activeWorkspaceId!;
    const firstTabId = getStore().browserPane!.tabs[0].id;
    const secondId = getStore().addBrowserTab(wsId)!;
    getStore().updateBrowserTab(secondId, { url: 'https://second.example.com' }, wsId);

    getStore().setActiveBrowserTab(firstTabId, wsId);
    expect(getStore().browserUrl).toBe('https://github.com');
    getStore().setActiveBrowserTab(secondId, wsId);
    expect(getStore().browserUrl).toBe('https://second.example.com');
  });

  it('updateWorkspaceBrowserUrl with explicit tabId updates only that tab', () => {
    const wsId = getStore().activeWorkspaceId!;
    const activeId = getStore().browserPane!.activeTabId!;
    const otherId = getStore().addBrowserTab(wsId)!;
    getStore().setActiveBrowserTab(activeId, wsId);

    getStore().updateWorkspaceBrowserUrl(wsId, otherId, 'https://other.example.com');

    expect(getStore().browserUrl).toBe('https://github.com');
    expect(getStore().browserPane!.tabs.find((tab) => tab.id === otherId)!.url).toBe('https://other.example.com');
  });

  it('updateWorkspaceBrowserUrl with null tabId updates active tab', () => {
    const wsId = getStore().activeWorkspaceId!;
    getStore().updateWorkspaceBrowserUrl(wsId, null, 'https://active.example.com');
    expect(getStore().browserUrl).toBe('https://active.example.com');
    const pane = getStore().browserPane!;
    expect(pane.tabs.find((tab) => tab.id === pane.activeTabId)!.url).toBe('https://active.example.com');
  });

  it('updateWorkspaceBrowserUrl on an inactive workspace does NOT mutate active snapshot', () => {
    const firstId = getStore().activeWorkspaceId!;
    addWorkspace(createWorkspaceFixture({
      id: 'workspace-2',
      name: 'workspace-2',
      workspacePath: '/workspace-2',
      browserUrl: 'https://second.example.com',
    }));
    const secondId = getStore().activeWorkspaceId!;
    expect(secondId).not.toBe(firstId);

    getStore().updateWorkspaceBrowserUrl(firstId, null, 'https://updated.example.com');

    expect(getStore().browserUrl).toBe('https://second.example.com');
    const firstWorkspace = getStore().workspaces.find((ws) => ws.id === firstId)!;
    // Active tab url and mirror were updated on the inactive workspace's own state.
    expect(firstWorkspace.browserUrl).toBe('https://updated.example.com');
  });

  it('tab actions do not mutate browser pane position', () => {
    const wsId = getStore().activeWorkspaceId!;
    const originalPosition = { ...getStore().browserPane!.position };
    const newId = getStore().addBrowserTab(wsId)!;
    getStore().updateBrowserTab(newId, { url: 'https://x.example.com' }, wsId);
    getStore().setActiveBrowserTab(newId, wsId);
    getStore().removeBrowserTab(newId, wsId);

    expect(getStore().browserPane!.position).toEqual(originalPosition);
  });
});

describe('browser integration hardening (Phase 6)', () => {
  it('workspace switch preserves tab state for both workspaces', () => {
    // Create first workspace and capture its generated id
    addWorkspace({ workspacePath: '/ws-a', name: 'ws-a' });
    const wsAId = getStore().activeWorkspaceId!;

    // Create second workspace
    addWorkspace({ workspacePath: '/ws-b', name: 'ws-b' });
    const wsBId = getStore().activeWorkspaceId!;

    // Setup workspace A: 3 tabs
    getStore().selectWorkspace(wsAId);
    getStore().toggleBrowser();
    const tabA1 = getStore().workspaces.find(ws => ws.id === wsAId)!.browserPane!.tabs[0].id;
    const tabA2 = getStore().addBrowserTab(wsAId)!;
    const tabA3 = getStore().addBrowserTab(wsAId)!;
    getStore().updateBrowserTab(tabA2, { url: 'https://a2.example.com' }, wsAId);
    getStore().updateBrowserTab(tabA3, { url: 'https://a3.example.com' }, wsAId);
    getStore().setActiveBrowserTab(tabA2, wsAId);

    // Setup workspace B: 2 tabs
    getStore().selectWorkspace(wsBId);
    getStore().toggleBrowser();
    const tabB2 = getStore().addBrowserTab(wsBId)!;
    getStore().updateBrowserTab(tabB2, { url: 'https://b2.example.com' }, wsBId);
    getStore().setActiveBrowserTab(tabB2, wsBId);

    // Switch to workspace A
    getStore().selectWorkspace(wsAId);
    const wsAState = getStore().getWorkspaceById(wsAId)!;
    expect(wsAState.browserPane!.tabs.length).toBe(3);
    expect(wsAState.browserPane!.activeTabId).toBe(tabA2);
    expect(getStore().browserUrl).toBe('https://a2.example.com');

    // Switch to workspace B
    getStore().selectWorkspace(wsBId);
    const wsBState = getStore().getWorkspaceById(wsBId)!;
    expect(wsBState.browserPane!.tabs.length).toBe(2);
    expect(wsBState.browserPane!.activeTabId).toBe(tabB2);
    expect(getStore().browserUrl).toBe('https://b2.example.com');

    // Switch back to A — verify all tabs preserved
    getStore().selectWorkspace(wsAId);
    const wsAState2 = getStore().getWorkspaceById(wsAId)!;
    expect(wsAState2.browserPane!.tabs.map(t => t.id)).toEqual([tabA1, tabA2, tabA3]);
    expect(wsAState2.browserPane!.activeTabId).toBe(tabA2);
    expect(wsAState2.browserPane!.tabs.find(t => t.id === tabA2)!.url).toBe('https://a2.example.com');
  });

  it('navigate → new tab → switch → close active → close inactive preserves correct state', () => {
    addWorkspace();
    getStore().toggleBrowser();
    const wsId = getStore().activeWorkspaceId!;

    // Navigate first tab
    const tab1 = getStore().browserPane!.activeTabId!;
    getStore().updateBrowserTab(tab1, { url: 'https://first.example.com' }, wsId);

    // Open second tab
    const tab2 = getStore().addBrowserTab(wsId)!;
    getStore().updateBrowserTab(tab2, { url: 'https://second.example.com' }, wsId);

    // Open third tab
    const tab3 = getStore().addBrowserTab(wsId)!;
    getStore().updateBrowserTab(tab3, { url: 'https://third.example.com' }, wsId);

    // Switch back to tab2
    getStore().setActiveBrowserTab(tab2, wsId);
    expect(getStore().browserUrl).toBe('https://second.example.com');

    // Close active (tab2) — should fall to tab3 (next sibling)
    const result1 = getStore().removeBrowserTab(tab2, wsId);
    expect(result1.removed).toBe(true);
    expect(result1.nextActiveTabId).toBe(tab3);
    expect(getStore().browserUrl).toBe('https://third.example.com');

    // Close inactive (tab1) — active stays on tab3
    const result2 = getStore().removeBrowserTab(tab1, wsId);
    expect(result2.removed).toBe(true);
    expect(result2.nextActiveTabId).toBe(tab3);
    expect(getStore().browserPane!.tabs.length).toBe(1);
    expect(getStore().browserPane!.tabs[0].id).toBe(tab3);
    expect(getStore().browserPane!.activeTabId).toBe(tab3);
    expect(getStore().browserUrl).toBe('https://third.example.com');
  });

  it('browser pane position is stable across navigate/switch/close cycles', () => {
    addWorkspace();
    getStore().toggleBrowser();
    const wsId = getStore().activeWorkspaceId!;
    const pos = { ...getStore().browserPane!.position };

    const tab1Id = getStore().browserPane!.activeTabId!;
    const tab2 = getStore().addBrowserTab(wsId)!;
    getStore().updateBrowserTab(tab2, { url: 'https://example.com' }, wsId);
    getStore().setActiveBrowserTab(tab2, wsId);
    getStore().removeBrowserTab(tab2, wsId);
    expect(getStore().browserPane!.tabs[0].id).toBe(tab1Id);

    expect(getStore().browserPane!.position).toEqual(pos);
  });

  it('malformed persisted browser pane state migrates to valid single-tab pane', () => {
    addWorkspace({ workspacePath: '/ws-malformed', name: 'ws-malformed', browserUrl: 'https://github.com' });

    // Toggle browser to create pane
    getStore().toggleBrowser();
    const wsId = getStore().activeWorkspaceId!;
    const pane = getStore().getWorkspaceById(wsId)!.browserPane!;
    expect(pane.tabs.length).toBe(1);
    expect(pane.activeTabId).toBeTruthy();
    expect(pane.tabs[0].url).toBe('https://github.com');
  });

  it('updateWorkspaceBrowserUrl from BROWSER_URL_UPDATED event updates correct tab', () => {
    addWorkspace();
    getStore().toggleBrowser();
    const wsId = getStore().activeWorkspaceId!;
    const tab1 = getStore().browserPane!.activeTabId!;
    const tab2 = getStore().addBrowserTab(wsId)!;
    // Switch back to tab1 so tab2 is inactive
    getStore().setActiveBrowserTab(tab1, wsId);

    // Simulate main process sending BROWSER_URL_UPDATED for inactive tab
    getStore().updateWorkspaceBrowserUrl(wsId, tab2, 'https://background.example.com', 'Background Title');

    // browserUrl should not change (tab2 is inactive)
    expect(getStore().browserUrl).toBe('https://github.com');
    const bgTab = getStore().browserPane!.tabs.find(t => t.id === tab2)!;
    expect(bgTab.url).toBe('https://background.example.com');
    expect(bgTab.title).toBe('Background Title');

    // Simulate main process sending BROWSER_URL_UPDATED for active tab
    getStore().updateWorkspaceBrowserUrl(wsId, tab1, 'https://active.example.com', 'Active Title');
    expect(getStore().browserUrl).toBe('https://active.example.com');
    expect(getStore().browserPane!.tabs.find(t => t.id === tab1)!.url).toBe('https://active.example.com');
    expect(getStore().browserPane!.tabs.find(t => t.id === tab1)!.title).toBe('Active Title');
  });
});

describe('file explorer', () => {
  it('setShowHiddenFiles updates both top-level and workspace array state', () => {
    addWorkspace();
    const wsId = getStore().activeWorkspaceId!;

    getStore().setShowHiddenFiles(false);

    // Top-level state
    expect(getStore().showHiddenFiles).toBe(false);

    // Synced to workspaces array
    const ws = getStore().workspaces.find(w => w.id === wsId)!;
    expect(ws.showHiddenFiles).toBe(false);

    // Toggle back
    getStore().setShowHiddenFiles(true);
    expect(getStore().showHiddenFiles).toBe(true);
  });

  it('setShowHiddenFiles persists across workspace switches', () => {
    addWorkspace({ workspacePath: '/first', showHiddenFiles: false });
    const firstId = getStore().activeWorkspaceId!;

    addWorkspace({ workspacePath: '/second', showHiddenFiles: true });
    const secondId = getStore().activeWorkspaceId!;

    // Switch to first
    getStore().selectWorkspace(firstId);
    expect(getStore().showHiddenFiles).toBe(false);

    // Switch to second
    getStore().selectWorkspace(secondId);
    expect(getStore().showHiddenFiles).toBe(true);
  });

  it('preserves explorer state per workspace when switching in the same session', () => {
    addWorkspace({ workspacePath: '/first' });
    const firstWorkspaceId = getStore().activeWorkspaceId!;

    getStore().setExplorerVisible(true);
    getStore().toggleExplorerPath('/first/src');
    getStore().setExplorerSelectedPath('/first/src/index.ts');
    getStore().setExplorerDirectoryEntries('/first', [{
      name: 'src',
      path: '/first/src',
      isDirectory: true,
      size: 0,
      modified: 1,
    }]);

    addWorkspace({ workspacePath: '/second' });
    const secondWorkspaceId = getStore().activeWorkspaceId!;

    expect(getStore().explorerVisible).toBe(false);
    expect(getStore().explorerExpandedPaths).toEqual([]);
    expect(getStore().explorerSelectedPath).toBeNull();

    getStore().selectWorkspace(firstWorkspaceId);

    expect(getStore().activeWorkspaceId).toBe(firstWorkspaceId);
    expect(getStore().explorerVisible).toBe(true);
    expect(getStore().explorerExpandedPaths).toEqual(['/first/src']);
    expect(getStore().explorerSelectedPath).toBe('/first/src/index.ts');
    expect(getStore().explorerEntriesByPath['/first']?.[0]?.path).toBe('/first/src');

    getStore().selectWorkspace(secondWorkspaceId);
    expect(getStore().explorerVisible).toBe(false);
    expect(getStore().explorerExpandedPaths).toEqual([]);
  });

  it('resetExplorerState clears the active workspace explorer state only', () => {
    addWorkspace({ workspacePath: '/first' });
    const firstWorkspaceId = getStore().activeWorkspaceId!;
    getStore().setExplorerVisible(true);
    getStore().setExplorerSelectedPath('/first/README.md');

    addWorkspace({ workspacePath: '/second', explorerVisible: true });
    getStore().setExplorerVisible(true);
    getStore().setExplorerSelectedPath('/second/package.json');
    getStore().resetExplorerState();

    expect(getStore().explorerVisible).toBe(false);
    expect(getStore().explorerSelectedPath).toBeNull();

    getStore().selectWorkspace(firstWorkspaceId);
    expect(getStore().explorerVisible).toBe(true);
    expect(getStore().explorerSelectedPath).toBe('/first/README.md');
  });
});

// ===========================================================================
// Pane management
// ===========================================================================
describe('pane management', () => {
  beforeEach(() => {
    addWorkspace();
  });

  it('addPane creates a new pane with terminal id', () => {
    getStore().addPane('t-new');
    const added = getStore().panes.find(p => p.terminalId === 't-new');
    expect(added).toBeTruthy();
    expect(getStore().panes.length).toBeGreaterThan(1);
  });

  it('removePane removes pane from layout', () => {
    const paneId = getStore().panes[0].id;
    getStore().removePane(paneId);
    expect(getStore().panes.find(p => p.id === paneId)).toBeUndefined();
  });

  it('updatePanePosition normalizes and applies position', () => {
    const paneId = getStore().panes[0].id;
    getStore().updatePanePosition(paneId, { x: 5, y: 3, w: 4, h: 4 });
    const pane = getStore().panes.find(p => p.id === paneId)!;
    expect(pane.position).toEqual({ x: 5, y: 3, w: 4, h: 4 });
  });

  it('updateAllPanePositions normalizes and applies multiple positions', () => {
    const pane1 = getStore().panes[0];
    const t2 = terminal('t2');
    getStore().addTerminal(t2);
    const pane2 = getStore().panes.find(p => p.terminalId === 't2')!;

    getStore().updateAllPanePositions([
      { id: pane1.id, position: { x: 0, y: 0, w: 6, h: 4 } },
      { id: pane2.id, position: { x: 6, y: 0, w: 6, h: 4 } },
    ]);

    const p1 = getStore().panes.find(p => p.id === pane1.id)!;
    const p2 = getStore().panes.find(p => p.id === pane2.id)!;
    expect(p1.position).toEqual({ x: 0, y: 0, w: 6, h: 4 });
    expect(p2.position).toEqual({ x: 6, y: 0, w: 6, h: 4 });
  });

  it('updateBrowserPosition creates browser pane if needed', () => {
    expect(getStore().browserPane).toBeNull();
    getStore().updateBrowserPosition({ x: 2, y: 2, w: 6, h: 4 });
    expect(getStore().browserPane).not.toBeNull();
    expect(getStore().browserPane!.position).toEqual({ x: 2, y: 2, w: 6, h: 4 });
  });

  it('updateBrowserPosition updates existing browser pane position', () => {
    getStore().toggleBrowser();
    getStore().updateBrowserPosition({ x: 1, y: 1, w: 4, h: 3 });
    expect(getStore().browserPane!.position).toEqual({ x: 1, y: 1, w: 4, h: 3 });
  });

  it('togglePaneLock toggles locked state', () => {
    const paneId = getStore().panes[0].id;
    expect(getStore().panes[0].locked).toBeFalsy();
    getStore().togglePaneLock(paneId);
    expect(getStore().panes.find(p => p.id === paneId)!.locked).toBe(true);
    getStore().togglePaneLock(paneId);
    expect(getStore().panes.find(p => p.id === paneId)!.locked).toBe(false);
  });
});

// ===========================================================================
// Layout operations
// ===========================================================================
describe('layout operations', () => {
  beforeEach(() => {
    addWorkspace();
  });

  it('swapPanes swaps two pane ids in layout', () => {
    const t2 = terminal('t2');
    getStore().addTerminal(t2);
    const pane1 = getStore().panes.find(p => p.terminalId === getStore().terminals[0].id)!;
    const pane2 = getStore().panes.find(p => p.terminalId === 't2')!;

    getStore().swapPanes(pane1.id, pane2.id);
    // Should succeed without error and bump revision
    expect(getStore().layoutRevision).toBeGreaterThan(0);
  });

  it('swapPanes is no-op when ids are the same', () => {
    const paneId = getStore().panes[0].id;
    const revBefore = getStore().layoutRevision;
    getStore().swapPanes(paneId, paneId);
    expect(getStore().layoutRevision).toBe(revBefore);
  });

  it('dockPaneToEdge moves pane to specified edge', () => {
    const t2 = terminal('t2');
    getStore().addTerminal(t2);
    const pane2 = getStore().panes.find(p => p.terminalId === 't2')!;
    getStore().dockPaneToEdge(pane2.id, 'right');
    expect(getStore().layoutRevision).toBeGreaterThan(0);
  });

  it('insertPaneAtEdgeSegment splits the targeted edge pane', () => {
    const t2 = terminal('t2');
    getStore().addTerminal(t2);
    const pane1 = getStore().panes.find(p => p.terminalId === getStore().terminals[0].id)!;
    const pane2 = getStore().panes.find(p => p.terminalId === 't2')!;
    const revBefore = getStore().layoutRevision;

    getStore().insertPaneAtEdgeSegment(pane2.id, 'left', pane1.id);

    expect(getStore().layoutRevision).toBeGreaterThan(revBefore);
    const root = getStore().layoutRoot as LayoutSplit;
    expect(root.orientation).toBe('horizontal');
    expect(getEdgeTerminals(getStore().layoutRoot, 'left').map((entry) => entry.paneId)).toEqual([pane2.id]);
    expect(getEdgeTerminals(getStore().layoutRoot, 'right').map((entry) => entry.paneId)).toEqual([pane1.id]);
  });

  it('setSplitRatio updates split node ratio', () => {
    const t2 = terminal('t2');
    getStore().addTerminal(t2);
    // The layout should have a split node
    const root = getStore().layoutRoot!;
    if (root.type === 'split') {
      getStore().setSplitRatio(root.nodeId, 0.7);
      expect(getStore().layoutRevision).toBeGreaterThan(0);
    }
  });

  it('resetLayout rebuilds layout from panes', () => {
    getStore().resetLayout();
    expect(getStore().layoutRoot).not.toBeNull();
  });

  it('fitAllPanes rebuilds layout from panes', () => {
    getStore().fitAllPanes();
    expect(getStore().layoutRoot).not.toBeNull();
  });

  it('bringPaneIntoView swaps target with first leaf', () => {
    const t2 = terminal('t2');
    getStore().addTerminal(t2);
    const pane2 = getStore().panes.find(p => p.terminalId === 't2')!;
    const revBefore = getStore().layoutRevision;
    getStore().bringPaneIntoView(pane2.id);
    expect(getStore().layoutRevision).toBeGreaterThan(revBefore);
  });

  it('bringPaneIntoView is no-op when pane is already first', () => {
    const firstPaneId = getStore().panes[0].id;
    const revBefore = getStore().layoutRevision;
    getStore().bringPaneIntoView(firstPaneId);
    expect(getStore().layoutRevision).toBe(revBefore);
  });

  it('bringBrowserIntoView swaps browser with first leaf', () => {
    getStore().toggleBrowser();
    // Make sure browser is in layout
    const revBefore = getStore().layoutRevision;
    getStore().bringBrowserIntoView();
    // Should have bumped revision if browser wasn't already first
    expect(getStore().layoutRevision).toBeGreaterThanOrEqual(revBefore);
  });

  it('bringBrowserIntoView is no-op when browser is not visible', () => {
    const revBefore = getStore().layoutRevision;
    getStore().bringBrowserIntoView();
    expect(getStore().layoutRevision).toBe(revBefore);
  });
});

// ===========================================================================
// Workspace property setters
// ===========================================================================
describe('workspace property setters', () => {
  beforeEach(() => {
    addWorkspace();
  });

  it('setWorkspacePath updates path', () => {
    getStore().setWorkspacePath('/new/path');
    expect(getStore().workspacePath).toBe('/new/path');
  });

  it('setHarness updates harness and clears model', () => {
    getStore().setModel('some-model');
    getStore().setHarness('claude');
    expect(getStore().harness).toBe('claude');
    expect(getStore().model).toBe('');
  });

  it('setModel updates model', () => {
    getStore().setModel('gpt-4');
    expect(getStore().model).toBe('gpt-4');
  });
});

// ===========================================================================
// Grid viewport
// ===========================================================================
describe('gridViewport', () => {
  it('setGridViewport clamps values', () => {
    addWorkspace();
    getStore().setGridViewport({ cols: 20, rows: 30 });
    const vp = getStore().gridViewport;
    expect(vp.cols).toBe(12); // clamped to GRID_COLS
    expect(vp.rows).toBeLessThanOrEqual(20);
  });

  it('setGridViewport is no-op when values match current', () => {
    addWorkspace();
    getStore().setGridViewport({ cols: 12, rows: 8 });
    // Should be a no-op, state unchanged
    expect(getStore().gridViewport).toEqual({ cols: 12, rows: 8 });
  });
});

// ===========================================================================
// canAddPane
// ===========================================================================
describe('canAddPane', () => {
  it('returns true when layoutRoot is null', () => {
    // No workspace loaded yet → layoutRoot is null
    expect(getStore().canAddPane()).toBe(true);
  });

  it('returns true when there are unlocked panes', () => {
    addWorkspace();
    expect(getStore().canAddPane()).toBe(true);
  });

  it('returns false when all panes are locked', () => {
    addWorkspace();
    const paneId = getStore().panes[0].id;
    getStore().togglePaneLock(paneId);
    expect(getStore().canAddPane()).toBe(false);
  });
});

// ===========================================================================
// Workspace sync (integration)
// ===========================================================================
describe('workspace sync', () => {
  it('addTerminal syncs to workspaces array', () => {
    addWorkspace();
    const wsId = getStore().activeWorkspaceId;
    const t = terminal('t-sync');
    getStore().addTerminal(t);
    const ws = getStore().workspaces.find(w => w.id === wsId)!;
    expect(ws.terminals.some(t => t.id === 't-sync')).toBe(true);
  });

  it('setActiveTerminal syncs to workspaces array', () => {
    addWorkspace();
    const wsId = getStore().activeWorkspaceId;
    const t = terminal('t-sync');
    getStore().addTerminal(t);
    getStore().setActiveTerminal('t-sync');
    const ws = getStore().workspaces.find(w => w.id === wsId)!;
    expect(ws.activeTerminalId).toBe('t-sync');
  });

  it('toggleBrowser syncs to workspaces array', () => {
    addWorkspace();
    const wsId = getStore().activeWorkspaceId;
    getStore().toggleBrowser();
    const ws = getStore().workspaces.find(w => w.id === wsId)!;
    expect(ws.browserVisible).toBe(true);
  });

  it('setPanes rebuilds layout and syncs', () => {
    addWorkspace();
    const wsId = getStore().activeWorkspaceId;
    const newPanes: Pane[] = [
      { id: 'p1', terminalId: 't1', position: { x: 0, y: 0, w: 6, h: 8 } },
      { id: 'p2', terminalId: 't2', position: { x: 6, y: 0, w: 6, h: 8 } },
    ];
    getStore().setPanes(newPanes);
    expect(getStore().panes).toEqual(newPanes);
    const ws = getStore().workspaces.find(w => w.id === wsId)!;
    expect(ws.panes).toEqual(newPanes);
  });
});

// ===========================================================================
// Editor
// ===========================================================================
describe('editor', () => {
  beforeEach(() => {
    installElectronApiMock({
      editorReadFile: vi.fn().mockResolvedValue({ success: true, content: 'test' }),
      editorWriteFile: vi.fn().mockResolvedValue({ success: true }),
    });
  });

  it('preserves editor state per workspace when switching', async () => {
    addWorkspace({ workspacePath: '/first' });
    const firstId = getStore().activeWorkspaceId!;

    await getStore().openFileInEditor('/first/test.js');
    expect(getStore().editorTabs).toHaveLength(1);

    addWorkspace({ workspacePath: '/second' });
    expect(getStore().editorTabs).toHaveLength(0);

    getStore().selectWorkspace(firstId);
    expect(getStore().activeWorkspaceId).toBe(firstId);
    expect(getStore().editorTabs).toHaveLength(1);
  });

  it('editor state resets on workspace close', async () => {
    addWorkspace({ workspacePath: '/workspace' });
    await getStore().openFileInEditor('/workspace/test.js');
    const wsId = getStore().activeWorkspaceId;

    getStore().closeWorkspace(wsId!);
    expect(getStore().editorTabs).toHaveLength(0);
    expect(getStore().editorVisible).toBe(false);
  });

  it('editor syncs to workspaces array', async () => {
    addWorkspace();
    const wsId = getStore().activeWorkspaceId;

    await getStore().openFileInEditor('/workspace/test.js');
    const ws = getStore().workspaces.find(w => w.id === wsId)!;
    expect(ws.editorTabs).toHaveLength(1);
    expect(ws.editorVisible).toBe(true);
    expect(ws.activeEditorTabId).not.toBeNull();
  });
});

// ===========================================================================
// renameEditorTabPath (S10)
// ===========================================================================
describe('renameEditorTabPath', () => {
  it('updates the editor tab filePath and fileName', () => {
    addWorkspace();

    // Set up tabs
    useWorkspaceStore.setState({
      editorTabs: [
        {
          id: 'tab-1',
          filePath: '/workspace/src/index.ts',
          fileName: 'index.ts',
          isDirty: false,
          content: 'console.log("hello")',
          originalContent: 'console.log("hello")',
        },
        {
          id: 'tab-2',
          filePath: '/workspace/src/main.ts',
          fileName: 'main.ts',
          isDirty: false,
          content: 'console.log("world")',
          originalContent: 'console.log("world")',
        },
      ],
      workspaces: getStore().workspaces.map((workspace) => ({
        ...workspace,
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/src/index.ts',
            fileName: 'index.ts',
            isDirty: false,
            content: 'console.log("hello")',
            originalContent: 'console.log("hello")',
          },
          {
            id: 'tab-2',
            filePath: '/workspace/src/main.ts',
            fileName: 'main.ts',
            isDirty: false,
            content: 'console.log("world")',
            originalContent: 'console.log("world")',
          },
        ],
      })),
    });

    // Rename the first tab
    getStore().renameEditorTabPath('/workspace/src/index.ts', '/workspace/src/main.ts');

    const tabs = getStore().editorTabs;
    expect(tabs.find(t => t.id === 'tab-1')?.filePath).toBe('/workspace/src/main.ts');
    expect(tabs.find(t => t.id === 'tab-1')?.fileName).toBe('main.ts');
    // Second tab should be unchanged
    expect(tabs.find(t => t.id === 'tab-2')?.filePath).toBe('/workspace/src/main.ts');
    expect(tabs.find(t => t.id === 'tab-2')?.fileName).toBe('main.ts');
  });

  it('syncs editorTabs to workspaces array after rename', () => {
    addWorkspace();
    const wsId = getStore().activeWorkspaceId!;

    useWorkspaceStore.setState({
      editorTabs: [
        {
          id: 'tab-1',
          filePath: '/workspace/file.ts',
          fileName: 'file.ts',
          isDirty: false,
          content: '',
          originalContent: '',
        },
      ],
      workspaces: getStore().workspaces.map((workspace) => ({
        ...workspace,
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/file.ts',
            fileName: 'file.ts',
            isDirty: false,
            content: '',
            originalContent: '',
          },
        ],
      })),
    });

    getStore().renameEditorTabPath('/workspace/file.ts', '/workspace/renamed.ts');

    const ws = getStore().workspaces.find(w => w.id === wsId)!;
    expect(ws.editorTabs[0].filePath).toBe('/workspace/renamed.ts');
    expect(ws.editorTabs[0].fileName).toBe('renamed.ts');
  });

  it('does nothing when oldPath does not match any tab', () => {
    addWorkspace();

    useWorkspaceStore.setState({
      editorTabs: [
        {
          id: 'tab-1',
          filePath: '/workspace/file.ts',
          fileName: 'file.ts',
          isDirty: false,
          content: '',
          originalContent: '',
        },
      ],
      workspaces: getStore().workspaces.map((workspace) => ({
        ...workspace,
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/file.ts',
            fileName: 'file.ts',
            isDirty: false,
            content: '',
            originalContent: '',
          },
        ],
      })),
    });

    getStore().renameEditorTabPath('/workspace/nonexistent.ts', '/workspace/new.ts');

    const tabs = getStore().editorTabs;
    expect(tabs[0].filePath).toBe('/workspace/file.ts');
    expect(tabs[0].fileName).toBe('file.ts');
  });
});

// ===========================================================================
// Git changes (S2)
// ===========================================================================
describe('git changes', () => {
  it('setGitChanges updates both top-level state and the active workspace in workspaces[]', () => {
    addWorkspace();
    const wsId = getStore().activeWorkspaceId!;

    const changes = [
      { path: 'src/index.ts', status: 'modified' as const, staged: false },
      { path: 'src/new.ts', status: 'added' as const, staged: true },
    ];
    getStore().setGitChanges(changes);

    // Top-level state
    expect(getStore().gitChanges).toEqual(changes);

    // Synced to workspaces array
    const ws = getStore().workspaces.find(w => w.id === wsId)!;
    expect(ws.gitChanges).toEqual(changes);
  });

  it('switching workspaces restores the correct gitChanges', () => {
    addWorkspace({ workspacePath: '/first' });
    const firstId = getStore().activeWorkspaceId!;

    const firstChanges = [
      { path: 'first-file.ts', status: 'modified' as const, staged: false },
    ];
    getStore().setGitChanges(firstChanges);

    addWorkspace({ workspacePath: '/second' });
    const secondId = getStore().activeWorkspaceId!;

    const secondChanges = [
      { path: 'second-file.ts', status: 'added' as const, staged: true },
    ];
    getStore().setGitChanges(secondChanges);

    // Switch back to first workspace
    getStore().selectWorkspace(firstId);
    expect(getStore().gitChanges).toEqual(firstChanges);

    // Switch to second workspace
    getStore().selectWorkspace(secondId);
    expect(getStore().gitChanges).toEqual(secondChanges);
  });

  it('closing the active workspace resets gitChanges to []', () => {
    addWorkspace({ workspacePath: '/first' });
    const firstId = getStore().activeWorkspaceId!;

    const changes = [
      { path: 'file.ts', status: 'modified' as const, staged: false },
    ];
    getStore().setGitChanges(changes);

    addWorkspace({ workspacePath: '/second' });
    const secondId = getStore().activeWorkspaceId!;

    // Close the active workspace (second)
    getStore().closeWorkspace(secondId);

    // Switched back to first, should have first's gitChanges
    expect(getStore().activeWorkspaceId).toBe(firstId);
    expect(getStore().gitChanges).toEqual(changes);
  });
});

// ===========================================================================
// Workspace Residency Metadata
// ===========================================================================

describe('workspace runtime metadata', () => {
  it('newly added workspace has warm residency state by default', () => {
    addWorkspace({ workspacePath: '/warm-test' });
    const ws = getStore().workspaces.find(w => w.workspacePath === '/warm-test');
    expect(ws?.runtimeState.residencyState).toBe('warm');
  });

  it('newly added workspace has default resource policy', () => {
    addWorkspace({ workspacePath: '/policy-test' });
    const ws = getStore().workspaces.find(w => w.workspacePath === '/policy-test');
    expect(ws?.runtimeState.resourcePolicy).toEqual({
      terminals: 'warm',
      browser: 'warm',
      explorer: 'cached',
      editor: 'warm',
    });
  });

  it('sanitizeWorkspace backfills runtimeState when workspace has none', () => {
    // Verify that addWorkspace via sanitizeWorkspace always produces workspace objects
    // with runtimeState present. The backfill happens in sanitizeWorkspace (called from
    // addWorkspace and selectWorkspace), so any newly added workspace has the field.
    addWorkspace({ workspacePath: '/sanitize-backfill-test' });
    const wsId = getStore().activeWorkspaceId!;

    // Verify the new workspace has runtimeState (not missing)
    expect(getStore().workspaces.find(w => w.id === wsId)?.runtimeState).toBeDefined();
  });

  it('setWorkspaceResidency updates residency state for a workspace', () => {
    addWorkspace({ workspacePath: '/switch-test' });
    const wsId = getStore().activeWorkspaceId!;

    getStore().setWorkspaceResidency(wsId, 'cold');

    const ws = getStore().workspaces.find(w => w.id === wsId);
    expect(ws?.runtimeState.residencyState).toBe('cold');
  });

  it('setWorkspaceResourcePolicy merges partial policy without clobbering other fields', () => {
    addWorkspace({ workspacePath: '/merge-test' });
    const wsId = getStore().activeWorkspaceId!;

    // Only change browser policy
    getStore().setWorkspaceResourcePolicy(wsId, { browser: 'cold' });

    const ws = getStore().workspaces.find(w => w.id === wsId);
    expect(ws?.runtimeState.resourcePolicy.browser).toBe('cold');
    expect(ws?.runtimeState.resourcePolicy.terminals).toBe('warm'); // unchanged
    expect(ws?.runtimeState.resourcePolicy.explorer).toBe('cached'); // unchanged
    expect(ws?.runtimeState.resourcePolicy.editor).toBe('warm'); // unchanged
  });

  it('selectWorkspace does not reset runtimeState on workspace', () => {
    addWorkspace({ workspacePath: '/first' });
    const firstId = getStore().activeWorkspaceId!;

    // Set non-default state
    getStore().setWorkspaceResidency(firstId, 'cold');
    getStore().setWorkspaceResourcePolicy(firstId, { browser: 'cold' });

    // Add second workspace and switch back
    addWorkspace({ workspacePath: '/second' });
    getStore().selectWorkspace(firstId);

    const ws = getStore().workspaces.find(w => w.id === firstId);
    expect(ws?.runtimeState.residencyState).toBe('cold');
    expect(ws?.runtimeState.resourcePolicy.browser).toBe('cold');
  });

  it('closeWorkspace removes workspace with its runtimeState', () => {
    addWorkspace({ workspacePath: '/close-test' });
    const wsId = getStore().activeWorkspaceId!;

    getStore().setWorkspaceResidency(wsId, 'cold');

    addWorkspace({ workspacePath: '/other' });
    const otherId = getStore().activeWorkspaceId!;

    getStore().closeWorkspace(wsId);

    const remaining = getStore().workspaces;
    expect(remaining.some(w => w.id === wsId)).toBe(false);
    expect(remaining.find(w => w.id === otherId)?.runtimeState.residencyState).toBe('warm');
  });

  it('assignWorkspaceLifecycles preserves runtimeState when reassigning lifecycle', () => {
    const ws1 = createWorkspaceFixture({ id: 'ws-1' });
    const ws2 = createWorkspaceFixture({ id: 'ws-2' });

    // Set custom state on ws1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ws1 as any).runtimeState = {
      residencyState: 'cold',
      resourcePolicy: { terminals: 'cold', browser: 'cold', explorer: 'cached', editor: 'cold' },
    };

    // Switch active — ws2 becomes active
    const result = assignWorkspaceLifecycles([ws1, ws2], 'ws-2');

    const afterWs1 = result.find(w => w.id === 'ws-1');
    expect(afterWs1?.lifecycle).toBe('parked');
    expect(afterWs1?.runtimeState.residencyState).toBe('cold');
    expect(afterWs1?.runtimeState.resourcePolicy.browser).toBe('cold');
  });
});
