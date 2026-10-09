/** Provider identity is derived only from validated hosted remote origins. */
import type { ProviderContext, VcsProvider, DeepLink } from './types';
import { parseTrustedRemote } from './trustedRemote';

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
  return { github: 'https://api.github.com', gitlab: 'https://gitlab.com/api/v4', bitbucket: 'https://api.bitbucket.org/2.0', unknown: '' }[provider];
}

export function buildProviderContext(
  _remoteName: string, remoteUrl: string, defaultBranch: string = 'main'
): ProviderContext | null {
  const parsed = parseTrustedRemote(remoteUrl);
  return parsed ? { ...parsed, defaultBranch } : null;
}

export function buildDeepLink(
  _provider: VcsProvider, baseUrl: string, owner: string, repo: string,
  type: DeepLink['type'], branch?: string, prNumber?: number, defaultBranch: string = 'main'
): string {
  const path = `/${owner}/${repo}`;
  switch (type) {
    case 'repo': return `${baseUrl}${path}`;
    case 'pr': return prNumber ? `${baseUrl}${path}/pull/${prNumber}` : `${baseUrl}${path}/pulls`;
    case 'create-pr': return branch
      ? `${baseUrl}${path}/compare/${encodeURIComponent(defaultBranch || 'main')}...${encodeURIComponent(branch)}`
      : `${baseUrl}${path}/compare`;
    case 'issues': return `${baseUrl}${path}/issues`;
    case 'releases': return `${baseUrl}${path}/releases`;
    case 'actions': return `${baseUrl}${path}/actions`;
    case 'branches': return `${baseUrl}${path}/branches`;
    default: return `${baseUrl}${path}`;
  }
}

/** Static links never query the provider API or retrieve credentials. */
export function getProviderDeepLinks(
  remoteUrl: string, branch?: string, prNumber?: number, defaultBranch?: string
): DeepLink[] {
  const context = parseTrustedRemote(remoteUrl);
  if (!context) return [];
  const { provider, baseUrl, owner, repo } = context;
  const link = (type: DeepLink['type'], label: string): DeepLink => ({
    type, label, url: buildDeepLink(provider, baseUrl, owner, repo, type, branch, prNumber, defaultBranch),
  });
  const links = [link('repo', 'Repository')];
  if (prNumber) links.push(link('pr', `PR #${prNumber}`));
  if (branch) links.push(link('create-pr', 'Create Pull Request'));
  links.push(link('branches', 'Branches'), link('issues', 'Issues'), link('releases', 'Releases'), link('actions', 'Actions'));
  return links;
}

export function getDeepLinkUrl(
  remoteUrl: string, type: DeepLink['type'], branch?: string, prNumber?: number, defaultBranch?: string
): string | null {
  return getProviderDeepLinks(remoteUrl, branch, prNumber, defaultBranch).find((link) => link.type === type)?.url ?? null;
}
