/**
 * Canonical path normalization for the IPC boundary.
 *
 * Rule: all paths crossing main↔renderer use POSIX separators (`/`).
 * Main converts incoming paths to native at the boundary, converts
 * outgoing paths back to POSIX before returning. Renderer assumes
 * POSIX everywhere.
 *
 * This module is renderer-safe: pure string transforms only.
 * No Node `path`, `os`, `fs`, or main-process imports.
 */

/**
 * Convert a path to POSIX form (forward slashes).
 * Handles Windows drive letters (`C:\foo` → `C:/foo`) and UNC paths
 * (`\\server\share` → `//server/share`).
 * POSIX paths are returned unchanged.
 */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Convert a POSIX path to native form for the given platform.
 * On Windows (`platform === 'win32'`), converts `/` to `\\` and
 * normalizes drive-letter roots (`C:/foo` → `C:\foo`).
 * On all other platforms, returns the path unchanged.
 *
 * The platform argument is required because this module is renderer-safe
 * and cannot access `process.platform`. Main-process callers should pass
 * `process.platform` explicitly.
 */
export function toNativePath(p: string, platform: string): string {
  if (platform !== 'win32') {
    return p;
  }

  // UNC: //server/share → \\server\share
  if (p.startsWith('//')) {
    return '\\' + p.slice(1).replace(/\//g, '\\');
  }

  // Drive letter: C:/foo → C:\foo
  if (/^[A-Za-z]:\//.test(p)) {
    return p.slice(0, 3).replace(/\//g, '\\') + p.slice(3).replace(/\//g, '\\');
  }

  // Regular path
  return p.replace(/\//g, '\\');
}
