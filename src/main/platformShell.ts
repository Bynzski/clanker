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
 * Returns common user-level CLI bin directories for this platform.
 *
 * Linux desktop launches frequently do not inherit the user's interactive shell
 * PATH, so npm global installs under `~/.npm-global/bin` would otherwise be
 * invisible to harness discovery and launch.
 */
export function userCliBinPaths(homeDir = os.homedir()): string[] {
  if (process.platform === 'win32') {
    return [
      ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : []),
      ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'npm')] : []),
    ];
  }

  return [
    path.join(homeDir, '.npm-global', 'bin'),
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, '.npm-packages', 'bin'),
    path.join(homeDir, 'bin'),
  ];
}

/**
 * Returns the canonical platform user-local bin path.
 * Retained for callers/tests that only need the XDG-style location.
 */
export function userLocalBinPath(): string {
  return process.platform === 'win32' ? '' : path.join(os.homedir(), '.local', 'bin');
}

/** Build a PATH value with known user CLI bin directories prepended. */
export function prependUserCliBinsToPath(existingPath: string, homeDir = os.homedir()): string {
  const existingSegments = existingPath.split(path.delimiter).filter(Boolean);
  const existingSet = new Set(existingSegments);
  const prependSegments = userCliBinPaths(homeDir).filter((entry) => entry && !existingSet.has(entry));
  return [...prependSegments, ...existingSegments].join(path.delimiter);
}

/** Backwards-compatible alias for the broader user CLI PATH augmentation. */
export function prependUserLocalBinToPath(existingPath: string): string {
  return prependUserCliBinsToPath(existingPath);
}
