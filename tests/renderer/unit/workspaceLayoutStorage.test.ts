// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeWorkspaceLayout, restoreWorkspaceLayoutFromPersisted } from '../../../src/renderer/lib/workspaceLayoutStorage';
import { collectLeafPaneIds } from '../../../src/renderer/store/workspaceLayout';
import type { LayoutLeaf } from '../../../src/renderer/store/workspaceTypes';
import { createWorkspaceFixture } from '../../setup/fixtures';

function leaf(paneId: string): LayoutLeaf { return { type: 'leaf', nodeId: `leaf-${paneId}`, paneId }; }
beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: vi.fn(() => { throw new Error('storage unavailable'); }),
    setItem: vi.fn(() => { throw new Error('storage unavailable'); }),
  } });
});
describe('explicit Recipe layouts', () => {
  it('captures layout, split ratios, terminal count and Explorer visibility without storage', () => {
    const workspace = createWorkspaceFixture({ explorerVisible: true,
      panes: [{ id: 'p1', terminalId: 't1' }, { id: 'p2', terminalId: 't2' }],
      layoutRoot: { type: 'split', nodeId: 'split', orientation: 'vertical', ratio: 0.35, first: leaf('p1'), second: leaf('p2') },
    });
    expect(serializeWorkspaceLayout(workspace)).toEqual({ terminalCount: 2, explorerVisible: true,
      root: { type: 'split', orientation: 'vertical', ratio: 0.35,
        first: { type: 'leaf', paneKey: 'terminal:0' }, second: { type: 'leaf', paneKey: 'terminal:1' } },
    });
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
  });
  it('applies a captured layout to fresh runtime pane IDs', () => {
    const original = createWorkspaceFixture({ panes: [{ id: 'old1', terminalId: 't1' }, { id: 'old2', terminalId: 't2' }],
      layoutRoot: { type: 'split', nodeId: 'split', orientation: 'horizontal', ratio: 0.6, first: leaf('old1'), second: leaf('old2') },
    });
    const fresh = createWorkspaceFixture({ panes: [{ id: 'new1', terminalId: 't3' }, { id: 'new2', terminalId: 't4' }], layoutRoot: null });
    const restored = restoreWorkspaceLayoutFromPersisted(fresh, serializeWorkspaceLayout(original));
    expect(collectLeafPaneIds(restored.layoutRoot)).toEqual(['new1', 'new2']);
    expect(restored.layoutRoot).toMatchObject({ type: 'split', ratio: 0.6 });
    expect(window.localStorage.getItem).not.toHaveBeenCalled();
  });
  it('recreates utility panes only when explicitly requested by a Recipe layout', () => {
    const shell = createWorkspaceFixture({ terminals: [], panes: [], activeTerminalId: null, layoutRoot: null });
    const restored = restoreWorkspaceLayoutFromPersisted(shell, { terminalCount: 0, explorerVisible: true,
      root: { type: 'split', orientation: 'horizontal', ratio: 0.4,
        first: { type: 'leaf', paneKey: 'browser' },
        second: { type: 'split', orientation: 'vertical', ratio: 0.5,
          first: { type: 'leaf', paneKey: 'editor' }, second: { type: 'leaf', paneKey: 'notes' } },
      },
    });
    expect(restored).toMatchObject({ browserVisible: true, editorVisible: true, notesVisible: true, explorerVisible: true });
    expect(collectLeafPaneIds(restored.layoutRoot)).toEqual([restored.browserPane?.id, restored.editorPane?.id, restored.notesPane?.id]);
    expect(shell).toMatchObject({ browserPane: null, editorPane: null, notesPane: null, layoutRoot: null });
  });
  it('leaves incompatible terminal counts unchanged', () => {
    const workspace = createWorkspaceFixture();
    expect(restoreWorkspaceLayoutFromPersisted(workspace, { root: { type: 'leaf', paneKey: 'terminal:0' }, terminalCount: 3 })).toBe(workspace);
  });
  it('leaves malformed topology unchanged', () => {
    const workspace = createWorkspaceFixture();
    expect(restoreWorkspaceLayoutFromPersisted(workspace, { root: { type: 'broken' }, terminalCount: 1 })).toBe(workspace);
  });
});
