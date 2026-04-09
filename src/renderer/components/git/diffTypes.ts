/**
 * Types for the per-file diff viewer feature.
 */

/** Parameters needed to request a file diff from the main process. */
export interface FileDiffRequest {
  /** Absolute workspace path */
  workspacePath: string;
  /** Relative file path within the workspace */
  filePath: string;
  /** Whether to show staged or working tree diff */
  mode: 'working' | 'staged';
}

/** State of the diff viewer modal. */
export interface DiffViewerState {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** The file being viewed */
  filePath: string | null;
  /** Old (HEAD) content */
  oldContent: string;
  /** New (working/staged) content */
  newContent: string;
  /** Old file path (same as filePath unless renamed) */
  oldPath: string;
  /** New file path */
  newPath: string;
  /** Whether the file is binary */
  isBinary: boolean;
  /** Whether content differs */
  hasDiff: boolean;
  /** Loading state */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
}

/** The initial (closed) state for DiffViewerState. */
export const initialDiffViewerState: DiffViewerState = {
  isOpen: false,
  filePath: null,
  oldContent: '',
  newContent: '',
  oldPath: '',
  newPath: '',
  isBinary: false,
  hasDiff: false,
  isLoading: false,
  error: null,
};
