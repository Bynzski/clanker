import { pathKey } from '../../shared/pathKey';
import { workspaceIdentityKey } from '../../shared/workspaceIdentity';
import { LOCAL_ENVIRONMENT_ID } from '../../shared/types/environments';

const NOTES_STORAGE_PREFIX = 'clanker-grid:notes:v1:';
const NOTES_VISIBILITY_STORAGE_PREFIX = 'clanker-grid:notes-visible:v1:';

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

function getNotesVisibilityStorageKey(workspacePath: string, workspaceId: string | null, environmentId?: string): string {
  return `${NOTES_VISIBILITY_STORAGE_PREFIX}${encodeURIComponent(workspaceIdentityKey({
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

export function readStoredNotesVisible(
  workspacePath: string,
  workspaceId: string | null = null,
  environmentId?: string,
): boolean {
  try {
    const legacyKey = environmentId == null || environmentId === LOCAL_ENVIRONMENT_ID
      ? `${NOTES_VISIBILITY_STORAGE_PREFIX}${getLegacyWorkspaceStorageKey(workspacePath, workspaceId)}`
      : null;
    return readStoredValue(getNotesVisibilityStorageKey(workspacePath, workspaceId, environmentId), legacyKey) === '1';
  } catch {
    return false;
  }
}

export function writeStoredNotesVisible(
  workspacePath: string,
  visible: boolean,
  workspaceId: string | null = null,
  environmentId?: string,
): void {
  try {
    window.localStorage.setItem(getNotesVisibilityStorageKey(workspacePath, workspaceId, environmentId), visible ? '1' : '0');
  } catch {
    // Non-critical preference persistence; keep pane state changes working.
  }
}
