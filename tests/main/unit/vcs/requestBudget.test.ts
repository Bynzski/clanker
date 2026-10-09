import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubProvider } from '../../../../src/main/vcs/providers/githubProvider';
import { withVcsBudget } from '../../../../src/main/vcs/requestBudget';
import { context, branch, SHA, installFetch, json } from './providerFixtures';
class InspectableProvider extends GitHubProvider {
  send() { return this.fetchJson('/user', 'secret-token'); }
  sendPage(page: number) { return this.fetchJson(`/user?page=${page}`, 'secret-token'); }
  list() { return this.pages(`/repos/owner/repo/commits/${SHA}/statuses?per_page=100`, 'secret-token'); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('production bounded transport', () => {
  it.each([[401, 'auth-required'], [403, 'forbidden'], [404, 'not-found'], [500, 'unknown']])('classifies %s without retry or raw error', async (status, code) => {
    const fetch = installFetch(() => json({ message: 'secret-token from remote' }, status));
    const result = await new InspectableProvider().send();
    expect(result).toMatchObject({ success: false, problem: { code } });
    expect(JSON.stringify(result)).not.toContain('secret-token'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds rate-limit backoff instead of retrying beyond the total budget', async () => {
    const fetch = installFetch(() => json({}, 429, { 'retry-after': '3600' }));
    expect(await new InspectableProvider().send()).toMatchObject({ problem: { code: 'rate-limited' } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retries transient network errors at most twice', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new Error('secret-token private hostname'));
    vi.stubGlobal('fetch', fetch);
    const promise = new InspectableProvider().send();
    await vi.advanceTimersByTimeAsync(1600);
    expect(await promise).toMatchObject({ problem: { code: 'network-error' } }); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('distinguishes caller cancellation from deadline expiration', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })));
    const cancelled = new AbortController();
    const first = withVcsBudget(() => new InspectableProvider().send(), { signal: cancelled.signal, timeoutMs: 200 });
    cancelled.abort(); await vi.advanceTimersByTimeAsync(1);
    expect(await first).toMatchObject({ problem: { code: 'cancelled' } });
    const second = withVcsBudget(() => new InspectableProvider().send(), { timeoutMs: 200 });
    await vi.advanceTimersByTimeAsync(201);
    expect(await second).toMatchObject({ problem: { code: 'timeout' } });
  });
  it('bounds body streaming even when headers arrived promptly', async () => {
    vi.useFakeTimers(); let cancelled = false;
    installFetch(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } })));
    const result = withVcsBudget(() => new InspectableProvider().send(), { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(101);
    expect(await result).toMatchObject({ problem: { code: 'timeout' } }); expect(cancelled).toBe(true);
  });
  it.each([true, false])('caps response size before JSON parsing (Content-Length present: %s)', async (advertised) => {
    let cancelled = false;
    installFetch(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } }), { headers: advertised ? { 'content-length': String(2 * 1024 * 1024 + 1) } : undefined }));
    expect(await new InspectableProvider().send()).toMatchObject({ problem: { code: 'response-too-large' } }); expect(cancelled).toBe(true);
  });
  it('caps total streamed bytes across otherwise valid pages in one scope', async () => {
    installFetch(() => json({ padding: 'x'.repeat(1900 * 1024) }));
    const provider = new InspectableProvider();
    const results = await withVcsBudget(async () => {
      const pages = [];
      for (let i = 0; i < 5; i++) pages.push(await provider.sendPage(i));
      return pages;
    });
    expect(results.slice(0, 4).every((result) => result.success)).toBe(true);
    expect(results[4]).toMatchObject({ success: false, problem: { code: 'response-too-large' } });
  });
  it('rejects malformed JSON', async () => {
    installFetch(() => new Response('not-json'));
    expect(await new InspectableProvider().send()).toMatchObject({ problem: { code: 'malformed-response' } });
  });
  it.each(['https://attacker.test/steal?page=2', `https://api.github.com/repos/owner/repo/commits/${SHA}/statuses?per_page=100&evil=1&page=2`])('does not follow hostile pagination %s', async (next) => {
    const fetch = installFetch(() => json([], 200, { link: `<${next}>; rel="next"` }));
    expect(await new InspectableProvider().list()).toMatchObject({ problem: { code: 'malformed-response' } }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('fails incompletely at the page ceiling, rather than accepting truncated success', async () => {
    const fetch = installFetch((url) => {
      url.searchParams.set('page', String(Number(url.searchParams.get('page') ?? 1) + 1));
      return json([], 200, { link: `<${url}>; rel="next"` });
    });
    expect(await new InspectableProvider().list()).toMatchObject({ problem: { code: 'incomplete' } }); expect(fetch).toHaveBeenCalledTimes(8);
  });
  it('deduplicates metadata reads only within a request budget', async () => {
    const fetch = installFetch(() => json({ default_branch: 'trunk' }));
    const provider = new GitHubProvider();
    await withVcsBudget(() => Promise.all([provider.getDefaultBranch(context('github')), provider.getDefaultBranch(context('github'))]));
    expect(fetch).toHaveBeenCalledTimes(1);
    await provider.getDefaultBranch(context('github')); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('isolates cancellation of parallel context budgets', async () => {
    const controller = new AbortController(); controller.abort();
    installFetch((url) => url.pathname.endsWith('/check-runs') ? json({ check_runs: [] }) : json([]));
    const provider = new GitHubProvider();
    const [cancelled, live] = await Promise.all([
      withVcsBudget(() => provider.getChecksSummary(context('github'), branch), { signal: controller.signal }),
      withVcsBudget(() => provider.getChecksSummary(context('github'), branch)),
    ]);
    expect(cancelled).toMatchObject({ state: 'unknown', problem: { code: 'cancelled' } }); expect(live.state).toBe('none');
  });
});
