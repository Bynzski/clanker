import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderContext, getProviderPrLink } from '../../../../src/main/vcs/contextService';
import { GitHubProvider } from '../../../../src/main/vcs/providers/githubProvider';
import { withVcsBudget } from '../../../../src/main/vcs/requestBudget';

vi.mock('../../../../src/main/credential/credentialService', () => ({ getPat: () => ({ success: false }) }));

function delayedFetch(delay: number) {
  return vi.fn((url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init.signal!;
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      const data = url.includes('/pulls?')
        ? [{ number: 1, title: 'PR', state: 'open', html_url: 'https://github.com/owner/repo/pull/1', user: { login: 'user' }, merged_at: null }]
        : url.includes('/git/refs/') ? { object: { sha: 'abc' } }
          : url.endsWith('/status') ? { state: 'success' }
            : url.endsWith('/reviews') ? [] : { default_branch: 'main' };
      resolve(new Response(JSON.stringify(data)));
    }, delay);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  }));
}

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const context = (options = {}) => getProviderContext('origin', 'https://github.com/owner/repo.git', 'feature', 'main', options);

describe('VCS request deadlines and cancellation', () => {
  it('caps the entire sequential context at ten seconds and retains only safe static links on failure', async () => {
    const fetch = delayedFetch(3000);
    vi.stubGlobal('fetch', fetch);
    const result = context();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ success: false, deepLinks: expect.any(Array) });
    expect(fetch).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('individual four-second timeout cancels context rather than retrying or fetching later endpoints', async () => {
    const fetch = delayedFetch(5000);
    vi.stubGlobal('fetch', fetch);
    const result = context();
    await vi.advanceTimersByTimeAsync(4000);
    expect((await result).success).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors caller cancellation during a fetch', async () => {
    const fetch = delayedFetch(3000);
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const result = context({ signal: controller.signal });
    await vi.advanceTimersByTimeAsync(20);
    controller.abort();
    expect((await result).success).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not dispatch for an already cancelled request', async () => {
    const fetch = delayedFetch(10);
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController(); controller.abort();
    expect((await context({ signal: controller.signal })).success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels retry backoff without another request', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('network error with secret'));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const result = context({ signal: controller.signal });
    await vi.advanceTimersByTimeAsync(50);
    controller.abort();
    expect((await result).success).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows bounded network retries within the same budget', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('{"login":"user"}'));
    vi.stubGlobal('fetch', fetch);
    const result = new GitHubProvider().validateToken('secret');
    await vi.advanceTimersByTimeAsync(750);
    expect(await result).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not spend the remaining budget on an impossible retry', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetch);
    const result = context({ timeoutMs: 200 });
    await vi.advanceTimersByTimeAsync(200);
    expect((await result).success).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 403, 429])('does not retry HTTP %s', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal('fetch', fetch);
    expect(await new GitHubProvider().validateToken('secret')).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stalled response body, not just response headers', async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal!.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
          controller.enqueue(new TextEncoder().encode('{'));
        },
      });
      return Promise.resolve(new Response(body));
    });
    vi.stubGlobal('fetch', fetch);
    const result = context();
    await vi.advanceTimersByTimeAsync(4000);
    expect((await result).success).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('isolates concurrent context budgets on singleton providers', async () => {
    const fetch = delayedFetch(100);
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const cancelled = context({ signal: controller.signal });
    const successful = context();
    controller.abort();
    await vi.advanceTimersByTimeAsync(600);
    expect((await cancelled).success).toBe(false);
    expect((await successful).success).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('PR navigation fetches only identity and builds a trusted link, not API-supplied URLs', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { number: 42, title: 'PR', state: 'open', html_url: 'https://attacker.example', user: { login: 'user' }, merged_at: null },
    ])));
    vi.stubGlobal('fetch', fetch);
    expect(await getProviderPrLink('https://github.com/owner/repo.git', 'feature')).toBe('https://github.com/owner/repo/pull/42');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain('/pulls?');
    expect(await getProviderPrLink('https://gitlab-attacker.example/owner/repo.git', 'feature')).toBeNull();
    expect(await getProviderPrLink('https://github.com/owner/repo.git')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sanitizes transport errors that may contain credentials', async () => {
    class InspectableProvider extends GitHubProvider {
      request() { return this.fetchWithAuth('/user', 'secret-token'); }
    }
    const fetch = vi.fn().mockRejectedValue(new Error('Bearer secret-token'));
    vi.stubGlobal('fetch', fetch);
    const result = withVcsBudget(() => new InspectableProvider().request());
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ success: false, error: 'Provider request failed' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
