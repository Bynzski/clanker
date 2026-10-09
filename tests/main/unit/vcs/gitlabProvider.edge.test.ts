import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitLabProvider } from '../../../../src/main/vcs/providers/gitlabProvider';
import { replaceApprovedGitLabOrigins } from '../../../../src/main/vcs/instancePolicy';
import { buildProviderContext } from '../../../../src/main/vcs/providerDetector';
import { getProviderInstance } from '../../../../src/main/vcs/providerRegistry';
import { context, installFetch, json } from './providerFixtures';
afterEach(() => { vi.unstubAllGlobals(); replaceApprovedGitLabOrigins([]); });
describe('approved instance policy at production dispatch', () => {
  it('accepts only explicitly approved exact HTTPS origin, preserving nested namespace and port', async () => {
    replaceApprovedGitLabOrigins(['https://code.example:8443']);
    const ctx = buildProviderContext('origin', 'https://code.example:8443/group/nested/repo.git');
    expect(ctx).toMatchObject({ provider: 'gitlab', owner: 'group/nested', baseUrl: 'https://code.example:8443' });
    const fetch = installFetch(() => json({ default_branch: 'trunk' }));
    expect(await getProviderInstance('gitlab', ctx!.baseUrl)!.getDefaultBranch(ctx!, 'host-token')).toBe('trunk');
    expect(fetch.mock.calls[0]).toEqual(['https://code.example:8443/api/v4/projects/group%2Fnested%2Frepo', expect.objectContaining({ headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'host-token' }) })]);
  });
  it.each(['http://code.example', 'https://code.example.attacker.test', 'https://code.example:8443', 'https://user@code.example', 'https://code.example/extra/../'])('rejects lookalike/unapproved remote %s', (origin) => {
    replaceApprovedGitLabOrigins(['https://code.example']);
    expect(buildProviderContext('origin', `${origin}/owner/repo.git`)).toBeNull();
  });
  it('resolves an SSH hostname only when there is one approved origin', () => {
    replaceApprovedGitLabOrigins(['https://code.example:8443']);
    expect(buildProviderContext('origin', 'git@code.example:group/repo.git')?.baseUrl).toBe('https://code.example:8443');
    replaceApprovedGitLabOrigins(['https://code.example', 'https://code.example:8443']);
    expect(buildProviderContext('origin', 'git@code.example:group/repo.git')).toBeNull();
  });
  it('rechecks revocation on an already constructed provider', async () => {
    replaceApprovedGitLabOrigins(['https://code.example']);
    const provider = new GitLabProvider('https://code.example');
    replaceApprovedGitLabOrigins([]);
    const fetch = installFetch(() => json({ default_branch: 'trunk' }));
    expect(await provider.getDefaultBranch({ ...context('gitlab'), baseUrl: 'https://code.example' }, 'secret')).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cannot repurpose a hosted provider registry for another origin', () => {
    expect(getProviderInstance('github', 'https://attacker.test')).toBeNull();
    expect(getProviderInstance('bitbucket', 'https://attacker.test')).toBeNull();
    expect(getProviderInstance('gitlab', 'https://attacker.test')).toBeNull();
  });
});
