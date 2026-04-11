/**
 * Terminal utilities re-exported for main process use.
 *
 * Phase 1: trimBuffer and MAX_TERMINAL_BUFFER_BYTES are deprecated no-ops.
 * xterm.js is the primary buffer/scrollback owner.
 */
export { TERMINAL_SCROLLBACK_LINES, trimBuffer, MAX_TERMINAL_BUFFER_BYTES } from '../shared/terminal';
