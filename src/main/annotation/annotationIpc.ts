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

// Browser view entry type matching main.ts
interface BrowserViewEntry {
  view: WebContentsView;
  url: string;
}

interface RegisterAnnotationIpcDeps {
  getBrowserViews: () => Map<string, BrowserViewEntry>;
  getActiveBrowserWorkspaceId: () => string | null;
  getMainWindow: () => BrowserWindow | null;
  onAnnotationModeChange?: (enabled: boolean) => void;
}

export function registerAnnotationIpc(deps: RegisterAnnotationIpcDeps): AnnotationController {
  // Create the controller with proper types
  const controller = createAnnotationController(deps.getBrowserViews);

  // Track escape handlers per workspace
  const escapeHandlers = new Map<string, (_event: Electron.Event, input: Electron.Input) => void>();

  // Track navigation handlers per workspace (for re-injection after navigation)
  const navigationHandlers = new Map<string, () => void>();

  /**
   * Remove escape and navigation handlers for a workspace.
   * Called during disable and cleanup.
   */
  function removeHandlersForWorkspace(workspaceId: string): void {
    const escapeHandler = escapeHandlers.get(workspaceId);
    if (escapeHandler) {
      const entry = deps.getBrowserViews().get(workspaceId);
      if (entry) {
        entry.view.webContents.removeListener('before-input-event', escapeHandler);
      }
      escapeHandlers.delete(workspaceId);
    }

    const navHandler = navigationHandlers.get(workspaceId);
    if (navHandler) {
      const entry = deps.getBrowserViews().get(workspaceId);
      if (entry) {
        entry.view.webContents.removeListener('did-finish-load', navHandler);
      }
      navigationHandlers.delete(workspaceId);
    }
  }

  // Handle: Enable annotation mode
  ipcMain.handle(ANNOTATION_ENABLE, async (_, workspaceId: string) => {
    console.log('[Annotation IPC] Enable:', workspaceId);

    const mainWindow = deps.getMainWindow();
    const entry = deps.getBrowserViews().get(workspaceId);

    if (mainWindow && entry) {
      // Remove any previous handlers for this workspace (idempotent enable)
      removeHandlersForWorkspace(workspaceId);

      // Set up escape handling via before-input-event on the active WebContentsView.
      // Only fires on Escape keyDown — ordinary typing must not cancel annotation mode.
      const escapeHandler = (_event: Electron.Event, input: Electron.Input) => {
        if (input.key !== 'Escape' || input.type !== 'keyDown') return;
        console.log('[Annotation IPC] Escape captured in main process');

        // Notify renderer via main window
        mainWindow.webContents.send(ANNOTATION_ESCAPE, { workspaceId });

        // Also clean up in the browser content
        entry.view.webContents.executeJavaScript(generateDisableCode()).catch(() => {
          // Ignore errors during cleanup
        });

        // Disable the controller state
        void controller.disable();

        // Remove handlers — annotation mode is now fully off
        removeHandlersForWorkspace(workspaceId);

        if (deps.onAnnotationModeChange) {
          deps.onAnnotationModeChange(false);
        }
      };

      entry.view.webContents.on('before-input-event', escapeHandler);
      escapeHandlers.set(workspaceId, escapeHandler);

      // Set up re-injection after navigation/reload.
      // The runtime lives in page-context and is destroyed on navigation.
      // We must re-inject and re-enable when the new page finishes loading.
      const navigationHandler = () => {
        const controllerState = controller.getState();
        if (!controllerState.enabled) return;

        console.log('[Annotation IPC] Page navigated — re-injecting annotation runtime');

        // Reinitialize the page runtime after navigation destroys the old document context.
        void controller.reinitialize().catch((err: unknown) => {
          console.error('[Annotation IPC] Re-injection failed:', err);
        });
      };

      entry.view.webContents.on('did-finish-load', navigationHandler);
      navigationHandlers.set(workspaceId, navigationHandler);
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

  // Handle: Disable annotation mode
  ipcMain.handle(ANNOTATION_DISABLE, async () => {
    console.log('[Annotation IPC] Disable');

    // Clean up all handlers for the active workspace
    const workspaceId = controller.getState().workspaceId ?? deps.getActiveBrowserWorkspaceId();
    if (workspaceId) {
      removeHandlersForWorkspace(workspaceId);
    }

    if (deps.onAnnotationModeChange) {
      deps.onAnnotationModeChange(false);
    }
    return await controller.disable();
  });

  // Handle: Get current state (includes copy trigger flag from page context)
  ipcMain.handle(ANNOTATION_GET_STATE, async () => {
    const state = controller.getState();
    // Check and clear the copy trigger atomically. If set, the renderer should
    // immediately invoke ANNOTATION_TRIGGER_COPY to complete the capture+export path.
    const copyTriggered = await controller.checkCopyTrigger();
    return { ...state, copyTriggered };
  });

  // Handle: Capture annotation from page
  ipcMain.handle(ANNOTATION_CAPTURE, async () => {
    console.log('[Annotation IPC] Capture');
    return await controller.capture();
  });

  // Handle: Export annotation to clipboard
  ipcMain.handle(ANNOTATION_EXPORT, async (_, capture: AnnotationData) => {
    console.log('[Annotation IPC] Export');
    const markdown = formatAnnotationMarkdown(capture);
    clipboard.writeText(markdown);
    return { success: true };
  });

  // Handle: Check if Escape was pressed in page
  ipcMain.handle(ANNOTATION_CHECK_ESCAPED, async () => {
    return await controller.checkEscaped();
  });

  // Event channel: main -> renderer (no handler needed, just for registration)
  ipcMain.on(ANNOTATION_ESCAPE, () => { });

  // Handle: Trigger copy — capture from page, format as markdown, write to clipboard.
  // This is the bridge between the in-page Copy button click and the clipboard write.
  ipcMain.handle(ANNOTATION_TRIGGER_COPY, async () => {
    console.log('[Annotation IPC] Trigger copy');
    const result = await controller.capture();
    if (!result.success || !result.annotation) {
      console.log('[Annotation IPC] Capture failed:', result.error);
      return { success: false, error: result.error || 'Capture failed' };
    }
    try {
      const markdown = formatAnnotationMarkdown(result.annotation);
      clipboard.writeText(markdown);
      console.log('[Annotation IPC] Annotation written to clipboard');
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('[Annotation IPC] Clipboard write failed:', error);
      return { success: false, error };
    }
  });

  console.log('[Annotation IPC] Registered');

  return controller;
}
