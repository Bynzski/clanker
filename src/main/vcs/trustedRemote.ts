import type { VcsProvider } from './types';

const HOST_PROVIDERS = new Map<string, VcsProvider>([
  ['github.com', 'github'],
  ['gitlab.com', 'gitlab'],
  ['bitbucket.org', 'bitbucket'],
]);

/** Hosted origins only. Self-managed instances need separate host-bound credentials. */
export function parseTrustedRemote(remote: string): {
  provider: VcsProvider; baseUrl: string; owner: string; repo: string;
} | null {
  try {
    const trimmed = remote.trim();
    const scp = trimmed.match(/^git@([a-zA-Z0-9.-]+):(.+)$/);
    const url = new URL(scp ? `ssh://git@${scp[1]}/${scp[2]}` : trimmed);
    if (!['https:', 'ssh:'].includes(url.protocol) || url.password || url.port || url.search || url.hash) return null;
    if (url.username && (url.protocol !== 'ssh:' || url.username !== 'git')) return null;
    const provider = HOST_PROVIDERS.get(url.hostname.toLowerCase());
    if (!provider) return null;
    const parts = url.pathname.slice(1).replace(/\.git$/, '').split('/');
    // Reject encoded path delimiters, traversal and ambiguous repository paths.
    if (parts.length < 2 || (provider !== 'gitlab' && parts.length !== 2)
      || parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '.' || part === '..')) return null;
    return {
      provider, baseUrl: `https://${url.hostname.toLowerCase()}`,
      owner: parts.slice(0, -1).join('/'), repo: parts[parts.length - 1],
    };
  } catch {
    return null;
  }
}
