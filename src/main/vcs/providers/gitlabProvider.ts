import { BaseProvider } from './baseProvider';
import type { CiSummary, ProviderContext, PullRequestContext, ReviewSummary, VcsProblem } from '../types';
import { aggregateChecks, providerDefaultBranch, problem, unavailablePr, type CheckState } from '../statusModel';
import { canonicalGitLabOrigin, isApprovedGitLabOrigin } from '../instancePolicy';

interface Project { id: number; default_branch: string | null; forked_from_project?: { id: number; path_with_namespace: string } | null }
interface Mr { iid: number; id: number; title: string; state: string; sha: string; source_branch: string; source_project_id: number; target_project_id: number; author: { username: string } }
interface Pipeline { id: number; sha: string; status: string; ref: string; project_id?: number }
interface MrPipelineIdentity extends Mr { diff_refs?: { head_sha: string }; head_pipeline?: Pipeline | null }
const validNamespace = (value: unknown): value is string => typeof value === 'string' && value.length <= 1024 && /^[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)+$/i.test(value)
  && value.split('/').every((segment) => segment !== '.' && segment !== '..');
const validSha = (sha: unknown): sha is string => typeof sha === 'string' && /^[a-f0-9]{40,64}$/i.test(sha);

export class GitLabProvider extends BaseProvider {
  readonly type = 'gitlab' as const;
  readonly apiBaseUrl: string;
  constructor(readonly origin: string = 'https://gitlab.com') {
    super();
    if (canonicalGitLabOrigin(origin) !== origin || !isApprovedGitLabOrigin(origin)) throw new Error('Unapproved GitLab origin');
    this.apiBaseUrl = `${origin}/api/v4`;
  }
  private valid(context: ProviderContext): boolean { return context.baseUrl === this.origin && isApprovedGitLabOrigin(this.origin); }
  private path(context: ProviderContext): string { return `/projects/${encodeURIComponent(`${context.owner}/${context.repo}`)}`; }
  private target(project: Project, context: ProviderContext): { id: number; path: string } | null {
    if (!Number.isSafeInteger(project?.id) || project.id <= 0) return null;
    if (project.forked_from_project != null && (typeof project.forked_from_project !== 'object'
      || !Number.isSafeInteger(project.forked_from_project.id) || project.forked_from_project.id <= 0
      || !validNamespace(project.forked_from_project.path_with_namespace))) return null;
    const id = project.forked_from_project?.id ?? project.id;
    const path = project.forked_from_project?.path_with_namespace ?? `${context.owner}/${context.repo}`;
    return Number.isSafeInteger(id) && id > 0 && validNamespace(path) ? { id, path } : null;
  }
  async getDefaultBranch(context: ProviderContext, token?: string): Promise<string> {
    if (!this.valid(context)) return '';
    const result = await this.fetchJson<Project>(this.path(context), token);
    return result.success ? providerDefaultBranch(result.data?.default_branch) : '';
  }
  async getPullRequestForBranch(context: ProviderContext, branch: string, token?: string): Promise<PullRequestContext> {
    if (!this.valid(context) || !branch) return unavailablePr(problem('unsupported'));
    const project = await this.fetchJson<Project>(this.path(context), token);
    if (!project.success) return unavailablePr(project.problem);
    const target = this.target(project.data, context);
    if (!target) return unavailablePr(problem('malformed-response'));
    const result = await this.pages<Mr>(`/projects/${encodeURIComponent(target.path)}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=all&scope=all&per_page=100`, token);
    if (!result.success) return unavailablePr(result.problem);
    if (result.data.some((mr) => !mr || !Number.isSafeInteger(mr.iid) || mr.iid <= 0 || !Number.isSafeInteger(mr.source_project_id)
      || !Number.isSafeInteger(mr.target_project_id) || typeof mr.title !== 'string' || mr.title.length > 512 || !validSha(mr.sha)
      || !['opened', 'closed', 'merged', 'locked'].includes(mr.state) || typeof mr.author?.username !== 'string' || mr.author.username.length > 128)) return unavailablePr(problem('malformed-response'));
    const candidates = result.data.filter((mr) => mr.source_branch === branch && mr.source_project_id === project.data.id && mr.target_project_id === target.id);
    if (!candidates.length) return { exists: false, outcome: 'none' };
    const matching = context.headSha ? candidates.filter((mr) => mr.sha === context.headSha) : candidates;
    if (!matching.length) return unavailablePr(problem('stale'));
    matching.sort((a, b) => Number(b.state === 'opened') - Number(a.state === 'opened') || b.iid - a.iid);
    const mr = matching[0];
    return { exists: true, outcome: 'found', number: mr.iid, title: mr.title, headSha: mr.sha,
      state: mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'closed', author: mr.author.username,
      repositoryPath: target.path, url: `${this.origin}/${target.path}/-/merge_requests/${mr.iid}` };
  }
  /** A synthetic merge SHA alone cannot prove which source HEAD its pipeline tested. */
  private async verifyMergedPipeline(context: ProviderContext, branch: string, sha: string, candidate: Pipeline,
    token?: string): Promise<{ pipeline?: Pipeline; problem?: VcsProblem }> {
    const project = await this.fetchJson<Project>(this.path(context), token);
    if (!project.success) return { problem: project.problem };
    const target = this.target(project.data, context);
    const namespace = context.pullRequestRepositoryPath ?? `${context.owner}/${context.repo}`;
    if (!target || target.path !== namespace) return { problem: problem('stale') };
    const mr = await this.fetchJson<MrPipelineIdentity>(`/projects/${encodeURIComponent(namespace)}/merge_requests/${context.pullRequestNumber}`, token);
    if (!mr.success) return { problem: mr.problem };
    const value = mr.data;
    if (!value || value.iid !== context.pullRequestNumber || value.source_project_id !== project.data.id
      || value.target_project_id !== target.id || value.source_branch !== branch || value.sha !== sha
      || value.diff_refs?.head_sha !== sha || value.head_pipeline?.id !== candidate.id
      || value.head_pipeline.sha !== candidate.sha
      || (value.head_pipeline.project_id !== project.data.id && value.head_pipeline.project_id !== target.id)
      || (candidate.project_id !== undefined && candidate.project_id !== value.head_pipeline.project_id)) return { problem: problem('stale') };
    if (typeof value.head_pipeline.status !== 'string') return { problem: problem('malformed-response') };
    const commit = await this.fetchJson<{ id: string; parent_ids: string[] }>(`/projects/${encodeURIComponent(namespace)}/repository/commits/${candidate.sha}`, token);
    if (!commit.success) return { problem: commit.problem };
    if (!commit.data || commit.data.id !== candidate.sha || !Array.isArray(commit.data.parent_ids)
      || commit.data.parent_ids.length !== 2 || commit.data.parent_ids.some((parent) => !validSha(parent)))
      return { problem: problem('malformed-response') };
    // GitLab merges source into target: target is first parent, source is second.
    // Mere membership is unsafe when today's source HEAD was an old target HEAD.
    if (commit.data.parent_ids[1] !== sha) return { problem: problem('stale') };
    return { pipeline: value.head_pipeline };
  }
  async getChecksSummary(context: ProviderContext, branch: string, token?: string): Promise<CiSummary> {
    if (!this.valid(context)) return { state: 'unknown', problem: problem('unsupported') };
    let sha = context.headSha;
    if (!sha && branch) {
      const commit = await this.fetchJson<{ id: string }>(`${this.path(context)}/repository/commits/${encodeURIComponent(branch)}`, token);
      if (!commit.success) return { state: 'unknown', problem: commit.problem };
      sha = commit.data?.id;
    }
    if (!validSha(sha)) return { state: 'unknown', problem: problem('malformed-response') };
    const [result, mrPipelines] = await Promise.all([
      this.pages<Pipeline>(`${this.path(context)}/pipelines?sha=${sha}${branch ? `&ref=${encodeURIComponent(branch)}` : ''}&order_by=id&sort=desc&per_page=100`, token),
      context.pullRequestNumber ? this.pages<Pipeline>(`/projects/${encodeURIComponent(context.pullRequestRepositoryPath ?? `${context.owner}/${context.repo}`)}/merge_requests/${context.pullRequestNumber}/pipelines?per_page=100`, token)
        : Promise.resolve({ success: true as const, data: [] as Pipeline[] }),
    ]);
    let error = !result.success ? result.problem : !mrPipelines.success ? mrPipelines.problem : undefined;
    const latest: Pipeline[] = [];
    for (const response of [result, mrPipelines]) if (response.data) {
      if (response.data.some((pipeline) => !pipeline || !Number.isSafeInteger(pipeline.id) || !validSha(pipeline.sha) || typeof pipeline.status !== 'string')) { error = problem('malformed-response'); continue; }
      if (response === result && response.data.some((pipeline) => pipeline.sha !== sha)) { error = problem('stale'); continue; }
      const pipeline = [...response.data].sort((a, b) => b.id - a.id)[0];
      if (!pipeline) continue;
      if (pipeline.sha === sha) latest.push(pipeline);
      else {
        // The newest MR pipeline can test a temporary merge commit, not source HEAD.
        // Do not fall back to an older green source pipeline or infer absence.
        const verified = await this.verifyMergedPipeline(context, branch, sha, pipeline, token);
        if (verified.pipeline) latest.push(verified.pipeline);
        else error = verified.problem ?? problem('unknown');
      }
    }
    const states: Record<string, CheckState> = { success: 'success', failed: 'failure', canceled: 'failure', pending: 'pending', running: 'pending', created: 'pending', preparing: 'pending', waiting_for_resource: 'pending', scheduled: 'pending', manual: 'pending', skipped: 'neutral' };
    return aggregateChecks(latest.map((pipeline) => states[pipeline.status] ?? 'unknown'), sha, error);
  }
  async getReviewSummary(context: ProviderContext, number: number, token?: string): Promise<ReviewSummary> {
    if (!this.valid(context)) return { state: 'unknown', problem: problem('unsupported') };
    const project = await this.fetchJson<Project>(this.path(context), token);
    if (!project.success) return { state: 'unknown', problem: project.problem };
    const target = this.target(project.data, context);
    if (!target) return { state: 'unknown', problem: problem('malformed-response') };
    const mrPath = `/projects/${encodeURIComponent(target.path)}/merge_requests/${number}`;
    const rules = await this.fetchJson<{ rules: Array<{ approvals_required: number; approved: boolean }> }>(`${mrPath}/approval_state`, token);
    if (!rules.success) return { state: 'unknown', problem: rules.problem };
    if (!rules.data || !Array.isArray(rules.data.rules) || rules.data.rules.some((rule) => !rule || !Number.isSafeInteger(rule.approvals_required)
      || rule.approvals_required < 0 || typeof rule.approved !== 'boolean')) return { state: 'unknown', problem: problem('malformed-response') };
    const required = rules.data.rules.filter((rule) => rule.approvals_required > 0);
    if (required.length) return { state: required.every((rule) => rule.approved) ? 'approved' : 'pending' };
    const result = await this.fetchJson<{ approvals_required: number; approvals_left: number; approved_by: Array<{ user: { id: number; username: string } }> }>(`${mrPath}/approvals`, token);
    if (!result.success) return { state: 'unknown', problem: result.problem };
    const value = result.data;
    if (!value || !Number.isSafeInteger(value.approvals_required) || value.approvals_required < 0 || !Number.isSafeInteger(value.approvals_left)
      || value.approvals_left < 0 || value.approvals_left > value.approvals_required || !Array.isArray(value.approved_by)
      || value.approved_by.some((entry) => !entry || !Number.isSafeInteger(entry.user?.id) || entry.user.id <= 0 || typeof entry.user.username !== 'string')) return { state: 'unknown', problem: problem('malformed-response') };
    return { state: value.approvals_left > 0 ? 'pending' : value.approved_by.length > 0 ? 'approved' : value.approvals_required === 0 ? 'none' : 'unknown' };
  }
}
