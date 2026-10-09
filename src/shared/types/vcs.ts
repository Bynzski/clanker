/**
 * Shared VCS types used by both main and renderer.
 */

export type VcsProvider = 'github' | 'gitlab' | 'bitbucket' | 'unknown';

export interface ProviderContext {
  provider: VcsProvider;
  baseUrl: string;
  owner: string;
  repo: string;
  /** Empty means unknown; never an assumed main branch. */
  defaultBranch: string;
  headSha?: string;
  /** Main-derived association only; never accepted from the renderer. */
  pullRequestNumber?: number;
  pullRequestRepositoryPath?: string;
}

export interface PullRequestContext {
  /** False only on confirmed absence; undefined on unavailable discovery. */
  exists?: boolean;
  outcome?: 'found' | 'none' | VcsProblemCode;
  problem?: VcsProblem;
  headSha?: string;
  number?: number;
  title?: string;
  state?: 'open' | 'closed' | 'merged';
  url?: string;
  checksStatus?: 'pending' | 'success' | 'failure' | 'error';
  reviewState?: 'approved' | 'changes_requested' | 'commented' | 'pending';
  author?: string;
  /** Provider-derived MR target namespace; descriptive, never IPC authority. */
  repositoryPath?: string;
}

export type DeepLinkType = 'repo' | 'pr' | 'create-pr' | 'issues' | 'releases' | 'actions' | 'branches';

export interface DeepLink {
  type: DeepLinkType;
  url: string;
  label: string;
}

export type VcsProblemCode = 'auth-required' | 'forbidden' | 'rate-limited' | 'network-error'
  | 'unsupported' | 'cancelled' | 'timeout' | 'malformed-response' | 'response-too-large'
  | 'incomplete' | 'not-found' | 'stale' | 'unknown';
export interface VcsProblem {
  code: VcsProblemCode;
  /** Stable application text, never provider exception/body text. */
  message: string;
  retryAfterMs?: number;
}
export interface CiSummary {
  state: 'success' | 'failure' | 'pending' | 'none' | 'unknown';
  sha?: string;
  problem?: VcsProblem;
}
export interface ReviewSummary {
  state: 'approved' | 'changes_requested' | 'pending' | 'none' | 'unknown';
  problem?: VcsProblem;
}
export interface VcsRequestIdentity {
  workspaceId?: string;
  environmentId: string;
  checkoutContextId?: string;
  checkoutPath: string;
  remoteName: string;
  remoteUrl: string;
  branch: string | null;
  headSha: string;
}
export interface VcsRequestOptions {
  checkoutContextId?: string;
  refresh?: boolean;
}

export interface ProviderContextResult {
  ci?: CiSummary;
  review?: ReviewSummary;
  problem?: VcsProblem;
  identity?: VcsRequestIdentity;
  credential?: { stored: boolean; decryptable: boolean; repositoryAccess: 'available' | 'unavailable' | 'unknown' };
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

export type VcsContextResult = ProviderContextResult;

export type VcsPrInfoResult = ProviderContextResult;
