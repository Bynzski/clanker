// Git presentation uses the canonical IPC types; do not redefine the status contract here.
export type { VcsProvider } from '../../../shared/types/vcs';
export type {
  GitStatus,
  GitBranch,
  GitRemote,
  GitOperationStateResult as GitOperationState,
  GitStash,
  GitHistoryEntry,
  GitDiffResult,
} from '../../../shared/types/git';

export type DiffMode = 'working' | 'staged' | 'commit';
