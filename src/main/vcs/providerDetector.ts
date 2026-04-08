/**
 * Provider Detector
 * Extracts provider context from git remote URLs.
 */

import type { ProviderContext, VcsProvider, DeepLink } from './types';

/**
 * Parse owner and repo from a remote URL.
 */
export function parseRemoteUrl(remoteUrl: string): { owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  try {
    // Handle SSH URLs: git@github.com:owner/repo.git
    const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (sshMatch) {
      const path = sshMatch[2];
      const parts = path.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return {
          owner: parts[0],
          repo: parts[1].replace(/\.git$/, ''),
        };
      }
    }

    // Handle HTTPS/HTTP URLs: https://github.com/owner/repo.git
    const url = new URL(trimmed);
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2) {
      return {
        owner: pathParts[0],
        repo: pathParts[1].replace(/\.git$/, ''),
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect the provider from a remote URL.
 */
export function detectProvider(remoteUrl: string): VcsProvider {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return 'unknown';
  }

  try {
    // Handle SSH URLs: git@github.com:owner/repo.git
    const sshMatch = trimmed.match(/^git@([^:]+):/);
    if (sshMatch) {
      const host = sshMatch[1].toLowerCase();
      if (host === 'github.com') return 'github';
      if (host === 'bitbucket.org') return 'bitbucket';
      if (host === 'gitlab.com') return 'gitlab';
      // Check for GitLab self-hosted (common pattern)
      if (host.includes('gitlab')) return 'gitlab';
      return 'unknown';
    }

    // Handle HTTPS/HTTP URLs
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (host === 'github.com') return 'github';
    if (host === 'bitbucket.org') return 'bitbucket';
    if (host === 'gitlab.com') return 'gitlab';
    // Check for GitLab self-hosted
    if (host.includes('gitlab')) return 'gitlab';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Get the API base URL for a provider.
 */
export function getApiBaseUrl(provider: VcsProvider, remoteUrl?: string): string {
  switch (provider) {
    case 'github':
      return 'https://api.github.com';
    case 'gitlab':
      // For GitLab, try to extract base URL from remote
      if (remoteUrl) {
        try {
          const parsed = new URL(remoteUrl);
          // Remove 'api.v4' if present to get base URL
          if (parsed.pathname.includes('/api/v4')) {
            parsed.pathname = parsed.pathname.replace(/\/api\/v4.*/, '');
          }
          return `${parsed.origin}/api/v4`;
        } catch {
          // Fall through
        }
      }
      return 'https://gitlab.com/api/v4';
    case 'bitbucket':
      return 'https://api.bitbucket.org/2.0';
    default:
      return '';
  }
}

/**
 * Get the web base URL for a provider.
 */
export function getWebBaseUrl(provider: VcsProvider, remoteUrl?: string): string {
  switch (provider) {
    case 'github':
      return 'https://github.com';
    case 'gitlab':
      if (remoteUrl) {
        try {
          const parsed = new URL(remoteUrl);
          // Remove 'api.v4' if present
          parsed.pathname = parsed.pathname.replace(/\/api\/v4.*/, '');
          return `${parsed.origin}`;
        } catch {
          // Fall through
        }
      }
      return 'https://gitlab.com';
    case 'bitbucket':
      return 'https://bitbucket.org';
    default:
      return '';
  }
}

/**
 * Build provider context from a git remote.
 */
export function buildProviderContext(
  _remoteName: string,
  remoteUrl: string,
  defaultBranch: string = 'main'
): ProviderContext | null {
  const provider = detectProvider(remoteUrl);
  if (provider === 'unknown') {
    return null;
  }

  const parsed = parseRemoteUrl(remoteUrl);
  if (!parsed) {
    return null;
  }

  return {
    provider,
    baseUrl: getWebBaseUrl(provider, remoteUrl),
    owner: parsed.owner,
    repo: parsed.repo,
    defaultBranch,
  };
}

/**
 * Build a deep link URL for a provider.
 */
export function buildDeepLink(
  _provider: VcsProvider,
  baseUrl: string,
  owner: string,
  repo: string,
  type: DeepLink['type'],
  branch?: string,
  prNumber?: number
): string {
  const path = `/${owner}/${repo}`;

  switch (type) {
    case 'repo':
      return `${baseUrl}${path}`;
    case 'pr':
      return prNumber ? `${baseUrl}${path}/pull/${prNumber}` : `${baseUrl}${path}/pulls`;
    case 'create-pr':
      if (branch) {
        return `${baseUrl}${path}/compare/main...${encodeURIComponent(branch)}`;
      }
      return `${baseUrl}${path}/compare`;
    case 'issues':
      return `${baseUrl}${path}/issues`;
    case 'releases':
      return `${baseUrl}${path}/releases`;
    case 'actions':
      return `${baseUrl}${path}/actions`;
    case 'branches':
      return `${baseUrl}${path}/branches`;
    default:
      return `${baseUrl}${path}`;
  }
}

/**
 * Get deep links for a provider (simple URL construction without API calls).
 */
export function getProviderDeepLinks(
  remoteUrl: string,
  branch?: string,
  prNumber?: number
): DeepLink[] {
  let provider: VcsProvider = 'unknown';
  let baseUrl = '';
  let owner = '';
  let repo = '';

  try {
    const trimmed = remoteUrl.trim();
    if (!trimmed) return [];

    // Extract hostname and path
    const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (sshMatch) {
      const host = sshMatch[1];
      const path = sshMatch[2];
      if (host === 'github.com') {
        provider = 'github';
        baseUrl = 'https://github.com';
      } else if (host === 'gitlab.com') {
        provider = 'gitlab';
        baseUrl = 'https://gitlab.com';
      } else if (host === 'bitbucket.org') {
        provider = 'bitbucket';
        baseUrl = 'https://bitbucket.org';
      }
      const parts = path.split('/').filter(Boolean);
      if (parts.length >= 2) {
        owner = parts[0];
        repo = parts[1];
      }
    } else {
      const url = new URL(trimmed);
      const hostname = url.hostname.toLowerCase();
      if (hostname === 'github.com') {
        provider = 'github';
        baseUrl = 'https://github.com';
      } else if (hostname === 'gitlab.com') {
        provider = 'gitlab';
        baseUrl = 'https://gitlab.com';
      } else if (hostname === 'bitbucket.org') {
        provider = 'bitbucket';
        baseUrl = 'https://bitbucket.org';
      }
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        owner = parts[0];
        repo = parts[1];
      }
    }

    if (provider === 'unknown' || !owner || !repo) {
      return [];
    }

    const pathStr = `/${owner}/${repo}`;
    const links: DeepLink[] = [
      {
        type: 'repo',
        url: `${baseUrl}${pathStr}`,
        label: 'Repository',
      },
    ];

    if (prNumber) {
      links.push({
        type: 'pr',
        url: `${baseUrl}${pathStr}/pull/${prNumber}`,
        label: `PR #${prNumber}`,
      });
    }

    if (branch) {
      links.push({
        type: 'create-pr',
        url: `${baseUrl}${pathStr}/compare/main...${encodeURIComponent(branch)}`,
        label: 'Create Pull Request',
      });
    }

    links.push(
      {
        type: 'branches',
        url: `${baseUrl}${pathStr}/branches`,
        label: 'Branches',
      },
      {
        type: 'issues',
        url: `${baseUrl}${pathStr}/issues`,
        label: 'Issues',
      },
      {
        type: 'releases',
        url: `${baseUrl}${pathStr}/releases`,
        label: 'Releases',
      },
      {
        type: 'actions',
        url: `${baseUrl}${pathStr}/actions`,
        label: 'Actions',
      }
    );

    return links;
  } catch {
    return [];
  }
}

/**
 * Get a deep link URL for a specific type.
 */
export function getDeepLinkUrl(
  remoteUrl: string,
  type: DeepLink['type'],
  branch?: string,
  prNumber?: number
): string | null {
  const links = getProviderDeepLinks(remoteUrl, branch, prNumber);
  const link = links.find((l) => l.type === type);
  return link?.url ?? null;
}
