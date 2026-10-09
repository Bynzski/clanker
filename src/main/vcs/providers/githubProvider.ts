import { BaseProvider } from './baseProvider';
import type { CiSummary, ProviderContext, PullRequestContext, ReviewSummary, VcsProblem } from '../types';
import { aggregateChecks, aggregateReviews, providerDefaultBranch, problem, unavailablePr, type CheckState } from '../statusModel';

interface Repo { default_branch: string; fork?: boolean; parent?: { full_name: string } }
interface Pr {
  number: number; title: string; state: string; merged_at: string | null;
  user: { login: string }; head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { repo: { full_name: string } }; updated_at?: string;
}
interface Check { id: number; status: string; conclusion: string | null }
interface Status { id: number; state: string; context: string }
interface Review { id: number; state: string; user: { id?: number; login: string } }
const shaValid = (sha: unknown): sha is string => typeof sha === 'string' && /^[a-f0-9]{40,64}$/i.test(sha);
const repoValid = (repo: unknown): repo is string => typeof repo === 'string' && repo.length <= 512 && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo) && repo.split('/').every((segment) => segment !== '.' && segment !== '..');

export class GitHubProvider extends BaseProvider {
  readonly type = 'github' as const;
  readonly apiBaseUrl = 'https://api.github.com';
  private path(context: ProviderContext): string { return `/repos/${context.owner}/${context.repo}`; }

  async getDefaultBranch(context: ProviderContext, token?: string): Promise<string> {
    const result = await this.fetchJson<Repo>(this.path(context), token);
    return result.success ? providerDefaultBranch(result.data?.default_branch) : '';
  }
  async getPullRequestForBranch(context: ProviderContext, branch: string, token?: string): Promise<PullRequestContext> {
    if (!branch) return unavailablePr(problem('unsupported'));
    const source = `${context.owner}/${context.repo}`;
    // Fork PRs live at the base repository, not at the fork's /pulls endpoint.
    const repo = await this.fetchJson<Repo>(this.path(context), token);
    if (!repo.success) return unavailablePr(repo.problem);
    if (!repo.data || typeof repo.data.default_branch !== 'string') return unavailablePr(problem('malformed-response'));
    let base = source;
    if (repo.data?.fork) {
      if (!repoValid(repo.data.parent?.full_name)) return unavailablePr(problem('malformed-response'));
      base = repo.data.parent.full_name;
    }
    const result = await this.pages<Pr>(`/repos/${base}/pulls?head=${encodeURIComponent(`${context.owner}:${branch}`)}&state=all&per_page=100`, token);
    if (!result.success) return unavailablePr(result.problem);
    if (result.data.some((pr) => !pr || !Number.isSafeInteger(pr.number) || pr.number <= 0 || typeof pr.title !== 'string' || pr.title.length > 512
      || !['open', 'closed'].includes(pr.state) || !pr.head || !shaValid(pr.head.sha) || typeof pr.head.ref !== 'string' || (pr.head.repo !== null && !repoValid(pr.head.repo?.full_name))
      || !pr.base?.repo || !repoValid(pr.base.repo.full_name) || typeof pr.user?.login !== 'string' || pr.user.login.length > 128)) return unavailablePr(problem('malformed-response'));
    if (result.data.some((pr) => pr.head.ref === branch && pr.head.repo === null)) return unavailablePr(problem('unknown'));
    const candidates = result.data.filter((pr) => pr.head.ref === branch && pr.head.repo?.full_name.toLowerCase() === source.toLowerCase()
      && pr.base.repo.full_name.toLowerCase() === base.toLowerCase());
    if (!candidates.length) return { exists: false, outcome: 'none' };
    const matching = context.headSha ? candidates.filter((pr) => pr.head.sha === context.headSha) : candidates;
    if (!matching.length) return unavailablePr(problem('stale'));
    matching.sort((a, b) => Number(b.state === 'open') - Number(a.state === 'open') || b.number - a.number);
    const pr = matching[0];
    return { exists: true, outcome: 'found', number: pr.number, title: pr.title, author: pr.user.login,
      state: pr.merged_at ? 'merged' : pr.state === 'open' ? 'open' : 'closed', headSha: pr.head.sha,
      repositoryPath: base, url: `https://github.com/${base}/pull/${pr.number}` };
  }
  private async resolveSha(context: ProviderContext, branch: string, token?: string): Promise<{ sha?: string; problem?: VcsProblem }> {
    if (context.headSha) return shaValid(context.headSha) ? { sha: context.headSha } : { problem: problem('malformed-response') };
    if (!branch) return { problem: problem('unsupported') };
    const result = await this.fetchJson<{ object: { sha: string } }>(`${this.path(context)}/git/ref/heads/${encodeURIComponent(branch)}`, token);
    return !result.success ? { problem: result.problem } : shaValid(result.data?.object?.sha) ? { sha: result.data.object.sha } : { problem: problem('malformed-response') };
  }
  async getChecksSummary(context: ProviderContext, branch: string, token?: string): Promise<CiSummary> {
    const resolved = await this.resolveSha(context, branch, token);
    const sha = resolved.sha;
    if (!sha) return { state: 'unknown', problem: resolved.problem };
    const paths = [this.path(context)];
    if (context.pullRequestRepositoryPath && context.pullRequestRepositoryPath !== `${context.owner}/${context.repo}`) {
      if (!repoValid(context.pullRequestRepositoryPath)) return { state: 'unknown', sha, problem: problem('malformed-response') };
      paths.push(`/repos/${context.pullRequestRepositoryPath}`);
    }
    const sources = await Promise.all(paths.map((path) => Promise.all([
      this.pages<Check>(`${path}/commits/${sha}/check-runs?filter=latest&per_page=100`, token, 'checks'),
      this.pages<Status>(`${path}/commits/${sha}/statuses?per_page=100`, token),
    ])));
    const states: CheckState[] = [];
    let failure: VcsProblem | undefined;
    for (const [checks, statuses] of sources) {
      failure ??= !checks.success ? checks.problem : !statuses.success ? statuses.problem : undefined;
      for (const check of checks.data ?? []) {
      if (!check || !Number.isSafeInteger(check.id) || typeof check.status !== 'string') { failure = problem('malformed-response'); continue; }
      if (['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(check.status)) states.push('pending');
      else if (check.status !== 'completed') states.push('unknown');
      else if (check.conclusion === 'success') states.push('success');
      else if (['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'].includes(check.conclusion ?? '')) states.push('failure');
      else if (['neutral', 'skipped'].includes(check.conclusion ?? '')) states.push('neutral');
      else states.push('unknown');
    }
    if (statuses.data) {
      const latest = new Map<string, Status>();
      for (const status of statuses.data) {
        if (!status || !Number.isSafeInteger(status.id) || typeof status.context !== 'string' || !['success', 'failure', 'error', 'pending'].includes(status.state)) { failure = problem('malformed-response'); continue; }
        if (!latest.has(status.context) || latest.get(status.context)!.id < status.id) latest.set(status.context, status);
      }
      for (const status of latest.values()) states.push(status.state === 'error' ? 'failure' : status.state as CheckState);
    }
    }
    return aggregateChecks(states, sha, failure);
  }
  async getReviewSummary(context: ProviderContext, number: number, token?: string): Promise<ReviewSummary> {
    // Fork base is re-derived, never supplied by the renderer.
    const repo = await this.fetchJson<Repo>(this.path(context), token);
    if (!repo.success) return { state: 'unknown', problem: repo.problem };
    if (!repo.data || typeof repo.data.default_branch !== 'string') return { state: 'unknown', problem: problem('malformed-response') };
    const base = repo.data.fork ? repo.data.parent?.full_name : `${context.owner}/${context.repo}`;
    if (!repoValid(base)) return { state: 'unknown', problem: problem('malformed-response') };
    const [result, pr] = await Promise.all([
      this.pages<Review>(`/repos/${base}/pulls/${number}/reviews?per_page=100`, token),
      this.fetchJson<{ requested_reviewers: unknown[]; requested_teams: unknown[] }>(`/repos/${base}/pulls/${number}`, token),
    ]);
    if (!result.success) return { state: 'unknown', problem: result.problem };
    if (result.data.some((review) => !review || !Number.isSafeInteger(review.id) || typeof review.user?.login !== 'string' || !review.user.login || review.user.login.length > 128
      || (review.user.id !== undefined && (!Number.isSafeInteger(review.user.id) || review.user.id <= 0))
      || !['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'PENDING', 'DISMISSED'].includes(review.state))) return { state: 'unknown', problem: problem('malformed-response') };
    const summary = aggregateReviews(result.data.map((review) => ({ id: review.id, reviewer: review.user.id === undefined ? review.user.login.toLowerCase() : String(review.user.id), state: review.state })));
    if (summary.state === 'changes_requested') return summary;
    if (!pr.success) return { state: 'unknown', problem: pr.problem };
    if (!pr.data || !Array.isArray(pr.data.requested_reviewers) || !Array.isArray(pr.data.requested_teams)
      || pr.data.requested_reviewers.some((user) => !user || typeof user !== 'object' || typeof (user as { login?: unknown }).login !== 'string')
      || pr.data.requested_teams.some((team) => !team || typeof team !== 'object' || typeof (team as { slug?: unknown }).slug !== 'string'))
      return { state: 'unknown', problem: problem('malformed-response') };
    return pr.data.requested_reviewers.length || pr.data.requested_teams.length ? { state: 'pending' } : summary;
  }
}
