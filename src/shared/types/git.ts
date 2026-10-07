/**
 * Shared Git types used by both main and renderer.
 * These types define the contract for Git IPC operations.
 */

import type { CheckoutContext } from './checkoutContext';

import type { VcsProvider } from './vcs';

export type GitErrorCode = 'not-a-repo' | 'git-not-found' | 'unknown';

export interface GitStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

export interface GitStatusResult {
  workspacePath?: string;
  workspaceId?: string;
  environmentId?: string;
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

export interface GitWorktree {
  path: string;
  branch: string | null;
  isMain: boolean;
  isLocked: boolean;
  isPrunable: boolean;
  /** Git's authoritative reasons, when supplied by porcelain output. */
  lockReason?: string;
  pruneReason?: string;
}

export interface GitWorktreeListResult {
  success: boolean;
  worktrees: GitWorktree[];
  error?: string;
}

/**
 * Opt-in for `gitCreateWorktree`. A workspace id alone only routes the Git operation (the remote
 * New Workspace flow passes the id of an open repository workspace and then opens the checkout as
 * a separate workspace), so attaching a checkout context must be asked for explicitly. It carries
 * no path or identity; main derives everything from the workspace named by the call.
 */
export interface GitCreateWorktreeOptions {
  attachCheckoutContext?: boolean;
}

export interface GitWorktreeCreateResult {
  success: boolean;
  worktree?: GitWorktree;
  /**
   * Present only when the caller asked to attach (`GitCreateWorktreeOptions`) and the new checkout
   * was attached to its registered workspace. Authority: main derives every field (path, branch, kind, mainCheckoutPath)
   * from Git and environment validation; nothing here comes from renderer input.
   */
  checkoutContext?: CheckoutContext;
  /**
   * True when the checkout exists even though `success` is false: a workspace-scoped create made
   * the worktree but attaching it to the workspace failed. The checkout and its branch are
   * kept (never auto-deleted) and appear in a normal worktree refresh; `worktree` identifies them.
   */
  created?: boolean;
  error?: string;
}

/** Bounded relative examples; counts include entries omitted from the examples. */
export interface GitWorktreeChanges {
  tracked: { count: number; paths: string[] };
  untracked: { count: number; paths: string[] };
  ignored: { count: number; paths: string[] };
}

/** Main-owned removal preference; ordinary renderer removal remains strict. */
export interface GitWorktreeRemovalOptions {
  discardIgnored?: boolean;
}

export interface GitWorktreeInspectionResult {
  success: boolean;
  worktree?: GitWorktree;
  hasChanges?: boolean;
  changes?: GitWorktreeChanges;
  error?: string;
}

export interface GitWorktreeRemoveResult {
  success: boolean;
  error?: string;
  warning?: string;
  recoveryPath?: string;
}

/**
 * Result of `git worktree prune --expire now`. Pruning is repository-wide: it drops the Git records
 * of every linked worktree whose directory is already gone. It never deletes a branch or a directory.
 */
export interface GitWorktreePruneResult {
  success: boolean;
  /** Paths whose stale records were removed (empty when nothing was stale). */
  pruned: string[];
  error?: string;
}

export interface GitWorktreeUnlockResult {
  success: boolean;
  error?: string;
}
