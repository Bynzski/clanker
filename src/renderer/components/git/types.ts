import type { VcsProvider } from '../../../shared/types/vcs';

export type { VcsProvider };

export interface GitStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
}

export interface GitOperationState {
  success: boolean;
  isRepo: boolean;
  inProgress: boolean;
  mode: 'none' | 'merge' | 'rebase';
  conflicts: string[];
  message: string;
  error?: string;
}

export interface GitStash {
  hash: string;
  ref: string;
  message: string;
}

export interface GitHistoryEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitDiffResult {
  success: boolean;
  output: string;
  title: string;
  error?: string;
}

export type DiffMode = 'working' | 'staged' | 'commit';
