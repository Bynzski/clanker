import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubProvider } from '../../../../src/main/vcs/providers/githubProvider';
import { context, SHA, OTHER_SHA, branch, installFetch, json, githubRepo, githubPr, githubRepoResponse } from './providerFixtures';
const provider = new GitHubProvider();
const ctx = context('github');
afterEach(() => vi.unstubAllGlobals());
describe('GitHub production provider', () => {
  it('matches repo, branch and actual HEAD, preferring a deterministic open PR', async () => {
    const fetch = installFetch((url) => url.pathname.endsWith('/pulls') ? json([githubPr(9, 'closed'), githubPr(2), githubPr(50, 'open', OTHER_SHA)]) : json(githubRepo));
    expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ exists: true, outcome: 'found', number: 2, headSha: SHA });
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('head')).toBe(`owner:${branch}`);
  });
  it.each([401, 403, 404, 500])('does not manufacture absence on HTTP %s', async (status) => {
    installFetch(() => json({ message: 'secret' }, status));
    const pr = await provider.getPullRequestForBranch(ctx, branch);
    expect(pr.exists).toBeUndefined(); expect(pr.problem).toBeDefined(); expect(JSON.stringify(pr)).not.toContain('secret');
  });
  it('distinguishes confirmed absence, detached HEAD, stale and malformed discovery', async () => {
    installFetch((url) => url.pathname.endsWith('/pulls') ? json([]) : json(githubRepo));
    expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ exists: false, outcome: 'none' });
    expect(await provider.getPullRequestForBranch(ctx, '')).toMatchObject({ outcome: 'unsupported' });
    installFetch((url) => url.pathname.endsWith('/pulls') ? json([githubPr(7, 'open', OTHER_SHA)]) : json(githubRepo));
    expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ outcome: 'stale' });
    installFetch((url) => url.pathname.endsWith('/pulls') ? json([null]) : json(githubRepo));
    expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ problem: { code: 'malformed-response' } });
  });
  it('looks up fork PRs and reviews on the authoritative parent repository', async () => {
    const pr = { ...githubPr(), base: { repo: { full_name: 'parent/repo' } }, html_url: 'https://github.com/parent/repo/pull/7' };
    const fetch = installFetch((url) => url.pathname.endsWith('/reviews') ? json([])
      : url.pathname.endsWith('/pulls') ? json([pr]) : githubRepoResponse(url, { ...githubRepo, fork: true, parent: { full_name: 'parent/repo' } }));
    expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ number: 7 });
    expect(await provider.getReviewSummary(ctx, 7)).toEqual({ state: 'none' });
    expect(fetch.mock.calls.map(([url]) => url)).toContain('https://api.github.com/repos/parent/repo/pulls/7/reviews?per_page=100');
  });
  it.each([
    ['success', 'success'], ['failure', 'failure'], ['cancelled', 'failure'], ['timed_out', 'failure'],
    ['action_required', 'failure'], ['neutral', 'unknown'], ['skipped', 'unknown'], [null, 'unknown'],
  ])('classifies completed checks %s as %s, not a guessed success', async (conclusion, expected) => {
    installFetch((url) => url.pathname.endsWith('/check-runs') ? json({ check_runs: [{ id: 1, status: 'completed', conclusion }] }) : json([]));
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: expected, sha: SHA });
  });
  it('includes fork target PR checks at the same HEAD instead of declaring no CI', async () => {
    installFetch((url) => url.pathname.endsWith('/check-runs') ? json({ check_runs: [{ id: 1, status: url.pathname.includes('/parent/') ? 'in_progress' : 'completed', conclusion: 'success' }] }) : json([]));
    expect(await provider.getChecksSummary({ ...ctx, pullRequestRepositoryPath: 'parent/repo' }, branch)).toMatchObject({ state: 'pending', sha: SHA });
  });
  it('combines modern checks and latest effective legacy contexts', async () => {
    const fetch = installFetch((url) => url.pathname.endsWith('/check-runs') ? json({ check_runs: [{ id: 1, status: 'queued' }] })
      : json([{ id: 1, context: 'build', state: 'failure' }, { id: 2, context: 'build', state: 'success' }, { id: 3, context: 'lint', state: 'error' }]));
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'failure' });
    expect(fetch.mock.calls.every(([url]) => url.includes(`/commits/${SHA}/`))).toBe(true);
  });
  it('separates empty CI from unavailable sources and retains a known failure', async () => {
    installFetch((url) => url.pathname.endsWith('/check-runs') ? json({ check_runs: [] }) : json([]));
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'none' });
    installFetch((url) => url.pathname.endsWith('/check-runs') ? json({ check_runs: [{ id: 1, status: 'completed', conclusion: 'failure' }] }) : json({}, 403));
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'failure', problem: { code: 'forbidden' } });
    installFetch((url) => url.pathname.endsWith('/check-runs') ? json({ check_runs: [{ id: 1, status: 'completed', conclusion: 'success' }] }) : json({}, 403));
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'unknown' });
  });
  it('aggregates latest submitted decisions; comments/drafts cannot erase a request', async () => {
    installFetch((url) => url.pathname.endsWith('/reviews') ? json([
      { id: 1, user: { login: 'a' }, state: 'APPROVED' }, { id: 2, user: { login: 'b' }, state: 'CHANGES_REQUESTED' },
      { id: 3, user: { login: 'b' }, state: 'COMMENTED' }, { id: 4, user: { login: 'b' }, state: 'PENDING' },
    ]) : githubRepoResponse(url));
    expect(await provider.getReviewSummary(ctx, 7)).toEqual({ state: 'changes_requested' });
  });
  it('allows approval supersession and handles dismissed decisions without reassurance', async () => {
    for (const [state, expected] of [['APPROVED', 'approved'], ['DISMISSED', 'none']] as const) {
      installFetch((url) => url.pathname.endsWith('/reviews') ? json([{ id: 1, user: { login: 'a' }, state: 'CHANGES_REQUESTED' }, { id: 2, user: { login: 'a' }, state }]) : githubRepoResponse(url));
      expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: expected });
    }
  });
  it('uses immutable reviewer IDs across login changes', async () => {
    installFetch((url) => url.pathname.endsWith('/reviews') ? json([
      { id: 1, user: { id: 100, login: 'old-name' }, state: 'CHANGES_REQUESTED' },
      { id: 2, user: { id: 100, login: 'new-name' }, state: 'APPROVED' },
    ]) : githubRepoResponse(url));
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: 'approved' });
  });
  it.each([
    { requested_reviewers: [{ login: 'b' }], requested_teams: [] },
    { requested_reviewers: [], requested_teams: [{ slug: 'team' }] },
  ])('keeps actual outstanding requests pending despite approvals: %j', async (requests) => {
    installFetch((url) => url.pathname.endsWith('/reviews') ? json([{ id: 1, user: { login: 'a' }, state: 'APPROVED' }])
      : /\/pulls\/7$/.test(url.pathname) ? json(requests) : json(githubRepo));
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: 'pending' });
  });
  it.each([
    ['APPROVED', 'COMMENTED', 'approved'],
    ['APPROVED', 'PENDING', 'approved'],
    ['COMMENTED', 'COMMENTED', 'none'],
    ['COMMENTED', 'PENDING', 'none'],
  ])('does not manufacture a request from %s plus an unrelated %s review', async (first, second, expected) => {
    installFetch((url) => url.pathname.endsWith('/reviews') ? json([
      { id: 1, user: { login: 'alice' }, state: first },
      { id: 2, user: { login: 'bob' }, state: second },
    ]) : githubRepoResponse(url));
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: expected });
  });
  it('lets submitted decisions supersede comments/drafts without either creating a requirement', async () => {
    const reviews = [{ id: 1, user: { login: 'alice' }, state: 'COMMENTED' }, { id: 2, user: { login: 'bob' }, state: 'PENDING' }];
    installFetch((url) => url.pathname.endsWith('/reviews') ? json(reviews) : githubRepoResponse(url));
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: 'none' });
    reviews.push({ id: 3, user: { login: 'alice' }, state: 'APPROVED' });
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: 'approved' });
    reviews.push({ id: 4, user: { login: 'bob' }, state: 'CHANGES_REQUESTED' });
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: 'changes_requested' });
    reviews.push({ id: 5, user: { login: 'bob' }, state: 'COMMENTED' });
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: 'changes_requested' });
    reviews.push({ id: 6, user: { login: 'bob' }, state: 'APPROVED' });
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: 'approved' });
    reviews.push({ id: 7, user: { login: 'bob' }, state: 'DISMISSED' });
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: 'approved' });
  });
  it('paginates reviews and lets the later reviewer decision win', async () => {
    installFetch((url) => url.pathname.endsWith('/reviews') ? url.searchParams.has('page')
      ? json([{ id: 2, user: { login: 'a' }, state: 'CHANGES_REQUESTED' }])
      : json([{ id: 1, user: { login: 'a' }, state: 'APPROVED' }], 200, { link: '<https://api.github.com/repos/owner/repo/pulls/7/reviews?per_page=100&page=2>; rel="next"' }) : githubRepoResponse(url));
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: 'changes_requested' });
  });
});
