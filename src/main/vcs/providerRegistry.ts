/**
 * Provider Registry
 * Centralizes provider instances for reuse across services.
 */

import { GitHubProvider, GitLabProvider, BitbucketProvider } from './providers';
import type { IVcsProvider } from './providers/baseProvider';
import type { VcsProvider } from './types';
import { isApprovedGitLabOrigin } from './instancePolicy';

const providerInstances: Record<VcsProvider, IVcsProvider | null> = {
  github: new GitHubProvider(),
  gitlab: new GitLabProvider(),
  bitbucket: new BitbucketProvider(),
  unknown: null,
};

export function getProviderInstance(provider: VcsProvider, origin?: string): IVcsProvider | null {
  if (provider === 'gitlab' && origin && origin !== 'https://gitlab.com') {
    return isApprovedGitLabOrigin(origin) ? new GitLabProvider(origin) : null;
  }
  if (origin && origin !== ({ github: 'https://github.com', gitlab: 'https://gitlab.com', bitbucket: 'https://bitbucket.org', unknown: '' }[provider])) return null;
  return providerInstances[provider] ?? null;
}
