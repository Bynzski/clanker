/**
 * Annotation Controller
 *
 * Main process controller for browser annotation lifecycle.
 * Manages injection of annotation runtime into WebContentsView content.
 *
 * Key responsibilities:
 * - Track annotation mode state per workspace
 * - Inject CSS and JS runtime on enable
 * - Handle navigation events for re-injection
 * - Handle element selection events via return-value capture
 * - Serialize annotation data
 * - Export to clipboard
 */

import { WebContentsView } from 'electron';
import {
  generateAnnotationRuntime,
  generateCaptureCode,
  generateEnableCode,
  generateDisableCode,
  generateCheckCopyTriggerCode,
} from './annotationRuntime';
import { type RawCaptureResult, mapRawCaptureToAnnotationData } from './annotationCaptureParser';

export interface AnnotationState {
  enabled: boolean;
  initialized: boolean;
  workspaceId: string | null;
}

export interface AnnotationCaptureResult {
  success: boolean;
  annotation?: AnnotationData;
  error?: string;
}

export interface AnnotationData {
  url: string;
  title: string;
  tagName: string;
  selector: string;
  fallbackSelectors: string[];
  id: string | null;
  className: string | null;
  text: string | null;
  role: string | null;
  accessibleName: string | null;
  attributes: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number };
  uiRegion: string | null;
  elementRoleInContext: string | null;
  nearbyText: string[];
  ancestorContext: string | null;
  note: string;
  timestamp: string;
}

export interface AnnotationController {
  getState(): AnnotationState;
  enable(workspaceId: string): Promise<{ success: boolean; error?: string }>;
  disable(): Promise<{ success: boolean }>;
  capture(): Promise<AnnotationCaptureResult>;
  checkEscaped(): Promise<boolean>;
  /** Atomically checks and clears the copy trigger flag from the page context. Returns true if a copy was triggered. */
  checkCopyTrigger(): Promise<boolean>;
  reinitialize(): Promise<{ success: boolean; error?: string }>;
}

interface BrowserViewEntry {
  view: WebContentsView;
  url: string;
}

type BrowserViewCollection = Map<string, BrowserViewEntry> | Map<string, Map<string, BrowserViewEntry>>;

/**
 * Create an annotation controller for managing browser annotation lifecycle
 */
export function createAnnotationController(
  getBrowserViews: () => BrowserViewCollection,
  getActiveBrowserView?: (workspaceId: string) => BrowserViewEntry | null
): AnnotationController {
  // State for this controller instance
  const state: AnnotationState = {
    enabled: false,
    initialized: false,
    workspaceId: null,
  };

  function getViewForWorkspace(workspaceId: string | null): WebContentsView | null {
    if (!workspaceId) {
      return null;
    }

    const activeEntry = getActiveBrowserView?.(workspaceId);
    if (activeEntry) {
      return activeEntry.view;
    }

    const workspaceEntry = getBrowserViews().get(workspaceId);
    if (!workspaceEntry) {
      return null;
    }

    if (workspaceEntry instanceof Map) {
      return workspaceEntry.values().next().value?.view ?? null;
    }

    return workspaceEntry.view ?? null;
  }

  /**
   * Execute JavaScript in the browser view for a specific workspace and return the result
   */
  async function executeAndCapture<T>(
    workspaceId: string | null,
    code: string
  ): Promise<{ success: boolean; result?: T; error?: string }> {
    const view = getViewForWorkspace(workspaceId);
    if (!view) {
      return { success: false, error: 'No annotation browser view' };
    }

    try {
      // webContents.executeJavaScript returns Promise<T>
      const result = await view.webContents.executeJavaScript(code);
      return { success: true, result: result as T };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('[Annotation] executeJavaScript error:', error);
      return { success: false, error };
    }
  }

  /**
   * Inject the annotation runtime into a workspace's browser view
   */
  async function injectRuntime(workspaceId: string | null): Promise<{ success: boolean; error?: string }> {
    const view = getViewForWorkspace(workspaceId);
    if (!view) {
      return { success: false, error: 'No annotation browser view' };
    }

    try {
      // Inject runtime - this should only be done once per page load
      const runtimeCode = generateAnnotationRuntime();
      await view.webContents.executeJavaScript(runtimeCode);
      state.initialized = true;
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('[Annotation] Runtime injection error:', error);
      return { success: false, error };
    }
  }

  /**
   * Reinitialize the runtime (after navigation)
   */
  async function reinitializeRuntime(): Promise<{ success: boolean; error?: string }> {
    if (!state.enabled) {
      return { success: true };
    }

    // Reset initialization state and re-inject
    state.initialized = false;
    const injectResult = await injectRuntime(state.workspaceId);
    if (!injectResult.success) {
      return injectResult;
    }

    const enableResult = await executeAndCapture<{ success: boolean; active?: boolean; error?: string }>(
      state.workspaceId,
      generateEnableCode()
    );

    if (!enableResult.success) {
      return { success: false, error: enableResult.error };
    }

    if (enableResult.result?.error) {
      return { success: false, error: enableResult.result.error };
    }

    return { success: true };
  }

  return {
    getState(): AnnotationState {
      return { ...state };
    },

    async enable(workspaceId: string): Promise<{ success: boolean; error?: string }> {
      // Always attempt to verify the runtime is present in the current page.
      // After navigation/reload, the page-context runtime is destroyed but
      // state.initialized may still be true from the previous document.
      // Reset and re-inject to guarantee a fresh runtime.
      //
      // Optimization: if already initialized and enabled for the same workspace,
      // skip re-injection (the runtime is still present in the current document).
      if (state.initialized && state.enabled && state.workspaceId === workspaceId) {
        return { success: true };
      }

      // Force re-injection if the page context may have changed.
      // This handles the post-navigation case where the runtime was destroyed.
      state.initialized = false;

      // Inject runtime fresh
      const injectResult = await injectRuntime(workspaceId);
      if (!injectResult.success) {
        return { success: false, error: injectResult.error };
      }

      // Then enable the annotation mode
      const enableResult = await executeAndCapture<{ success: boolean; active?: boolean; error?: string }>(
        workspaceId,
        generateEnableCode()
      );

      if (!enableResult.success) {
        return { success: false, error: enableResult.error };
      }

      if (enableResult.result?.error) {
        return { success: false, error: enableResult.result.error };
      }

      state.enabled = true;
      state.workspaceId = workspaceId;
      return { success: true };
    },

    async disable(): Promise<{ success: boolean }> {
      if (!state.enabled) {
        return { success: true };
      }

      await executeAndCapture(state.workspaceId, generateDisableCode());

      state.enabled = false;
      state.initialized = false;
      state.workspaceId = null;
      return { success: true };
    },

    async capture(): Promise<AnnotationCaptureResult> {
      const result = await executeAndCapture<RawCaptureResult>(
        state.workspaceId,
        generateCaptureCode(),
      );

      if (!result.success) {
        return { success: false, error: result.error || 'Unknown error' };
      }

      if (result.result?.error) {
        return { success: false, error: result.result.error };
      }

      if (!result.result?.url || !result.result?.selector) {
        return { success: false, error: 'No annotation pending' };
      }

      return {
        success: true,
        annotation: mapRawCaptureToAnnotationData(result.result),
      };
    },

    async checkEscaped(): Promise<boolean> {
      const result = await executeAndCapture<boolean>(state.workspaceId, `
        (function() {
          if (window.__clankerAnnotationCheckEscaped__) {
            return window.__clankerAnnotationCheckEscaped__();
          }
          return false;
        })()
      `);
      return result.success && result.result === true;
    },

    async checkCopyTrigger(): Promise<boolean> {
      if (!state.enabled || !state.workspaceId) {
        return false;
      }
      const result = await executeAndCapture<boolean>(state.workspaceId, generateCheckCopyTriggerCode());
      return result.success && result.result === true;
    },

    async reinitialize(): Promise<{ success: boolean; error?: string }> {
      return reinitializeRuntime();
    },
  };
}

// Re-export formatAnnotationMarkdown for backward compatibility.
// Implementation lives in annotationMarkdownFormatter.ts.
export { formatAnnotationMarkdown } from './annotationMarkdownFormatter';
