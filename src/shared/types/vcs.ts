/**
 * Shared VCS types used by both main and renderer.
 */

export type VcsProvider = 'github' | 'gitlab' | 'bitbucket' | 'unknown';

export interface ProviderContext {
  provider: VcsProvider;
  baseUrl: string;
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface PullRequestContext {
  exists: boolean;
  number?: number;
  title?: string;
  state?: 'open' | 'closed' | 'merged';
  url?: string;
  checksStatus?: 'pending' | 'success' | 'failure' | 'error';
  reviewState?: 'approved' | 'changes_requested' | 'commented' | 'pending';
  author?: string;
}

export type DeepLinkType = 'repo' | 'pr' | 'create-pr' | 'issues' | 'releases' | 'actions' | 'branches';

export interface DeepLink {
  type: DeepLinkType;
  url: string;
  label: string;
}

export interface ProviderContextResult {
  success: boolean;
  provider?: ProviderContext;
  pullRequest?: PullRequestContext;
  deepLinks?: DeepLink[];
  error?: string;
}

export type VcsErrorCode = 'not-configured' | 'auth-required' | 'network-error' | 'api-error' | 'unknown-provider';

export interface VcsError {
  code: VcsErrorCode;
  message: string;
  provider?: VcsProvider;
}
