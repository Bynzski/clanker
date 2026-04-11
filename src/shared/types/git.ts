/**
 * Shared Git types used by both main and renderer.
 * These types define the contract for Git IPC operations.
 */

import type { VcsProvider } from './vcs';

export type GitErrorCode = 'not-a-repo' | 'git-not-found' | 'unknown';

export interface GitStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

export interface GitStatusResult {
  success: boolean;
  isRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  changes: GitStatus[];
  upstream: string | null;
  ahead: number;
  behind: number;
  errorCode?: GitErrorCode;
  error?: string;
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
}

export interface GitBranchStateResult {
  success: boolean;
  isRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  branches: GitBranch[];
  error?: string;
}

export interface GitDeleteBranchResult {
  success: boolean;
  error?: string;
  blockedByUnmergedCommits?: boolean;
}

export interface GitOperationStateResult {
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

export interface FileDiffResult {
  success: boolean;
  oldContent: string;
  newContent: string;
  oldPath: string;
  newPath: string;
  isBinary: boolean;
  hasDiff: boolean;
  error?: string;
}

export interface GenerateCommitMessageResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitRemotesResult {
  success: boolean;
  remotes: GitRemote[];
  provider: VcsProvider;
  error?: string;
}

export interface GitRemoteOperationResult {
  success: boolean;
  error?: string;
}

export interface GitInitResult {
  success: boolean;
  error?: string;
}
