import { afterEach, describe, expect, it, vi } from 'vitest';
import { BitbucketProvider } from '../../../../src/main/vcs/providers/bitbucketProvider';
import { context, SHA, OTHER_SHA, branch, installFetch, json, bitbucketRepo, bitbucketPr } from './providerFixtures';
const provider = new BitbucketProvider(); const ctx = context('bitbucket');
afterEach(() => vi.unstubAllGlobals());
describe('Bitbucket production provider', () => {
  it('matches source repository, branch, HEAD and prefers open PRs', async () => {
    installFetch((url) => url.pathname.endsWith('/pullrequests') ? json({ values: [bitbucketPr(9, 'MERGED'), bitbucketPr(7), { ...bitbucketPr(99), source: { ...bitbucketPr().source, repository: { full_name: 'other/repo' } } }] }) : json(bitbucketRepo));
    expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ exists: true, number: 7, outcome: 'found' });
  });
  it('supports parent-repository PR discovery for forks', async () => {
    installFetch((url) => url.pathname.endsWith('/pullrequests') ? json({ values: [{ ...bitbucketPr(), destination: { repository: { full_name: 'parent/repo' } } }] }) : json({ ...bitbucketRepo, parent: { full_name: 'parent/repo' } }));
    expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ number: 7 });
  });
  it('separates empty, stale, malformed and unavailable discovery', async () => {
    for (const [body, outcome] of [[{ values: [] }, 'none'], [{ values: [bitbucketPr(7, 'OPEN', OTHER_SHA)] }, 'stale'], [{ values: [null] }, 'malformed-response']] as const) {
      installFetch((url) => url.pathname.endsWith('/pullrequests') ? json(body) : json(bitbucketRepo));
      expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ outcome });
    }
    installFetch(() => json({}, 401)); expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ problem: { code: 'auth-required' } });
  });
  it.each([['SUCCESSFUL', 'success'], ['FAILED', 'failure'], ['INPROGRESS', 'pending'], ['STOPPED', 'failure']])('uses real commit statuses (%s)', async (state, expected) => {
    const fetch = installFetch(() => json({ values: [{ key: 'build', state }] }));
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: expected, sha: SHA });
    expect(fetch.mock.calls[0][0]).toBe(`https://api.bitbucket.org/2.0/repositories/owner/repo/commit/${SHA}/statuses?pagelen=100`);
  });
  it('paginates statuses and never hides a failure on a later page', async () => {
    installFetch((url) => url.searchParams.has('page') ? json({ values: [{ key: 'lint', state: 'FAILED' }] })
      : json({ values: [{ key: 'build', state: 'SUCCESSFUL' }], next: `https://api.bitbucket.org/2.0/repositories/owner/repo/commit/${SHA}/statuses?pagelen=100&page=2` }));
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'failure' });
  });
  it('retains a known failure when a continuation is incomplete or hostile', async () => {
    installFetch(() => json({ values: [{ key: 'ci', state: 'FAILED' }], next: 'https://attacker.test/steal' }));
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'failure', problem: { code: 'malformed-response' } });
  });
  it('separates empty status data from malformed or forbidden data', async () => {
    installFetch(() => json({ values: [] })); expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'none' });
    installFetch(() => json({ values: [{ key: 'build', state: 'MAGIC' }] })); expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'unknown' });
    installFetch(() => json({}, 403)); expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'unknown', problem: { code: 'forbidden' } });
  });
  it.each([
    [{ participants: [], reviewers: [] }, 'none'],
    [{ participants: [{ user: { uuid: 'a' }, role: 'REVIEWER', approved: true }], reviewers: [{ uuid: 'a' }] }, 'approved'],
    [{ participants: [{ user: { uuid: 'a' }, role: 'REVIEWER', approved: true }], reviewers: [{ uuid: 'a' }, { uuid: 'b' }] }, 'pending'],
    [{ participants: [{ user: { uuid: 'a' }, role: 'REVIEWER', approved: false, state: 'changes_requested' }], reviewers: [] }, 'changes_requested'],
  ])('derives reviews from native PR participants (%s)', async (body, state) => {
    const fetch = installFetch((url) => url.pathname.endsWith('/pullrequests/7') ? json(body) : json(bitbucketRepo));
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state });
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/participants'))).toBe(false);
  });
  it('uses Bearer auth, not app-password Basic auth', async () => {
    const fetch = installFetch(() => json({ uuid: 'a' }));
    expect(await provider.validateToken('token')).toBe(true);
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer token' }, redirect: 'error' });
  });
});
