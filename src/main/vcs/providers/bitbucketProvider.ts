import { BaseProvider } from './baseProvider';
import type { CiSummary, ProviderContext, PullRequestContext, ReviewSummary } from '../types';
import { aggregateChecks, providerDefaultBranch, problem, unavailablePr, type CheckState } from '../statusModel';

interface Repo { mainbranch?: { name: string }; parent?: { full_name: string } }
interface Pr {
  id: number; title: string; state: string; author: { nickname?: string; display_name?: string };
  source: { branch: { name: string }; commit: { hash: string }; repository: { full_name: string } };
  destination: { repository: { full_name: string } };
}
interface Build { key: string; state: string; updated_on?: string }
interface Participant { user: { uuid: string }; role: string; approved: boolean; state?: string }
const shaValid = (sha: unknown): sha is string => typeof sha === 'string' && /^[a-f0-9]{40,64}$/i.test(sha);
const repoValid = (repo: unknown): repo is string => typeof repo === 'string' && repo.length <= 512 && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo) && repo.split('/').every((segment) => segment !== '.' && segment !== '..');

export class BitbucketProvider extends BaseProvider {
  readonly type = 'bitbucket' as const;
  readonly apiBaseUrl = 'https://api.bitbucket.org/2.0';
  private path(context: ProviderContext): string { return `/repositories/${context.owner}/${context.repo}`; }
  async getDefaultBranch(context: ProviderContext, token?: string): Promise<string> {
    const result = await this.fetchJson<Repo>(this.path(context), token);
    return result.success ? providerDefaultBranch(result.data?.mainbranch?.name) : '';
  }
  private async base(context: ProviderContext, token?: string) {
    const repo = await this.fetchJson<Repo>(this.path(context), token);
    if (!repo.success) return repo;
    if (!repo.data || typeof repo.data !== 'object') return { success: false as const, problem: problem('malformed-response') };
    const name = repo.data.parent?.full_name ?? `${context.owner}/${context.repo}`;
    return repoValid(name) ? { success: true as const, name } : { success: false as const, problem: problem('malformed-response') };
  }
  async getPullRequestForBranch(context: ProviderContext, branch: string, token?: string): Promise<PullRequestContext> {
    if (!branch) return unavailablePr(problem('unsupported'));
    const base = await this.base(context, token);
    if (!base.success) return unavailablePr(base.problem);
    const source = `${context.owner}/${context.repo}`;
    const query = `source.branch.name = ${JSON.stringify(branch)} AND source.repository.full_name = ${JSON.stringify(source)}`;
    const result = await this.pages<Pr>(`/repositories/${base.name}/pullrequests?state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED&q=${encodeURIComponent(query)}&pagelen=100`, token, 'bitbucket');
    if (!result.success) return unavailablePr(result.problem);
    if (result.data.some((pr) => !pr || !Number.isSafeInteger(pr.id) || pr.id <= 0 || typeof pr.title !== 'string' || pr.title.length > 512
      || !['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'].includes(pr.state) || !shaValid(pr.source?.commit?.hash)
      || typeof pr.source?.branch?.name !== 'string' || !repoValid(pr.source?.repository?.full_name)
      || !repoValid(pr.destination?.repository?.full_name)
      || (pr.author?.nickname !== undefined && (typeof pr.author.nickname !== 'string' || pr.author.nickname.length > 256))
      || (pr.author?.display_name !== undefined && (typeof pr.author.display_name !== 'string' || pr.author.display_name.length > 256)))) return unavailablePr(problem('malformed-response'));
    const candidates = result.data.filter((pr) => pr.source.branch.name === branch && pr.source.repository.full_name.toLowerCase() === source.toLowerCase()
      && pr.destination.repository.full_name.toLowerCase() === base.name.toLowerCase());
    if (!candidates.length) return { exists: false, outcome: 'none' };
    const matching = context.headSha ? candidates.filter((pr) => pr.source.commit.hash === context.headSha) : candidates;
    if (!matching.length) return unavailablePr(problem('stale'));
    matching.sort((a, b) => Number(b.state === 'OPEN') - Number(a.state === 'OPEN') || b.id - a.id);
    const pr = matching[0];
    return { exists: true, outcome: 'found', number: pr.id, title: pr.title, headSha: pr.source.commit.hash,
      state: pr.state === 'MERGED' ? 'merged' : pr.state === 'OPEN' ? 'open' : 'closed', author: pr.author?.nickname ?? pr.author?.display_name,
      repositoryPath: base.name, url: `https://bitbucket.org/${base.name}/pull-requests/${pr.id}` };
  }
  async getChecksSummary(context: ProviderContext, branch: string, token?: string): Promise<CiSummary> {
    let sha = context.headSha;
    if (!sha && branch) {
      const ref = await this.fetchJson<{ target: { hash: string } }>(`${this.path(context)}/refs/branches/${encodeURIComponent(branch)}`, token);
      if (!ref.success) return { state: 'unknown', problem: ref.problem };
      sha = ref.data?.target?.hash;
    }
    if (!shaValid(sha)) return { state: 'unknown', problem: problem('malformed-response') };
    const result = await this.pages<Build>(`${this.path(context)}/commit/${sha}/statuses?pagelen=100`, token, 'bitbucket');
    if (!result.data) return { state: 'unknown', sha, problem: result.success ? problem('unknown') : result.problem };
    const latest = new Map<string, Build>();
    for (const build of result.data) {
      if (!build || typeof build.key !== 'string' || !['SUCCESSFUL', 'FAILED', 'INPROGRESS', 'STOPPED'].includes(build.state)
        || (build.updated_on !== undefined && !Number.isFinite(Date.parse(build.updated_on)))) return { state: 'unknown', sha, problem: problem('malformed-response') };
      const previous = latest.get(build.key);
      if (previous && previous.state !== build.state && (!previous.updated_on || !build.updated_on || previous.updated_on === build.updated_on))
        return { state: 'unknown', sha, problem: problem('malformed-response') };
      if (!previous || Date.parse(build.updated_on ?? '') > Date.parse(previous.updated_on ?? '')) latest.set(build.key, build);
    }
    const states: Record<string, CheckState> = { SUCCESSFUL: 'success', FAILED: 'failure', INPROGRESS: 'pending', STOPPED: 'failure' };
    return aggregateChecks([...latest.values()].map((build) => states[build.state]), sha, result.success ? undefined : result.problem);
  }
  async getReviewSummary(context: ProviderContext, number: number, token?: string): Promise<ReviewSummary> {
    const base = await this.base(context, token);
    if (!base.success) return { state: 'unknown', problem: base.problem };
    // Participants are embedded in the PR self resource; there is no /participants API.
    const result = await this.fetchJson<{ participants: Participant[]; reviewers: Array<{ uuid: string }> }>(`/repositories/${base.name}/pullrequests/${number}`, token);
    if (!result.success) return { state: 'unknown', problem: result.problem };
    const value = result.data;
    if (!value || !Array.isArray(value.participants) || !Array.isArray(value.reviewers)
      || value.participants.some((p) => !p || typeof p.user?.uuid !== 'string' || typeof p.approved !== 'boolean' || typeof p.role !== 'string')
      || value.reviewers.some((r) => !r || typeof r.uuid !== 'string')) return { state: 'unknown', problem: problem('malformed-response') };
    if (value.participants.some((p) => p.role !== 'AUTHOR' && p.state === 'changes_requested')) return { state: 'changes_requested' };
    const approved = new Set(value.participants.filter((p) => p.role !== 'AUTHOR' && p.approved).map((p) => p.user.uuid));
    if (value.reviewers.some((r) => !approved.has(r.uuid))) return { state: 'pending' };
    return { state: approved.size > 0 ? 'approved' : 'none' };
  }
}
