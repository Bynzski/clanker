import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitLabProvider } from '../../../../src/main/vcs/providers/gitlabProvider';
import { context, SHA, OTHER_SHA, branch, installFetch, json, gitlabRepo, gitlabMr } from './providerFixtures';
const provider = new GitLabProvider(); const ctx = context('gitlab');
afterEach(() => vi.unstubAllGlobals());
describe('GitLab production provider', () => {
  it('matches source/target project, branch and HEAD instead of the first MR', async () => {
    installFetch((url) => url.pathname.endsWith('/merge_requests') ? json([gitlabMr(1, 'closed'), gitlabMr(7), { ...gitlabMr(99), source_project_id: 2 }]) : json(gitlabRepo));
    expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ exists: true, number: 7, outcome: 'found' });
  });
  it('distinguishes no MR, stale MR, detached HEAD and permission denial', async () => {
    installFetch((url) => url.pathname.endsWith('/merge_requests') ? json([]) : json(gitlabRepo));
    expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ exists: false, outcome: 'none' });
    expect(await provider.getPullRequestForBranch(ctx, '')).toMatchObject({ outcome: 'unsupported' });
    installFetch((url) => url.pathname.endsWith('/merge_requests') ? json([gitlabMr(1, 'opened', OTHER_SHA)]) : json(gitlabRepo));
    expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ outcome: 'stale' });
    installFetch(() => json({}, 403));
    expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ outcome: 'forbidden', problem: { code: 'forbidden' } });
  });
  it.each([['success', 'success'], ['failed', 'failure'], ['canceled', 'failure'], ['running', 'pending'], ['manual', 'pending'], ['skipped', 'unknown'], ['not-real', 'unknown']])('classifies pipeline %s as %s', async (status, expected) => {
    const fetch = installFetch(() => json([{ id: 1, sha: SHA, status }]));
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: expected, sha: SHA });
    const url = new URL(fetch.mock.calls[0][0]); expect(url.searchParams.get('sha')).toBe(SHA); expect(url.searchParams.get('ref')).toBe(branch);
  });
  it('uses latest pipeline, validates HEAD, and distinguishes no pipeline', async () => {
    installFetch(() => json([{ id: 1, sha: SHA, status: 'failed' }, { id: 2, sha: SHA, status: 'success' }]));
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'success' });
    installFetch(() => json([{ id: 3, sha: OTHER_SHA, status: 'success' }]));
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'unknown', problem: { code: 'stale' } });
    installFetch(() => json([])); expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'none' });
  });
  it('includes relevant MR pipelines, not another commit or just a green branch pipeline', async () => {
    installFetch((url) => url.pathname.includes('/merge_requests/') ? json([{ id: 30, sha: OTHER_SHA, status: 'failed' }, { id: 20, sha: SHA, status: 'running' }]) : json([{ id: 10, sha: SHA, status: 'success' }]));
    expect(await provider.getChecksSummary({ ...ctx, pullRequestNumber: 7 }, branch)).toMatchObject({ state: 'pending' });
    installFetch((url) => url.pathname.includes('/merge_requests/') ? json({}, 403) : json([{ id: 10, sha: SHA, status: 'success' }]));
    expect(await provider.getChecksSummary({ ...ctx, pullRequestNumber: 7 }, branch)).toMatchObject({ state: 'unknown', problem: { code: 'forbidden' } });
  });
  it.each([[true, 'approved'], [false, 'pending']])('uses required approval rules (%s)', async (approved, state) => {
    installFetch((url) => url.pathname.endsWith('/approval_state') ? json({ rules: [{ approvals_required: 1, approved }] }) : json(gitlabRepo));
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state });
  });
  it('separates no approvals configured from unavailable approvals', async () => {
    installFetch((url) => !url.pathname.includes('/merge_requests/') ? json(gitlabRepo) : url.pathname.endsWith('/approval_state') ? json({ rules: [] }) : json({ approvals_required: 0, approvals_left: 0, approved_by: [] }));
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: 'none' });
    installFetch(() => json({}, 404));
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: 'unknown', problem: { code: 'not-found' } });
  });
  it('routes fork MR discovery, approval rules and MR pipelines to the verified parent', async () => {
    const fork = { ...gitlabRepo, forked_from_project: { id: 2, path_with_namespace: 'parent/nested/repo' } };
    const fetch = installFetch((url) => url.pathname.endsWith('/merge_requests') ? json([{ ...gitlabMr(), target_project_id: 2 }])
      : url.pathname.endsWith('/approval_state') ? json({ rules: [{ approvals_required: 1, approved: true }] })
      : url.pathname.endsWith('/pipelines') ? json([{ id: 1, sha: SHA, status: 'success' }]) : json(fork));
    const pr = await provider.getPullRequestForBranch(ctx, branch);
    expect(pr).toMatchObject({ number: 7, repositoryPath: 'parent/nested/repo', url: 'https://gitlab.com/parent/nested/repo/-/merge_requests/7' });
    expect(await provider.getReviewSummary(ctx, 7)).toMatchObject({ state: 'approved' });
    await provider.getChecksSummary({ ...ctx, pullRequestNumber: 7, pullRequestRepositoryPath: pr.repositoryPath }, branch);
    expect(fetch.mock.calls.map(([url]) => url)).toContain('https://gitlab.com/api/v4/projects/parent%2Fnested%2Frepo/merge_requests/7/pipelines?per_page=100');
  });
  it('paginates native x-next-page MR listings', async () => {
    installFetch((url) => !url.pathname.endsWith('/merge_requests') ? json(gitlabRepo) : url.searchParams.has('page') ? json([gitlabMr()]) : json([], 200, { 'x-next-page': '2' }));
    expect(await provider.getPullRequestForBranch(ctx, branch)).toMatchObject({ number: 7 });
  });
});
