/**
 * Boolean ↔ string translation layer for harness flags.
 *
 * The UI exposes known boolean-style toggles (yolo/auto mode) per harness.
 * The store field remains `flags: string` for forward compatibility.
 *
 * This module is the ONLY place the renderer maps between booleans and flag strings.
 * UI code calls harnessFlagsFromToggle() and harnessToggleFromFlags() only —
 * it never manipulates the flags string directly.
 */

/**
 * Known boolean flag per harness.
 * Maps harness ID → the flag string to set when the toggle is ON.
 * Only harnesses with a known boolean toggle are listed.
 */
const HARNESS_FLAG_MAP: Record<string, string> = {
  codex:    '--yolo',
  opencode: '--pure',
  claude:   '--dangerously-skip-permissions',
};

/**
 * Resolve the flags string for a harness given the toggle state.
 *
 * @param harnessId  - The harness ID (e.g. 'codex', 'opencode')
 * @param enabled    - Whether the boolean toggle is ON
 * @returns The flags string to store (e.g. '--yolo') or '' if disabled/not known
 */
export function harnessFlagsFromToggle(
  harnessId: string,
  enabled: boolean
): string {
  const flag = HARNESS_FLAG_MAP[harnessId];
  return enabled && flag ? flag : '';
}

/**
 * Resolve the toggle state from the current flags string stored in electron-store.
 *
 * Token matching: the flags string is split on whitespace before testing.
 * '--yolo-extra' does NOT match '--yolo'. This prevents false positives
 * when future multi-word flags are added.
 *
 * @param harnessId - The harness ID (e.g. 'codex', 'opencode')
 * @param flags     - The current flags string from the store (e.g. '--yolo --verbose')
 * @returns true if the harness's known toggle flag is present in the flags string
 */
export function harnessToggleFromFlags(
  harnessId: string,
  flags: string
): boolean {
  const flag = HARNESS_FLAG_MAP[harnessId];
  if (!flag) return false;
  const tokens = flags.trim().split(/\s+/);
  return tokens.includes(flag);
}
