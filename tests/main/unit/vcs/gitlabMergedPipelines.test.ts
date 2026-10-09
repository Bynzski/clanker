import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitLabProvider } from '../../../../src/main/vcs/providers/gitlabProvider';
import { context, SHA, OTHER_SHA, branch, installFetch, json, gitlabRepo, gitlabMr } from './providerFixtures';
const targetSha = 'c'.repeat(40);
const provider = new GitLabProvider();
const ctx = { ...context('gitlab'), pullRequestNumber: 7, pullRequestRepositoryPath: 'owner/repo' };
function pipeline(id: number, sha: string, status: string) {
  return { id, sha, status, ref: sha === SHA ? branch : 'refs/merge-requests/7/merge', project_id: 1 };
}
const merged = pipeline(30, OTHER_SHA, 'running');
function mrDetail(head = merged) {
  return { ...gitlabMr(), diff_refs: { head_sha: SHA, base_sha: targetSha, start_sha: targetSha }, head_pipeline: head };
}
function responses(options: {
  branchPipelines?: ReturnType<typeof pipeline>[]; mrPipelines?: ReturnType<typeof pipeline>[];
  detail?: unknown; detailStatus?: number; commit?: unknown; commitStatus?: number; project?: unknown;
} = {}) {
  return installFetch((url) => {
    if (url.pathname.endsWith('/merge_requests/7/pipelines')) return json(options.mrPipelines ?? [merged]);
    if (url.pathname.endsWith('/pipelines')) return json(options.branchPipelines ?? []);
    if (url.pathname.endsWith('/merge_requests/7')) return json(options.detail ?? mrDetail(), options.detailStatus ?? 200);
    if (url.pathname.endsWith(`/repository/commits/${OTHER_SHA}`)) return json(options.commit ?? { id: OTHER_SHA, parent_ids: [targetSha, SHA] }, options.commitStatus ?? 200);
    if (url.pathname.endsWith('/projects/owner%2Frepo')) return json(options.project ?? gitlabRepo);
    return json({}, 404);
  });
}
afterEach(() => vi.unstubAllGlobals());
describe('GitLab current-MR merged-results pipeline attribution', () => {
  it.each([['running', 'pending'], ['success', 'success'], ['failed', 'failure']])('reports verified synthetic-commit %s without an ordinary branch pipeline', async (status, state) => {
    const head = pipeline(30, OTHER_SHA, status);
    const fetch = responses({ mrPipelines: [head], detail: mrDetail(head) });
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state, sha: SHA });
    expect(fetch.mock.calls.map(([url]) => url)).toContain(`https://gitlab.com/api/v4/projects/owner%2Frepo/repository/commits/${OTHER_SHA}`);
  });
  it('prefers the newest verified merged pipeline over an older green source-HEAD MR pipeline', async () => {
    const head = pipeline(30, OTHER_SHA, 'failed');
    responses({ mrPipelines: [pipeline(20, SHA, 'success'), head], detail: mrDetail(head) });
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'failure' });
  });
  it.each([
    ['success', 'running', 'pending'], ['failed', 'success', 'failure'], ['success', 'failed', 'failure'],
  ])('combines branch %s and verified merged MR %s as %s', async (branchState, mrState, state) => {
    const head = pipeline(30, OTHER_SHA, mrState);
    responses({ branchPipelines: [pipeline(10, SHA, branchState)], mrPipelines: [head], detail: mrDetail(head) });
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state });
  });
  it('uses current native head-pipeline status, not an earlier listing status', async () => {
    responses({ mrPipelines: [pipeline(30, OTHER_SHA, 'success')], detail: mrDetail(pipeline(30, OTHER_SHA, 'failed')) });
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'failure' });
  });
  it.each([
    { sha: targetSha }, { diff_refs: { head_sha: targetSha } }, { iid: 8 },
    { source_project_id: 2 }, { target_project_id: 2 }, { source_branch: 'other' },
    { head_pipeline: pipeline(29, OTHER_SHA, 'success') }, { head_pipeline: pipeline(30, targetSha, 'success') },
    { head_pipeline: { ...merged, project_id: 99 } },
  ])('rejects stale or mismatched MR identity %j, rather than reporting no CI', async (change) => {
    const fetch = responses({ detail: { ...mrDetail(), ...change } });
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'unknown', problem: { code: 'stale' } });
    expect(fetch.mock.calls.some(([url]) => url.includes('/repository/commits/'))).toBe(false);
  });
  it.each([[targetSha, 'd'.repeat(40)], [SHA, targetSha]])('rejects stale source parents even if current HEAD was the old target: %j', async (...parents) => {
    responses({ commit: { id: OTHER_SHA, parent_ids: parents } });
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'unknown', problem: { code: 'stale' } });
  });
  it.each(['detail', 'commit'])('returns unknown when %s proof is inaccessible, despite a green branch pipeline', async (endpoint) => {
    responses({ branchPipelines: [pipeline(10, SHA, 'success')], ...(endpoint === 'detail' ? { detailStatus: 403 } : { commitStatus: 403 }) });
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'unknown', problem: { code: 'forbidden' } });
  });
  it('keeps a known branch failure when merged-result attribution is unavailable', async () => {
    responses({ branchPipelines: [pipeline(10, SHA, 'failed')], detailStatus: 403 });
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'failure', problem: { code: 'forbidden' } });
  });
  it('ignores historical merged pipelines when the newest MR pipeline is at current source HEAD', async () => {
    const fetch = responses({ mrPipelines: [merged, pipeline(40, SHA, 'success')] });
    expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'success' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('verifies a fork MR and its synthetic commit in the native target project', async () => {
    const namespace = 'parent/nested/repo';
    const fetch = responses({ mrPipelines: [{ ...merged, project_id: 2 }], project: { ...gitlabRepo, forked_from_project: { id: 2, path_with_namespace: namespace } },
      detail: { ...mrDetail(), target_project_id: 2, head_pipeline: { ...merged, project_id: 2 } } });
    expect(await provider.getChecksSummary({ ...ctx, pullRequestRepositoryPath: namespace }, branch)).toMatchObject({ state: 'pending' });
    expect(fetch.mock.calls.map(([url]) => url)).toContain(`https://gitlab.com/api/v4/projects/parent%2Fnested%2Frepo/repository/commits/${OTHER_SHA}`);
  });
  it.each([
    { id: OTHER_SHA, parent_ids: [SHA] }, { id: OTHER_SHA, parent_ids: [SHA, 'invalid'] },
    { id: SHA, parent_ids: [targetSha, SHA] },
  ])('refuses malformed or unprovable synthetic commit metadata %j', async (commit) => {
    responses({ commit }); expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'unknown', problem: { code: 'malformed-response' } });
  });
  it('reports none only when both pipeline collections are actually empty', async () => {
    responses({ mrPipelines: [] }); expect(await provider.getChecksSummary(ctx, branch)).toMatchObject({ state: 'none' });
  });
});
