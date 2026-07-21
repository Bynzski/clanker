// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  persistWorkspaceLayout,
  restoreWorkspaceLayout,
  getWorkspaceLayoutStorageKey,
} from '../../../src/renderer/lib/workspaceLayoutStorage';
import { collectLeafPaneIds } from '../../../src/renderer/store/workspaceLayout';
import type { LayoutLeaf, LayoutSplit, WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';
import { createWorkspaceFixture } from '../../setup/fixtures';

let storedValues: Record<string, string>;
let localStorageMock: {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
};

function leaf(nodeId: string, paneId: string): LayoutLeaf {
  return { type: 'leaf', nodeId, paneId };
}

function workspaceWithLayout(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return createWorkspaceFixture({
    workspacePath: '/projects/clanker',
    explorerVisible: true,
    explorerPane: { id: 'explorer-old' },
    browserVisible: true,
    browserPane: {
      id: 'browser-old',
      position: { x: 0, y: 0, w: 6, h: 6 },
      tabs: [{
        id: 'tab-1',
        url: 'https://example.com',
        title: 'Example',
        canGoBack: false,
        canGoForward: false,
      }],
      activeTabId: 'tab-1',
    },
    layoutRoot: {
      type: 'split',
      nodeId: 'split-root',
      orientation: 'horizontal',
      ratio: 0.35,
      first: leaf('leaf-explorer', 'explorer-old'),
      second: {
        type: 'split',
        nodeId: 'split-content',
        orientation: 'vertical',
        ratio: 0.6,
        first: leaf('leaf-terminal', 'pane-1'),
        second: leaf('leaf-browser', 'browser-old'),
      },
    },
    ...overrides,
  });
}

beforeEach(() => {
  storedValues = {};
  localStorageMock = {
    getItem: vi.fn((key: string) => storedValues[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storedValues[key] = value;
    }),
    clear: vi.fn(() => {
      storedValues = {};
    }),
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });
  let id = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `restored-${++id}` });
});

describe('workspace layout persistence', () => {
  it('canonicalizes equivalent Windows workspace paths to one storage key', () => {
    expect(getWorkspaceLayoutStorageKey('C:\\Users\\Jay\\Repo\\', true)).toBe(
      getWorkspaceLayoutStorageKey('c:/users/jay/repo', true),
    );
    expect(getWorkspaceLayoutStorageKey('/Users/Jay/Repo', false)).not.toBe(
      getWorkspaceLayoutStorageKey('/users/jay/repo', false),
    );
  });

  it('restores topology onto newly generated pane IDs', () => {
    persistWorkspaceLayout(workspaceWithLayout());
    const current = workspaceWithLayout({
      panes: [{ id: 'pane-new', terminalId: 'terminal-new' }],
      terminals: [{ id: 'terminal-new', pid: 222, workingDir: '/projects/clanker' }],
      activeTerminalId: 'terminal-new',
      explorerPane: { id: 'explorer-new' },
      browserPane: {
        id: 'browser-new',
        position: { x: 0, y: 0, w: 6, h: 6 },
        tabs: [{
          id: 'tab-new',
          url: 'https://example.com',
          title: 'Example',
          canGoBack: false,
          canGoForward: false,
        }],
        activeTabId: 'tab-new',
      },
      layoutRoot: leaf('current-leaf', 'pane-new'),
      layoutRevision: 4,
      layoutUndoStack: [leaf('undo-leaf', 'pane-new')],
    });

    const restored = restoreWorkspaceLayout(current);

    expect(collectLeafPaneIds(restored.layoutRoot)).toEqual([
      'explorer-new',
      'pane-new',
      'browser-new',
    ]);
    expect((restored.layoutRoot as LayoutSplit).ratio).toBe(0.35);
    expect(((restored.layoutRoot as LayoutSplit).second as LayoutSplit).ratio).toBe(0.6);
    expect(restored.layoutRevision).toBe(5);
    expect(restored.layoutUndoStack).toEqual([]);
  });

  it('recreates persisted utility panes when runtime pane state is unavailable', () => {
    persistWorkspaceLayout(workspaceWithLayout());
    const current = workspaceWithLayout({
      explorerVisible: false,
      explorerPane: null,
      browserVisible: false,
      browserPane: null,
      layoutRoot: leaf('current-leaf', 'pane-1'),
    });

    const restored = restoreWorkspaceLayout(current);

    expect(restored.explorerVisible).toBe(true);
    expect(restored.explorerPane).not.toBeNull();
    expect(restored.browserVisible).toBe(true);
    expect(restored.browserPane).not.toBeNull();
    expect(collectLeafPaneIds(restored.layoutRoot)).toEqual([
      restored.explorerPane?.id,
      'pane-1',
      restored.browserPane?.id,
    ]);
  });

  it('uses the persisted topology as the source of utility-pane visibility', () => {
    persistWorkspaceLayout(workspaceWithLayout({
      explorerVisible: false,
      explorerPane: null,
      browserVisible: false,
      browserPane: null,
      layoutRoot: leaf('saved-terminal-leaf', 'pane-1'),
    }));

    const restored = restoreWorkspaceLayout(workspaceWithLayout({
      editorVisible: true,
      editorPane: { id: 'current-editor' },
      notesVisible: true,
      notesPane: { id: 'current-notes' },
    }));

    expect(restored.explorerVisible).toBe(false);
    expect(restored.browserVisible).toBe(false);
    expect(restored.editorVisible).toBe(false);
    expect(restored.notesVisible).toBe(false);
    expect(collectLeafPaneIds(restored.layoutRoot)).toEqual(['pane-1']);
  });

  it('ignores corrupt data and terminal-count mismatches', () => {
    const current = workspaceWithLayout();
    window.localStorage.setItem('clanker-grid:layout:v1:%2Fprojects%2Fclanker', '{not-json');
    expect(restoreWorkspaceLayout(current)).toBe(current);

    persistWorkspaceLayout(workspaceWithLayout({
      panes: [
        { id: 'pane-1', terminalId: 'terminal-1' },
        { id: 'pane-2', terminalId: 'terminal-2' },
      ],
    }));
    expect(restoreWorkspaceLayout(current)).toBe(current);
  });

  it('never throws when storage access fails', () => {
    localStorageMock.setItem.mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(() => persistWorkspaceLayout(workspaceWithLayout())).not.toThrow();
  });
});
