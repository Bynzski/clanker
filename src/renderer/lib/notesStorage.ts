import { pathKey } from '../../shared/pathKey';
import { workspaceIdentityKey } from '../../shared/workspaceIdentity';
import { LOCAL_ENVIRONMENT_ID } from '../../shared/types/environments';

const NOTES_STORAGE_PREFIX = 'clanker-grid:notes:v1:';

function trimTrailingSlashes(value: string): string {
  let result = value;
  while (
    result.length > 1 &&
    result.endsWith('/') &&
    !/^[A-Za-z]:\/$/.test(result) &&
    result !== '//'
  ) {
    result = result.slice(0, -1);
  }
  return result;
}

function normalizeWorkspacePathForStorage(workspacePath: string): string {
  const normalized = trimTrailingSlashes(workspacePath.trim().replace(/\\/g, '/'));
  return pathKey(normalized);
}

function getLegacyWorkspaceStorageKey(workspacePath: string, workspaceId: string | null): string {
  return normalizeWorkspacePathForStorage(workspacePath) || workspaceId || 'default';
}

export function getNotesContentStorageKey(
  workspacePath: string,
  workspaceId: string | null,
  environmentId?: string,
): string {
  return `${NOTES_STORAGE_PREFIX}${encodeURIComponent(workspaceIdentityKey({
    path: workspacePath || workspaceId || 'default',
    environmentId,
  }))}`;
}

function readStoredValue(key: string, legacyKey: string | null): string | null {
  const value = window.localStorage.getItem(key);
  if (value !== null || legacyKey === null) return value;
  const legacyValue = window.localStorage.getItem(legacyKey);
  if (legacyValue !== null) {
    try {
      window.localStorage.setItem(key, legacyValue);
    } catch {
      // Existing local notes remain readable if migrating the key is blocked.
    }
  }
  return legacyValue;
}

export function readStoredNote(workspacePath: string, workspaceId: string | null, environmentId?: string): string {
  try {
    const legacyKey = environmentId == null || environmentId === LOCAL_ENVIRONMENT_ID
      ? `${NOTES_STORAGE_PREFIX}${getLegacyWorkspaceStorageKey(workspacePath, workspaceId)}`
      : null;
    return readStoredValue(getNotesContentStorageKey(workspacePath, workspaceId, environmentId), legacyKey) ?? '';
  } catch {
    return '';
  }
}

export function writeStoredNote(storageKey: string, value: string): void {
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Ignore storage failures so typing never blocks on quota or privacy-mode errors.
  }
}
