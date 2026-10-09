import { createHash } from 'node:crypto';
import { isApprovedGitLabOrigin } from '../instancePolicy';
import type { CiSummary, DeepLink, ProviderContext, PullRequestContext, ReviewSummary, VcsProblem, VcsProvider } from '../types';
import { assertVcsBudget, currentVcsBudget, vcsRetryDelay, withVcsBudget } from '../requestBudget';
import { ProviderFailure, readProviderBody } from '../responseBody';
import { problem } from '../statusModel';
import { providerLinks } from '../providerLinks';

export type ApiResult<T> = { success: true; data: T; headers: Headers }
  | { success: false; error: string; problem: VcsProblem; data?: T };
export interface IVcsProvider {
  readonly type: VcsProvider;
  readonly apiBaseUrl: string;
  getPullRequestForBranch(context: ProviderContext, branch: string, token?: string): Promise<PullRequestContext>;
  getChecksSummary(context: ProviderContext, branch: string, token?: string): Promise<CiSummary>;
  getReviewSummary(context: ProviderContext, number: number, token?: string): Promise<ReviewSummary>;
  getChecksStatus(context: ProviderContext, branch: string, token?: string): Promise<'pending' | 'success' | 'failure' | 'error'>;
  getReviewState(context: ProviderContext, number: number, token?: string): Promise<'approved' | 'changes_requested' | 'commented' | 'pending' | undefined>;
  getDefaultBranch(context: ProviderContext, token?: string): Promise<string>;
  validateToken(token: string): Promise<boolean>;
  getDeepLinks(context: ProviderContext, branch?: string, number?: number): DeepLink[];
}

/** One bounded, provider-aware transport, shared by all hosted/approved instances. */
export abstract class BaseProvider implements IVcsProvider {
  abstract readonly type: VcsProvider;
  abstract readonly apiBaseUrl: string;
  abstract getPullRequestForBranch(context: ProviderContext, branch: string, token?: string): Promise<PullRequestContext>;
  abstract getChecksSummary(context: ProviderContext, branch: string, token?: string): Promise<CiSummary>;
  abstract getReviewSummary(context: ProviderContext, number: number, token?: string): Promise<ReviewSummary>;
  abstract getDefaultBranch(context: ProviderContext, token?: string): Promise<string>;

  /** One-way legacy projections: unavailable/absent never becomes pending or green. */
  async getChecksStatus(context: ProviderContext, branch: string, token?: string): Promise<'pending' | 'success' | 'failure' | 'error'> {
    const { state } = await this.getChecksSummary(context, branch, token);
    return state === 'none' || state === 'unknown' ? 'error' : state;
  }
  async getReviewState(context: ProviderContext, number: number, token?: string): Promise<'approved' | 'changes_requested' | 'commented' | 'pending' | undefined> {
    const { state } = await this.getReviewSummary(context, number, token);
    return state === 'none' || state === 'unknown' ? undefined : state;
  }
  getDeepLinks(context: ProviderContext, branch?: string, number?: number): DeepLink[] { return providerLinks(context, branch, number); }
  async validateToken(token: string): Promise<boolean> {
    const result = await this.fetchWithAuth<{ id?: number; login?: string; username?: string; uuid?: string }>('/user', token);
    if (!result.success || !result.data || typeof result.data !== 'object') return false;
    const identity = result.data;
    if (this.type === 'bitbucket') return typeof identity.uuid === 'string' && !!identity.uuid;
    return Number.isSafeInteger(identity.id) && identity.id! > 0
      && (this.type === 'github' ? typeof identity.login === 'string' && !!identity.login : typeof identity.username === 'string' && !!identity.username);
  }

  private async attempt(url: string, init: RequestInit): Promise<Response> {
    assertVcsBudget();
    const budget = currentVcsBudget()!;
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.origin !== new URL(this.apiBaseUrl).origin || target.username || target.password
      || (this.type === 'gitlab' && !isApprovedGitLabOrigin(target.origin))) {
      throw new ProviderFailure(problem('unsupported'));
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    budget.signal.addEventListener('abort', abort, { once: true });
    if (budget.signal.aborted) abort();
    const timer = setTimeout(() => { budget.cancel('timeout'); abort(); }, Math.min(4000, Math.max(0, budget.deadline - Date.now())));
    try {
      const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        let code: VcsProblem['code'] = 'unknown';
        if (response.status === 401) code = 'auth-required';
        else if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) code = 'rate-limited';
        else if (response.status === 403) code = 'forbidden';
        else if (response.status === 404) code = 'not-found';
        const retry = response.headers.get('retry-after');
        const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : NaN;
        throw new ProviderFailure(problem(code, code === 'rate-limited' && Number.isFinite(seconds) ? Math.max(0, seconds) : undefined));
      }
      const body = await readProviderBody(response, controller.signal);
      assertVcsBudget();
      return new Response([204, 205].includes(response.status) ? null : body, { status: response.status, headers: response.headers });
    } finally {
      controller.abort();
      clearTimeout(timer);
      budget.signal.removeEventListener('abort', abort);
    }
  }

  protected async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    if (!currentVcsBudget()) return withVcsBudget(() => this.fetchWithRetry(url, init));
    for (let attempt = 0; ; attempt++) {
      try { return await this.attempt(url, init); }
      catch (error) {
        const budget = currentVcsBudget()!;
        if (budget.signal.aborted || Date.now() >= budget.deadline) {
          throw new ProviderFailure(problem(budget.signal.reason?.name === 'TimeoutError' || Date.now() >= budget.deadline ? 'timeout' : 'cancelled'));
        }
        const failure = error instanceof ProviderFailure ? error : new ProviderFailure(problem('network-error'));
        if (attempt >= 2 || !['network-error', 'rate-limited'].includes(failure.problem.code)) throw failure;
        const delay = failure.problem.retryAfterMs ?? (250 * 2 ** attempt);
        if (delay >= budget.deadline - Date.now()) throw failure;
        await vcsRetryDelay(delay, budget.signal);
      }
    }
  }

  private request<T>(endpoint: string, token?: string): Promise<ApiResult<T>> {
    const budget = currentVcsBudget();
    const key = createHash('sha256').update(`${this.apiBaseUrl}${endpoint}\0${token ?? ''}`).digest('hex');
    const existing = budget?.requests.get(key);
    if (existing) return existing as Promise<ApiResult<T>>;
    const request = this.performRequest<T>(endpoint, token);
    if (budget && budget.requests.size < 32) budget.requests.set(key, request);
    return request;
  }

  private async performRequest<T>(endpoint: string, token?: string): Promise<ApiResult<T>> {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers[this.type === 'gitlab' ? 'PRIVATE-TOKEN' : 'Authorization'] = this.type === 'gitlab' ? token : `Bearer ${token}`;
      if (this.type === 'github') headers['X-GitHub-Api-Version'] = '2022-11-28';
      const response = await this.fetchWithRetry(`${this.apiBaseUrl}${endpoint}`, { headers });
      const text = await response.text();
      let data: T;
      try { data = JSON.parse(text) as T; }
      catch { throw new ProviderFailure(problem('malformed-response')); }
      return { success: true, data, headers: response.headers };
    } catch (error) {
      const budget = currentVcsBudget();
      const failure = error instanceof ProviderFailure ? error.problem
        : problem(budget?.signal.aborted ? (budget.signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled') : 'malformed-response');
      return { success: false, error: failure.message, problem: failure };
    }
  }
  protected fetchWithAuth<T>(endpoint: string, token: string): Promise<ApiResult<T>> { return this.request(endpoint, token); }
  protected fetchPublic<T>(endpoint: string): Promise<ApiResult<T>> { return this.request(endpoint); }
  protected fetchJson<T>(endpoint: string, token?: string): Promise<ApiResult<T>> { return this.request(endpoint, token); }

  /** At most eight 100-row pages, inside the same deadline. Never silently truncate. */
  protected async pages<T>(endpoint: string, token: string | undefined, kind: 'array' | 'checks' | 'bitbucket' = 'array'): Promise<ApiResult<T[]>> {
    if (!currentVcsBudget()) return withVcsBudget(() => this.pages(endpoint, token, kind));
    const initial = new URL(`${this.apiBaseUrl}${endpoint}`);
    const rows: T[] = [];
    let next: string | null = endpoint;
    const seen = new Set<string>();
    for (let page = 1; next && page <= 8; page++) {
      if (seen.has(next)) return { success: false, error: problem('incomplete').message, problem: problem('incomplete'), data: rows };
      seen.add(next);
      const result: ApiResult<unknown> = await this.request<unknown>(next, token);
      if (!result.success) return { ...result, data: rows };
      const envelope = result.data as { values?: T[]; check_runs?: T[]; next?: unknown; size?: number; total_count?: number } | null;
      const entries = kind === 'array' ? result.data : kind === 'checks' ? envelope?.check_runs : envelope?.values;
      if (!Array.isArray(entries) || entries.length > 100) return { success: false, error: problem('malformed-response').message, problem: problem('malformed-response'), data: rows };
      rows.push(...entries as T[]);
      let nextUrl: string | null = null;
      if (kind === 'bitbucket') {
        if (envelope?.size !== undefined && (!Number.isSafeInteger(envelope.size) || envelope.size < 0))
          return { success: false, error: problem('malformed-response').message, problem: problem('malformed-response'), data: rows };
        if (envelope?.next !== undefined && typeof envelope.next !== 'string') return { success: false, error: problem('malformed-response').message, problem: problem('malformed-response'), data: rows };
        nextUrl = typeof envelope?.next === 'string' ? envelope.next : null;
        if (!nextUrl && typeof envelope?.size === 'number' && envelope.size > rows.length) return { success: false, error: problem('incomplete').message, problem: problem('incomplete'), data: rows };
      } else {
        if (kind === 'checks' && envelope?.total_count !== undefined && (!Number.isSafeInteger(envelope.total_count) || envelope.total_count < 0))
          return { success: false, error: problem('malformed-response').message, problem: problem('malformed-response'), data: rows };
        nextUrl = result.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
        const gitLabNext = result.headers.get('x-next-page');
        if (gitLabNext) {
          if (!/^\d+$/.test(gitLabNext)) return { success: false, error: problem('malformed-response').message, problem: problem('malformed-response'), data: rows };
          const url = new URL(initial); url.searchParams.set('page', gitLabNext); nextUrl = url.href;
        } else if (!nextUrl && entries.length === 100) {
          const url = new URL(initial); url.searchParams.set('page', String(page + 1)); nextUrl = url.href;
        }
      }
      if (!nextUrl && ((kind === 'checks' && (envelope?.total_count ?? 0) > rows.length)
        || Number(result.headers.get('x-total') ?? 0) > rows.length))
        return { success: false, error: problem('incomplete').message, problem: problem('incomplete'), data: rows };
      if (nextUrl) {
        try {
          if (nextUrl.length > 8192) throw new Error();
          const url: URL = new URL(nextUrl, this.apiBaseUrl);
          if (url.origin !== initial.origin || url.pathname !== initial.pathname || url.username || url.password
            || [...new Set(initial.searchParams.keys())].some((key) => !['page', 'per_page', 'pagelen'].includes(key)
              && JSON.stringify(url.searchParams.getAll(key).sort()) !== JSON.stringify(initial.searchParams.getAll(key).sort()))
            || [...url.searchParams.keys()].some((key) => !initial.searchParams.has(key) && !['page', 'per_page', 'pagelen'].includes(key))) throw new Error();
          next = `${url.pathname.slice(new URL(this.apiBaseUrl).pathname.length === 1 ? 0 : new URL(this.apiBaseUrl).pathname.length)}${url.search}`;
        } catch { return { success: false, error: problem('malformed-response').message, problem: problem('malformed-response'), data: rows }; }
      } else next = null;
    }
    if (next) return { success: false, error: problem('incomplete').message, problem: problem('incomplete'), data: rows };
    return { success: true, data: rows, headers: new Headers() };
  }
}
