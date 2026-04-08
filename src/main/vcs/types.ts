/**
 * VCS Types
 * Shared type definitions for remote VCS provider integration.
 */

export type VcsProvider = 'github' | 'gitlab' | 'bitbucket' | 'unknown';

/**
 * Provider context extracted from git remote URL.
 */
export interface ProviderContext {
  provider: VcsProvider;
  /** Base URL: https://github.com or custom for GitLab */
  baseUrl: string;
  owner: string;
  repo: string;
  defaultBranch: string;
}

/**
 * Pull request/merge request information for a branch.
 */
export interface PullRequestContext {
  /** Whether a PR/MR exists for the current branch */
  exists: boolean;
  /** PR/MR number (if exists) */
  number?: number;
  /** PR/MR title (if exists) */
  title?: string;
  /** PR/MR state */
  state?: 'open' | 'closed' | 'merged';
  /** Direct URL to the PR/MR */
  url?: string;
  /** CI/check status */
  checksStatus?: 'pending' | 'success' | 'failure' | 'error';
  /** Review state */
  reviewState?: 'approved' | 'changes_requested' | 'commented' | 'pending';
  /** Author login */
  author?: string;
}

/**
 * Branch context combining local and remote state.
 */
export interface BranchContext {
  localBranch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** Provider context (if remote detected) */
  provider?: ProviderContext;
  /** PR/MR context (if exists) */
  pullRequest?: PullRequestContext;
}

/**
 * Deep link types for quick navigation.
 */
export type DeepLinkType = 'repo' | 'pr' | 'create-pr' | 'issues' | 'releases' | 'actions' | 'branches';

/**
 * A deep link to a provider page.
 */
export interface DeepLink {
  type: DeepLinkType;
  url: string;
  label: string;
}

/**
 * Result of fetching provider context.
 */
export interface ProviderContextResult {
  success: boolean;
  provider?: ProviderContext;
  pullRequest?: PullRequestContext;
  error?: string;
}

/**
 * GitHub API response types (minimal subset).
 */
export interface GitHubRepo {
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: { login: string };
  merged_at: string | null;
}

export interface GitHubCommitStatus {
  state: 'pending' | 'success' | 'failure' | 'error';
  statuses: Array<{
    state: string;
    context: string;
  }>;
}

export interface GitHubReview {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';
  user: { login: string };
}

/**
 * Error types for VCS operations.
 */
export type VcsErrorCode = 'not-configured' | 'auth-required' | 'network-error' | 'api-error' | 'unknown-provider';

export interface VcsError {
  code: VcsErrorCode;
  message: string;
  provider?: VcsProvider;
}
