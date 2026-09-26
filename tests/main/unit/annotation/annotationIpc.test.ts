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

import {
  ANNOTATION_ENABLE,
  ANNOTATION_GET_STATE,
  ANNOTATION_STATE_CHANGED,
} from '../../../../src/shared/ipcChannels';
import { registerAnnotationIpc } from '../../../../src/main/annotation/annotationIpc';
import { ANNOTATION_EXPORT } from '../../../../src/shared/ipcChannels';
import { ANNOTATION_PREPARE_SEND } from '../../../../src/shared/ipcChannels';
import { generateCaptureCode, generateDrainActionsCode } from '../../../../src/main/annotation/annotationRuntime';

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

  it('prepares annotation markdown for a trusted preview without copying it', async () => {
    const executeJavaScript = vi.fn(async (code: string) => code === generateCaptureCode()
      ? { url: 'https://example.com/settings', selector: '#save', tagName: 'BUTTON', note: 'Make this clearer' }
      : undefined);
    const view = { webContents: { executeJavaScript, on: vi.fn(), removeListener: vi.fn() } };
    registerAnnotationIpc({
      getBrowserViews: () => new Map([['workspace-1', { view: view as never, url: 'https://example.com/settings' }]]) as never,
      getActiveBrowserWorkspaceId: () => 'workspace-1',
      getMainWindow: () => ({ webContents: { send: vi.fn() } } as never),
    });
    const enable = mockHandle.mock.calls.find(([channel]) => channel === ANNOTATION_ENABLE)?.[1];
    const prepare = mockHandle.mock.calls.find(([channel]) => channel === ANNOTATION_PREPARE_SEND)?.[1];
    await enable?.({}, 'workspace-1');
    const result = await prepare?.({});
    expect(result).toMatchObject({ success: true, message: expect.stringContaining('Make this clearer') });
    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it('processes queued copy and send actions with their own captures in order', async () => {
    let drained = false;
    const executeJavaScript = vi.fn(async (code: string) => {
      if (code !== generateDrainActionsCode() || drained) return undefined;
      drained = true;
      return { actions: [
        { type: 'copy', annotation: { url: 'https://example.com', selector: '#first', tagName: 'BUTTON', note: 'Copy first' } },
        { type: 'send', annotation: { url: 'https://example.com', selector: '#second', tagName: 'BUTTON', note: 'Send second' } },
      ], overflowed: false };
    });
    const view = { webContents: { executeJavaScript, on: vi.fn(), removeListener: vi.fn() } };
    registerAnnotationIpc({
      getBrowserViews: () => new Map([['workspace-1', { view: view as never, url: 'https://example.com' }]]) as never,
      getActiveBrowserWorkspaceId: () => 'workspace-1',
      getMainWindow: () => ({ webContents: { send: vi.fn() } } as never),
    });
    const enable = mockHandle.mock.calls.find(([channel]) => channel === ANNOTATION_ENABLE)?.[1];
    const getState = mockHandle.mock.calls.find(([channel]) => channel === ANNOTATION_GET_STATE)?.[1];
    await enable?.({}, 'workspace-1');
    const state = await getState?.({});
    expect(mockWriteText).toHaveBeenCalledOnce();
    expect(mockWriteText.mock.calls[0][0]).toContain('Copy first');
    expect(mockWriteText.mock.calls[0][0]).not.toContain('Send second');
    expect(state.actions).toEqual([
      { type: 'copy', success: true },
      { type: 'send', success: true, message: expect.stringContaining('Send second') },
    ]);
    expect(state.actions[1].message).not.toContain('Copy first');
    const nextState = await getState?.({});
    expect(nextState?.actions).toEqual([]);
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

  it('emits state changes and removes native listeners when disposed', async () => {
    const send = vi.fn();
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    };
    const controller = registerAnnotationIpc({
      getBrowserViews: () => new Map([
        ['workspace-1', { view: view as never, url: 'https://example.com' }],
      ]) as never,
      getActiveBrowserWorkspaceId: () => 'workspace-1',
      getMainWindow: () => ({ webContents: { send } } as never),
    });
    const enableHandler = mockHandle.mock.calls.find(([channel]) => channel === ANNOTATION_ENABLE)?.[1];

    await enableHandler?.({}, 'workspace-1');
    await controller.dispose();

    expect(send).toHaveBeenCalledWith(ANNOTATION_STATE_CHANGED, expect.objectContaining({
      enabled: true,
      workspaceId: 'workspace-1',
    }));
    expect(send).toHaveBeenLastCalledWith(ANNOTATION_STATE_CHANGED, {
      enabled: false,
      initialized: false,
      workspaceId: null,
    });
    expect(view.webContents.removeListener).toHaveBeenCalledWith('before-input-event', expect.any(Function));
    expect(view.webContents.removeListener).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
  });
});
