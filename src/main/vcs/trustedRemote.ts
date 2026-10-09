import type { VcsProvider } from './types';
import { isApprovedGitLabOrigin, resolveGitLabSshOrigin } from './instancePolicy';

const HOST_PROVIDERS = new Map<string, VcsProvider>([
  ['github.com', 'github'],
  ['gitlab.com', 'gitlab'],
  ['bitbucket.org', 'bitbucket'],
]);

/** Hosted origins, or an exactly approved main-owned GitLab instance. */
export function parseTrustedRemote(remote: string): {
  provider: VcsProvider; baseUrl: string; owner: string; repo: string;
} | null {
  try {
    if (typeof remote !== 'string' || remote.length > 8192) return null;
    const trimmed = remote.trim();
    if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) return null;
    const scp = trimmed.match(/^git@([a-zA-Z0-9.-]+):(.+)$/);
    const url = new URL(scp ? `ssh://git@${scp[1]}/${scp[2]}` : trimmed);
    const rawPath = scp ? `/${scp[2]}` : trimmed.match(/^[a-z]+:\/\/[^/]*(\/[^?#]*)/i)?.[1];
    if (!rawPath || rawPath !== url.pathname || rawPath.length > 1024) return null;
    if (!['https:', 'ssh:'].includes(url.protocol) || url.password || url.search || url.hash) return null;
    if (url.username && (url.protocol !== 'ssh:' || url.username !== 'git')) return null;
    const host = url.hostname.toLowerCase();
    let provider = HOST_PROVIDERS.get(host);
    let baseUrl = `https://${host}`;
    if (provider) {
      if (url.port) return null;
    } else {
      const origin = url.protocol === 'ssh:' ? resolveGitLabSshOrigin(host) : url.origin;
      if (!origin || !isApprovedGitLabOrigin(origin)) return null;
      provider = 'gitlab';
      baseUrl = origin;
    }
    const parts = url.pathname.slice(1).replace(/\.git$/, '').split('/');
    // Reject encoded path delimiters, traversal and ambiguous repository paths.
    if (parts.length < 2 || (provider !== 'gitlab' && parts.length !== 2)
      || parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '.' || part === '..')) return null;
    return {
      provider, baseUrl,
      owner: parts.slice(0, -1).join('/'), repo: parts[parts.length - 1],
    };
  } catch {
    return null;
  }
}
