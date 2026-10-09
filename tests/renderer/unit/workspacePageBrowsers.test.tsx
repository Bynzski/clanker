import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { workspaceBrowserPresented } from '../../../src/renderer/store/workspacePages';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

const store = () => useWorkspaceStore.getState();
const workspace = () => store().getWorkspaceById('w')!;
const page = (id: string) => workspace().pages!.find((entry) => entry.id === id)!;
beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useAssistantNavStore.setState({ activeAssistantId: null });
  installElectronApiMock();
  store().addWorkspace(createWorkspaceFixture({ id: 'w' }));
});
function twoBrowsers() {
  const first = workspace().activePageId!;
  store().toggleBrowser('w');
  const a = workspace().browserPane!;
  store().addWorkspacePage('w');
  const second = workspace().activePageId!;
  expect(workspace().browserPane).toBeNull();
  store().toggleBrowser('w');
  return { first, second, a, b: workspace().browserPane! };
}

describe('page-owned Browsers', () => {
  it('creates independent stable panes and projects only the selected page', () => {
    const { first, second, a, b } = twoBrowsers();
    expect(a.id).not.toBe(b.id);
    expect(a.tabs[0].id).not.toBe(b.tabs[0].id);
    expect(page(first).browser?.pane).toBe(a);
    expect(page(second).browser?.pane).toBe(b);
    store().selectWorkspacePage('w', first);
    expect(workspace().browserPane).toBe(a);
    store().selectWorkspacePage('w', second);
    expect(workspace().browserPane).toBe(b);
  });
  it('routes background events and tab selection by ownership, without page changes', () => {
    const { first, second, a, b } = twoBrowsers();
    store().updateWorkspaceBrowserUrl('w', a.tabs[0].id, 'http://localhost:5173', 'A');
    store().updateBrowserTab(a.tabs[0].id, { canGoBack: true }, 'w');
    expect(page(first).browser?.pane?.tabs[0]).toMatchObject({ url: 'http://localhost:5173', title: 'A', canGoBack: true });
    expect(workspace().browserPane).toBe(b);
    expect(workspace().activePageId).toBe(second);
    store().selectWorkspacePage('w', first);
    const extra = store().addBrowserTab('w')!;
    store().selectWorkspacePage('w', second);
    expect(store().setActiveBrowserTab(a.tabs[0].id, 'w')).toBe(true);
    expect(page(first).browser?.pane?.activeTabId).toBe(a.tabs[0].id);
    expect(page(second).browser?.pane?.activeTabId).toBe(b.activeTabId);
    expect(store().removeBrowserTab(extra, 'w').removed).toBe(true);
    expect(store().updateBrowserTab(extra, { url: 'https://invalid.example' }, 'w')).toBe(false);
    expect(page(first).browser?.pane?.tabs).toHaveLength(1);
    expect(workspace().browserPane).toBe(b);
  });
  it('hides, minimizes and restores only the selected page Browser', () => {
    const { first, second, a, b } = twoBrowsers();
    store().selectWorkspacePage('w', first);
    store().minimizeWorkspacePane('w', a.id);
    expect(workspaceBrowserPresented(workspace())).toBe(false);
    store().selectWorkspacePage('w', second);
    expect(workspaceBrowserPresented(workspace())).toBe(true);
    store().toggleBrowser('w');
    expect(page(second).browser?.visible).toBe(false);
    expect(page(first).browser?.visible).toBe(true);
    store().toggleBrowser('w');
    expect(workspace().browserPane).toBe(b);
    store().selectWorkspacePage('w', first);
    store().toggleBrowser('w');
    expect(workspace().activePageId).toBe(first);
    expect(workspace().browserPane).toBe(a);
    expect(workspaceBrowserPresented(workspace())).toBe(true);
    expect(workspace().minimizedPanes).toEqual([]);
  });
  it('cannot remove a page that owns a hidden Browser', () => {
    const { first, second } = twoBrowsers();
    store().toggleBrowser('w');
    expect(workspace().layoutRoot).toBeNull();
    store().selectWorkspacePage('w', first);
    store().removeWorkspacePage('w', second);
    expect(workspace().pages).toHaveLength(2);
    expect(page(second).browser).toBeDefined();
  });
  it('moves ownership without reconstruction, and rejects occupied or hidden destinations', () => {
    const { first, second, a, b } = twoBrowsers();
    store().toggleBrowser('w'); // B still owns the hidden destination
    store().selectWorkspacePage('w', first);
    store().movePaneToWorkspacePage('w', a.id, second, first);
    expect(workspace().activePageId).toBe(first);
    expect(page(first).browser?.pane).toBe(a);
    expect(page(second).browser?.pane).toBe(b);
    store().movePaneToWorkspacePage('w', a.id, undefined, first);
    expect(workspace().pages).toHaveLength(3);
    expect(workspace().browserPane).toBe(a);
    expect(page(first).browser).toBeUndefined();
    expect(page(second).browser?.pane).toBe(b);
  });
  it('backfills legacy singleton state into the initial page', () => {
    const legacy = createWorkspaceFixture({ id: 'legacy', browserVisible: true, browserPane: {
      id: 'old-browser', position: { x: 0, y: 0, w: 6, h: 6 },
      activeTabId: 'old-tab', tabs: [{ id: 'old-tab', url: 'https://github.com', title: '', canGoBack: false, canGoForward: false }],
    } });
    store().addWorkspace(legacy);
    const restored = store().getWorkspaceById('legacy')!;
    expect(restored.pages![0].browser?.pane?.id).toBe('old-browser');
    expect(restored.browserPane).toBe(restored.pages![0].browser?.pane);
  });
});
