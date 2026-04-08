/**
 * Context Service
 * Orchestrates VCS provider calls to get context about the current repository.
 */

import { GitHubProvider, GitLabProvider, BitbucketProvider } from './providers';
import type { IVcsProvider } from './providers/baseProvider';
import { buildProviderContext } from './providerDetector';
import { getPat } from '../credential/credentialService';
import type {
  PullRequestContext,
  ProviderContextResult,
  VcsProvider,
} from './types';

export { getProviderDeepLinks, getDeepLinkUrl } from './providerDetector';

/**
 * Map of provider type to provider instance.
 */
const providerMap: Record<VcsProvider, IVcsProvider | null> = {
  github: new GitHubProvider(),
  gitlab: new GitLabProvider(),
  bitbucket: new BitbucketProvider(),
  unknown: null,
};

/**
 * Get a provider instance for the given type.
 */
function getProvider(type: VcsProvider): IVcsProvider | null {
  return providerMap[type];
}

/**
 * Get the stored PAT for a provider if available.
 */
function getProviderToken(provider: VcsProvider): string | undefined {
  if (provider === 'unknown') return undefined;

  const result = getPat(provider);
  if (result.success && result.token) {
    return result.token;
  }
  return undefined;
}

/**
 * Get provider context for a repository.
 * Combines local git info with remote API data.
 */
export async function getProviderContext(
  remoteName: string,
  remoteUrl: string,
  branch: string,
  defaultBranch: string = 'main'
): Promise<ProviderContextResult> {
  // Build basic context from remote URL
  const providerContext = buildProviderContext(remoteName, remoteUrl, defaultBranch);
  if (!providerContext) {
    return {
      success: false,
      error: 'Could not detect provider from remote URL',
    };
  }

  const provider = getProvider(providerContext.provider);
  if (!provider) {
    // Provider not yet implemented
    return {
      success: true,
      provider: providerContext,
      pullRequest: { exists: false },
    };
  }

  // Get token if available
  const token = getProviderToken(providerContext.provider);

  // Fetch PR info
  const prResult = await provider.getPullRequestForBranch(providerContext, branch, token);

  // Fetch checks status if PR exists
  let checksStatus: 'pending' | 'success' | 'failure' | 'error' = 'pending';
  if (pullRequestExists(prResult)) {
    checksStatus = await provider.getChecksStatus(providerContext, branch, token);
  }

  // Fetch review state if PR exists
  let reviewState: PullRequestContext['reviewState'];
  if (pullRequestExists(prResult) && prResult.number) {
    reviewState = await provider.getReviewState(
      providerContext,
      prResult.number,
      token
    );
  }

  // Combine into full pull request context
  const fullPullRequest: PullRequestContext = {
    ...prResult,
    checksStatus,
    reviewState,
  };

  return {
    success: true,
    provider: providerContext,
    pullRequest: fullPullRequest,
  };
}

/**
 * Helper to check if a pull request exists.
 */
function pullRequestExists(pr: PullRequestContext | undefined): pr is PullRequestContext & { exists: true } {
  return pr !== undefined && pr.exists === true;
}
