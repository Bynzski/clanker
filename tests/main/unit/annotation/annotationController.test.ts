import { vi, describe, expect, it, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  WebContentsView: class MockWebContentsView {
    webContents = {
      executeJavaScript: vi.fn(),
    };
  },
}));

import { createAnnotationController } from '../../../../src/main/annotation/annotationController';

describe('annotationController', () => {
  const workspaceId = 'workspace-1';
  const otherWorkspaceId = 'workspace-2';
  const executeJavaScript = vi.fn(async (code: string) => {
    if (code.includes('window.__clankerAnnotationEnable__')) {
      return { success: true, active: true };
    }

    if (code.includes('window.__clankerAnnotationDisable__')) {
      return { success: true };
    }

    if (code.includes('window.__clankerAnnotationData__')) {
      return {
        url: 'https://example.com',
        title: 'Example',
        tagName: 'BUTTON',
        selector: '#save',
        id: 'save',
        className: 'primary',
        text: 'Save',
        role: 'button',
        accessibleName: 'Save',
        attributes: {},
        bounds: { x: 1, y: 2, width: 3, height: 4 },
        note: 'hello',
        timestamp: '2024-01-01T00:00:00.000Z',
      };
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

  const otherExecuteJavaScript = vi.fn(async (code: string) => {
    if (code.includes('window.__clankerAnnotationEnable__')) {
      return { success: true, active: true };
    }

    if (code.includes('window.__clankerAnnotationDisable__')) {
      return { success: true };
    }

    if (code.includes('window.__clankerAnnotationData__')) {
      return {
        url: 'https://example.org',
        title: 'Other',
        tagName: 'A',
        selector: '#link',
        id: 'link',
        className: 'secondary',
        text: 'Link',
        role: 'link',
        accessibleName: 'Link',
        attributes: {},
        bounds: { x: 5, y: 6, width: 7, height: 8 },
        note: 'other',
        timestamp: '2024-01-01T00:00:00.000Z',
      };
    }

    return undefined;
  });

  const otherView = {
    webContents: {
      executeJavaScript: otherExecuteJavaScript,
      on: vi.fn(),
      removeListener: vi.fn(),
    },
  };

  const browserViews = new Map([
    [workspaceId, { view: view as never, url: 'https://example.com' }],
    [otherWorkspaceId, { view: otherView as never, url: 'https://example.org' }],
  ]);

  const controller = createAnnotationController(() => browserViews as never);

  beforeEach(() => {
    executeJavaScript.mockClear();
    otherExecuteJavaScript.mockClear();
  });

  it('reinitializes the runtime after navigation and re-enables annotation mode', async () => {
    await expect(controller.enable(workspaceId)).resolves.toEqual({ success: true });

    expect(executeJavaScript).toHaveBeenCalledTimes(2);
    expect(executeJavaScript.mock.calls[0][0]).toContain('window.__clankerAnnotation__');
    expect(executeJavaScript.mock.calls[1][0]).toContain('window.__clankerAnnotationEnable__');

    await expect(controller.reinitialize()).resolves.toEqual({ success: true });

    expect(executeJavaScript).toHaveBeenCalledTimes(4);
    expect(executeJavaScript.mock.calls[2][0]).toContain('window.__clankerAnnotation__');
    expect(executeJavaScript.mock.calls[3][0]).toContain('window.__clankerAnnotationEnable__');
  });

  it('resets initialization state when disabled', async () => {
    await expect(controller.enable(workspaceId)).resolves.toEqual({ success: true });
    await expect(controller.disable()).resolves.toEqual({ success: true });

    const state = controller.getState();
    expect(state.enabled).toBe(false);
    expect(state.initialized).toBe(false);
    expect(state.workspaceId).toBeNull();
  });

  it('keeps annotation operations scoped to the enabled workspace', async () => {
    await expect(controller.enable(workspaceId)).resolves.toEqual({ success: true });
    await expect(controller.capture()).resolves.toEqual(
      expect.objectContaining({
        success: true,
        annotation: expect.objectContaining({
          url: 'https://example.com',
        }),
      })
    );

    await expect(controller.disable()).resolves.toEqual({ success: true });

    expect(executeJavaScript).toHaveBeenCalled();
    expect(otherExecuteJavaScript).not.toHaveBeenCalled();
  });
});
