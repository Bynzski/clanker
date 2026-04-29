/**
 * Annotation IPC Handlers
 *
 * Registers IPC handlers for browser annotation feature.
 * Provides bridge between renderer and main process annotation controller.
 */

import { ipcMain, clipboard, BrowserWindow, WebContentsView } from 'electron';
import {
  ANNOTATION_ENABLE,
  ANNOTATION_DISABLE,
  ANNOTATION_CAPTURE,
  ANNOTATION_GET_STATE,
  ANNOTATION_EXPORT,
  ANNOTATION_CHECK_ESCAPED,
  ANNOTATION_ESCAPE,
  ANNOTATION_TRIGGER_COPY,
} from '../../shared/ipcChannels';
import { generateDisableCode } from './annotationRuntime';
import {
  createAnnotationController,
  formatAnnotationMarkdown,
  type AnnotationController,
  type AnnotationData,
} from './annotationController';

interface BrowserViewEntry {
  view: WebContentsView;
  url: string;
}

type BrowserViewCollection = Map<string, BrowserViewEntry> | Map<string, Map<string, BrowserViewEntry>>;

interface RegisterAnnotationIpcDeps {
  getBrowserViews: () => BrowserViewCollection;
  getActiveBrowserWorkspaceId: () => string | null;
  getMainWindow: () => BrowserWindow | null;
  getActiveBrowserTabId?: (workspaceId: string) => string | null;
  onAnnotationModeChange?: (enabled: boolean) => void;
}

function isBrowserViewEntry(value: unknown): value is BrowserViewEntry {
  return typeof value === 'object'
    && value !== null
    && 'view' in value
    && (value as BrowserViewEntry).view instanceof WebContentsView;
}

function getBrowserViewEntryForWorkspace(deps: RegisterAnnotationIpcDeps, workspaceId: string): BrowserViewEntry | null {
  const workspaceEntry = deps.getBrowserViews().get(workspaceId);
  if (!workspaceEntry) return null;

  if (workspaceEntry instanceof Map) {
    const activeTabId = deps.getActiveBrowserTabId?.(workspaceId);
    if (activeTabId) {
      return workspaceEntry.get(activeTabId) ?? null;
    }
    return workspaceEntry.values().next().value ?? null;
  }

  return workspaceEntry;
}

export function registerAnnotationIpc(deps: RegisterAnnotationIpcDeps): AnnotationController {
  const controller = createAnnotationController(
    deps.getBrowserViews,
    (workspaceId) => getBrowserViewEntryForWorkspace(deps, workspaceId),
  );

  const escapeHandlers = new Map<string, { view: WebContentsView; handler: (_event: Electron.Event, input: Electron.Input) => void }>();
  const navigationHandlers = new Map<string, { view: WebContentsView; handler: () => void }>();

  function removeHandlersForWorkspace(workspaceId: string): void {
    const escape = escapeHandlers.get(workspaceId);
    if (escape) {
      escape.view.webContents.removeListener('before-input-event', escape.handler);
      escapeHandlers.delete(workspaceId);
    }

    const nav = navigationHandlers.get(workspaceId);
    if (nav) {
      nav.view.webContents.removeListener('did-finish-load', nav.handler);
      navigationHandlers.delete(workspaceId);
    }
  }

  async function disableAnnotationForWorkspace(workspaceId: string): Promise<{ success: boolean }> {
    removeHandlersForWorkspace(workspaceId);
    if (deps.onAnnotationModeChange) {
      deps.onAnnotationModeChange(false);
    }
    return await controller.disable();
  }

  ipcMain.handle(ANNOTATION_ENABLE, async (_, workspaceId: string) => {
    const mainWindow = deps.getMainWindow();
    const entry = getBrowserViewEntryForWorkspace(deps, workspaceId);

    if (mainWindow && entry) {
      removeHandlersForWorkspace(workspaceId);

      const escapeHandler = (_event: Electron.Event, input: Electron.Input) => {
        if (input.key !== 'Escape' || input.type !== 'keyDown') return;

        mainWindow.webContents.send(ANNOTATION_ESCAPE, { workspaceId });

        entry.view.webContents.executeJavaScript(generateDisableCode()).catch(() => {
          // Ignore errors during cleanup
        });

        void controller.disable();
        removeHandlersForWorkspace(workspaceId);

        if (deps.onAnnotationModeChange) {
          deps.onAnnotationModeChange(false);
        }
      };

      entry.view.webContents.on('before-input-event', escapeHandler);
      escapeHandlers.set(workspaceId, { view: entry.view, handler: escapeHandler });

      const navigationHandler = () => {
        const controllerState = controller.getState();
        if (!controllerState.enabled) return;

        void controller.reinitialize().catch((err: unknown) => {
          console.error('[Annotation IPC] Re-injection failed:', err);
        });
      };

      entry.view.webContents.on('did-finish-load', navigationHandler);
      navigationHandlers.set(workspaceId, { view: entry.view, handler: navigationHandler });
    }

    let result;
    try {
      result = await controller.enable(workspaceId);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      result = { success: false, error };
    }

    if (!result.success) {
      removeHandlersForWorkspace(workspaceId);
      if (deps.onAnnotationModeChange) {
        deps.onAnnotationModeChange(false);
      }
      return result;
    }

    if (deps.onAnnotationModeChange) {
      deps.onAnnotationModeChange(true);
    }
    return result;
  });

  ipcMain.handle(ANNOTATION_DISABLE, async () => {
    const workspaceId = controller.getState().workspaceId ?? deps.getActiveBrowserWorkspaceId();
    if (workspaceId) {
      return await disableAnnotationForWorkspace(workspaceId);
    }

    if (deps.onAnnotationModeChange) {
      deps.onAnnotationModeChange(false);
    }
    return await controller.disable();
  });

  ipcMain.handle(ANNOTATION_GET_STATE, async () => {
    const state = controller.getState();
    const copyTriggered = await controller.checkCopyTrigger();
    return { ...state, copyTriggered };
  });

  ipcMain.handle(ANNOTATION_CAPTURE, async () => {
    return await controller.capture();
  });

  ipcMain.handle(ANNOTATION_EXPORT, async (_, capture: AnnotationData) => {
    const markdown = formatAnnotationMarkdown(capture);
    clipboard.writeText(markdown);
    return { success: true };
  });

  ipcMain.handle(ANNOTATION_CHECK_ESCAPED, async () => {
    return await controller.checkEscaped();
  });

  ipcMain.on(ANNOTATION_ESCAPE, () => { });

  ipcMain.handle(ANNOTATION_TRIGGER_COPY, async () => {
    const result = await controller.capture();
    if (!result.success || !result.annotation) {
      return { success: false, error: result.error || 'Capture failed' };
    }
    try {
      const markdown = formatAnnotationMarkdown(result.annotation);
      clipboard.writeText(markdown);
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('[Annotation IPC] Clipboard write failed:', error);
      return { success: false, error };
    }
  });

  return controller;
}

export { getBrowserViewEntryForWorkspace, isBrowserViewEntry };
