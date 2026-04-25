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

/**
 * Create an annotation controller for managing browser annotation lifecycle
 */
export function createAnnotationController(
  getBrowserViews: () => Map<string, BrowserViewEntry>
): AnnotationController {
  // State for this controller instance
  const state: AnnotationState = {
    enabled: false,
    initialized: false,
    workspaceId: null,
  };

  function getViewForWorkspace(workspaceId: string | null): WebContentsView | null {
    if (!workspaceId) {
      console.log('[Annotation] No annotation workspace');
      return null;
    }

    const entry = getBrowserViews().get(workspaceId);
    return entry?.view || null;
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
      console.log('[Annotation] Runtime injected');
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
      console.log('[Annotation] Enable called for workspace:', workspaceId);

      // Always attempt to verify the runtime is present in the current page.
      // After navigation/reload, the page-context runtime is destroyed but
      // state.initialized may still be true from the previous document.
      // Reset and re-inject to guarantee a fresh runtime.
      //
      // Optimization: if already initialized and enabled for the same workspace,
      // skip re-injection (the runtime is still present in the current document).
      if (state.initialized && state.enabled && state.workspaceId === workspaceId) {
        console.log('[Annotation] Already initialized and enabled — skipping injection');
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
      console.log('[Annotation] Enabled successfully');
      return { success: true };
    },

    async disable(): Promise<{ success: boolean }> {
      console.log('[Annotation] Disable called');

      if (!state.enabled) {
        return { success: true };
      }

      await executeAndCapture(state.workspaceId, generateDisableCode());

      state.enabled = false;
      state.initialized = false;
      state.workspaceId = null;
      console.log('[Annotation] Disabled');
      return { success: true };
    },

    async capture(): Promise<AnnotationCaptureResult> {
      console.log('[Annotation] Capture called');

      const result = await executeAndCapture<{
        error?: string;
        url?: string;
        title?: string;
        tagName?: string;
      selector?: string;
      fallbackSelectors?: string[];
      id?: string | null;
      className?: string | null;
      text?: string | null;
      role?: string | null;
      accessibleName?: string | null;
      attributes?: Record<string, string>;
      bounds?: { x: number; y: number; width: number; height: number };
      uiRegion?: string | null;
      elementRoleInContext?: string | null;
      nearbyText?: string[];
      ancestorContext?: string | null;
      note?: string;
      timestamp?: string;
    }>(state.workspaceId, generateCaptureCode());

      if (!result.success) {
        return { success: false, error: result.error || 'Unknown error' };
      }

      if (result.result?.error) {
        return { success: false, error: result.result.error };
      }

      // Validate we got actual annotation data
      if (!result.result?.url || !result.result?.selector) {
        return { success: false, error: 'No annotation pending' };
      }

      return {
        success: true,
        annotation: {
          url: result.result.url,
          title: result.result.title || '',
          tagName: result.result.tagName || 'UNKNOWN',
          selector: result.result.selector || '',
          fallbackSelectors: result.result.fallbackSelectors || [],
          id: result.result.id || null,
          className: result.result.className || null,
          text: result.result.text || null,
          role: result.result.role || null,
          accessibleName: result.result.accessibleName || null,
          attributes: result.result.attributes || {},
          bounds: result.result.bounds || { x: 0, y: 0, width: 0, height: 0 },
          uiRegion: result.result.uiRegion || null,
          elementRoleInContext: result.result.elementRoleInContext || null,
          nearbyText: result.result.nearbyText || [],
          ancestorContext: result.result.ancestorContext || null,
          note: result.result.note || '',
          timestamp: result.result.timestamp || new Date().toISOString(),
        },
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
      console.log('[Annotation] Reinitialize called');
      return reinitializeRuntime();
    },
  };
}

/**
 * Format annotation as Markdown for clipboard export
 * Structured format suitable for pasting into an agent window
 */
export function formatAnnotationMarkdown(capture: AnnotationData): string {
  const formatInlineCodeList = (values: string[]): string => values.map(value => `\`${value}\``).join(', ');
  const formatTextList = (values: string[]): string => values.map(value => `\`${value}\``).join('; ');

  const lines: string[] = [
    '## Page Annotation',
    '',
    `- URL: ${capture.url}`,
    `- Title: ${capture.title}`,
    `- Captured At: ${capture.timestamp}`,
    '',
    '### Selected Element',
    `- Tag: \`${capture.tagName.toLowerCase()}\``,
    `- Primary Selector: \`${capture.selector}\``,
  ];

  if (capture.fallbackSelectors.length > 0) {
    lines.push(`- Fallback Selectors: ${formatInlineCodeList(capture.fallbackSelectors.slice(0, 4))}`);
  }

  if (capture.id) {
    lines.push(`- ID: ${capture.id}`);
  }

  if (capture.className) {
    const classes = capture.className.split(' ').filter(c => c && !c.match(/^_/)).slice(0, 5);
    if (classes.length > 0) {
      lines.push(`- Classes: ${classes.join(' ')}`);
    }
  }

  if (capture.text) {
    lines.push(`- Text: ${capture.text.slice(0, 100)}`);
  }

  if (capture.role) {
    lines.push(`- Role: ${capture.role}`);
  }

  if (capture.accessibleName) {
    lines.push(`- Accessible Name: ${capture.accessibleName}`);
  }

  lines.push(
    `- Bounds: x=${Math.round(capture.bounds.x)} y=${Math.round(capture.bounds.y)} w=${Math.round(capture.bounds.width)} h=${Math.round(capture.bounds.height)}`
  );

  // Always render context section - show what's available
  lines.push('');
  lines.push('### Context');

  if (capture.elementRoleInContext) {
    lines.push(`- Element Role: ${capture.elementRoleInContext}`);
  }

  if (capture.uiRegion) {
    lines.push(`- UI Region: ${capture.uiRegion}`);
  }

  if (capture.ancestorContext) {
    lines.push(`- Ancestor Context: ${capture.ancestorContext}`);
  }

  if (capture.nearbyText.length > 0) {
    lines.push(`- Nearby Text: ${formatTextList(capture.nearbyText.slice(0, 4))}`);
  }

  // If nothing was detected, provide a fallback
  if (!capture.elementRoleInContext && !capture.uiRegion && !capture.ancestorContext && capture.nearbyText.length === 0) {
    lines.push(`- Element Role: ${capture.tagName.toLowerCase()} (not further classified)`);
  }

  if (Object.keys(capture.attributes).length > 0) {
    lines.push('');
    lines.push('### Attributes');
    for (const [key, value] of Object.entries(capture.attributes).slice(0, 10)) {
      lines.push(`- ${key}: ${value}`);
    }
  }

  // Always render annotation section to keep clipboard export structure stable
  lines.push('');
  lines.push('### Annotation');
  const trimmedNote = capture.note.trim();
  lines.push(trimmedNote.length > 0 ? trimmedNote : '_No note provided._');

  return lines.join('\n');
}
