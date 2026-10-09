import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const credentials = vi.hoisted(() => ({ stored: false, token: undefined as string | undefined, revision: 0 }));
vi.mock('../../../../src/main/credential/credentialService', () => ({
  getProviderPat: vi.fn(() => ({ success: !!credentials.token, token: credentials.token })),
  hasStoredProviderPat: vi.fn(() => credentials.stored), getCredentialRevision: () => credentials.revision,
}));
import { getProviderContext, getProviderPrLink, getDeepLinkUrl } from '../../../../src/main/vcs/contextService';
import { getProviderPat } from '../../../../src/main/credential/credentialService';
import { replaceApprovedGitLabOrigins } from '../../../../src/main/vcs/instancePolicy';
import type { VcsRequestIdentity } from '../../../../src/shared/types/vcs';
import { SHA, OTHER_SHA, branch, installFetch, json, githubPr, githubRepoResponse } from './providerFixtures';
let sequence = 0;
function identity(): VcsRequestIdentity { return { workspaceId: `ws-${++sequence}`, environmentId: 'local', checkoutPath: '/repo', checkoutContextId: 'context',
  remoteName: 'origin', remoteUrl: 'https://github.com/owner/repo.git', branch, headSha: SHA }; }
function fetchProvider() { return installFetch((url) => url.pathname.endsWith('/pulls') ? json([githubPr()])
  : url.pathname.endsWith('/reviews') ? json([]) : url.pathname.endsWith('/check-runs') ? json({ check_runs: [] })
    : url.pathname.endsWith('/statuses') ? json([]) : githubRepoResponse(url)); }
function load(id = identity(), refresh = false) { return getProviderContext(id.remoteName, id.remoteUrl, id.branch ?? '', '', { identity: id, refresh }); }
beforeEach(() => { credentials.stored = false; credentials.token = undefined; credentials.revision++; vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); replaceApprovedGitLabOrigins([]); });
describe('normalized production context and bounded identity cache', () => {
  it('returns actual identity, truthful empty statuses, and one repo metadata fetch', async () => {
    const fetch = fetchProvider(); const id = identity(); const result = await load(id);
    expect(result).toMatchObject({ success: true, identity: id, provider: { defaultBranch: 'trunk', headSha: SHA },
      pullRequest: { exists: true, outcome: 'found', number: 7 }, ci: { state: 'none' }, review: { state: 'none' } });
    expect(fetch.mock.calls.filter(([url]) => url === 'https://api.github.com/repos/owner/repo')).toHaveLength(1);
  });
  it('deduplicates concurrent equivalent calls and caches briefly, including PR navigation', async () => {
    const fetch = fetchProvider(); const id = identity();
    const [a, b] = await Promise.all([load(id), load(id)]); expect(a).toEqual(b); expect(fetch).toHaveBeenCalledTimes(6);
    await load(id); expect(fetch).toHaveBeenCalledTimes(6);
    expect(await getProviderPrLink(id.remoteUrl, branch, { identity: id })).toBe('https://github.com/owner/repo/pull/7');
    expect(fetch).toHaveBeenCalledTimes(6);
  });
  it('invalidates by explicit refresh, SHA, branch, remote, context, environment and credentials', async () => {
    const fetch = fetchProvider(); const id = identity(); await load(id);
    const variations = [{ ...id, headSha: OTHER_SHA }, { ...id, branch: 'another' }, { ...id, remoteUrl: 'https://github.com/other/repo.git' },
      { ...id, checkoutContextId: 'other' }, { ...id, environmentId: 'ssh:test' }, { ...id, checkoutPath: '/other' }];
    for (const variant of variations) { const before = fetch.mock.calls.length; await load(variant); expect(fetch.mock.calls.length).toBeGreaterThan(before); }
    let before = fetch.mock.calls.length; await load(id, true); expect(fetch.mock.calls.length).toBeGreaterThan(before);
    credentials.token = 'new-token'; credentials.stored = true; credentials.revision++;
    before = fetch.mock.calls.length; await load(id); expect(fetch.mock.calls.length).toBeGreaterThan(before);
  });
  it('expires cache without timers or background polling', async () => {
    vi.useFakeTimers(); const fetch = fetchProvider(); const id = identity(); await load(id);
    await vi.advanceTimersByTimeAsync(6000); expect(fetch).toHaveBeenCalledTimes(6);
    await load(id); expect(fetch).toHaveBeenCalledTimes(12);
  });
  it('does not cache failed or auth-dependent unavailable results', async () => {
    const fetch = installFetch(() => json({}, 401)); const id = identity();
    await load(id); const before = fetch.mock.calls.length; await load(id); expect(fetch.mock.calls.length).toBeGreaterThan(before);
  });
  it('does not retrieve credentials or dispatch for unapproved remotes', async () => {
    const fetch = fetchProvider();
    expect(await getProviderContext('origin', 'https://gitlab.attacker.test/owner/repo', branch)).toMatchObject({ problem: { code: 'unsupported' } });
    expect(getProviderPat).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('never silently falls back to anonymous when a stored credential cannot decrypt', async () => {
    credentials.stored = true; const fetch = fetchProvider();
    expect(await load()).toMatchObject({ pullRequest: { outcome: 'auth-required' }, credential: { stored: true, decryptable: false, repositoryAccess: 'unavailable' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves PR discovery when review access fails, without legacy reassuring values', async () => {
    installFetch((url) => url.pathname.endsWith('/reviews') ? json({}, 403) : url.pathname.endsWith('/pulls') ? json([githubPr()])
      : url.pathname.endsWith('/check-runs') ? json({ check_runs: [] }) : url.pathname.endsWith('/statuses') ? json([]) : githubRepoResponse(url));
    const result = await load(); expect(result).toMatchObject({ success: false, pullRequest: { exists: true, number: 7 }, review: { state: 'unknown', problem: { code: 'forbidden' } } });
    expect(result.pullRequest?.reviewState).toBeUndefined(); expect(result.pullRequest?.checksStatus).toBeUndefined();
  });
  it('does not guess main for failure fallback navigation', async () => {
    installFetch(() => json({}, 403)); const result = await load();
    expect(result.provider?.defaultBranch).toBe(''); expect(result.pullRequest?.exists).toBeUndefined();
    expect(result.deepLinks?.find((link) => link.type === 'create-pr')?.url).not.toContain('main...');
  });
  it('keeps static navigation API- and credential-free and PR-only lookup CI-free', async () => {
    const fetch = fetchProvider(); const id = identity();
    expect(getDeepLinkUrl(id.remoteUrl, 'repo')).toBe('https://github.com/owner/repo'); expect(fetch).not.toHaveBeenCalled(); expect(getProviderPat).not.toHaveBeenCalled();
    expect(await getProviderPrLink(id.remoteUrl, branch, { identity: id })).toBe('https://github.com/owner/repo/pull/7');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
