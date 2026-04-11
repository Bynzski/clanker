/**
 * Terminal utilities and constants shared by main and renderer.
 *
 * Phase 1 redesign: xterm.js is now the primary buffer/scrollback owner.
 * The old app-level head-truncated buffer model has been removed.
 * Session continuity across workspace/tab switches is preserved via
 * xterm instance caching in the renderer (see TerminalPane.tsx).
 */

/**
 * Number of scrollback lines xterm.js retains in its internal buffer.
 *
 * Increased from 1000 to 10,000 in Phase 1 to compensate for removal
 * of the app-level buffer. Provides ~400 screens of history at 80×24.
 */
export const TERMINAL_SCROLLBACK_LINES = 10_000;

/**
 * @deprecated Removed in Phase 1 terminal redesign.
 * Kept only for backward-compatible test references.
 * Do not use in new code. xterm.js owns scrollback; no app-level buffer.
 */
export const MAX_TERMINAL_BUFFER_BYTES = 0;

/**
 * @deprecated Removed in Phase 1 terminal redesign.
 * No-op kept for backward-compatible test references.
 */
export function trimBuffer(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _buffer: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _maxBytes: number,
): string {
  return '';
}
