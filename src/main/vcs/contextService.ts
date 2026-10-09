/**
 * Context Service
 * Orchestrates VCS provider calls to get context about the current repository.
 */

import { buildProviderContext } from './providerDetector';
import { assertVcsBudget, withVcsBudget, type VcsRequestOptions } from './requestBudget';
import { getProviderInstance } from './providerRegistry';
import { getPat } from '../credential/credentialService';
import type {
  PullRequestContext,
  ProviderContextResult,
  VcsProvider,
} from './types';

export { getProviderDeepLinks, getDeepLinkUrl } from './providerDetector';

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
  defaultBranch: string = 'main',
  options: VcsRequestOptions = {}
): Promise<ProviderContextResult> {
  return withVcsBudget(async () => {
    try {
      return await fetchProviderContext(remoteName, remoteUrl, branch, defaultBranch);
    } catch {
      // Do not leak provider/network error messages, URLs or token details.
      const provider = buildProviderContext(remoteName, remoteUrl, defaultBranch);
      return {
        success: false, error: 'Provider context cancelled, timed out, or unavailable.',
        ...(provider ? { provider, deepLinks: getProviderInstance(provider.provider)?.getDeepLinks(provider, branch) ?? [] } : {}),
      };
    }
  }, options);
}

async function fetchProviderContext(
  remoteName: string, remoteUrl: string, branch: string, defaultBranch: string
): Promise<ProviderContextResult> {
  assertVcsBudget();
  // Build basic context from remote URL
  let providerContext = buildProviderContext(remoteName, remoteUrl, defaultBranch);
  if (!providerContext) {
    return {
      success: false,
      error: 'Could not detect provider from remote URL',
    };
  }

  const provider = getProviderInstance(providerContext.provider);
  if (!provider) {
    // Provider not yet implemented
    return {
      success: true,
      provider: providerContext,
      pullRequest: { exists: false },
      deepLinks: [],
    };
  }

  // Get token if available
  const token = getProviderToken(providerContext.provider);

  // Ensure default branch reflects remote state
  const resolvedDefaultBranch = await provider.getDefaultBranch(providerContext, token);
  providerContext = {
    ...providerContext,
    defaultBranch: resolvedDefaultBranch,
  };

  assertVcsBudget();
  // Fetch PR info
  const prResult = await provider.getPullRequestForBranch(providerContext, branch, token);

  assertVcsBudget();
  // Fetch checks status if PR exists
  let checksStatus: 'pending' | 'success' | 'failure' | 'error' = 'pending';
  if (pullRequestExists(prResult)) {
    checksStatus = await provider.getChecksStatus(providerContext, branch, token);
  }

  assertVcsBudget();
  // Fetch review state if PR exists
  let reviewState: PullRequestContext['reviewState'];
  if (pullRequestExists(prResult) && prResult.number) {
    reviewState = await provider.getReviewState(
      providerContext,
      prResult.number,
      token
    );
  }

  assertVcsBudget();
  // Combine into full pull request context
  const fullPullRequest: PullRequestContext = {
    ...prResult,
    checksStatus,
    reviewState,
  };

  const deepLinks = provider.getDeepLinks(
    providerContext,
    branch,
    fullPullRequest.number
  );

  return {
    success: true,
    provider: providerContext,
    pullRequest: fullPullRequest,
    deepLinks,
  };
}

/** Only PR identity needs discovery for a navigation request; never fetch CI/reviews. */
export async function getProviderPrLink(remoteUrl: string, branch?: string): Promise<string | null> {
  if (!branch) return null;
  const context = buildProviderContext('origin', remoteUrl);
  const provider = context && getProviderInstance(context.provider);
  if (!context || !provider) return null;
  return withVcsBudget(async () => {
    try {
      assertVcsBudget();
      const pr = await provider.getPullRequestForBranch(context, branch, getProviderToken(context.provider));
      assertVcsBudget();
      return pr.exists ? provider.getDeepLinks(context, undefined, pr.number).find((link) => link.type === 'pr')?.url ?? null : null;
    } catch {
      return null;
    }
  });
}

/**
 * Helper to check if a pull request exists.
 */
function pullRequestExists(pr: PullRequestContext | undefined): pr is PullRequestContext & { exists: true } {
  return pr !== undefined && pr.exists === true;
}
