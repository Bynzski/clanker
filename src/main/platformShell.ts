/**
 * Cross-platform shell and PATH defaults.
 *
 * Single source of truth for the default shell used when spawning terminals
 * and harness sessions. Both `terminalIpc.ts` and `sessionIpc.ts` import
 * from here instead of duplicating the platform branch.
 */

import * as path from 'node:path';
import * as os from 'node:os';

/** Returns the default interactive shell for the current platform. */
export function defaultShell(): string {
  if (process.platform === 'win32') {
    return 'powershell.exe';
  }
  return process.env.SHELL ?? 'bash';
}

/**
 * Returns the platform-appropriate PATH segment to prepend for user-installed
 * CLI tools (e.g., `~/.local/bin` on Linux/macOS).
 *
 * On Windows, returns an empty string — Windows tool installers (npm global,
 * pip, winget) handle PATH registration automatically.
 */
export function userLocalBinPath(): string {
  if (process.platform === 'win32') {
    return '';
  }
  return path.join(os.homedir(), '.local', 'bin');
}

/**
 * Build a PATH value with the user-local bin directory prepended.
 * Uses `path.delimiter` (`:` on Unix, `;` on Windows) for cross-platform
 * correctness.
 */
export function prependUserLocalBinToPath(existingPath: string): string {
  const localBin = userLocalBinPath();
  if (!localBin) {
    return existingPath;
  }
  // Avoid double-prepend
  const segments = existingPath.split(path.delimiter);
  if (segments[0] === localBin) {
    return existingPath;
  }
  return [localBin, existingPath].join(path.delimiter);
}
