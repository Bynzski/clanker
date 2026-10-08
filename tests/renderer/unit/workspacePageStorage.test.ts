import { describe, expect, it } from 'vitest';
import { parseWorkspacePages, serializeWorkspacePages, restoreWorkspacePages } from '../../../src/renderer/lib/workspacePageStorage';
import { sanitizeWorkspace } from '../../../src/renderer/store/workspaceStoreHelpers';
import { collectLeafPaneIds } from '../../../src/renderer/store/workspaceLayout';
import { createWorkspaceFixture } from '../../setup/fixtures';

const saved = () => ({ version: 1, activePageId: 'two', pages: [
  { id: 'one', root: { type: 'split', orientation: 'horizontal', ratio: .7,
    first: { type: 'leaf', key: 'terminal-slot:0' }, second: { type: 'leaf', key: 'browser' } } },
  { id: 'two', root: null },
], minimized: [{ key: 'terminal-slot:1', pageId: 'two' }] });
const empty = () => sanitizeWorkspace(createWorkspaceFixture({ id: 'fresh', terminals: [], panes: [], activeTerminalId: null }));

describe('bounded page preferences, without conversation resurrection', () => {
  it('preserves page order/active selection but drops absent resources when reopening an empty shell', () => {
    const result = restoreWorkspacePages(empty(), saved());
    expect(result.pages?.map((page) => page.id)).toEqual(['one', 'two']);
    expect(result.activePageId).toBe('two'); expect(result.pages?.every((page) => page.layoutRoot === null)).toBe(true);
    expect(result.minimizedPanes).toEqual([]); expect(result.terminals).toEqual([]);
    expect(result.layoutUndoStack).toEqual([]);
  });
  it('maps only already-present utilities and safely collapses absent terminal leaves', () => {
    const workspace = empty();
    const browser = { id: 'runtime-browser', tabs: [], activeTabId: null, position: { x: 0, y: 0, w: 6, h: 6 } };
    const result = restoreWorkspacePages({ ...workspace, browserPane: browser, browserVisible: true }, saved());
    expect(collectLeafPaneIds(result.pages![0].layoutRoot)).toEqual(['runtime-browser']);
    expect(result.browserPane).toBe(browser); expect(result.pages![1].layoutRoot).toBeNull();
  });
  it('refuses to replace the layout or attach saved slots to unrelated live terminals', () => {
    const live = sanitizeWorkspace(createWorkspaceFixture());
    expect(restoreWorkspacePages(live, saved())).toBe(live);
  });
  it('round trips page preferences without runtime pane/process ids, focus, maximize or undo', () => {
    const workspace = sanitizeWorkspace(createWorkspaceFixture());
    const result = serializeWorkspacePages(workspace);
    const json = JSON.stringify(result);
    expect(json).not.toContain('terminal-1'); expect(json).not.toContain('pane-1');
    expect(json).not.toContain('layoutUndoStack'); expect(json).not.toContain('maximizedPaneId'); expect(json).not.toContain('activeTerminalId');
    expect(parseWorkspacePages(JSON.parse(json))).toEqual(result);
    expect(restoreWorkspacePages(empty(), result).pages).toHaveLength(1);
  });
  it.each(['version', 'active', 'duplicate page', 'duplicate pane', 'duplicate minimized', 'bad ratio', 'too many pages', 'deep tree'])('rejects %s safely', (kind) => {
    const value: Record<string, unknown> = saved();
    if (kind === 'version') value.version = 2;
    if (kind === 'active') value.activePageId = 'unknown';
    if (kind === 'duplicate page') value.pages = [saved().pages[0], saved().pages[0]];
    if (kind === 'duplicate pane') value.pages = [saved().pages[0], { id: 'two', root: { type: 'leaf', key: 'browser' } }];
    if (kind === 'duplicate minimized') value.minimized = [{ key: 'browser', pageId: 'one' }];
    if (kind === 'bad ratio') value.pages = [{ id: 'two', root: { ...saved().pages[0].root, ratio: Number.NaN } }];
    if (kind === 'too many pages') value.pages = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, root: null }));
    if (kind === 'deep tree') {
      let node: unknown = { type: 'leaf', key: 'browser' };
      for (let i = 0; i < 40; i++) node = { type: 'split', orientation: 'horizontal', ratio: .5, first: node, second: { type: 'leaf', key: `terminal-slot:${i}` } };
      value.pages = [{ id: 'two', root: node }];
    }
    expect(parseWorkspacePages(value)).toBeNull();
    const workspace = empty(); expect(restoreWorkspacePages(workspace, value)).toBe(workspace);
  });
});
