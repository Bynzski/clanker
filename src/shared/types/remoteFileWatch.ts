export const REMOTE_WATCH_MAX_FILES = 128;
export const REMOTE_WATCH_MAX_DIRECTORIES = 128;

export interface RemoteFileWatchRequest {
  workspaceId: string;
  checkoutContextId?: string;
  filePaths: string[];
  directoryPaths: string[];
}

export interface RemoteFileSnapshotTargets {
  filePaths: string[];
  directoryPaths: string[];
}

/** Missing paths have a null fingerprint; inaccessible paths are omitted. */
export interface RemoteFileSnapshot {
  files: Array<{ path: string; fingerprint: string | null }>;
  directories: Array<{ path: string; fingerprint: string | null }>;
}

export interface RemoteFilesChangedEvent {
  workspaceId: string;
  checkoutContextId?: string;
  /** A scoped poll failed; ask Git to re-verify the context, never infer deletion from SSH errors. */
  reconcileCheckout?: boolean;
  files: Array<{ filePath: string; deleted: boolean; initial: boolean }>;
  directoryPaths: string[];
  /** Existing unchanged files let the renderer retry previously failed clean reloads. */
  unchangedFilePaths?: string[];
  /** Existing unchanged directories let Explorer retry failed listings. */
  unchangedDirectoryPaths?: string[];
}
