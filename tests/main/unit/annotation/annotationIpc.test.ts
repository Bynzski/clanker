import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockHandle, mockOn } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockOn: vi.fn(),
}));
const mockWriteText = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockHandle,
    on: mockOn,
  },
  clipboard: {
    writeText: mockWriteText,
  },
  BrowserWindow: vi.fn(),
  WebContentsView: class MockWebContentsView {
    webContents = {
      executeJavaScript: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
  },
}));

import { ANNOTATION_ENABLE } from '../../../../src/shared/ipcChannels';
import { registerAnnotationIpc } from '../../../../src/main/annotation/annotationIpc';
import { ANNOTATION_EXPORT } from '../../../../src/shared/ipcChannels';

describe('annotationIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes workspace listeners when enablement fails', async () => {
    const executeJavaScript = vi.fn(async (code: string) => {
      if (code.includes('window.__clankerAnnotationEnable__')) {
        throw new Error('page still loading');
      }

      return undefined;
    });

    const view = {
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    };

    const browserViews = new Map([
      ['workspace-1', { view: view as never, url: 'https://example.com' }],
    ]);
    const onAnnotationModeChange = vi.fn();

    registerAnnotationIpc({
      getBrowserViews: () => browserViews as never,
      getActiveBrowserWorkspaceId: () => 'workspace-1',
      getMainWindow: () => ({ webContents: { send: vi.fn() } } as never),
      onAnnotationModeChange,
    });

    const enableHandler = mockHandle.mock.calls.find(([channel]) => channel === ANNOTATION_ENABLE)?.[1];
    expect(enableHandler).toBeTypeOf('function');

    await expect(enableHandler?.({}, 'workspace-1')).resolves.toEqual({
      success: false,
      error: 'page still loading',
    });

    const escapeHandler = view.webContents.on.mock.calls.find(([event]) => event === 'before-input-event')?.[1];
    const navigationHandler = view.webContents.on.mock.calls.find(([event]) => event === 'did-finish-load')?.[1];

    expect(view.webContents.removeListener).toHaveBeenCalledWith('before-input-event', escapeHandler);
    expect(view.webContents.removeListener).toHaveBeenCalledWith('did-finish-load', navigationHandler);
    expect(onAnnotationModeChange).toHaveBeenCalledWith(false);
  });

  it('writes the exported annotation markdown to the clipboard', async () => {
    registerAnnotationIpc({
      getBrowserViews: () => new Map() as never,
      getActiveBrowserWorkspaceId: () => 'workspace-1',
      getMainWindow: () => ({ webContents: { send: vi.fn() } } as never),
    });

    const exportHandler = mockHandle.mock.calls.find(([channel]) => channel === ANNOTATION_EXPORT)?.[1];
    expect(exportHandler).toBeTypeOf('function');

    await expect(exportHandler?.({}, {
      url: 'https://github.com/',
      title: 'GitHub',
      tagName: 'DIV',
      selector: 'div:nth-of-type(1)',
      fallbackSelectors: ['.width-full.d-flex.mt-2'],
      id: null,
      className: 'width-full d-flex mt-2',
      text: 'Bynzski/clanker-built',
      role: null,
      accessibleName: null,
      attributes: {},
      bounds: { x: 24, y: 346, width: 257, height: 21 },
      uiRegion: 'Top repositories',
      elementRoleInContext: 'repository list entry',
      nearbyText: ['Bynzski/base_app', 'Bynzski/LandSnag'],
      ancestorContext: 'left sidebar repository list',
      note: 'this is a DIV',
      timestamp: '2026-04-13T14:51:03.803Z',
    })).resolves.toEqual({ success: true });

    expect(mockWriteText).toHaveBeenCalledWith(expect.stringContaining('### Context'));
  });

  it('resolves the active tab view from nested browser view map', async () => {
    const activeTabView = {
      webContents: {
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    };
    const inactiveTabView = {
      webContents: {
        executeJavaScript: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    };

    const tabViews = new Map([
      ['tab-active', { view: activeTabView as never, url: 'https://example.com' }],
      ['tab-inactive', { view: inactiveTabView as never, url: 'https://other.example.com' }],
    ]);

    const browserViews = new Map([
      ['workspace-1', tabViews as never],
    ]);

    registerAnnotationIpc({
      getBrowserViews: () => browserViews as never,
      getActiveBrowserWorkspaceId: () => 'workspace-1',
      getActiveBrowserTabId: () => 'tab-active',
      getMainWindow: () => ({ webContents: { send: vi.fn() } } as never),
    });

    const enableHandler = mockHandle.mock.calls.find(([channel]) => channel === ANNOTATION_ENABLE)?.[1];
    expect(enableHandler).toBeTypeOf('function');

    await enableHandler?.({}, 'workspace-1');

    // The active tab's view should have been used for attaching handlers
    expect(activeTabView.webContents.on).toHaveBeenCalledWith('before-input-event', expect.any(Function));
    expect(activeTabView.webContents.on).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
    expect(inactiveTabView.webContents.on).not.toHaveBeenCalled();
  });
});
