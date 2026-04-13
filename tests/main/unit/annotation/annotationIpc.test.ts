import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockHandle, mockOn } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockOn: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockHandle,
    on: mockOn,
  },
  clipboard: {
    writeText: vi.fn(),
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
});
