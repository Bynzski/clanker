import { toPosixPath } from './pathNormalize';
import { pathKey, runtimeIsWindows } from './pathKey';
import { LOCAL_ENVIRONMENT_ID, type WorkspaceLocation, type WorkspaceEnvironmentId } from './types/environments';
import { isValidWorkspaceEnvironmentId } from './sshValidation';

export type WorkspaceIdentityInput =
  | string
  | WorkspaceLocation
  | { path: string; environmentId?: WorkspaceEnvironmentId };

/**
 * Parse a workspace path or location object into a normalized WorkspaceLocation.
 * Defaults to the built-in 'local' environment if none is specified.
 */
export function parseWorkspaceIdentity(input: WorkspaceIdentityInput): WorkspaceLocation {
  if (typeof input === 'string') {
    const separatorIndex = input.indexOf('::');
    const prefix = input.slice(0, separatorIndex);
    if (separatorIndex !== -1 && isValidWorkspaceEnvironmentId(prefix)) {
      return {
        environmentId: prefix.trim(),
        path: input.slice(separatorIndex + 2),
      };
    }
    return {
      environmentId: LOCAL_ENVIRONMENT_ID,
      path: input,
    };
  }
  return {
    environmentId: (input.environmentId && input.environmentId.trim()) ? input.environmentId.trim() : LOCAL_ENVIRONMENT_ID,
    path: input.path || '',
  };
}

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
 * Returns a canonical key for matching workspace identities (environmentId + canonical path).
 * Case-insensitivity on Windows only applies to local workspaces. Remote workspaces are POSIX.
 */
export function workspaceIdentityKey(input: WorkspaceIdentityInput, isWindows?: boolean): string {
  const loc = parseWorkspaceIdentity(input);
  const normalized = normalizeWorkspacePath(loc.path);
  if (!isValidWorkspaceEnvironmentId(loc.environmentId)) {
    throw new Error('Invalid workspace environment ID');
  }
  const isWindowsPlatform = isWindows ?? runtimeIsWindows();
  const isWindowsLocal = loc.environmentId === LOCAL_ENVIRONMENT_ID && isWindowsPlatform;
  const canonicalPath = pathKey(normalized, isWindowsLocal);
  return `${loc.environmentId}::${canonicalPath}`;
}

/**
 * Compares two workspace identities for equivalence across environments, platforms, and slash styles.
 */
export function isSameWorkspaceIdentity(
  a: WorkspaceIdentityInput,
  b: WorkspaceIdentityInput,
  isWindows?: boolean
): boolean {
  if (!a || !b) return false;
  return workspaceIdentityKey(a, isWindows) === workspaceIdentityKey(b, isWindows);
}
