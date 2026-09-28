import { toPosixPath } from './pathNormalize';
import { pathKey } from './pathKey';

/**
 * Normalize a workspace path to a canonical POSIX representation for durable storage and matching.
 * Strips trailing slashes (except root like "/" or "C:/") and converts backslashes to slashes.
 */
export function normalizeWorkspacePath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== 'string') return '';
  let normalized = toPosixPath(inputPath.trim());
  while (normalized.length > 1 && normalized.endsWith('/') && !/^[A-Za-z]:\/$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Returns a canonical key for matching workspace identities (case-insensitive on Windows).
 */
export function workspaceIdentityKey(workspacePath: string, isWindows?: boolean): string {
  return pathKey(normalizeWorkspacePath(workspacePath), isWindows);
}

/**
 * Compares two workspace paths for equivalence across platforms and slash styles.
 */
export function isSameWorkspaceIdentity(pathA: string, pathB: string, isWindows?: boolean): boolean {
  if (!pathA || !pathB) return false;
  return workspaceIdentityKey(pathA, isWindows) === workspaceIdentityKey(pathB, isWindows);
}
