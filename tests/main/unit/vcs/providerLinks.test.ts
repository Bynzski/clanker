import { describe, expect, it, vi } from 'vitest';
import { getDeepLinkUrl, getProviderDeepLinks, buildDeepLink } from '../../../../src/main/vcs/providerDetector';
import { GitHubProvider } from '../../../../src/main/vcs/providers/githubProvider';
import { GitLabProvider } from '../../../../src/main/vcs/providers/gitlabProvider';
import { BitbucketProvider } from '../../../../src/main/vcs/providers/bitbucketProvider';
import type { DeepLinkType, ProviderContext } from '../../../../src/main/vcs/types';

const source = 'feature/é+%#&=;';
const target = 'release/v1+stable';
const providers = [
  { provider: new GitHubProvider(), remote: 'git@github.com:owner/repo.git', baseUrl: 'https://github.com', owner: 'owner', paths: {
    repo: '', pr: '/pull/42', 'create-pr': `/compare/${encodeURIComponent(target)}...${encodeURIComponent(source)}`,
    branches: '/branches', issues: '/issues', releases: '/releases', actions: '/actions',
  } },
  { provider: new GitLabProvider(), remote: 'ssh://git@gitlab.com/group/subgroup/repo.git', baseUrl: 'https://gitlab.com', owner: 'group/subgroup', paths: {
    repo: '', pr: '/-/merge_requests/42', 'create-pr': `/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(source)}&merge_request[target_branch]=${encodeURIComponent(target)}`,
    branches: '/-/branches', issues: '/-/issues', releases: '/-/releases', actions: '/-/pipelines',
  } },
  { provider: new BitbucketProvider(), remote: 'https://bitbucket.org/owner/repo.git', baseUrl: 'https://bitbucket.org', owner: 'owner', paths: {
    repo: '', pr: '/pull-requests/42', 'create-pr': '/pull-requests/new', branches: '/branches', actions: '/pipelines',
  } },
];

describe('static provider navigation contract', () => {
  for (const { provider, remote, baseUrl, owner, paths } of providers) {
    const context: ProviderContext = { provider: provider.type, baseUrl, owner, repo: 'repo', defaultBranch: target };
    const root = `${baseUrl}/${owner}/repo`;
    for (const [type, suffix] of Object.entries(paths)) {
      it(`${provider.type}: ${type} uses its provider-specific path through every entry point`, () => {
        const fetchSpy = vi.spyOn(global, 'fetch');
        try {
          const expected = `${root}${suffix}`;
          expect(provider.getDeepLinks(context, source, 42).find((link) => link.type === type)?.url).toBe(expected);
          expect(getProviderDeepLinks(remote, source, 42, target).find((link) => link.type === type)?.url).toBe(expected);
          expect(getDeepLinkUrl(remote, type as DeepLinkType, source, 42, target)).toBe(expected);
          expect(buildDeepLink(provider.type, baseUrl, owner, 'repo', type as DeepLinkType, source, 42, target)).toBe(expected);
          expect(fetchSpy).not.toHaveBeenCalled();
        } finally { fetchSpy.mockRestore(); }
      });
    }
    it(`${provider.type}: omits requests without identity and creation without branch`, () => {
      expect(provider.getDeepLinks(context).map((link) => link.type)).not.toContain('pr');
      expect(provider.getDeepLinks(context).map((link) => link.type)).not.toContain('create-pr');
      expect(getDeepLinkUrl(remote, 'pr')).toBeNull();
      expect(provider.getDeepLinks(context, source, -1).map((link) => link.type)).not.toContain('pr');
    });
    it(`${provider.type}: rejects directly constructed untrusted origins`, () => {
      expect(provider.getDeepLinks({ ...context, baseUrl: 'https://attacker.example' }, source, 42)).toEqual([]);
      expect(provider.getDeepLinks({ ...context, owner: '../other' }, source, 42)).toEqual([]);
    });
  }

  it('omits retired Bitbucket issues and unsupported releases instead of substituting downloads', () => {
    const remote = 'git@bitbucket.org:owner/repo.git';
    expect(getDeepLinkUrl(remote, 'issues')).toBeNull();
    expect(getDeepLinkUrl(remote, 'releases')).toBeNull();
  });
  it('uses native default targets without API discovery or fabricated main branches', () => {
    expect(getDeepLinkUrl('https://github.com/owner/repo.git', 'create-pr', source)).toBe(`https://github.com/owner/repo/compare/${encodeURIComponent(source)}`);
    const gl = new URL(getDeepLinkUrl('https://gitlab.com/group/subgroup/repo.git', 'create-pr', source)!);
    expect(gl.searchParams.get('merge_request[source_branch]')).toBe(source);
    expect(gl.searchParams.has('merge_request[target_branch]')).toBe(false);
  });
  it('preserves exact source and target branch values in GitLab query parameters', () => {
    const url = new URL(getDeepLinkUrl('https://gitlab.com/group/subgroup/repo.git', 'create-pr', source, undefined, target)!);
    expect(url.searchParams.get('merge_request[source_branch]')).toBe(source);
    expect(url.searchParams.get('merge_request[target_branch]')).toBe(target);
  });
});
