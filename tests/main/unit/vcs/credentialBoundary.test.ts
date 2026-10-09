import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitLabProvider } from '../../../../src/main/vcs/providers/gitlabProvider';
import { GitHubProvider } from '../../../../src/main/vcs/providers/githubProvider';
import { BitbucketProvider } from '../../../../src/main/vcs/providers/bitbucketProvider';
import type { ProviderContext } from '../../../../src/main/vcs/types';

const context: ProviderContext = {
  provider: 'gitlab', baseUrl: 'https://gitlab.com', owner: 'group/subgroup', repo: 'repo', defaultBranch: 'main',
};

afterEach(() => vi.unstubAllGlobals());

describe('provider credential boundary', () => {
  it.each([
    'https://gitlab-attacker.example',
    'https://gitlab.com.attacker.example',
    'http://gitlab.com',
    'https://gitlab.com:8443',
    'https://gitlab.com@attacker.example',
    'https://user:password@gitlab.com',
  ])('refuses API dispatch to %s even with a directly constructed context', async (baseUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new GitLabProvider();
    expect(await provider.getDefaultBranch({ ...context, baseUrl }, 'secret')).toBe('main');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [new GitHubProvider(), 'https://api.github.com/user', 'Authorization', 'Bearer secret'],
    [new GitLabProvider(), 'https://gitlab.com/api/v4/user', 'PRIVATE-TOKEN', 'secret'],
    [new BitbucketProvider(), 'https://api.bitbucket.org/2.0/user', 'Authorization', 'Bearer secret'],
  ] as const)('uses bounded, redirect-denying transport for %s', async (provider, url, header, value) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await provider.validateToken('secret')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({
      redirect: 'error', signal: expect.any(AbortSignal), headers: expect.objectContaining({ [header]: value }),
    }));
  });

  it('does not retry authentication failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new GitLabProvider().validateToken('secret')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('encodes the complete GitLab namespace', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ default_branch: 'trunk' })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new GitLabProvider().getDefaultBranch(context, 'secret')).toBe('trunk');
    expect(fetchMock).toHaveBeenCalledWith('https://gitlab.com/api/v4/projects/group%2Fsubgroup%2Frepo', expect.anything());
  });
});
