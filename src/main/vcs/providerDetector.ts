/** Provider identity is derived only from validated hosted remote origins. */
import type { ProviderContext, VcsProvider, DeepLink } from './types';
import { parseTrustedRemote } from './trustedRemote';
import { providerLinks } from './providerLinks';

export function parseRemoteUrl(remoteUrl: string): { owner: string; repo: string } | null {
  const parsed = parseTrustedRemote(remoteUrl);
  return parsed ? { owner: parsed.owner, repo: parsed.repo } : null;
}

export function detectProvider(remoteUrl: string): VcsProvider {
  return parseTrustedRemote(remoteUrl)?.provider ?? 'unknown';
}

export function getWebBaseUrl(provider: VcsProvider, remoteUrl?: string): string {
  if (remoteUrl !== undefined) {
    const parsed = parseTrustedRemote(remoteUrl);
    return parsed?.provider === provider ? parsed.baseUrl : '';
  }
  return { github: 'https://github.com', gitlab: 'https://gitlab.com', bitbucket: 'https://bitbucket.org', unknown: '' }[provider];
}

export function getApiBaseUrl(provider: VcsProvider, remoteUrl?: string): string {
  if (remoteUrl !== undefined && detectProvider(remoteUrl) !== provider) return '';
  if (provider === 'gitlab') return `${getWebBaseUrl(provider, remoteUrl)}/api/v4`;
  return { github: 'https://api.github.com', gitlab: 'https://gitlab.com/api/v4', bitbucket: 'https://api.bitbucket.org/2.0', unknown: '' }[provider];
}

export function buildProviderContext(
  _remoteName: string, remoteUrl: string, defaultBranch: string = ''
): ProviderContext | null {
  const parsed = parseTrustedRemote(remoteUrl);
  return parsed ? { ...parsed, defaultBranch } : null;
}

export function buildDeepLink(
  provider: VcsProvider, baseUrl: string, owner: string, repo: string,
  type: DeepLink['type'], branch?: string, prNumber?: number, defaultBranch: string = ''
): string | null {
  return providerLinks({ provider, baseUrl, owner, repo, defaultBranch }, branch, prNumber)
    .find((link) => link.type === type)?.url ?? null;
}

/** Static links never query the provider API or retrieve credentials. */
export function getProviderDeepLinks(
  remoteUrl: string, branch?: string, prNumber?: number, defaultBranch?: string
): DeepLink[] {
  const context = parseTrustedRemote(remoteUrl);
  if (!context) return [];
  return providerLinks({ ...context, defaultBranch: defaultBranch || '' }, branch, prNumber);
}

export function getDeepLinkUrl(
  remoteUrl: string, type: DeepLink['type'], branch?: string, prNumber?: number, defaultBranch?: string
): string | null {
  return getProviderDeepLinks(remoteUrl, branch, prNumber, defaultBranch).find((link) => link.type === type)?.url ?? null;
}
