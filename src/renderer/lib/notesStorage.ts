import { pathKey } from '../../shared/pathKey';

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

function getWorkspaceStorageKey(workspacePath: string, workspaceId: string | null): string {
  return normalizeWorkspacePathForStorage(workspacePath) || workspaceId || 'default';
}

export function getNotesContentStorageKey(workspacePath: string, workspaceId: string | null): string {
  return `${NOTES_STORAGE_PREFIX}${getWorkspaceStorageKey(workspacePath, workspaceId)}`;
}

function getNotesVisibilityStorageKey(workspacePath: string, workspaceId: string | null): string {
  return `${NOTES_VISIBILITY_STORAGE_PREFIX}${getWorkspaceStorageKey(workspacePath, workspaceId)}`;
}

export function readStoredNote(storageKey: string): string {
  try {
    return window.localStorage.getItem(storageKey) ?? '';
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

export function readStoredNotesVisible(workspacePath: string, workspaceId: string | null = null): boolean {
  try {
    return window.localStorage.getItem(getNotesVisibilityStorageKey(workspacePath, workspaceId)) === '1';
  } catch {
    return false;
  }
}

export function writeStoredNotesVisible(workspacePath: string, visible: boolean, workspaceId: string | null = null): void {
  try {
    window.localStorage.setItem(getNotesVisibilityStorageKey(workspacePath, workspaceId), visible ? '1' : '0');
  } catch {
    // Non-critical preference persistence; keep pane state changes working.
  }
}
