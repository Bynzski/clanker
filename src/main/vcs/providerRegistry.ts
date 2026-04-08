/**
 * Provider Registry
 * Centralizes provider instances for reuse across services.
 */

import { GitHubProvider, GitLabProvider, BitbucketProvider } from './providers';
import type { IVcsProvider } from './providers/baseProvider';
import type { VcsProvider } from './types';

const providerInstances: Record<VcsProvider, IVcsProvider | null> = {
  github: new GitHubProvider(),
  gitlab: new GitLabProvider(),
  bitbucket: new BitbucketProvider(),
  unknown: null,
};

export function getProviderInstance(provider: VcsProvider): IVcsProvider | null {
  return providerInstances[provider] ?? null;
}
