/**
 * Base VCS Provider Interface
 * Abstract interface for VCS provider implementations.
 */

import { assertVcsBudget, currentVcsBudget, withVcsBudget, vcsRetryDelay } from '../requestBudget';
import type {
  ProviderContext,
  PullRequestContext,
  DeepLink,
  VcsProvider,
} from '../types';

export interface IVcsProvider {
  /** The provider type */
  readonly type: VcsProvider;

  /** The base API URL */
  readonly apiBaseUrl: string;

  /**
   * Get PR/MR information for a branch.
   */
  getPullRequestForBranch(
    context: ProviderContext,
    branch: string,
    token?: string
  ): Promise<PullRequestContext>;

  /**
   * Get CI/check status for the latest commit on a branch.
   */
  getChecksStatus(
    context: ProviderContext,
    branch: string,
    token?: string
  ): Promise<'pending' | 'success' | 'failure' | 'error'>;

  /**
   * Get review state for a PR/MR.
   */
  getReviewState(
    context: ProviderContext,
    prNumber: number,
    token?: string
  ): Promise<'approved' | 'changes_requested' | 'commented' | 'pending' | undefined>;

  /**
   * Get the repository's default branch name.
   */
  getDefaultBranch(context: ProviderContext, token?: string): Promise<string>;

  /**
   * Validate a token has the required scopes.
   */
  validateToken(token: string): Promise<boolean>;

  /**
   * Get available deep links for the provider.
   */
  getDeepLinks(
    context: ProviderContext,
    branch?: string,
    prNumber?: number
  ): DeepLink[];
}

export const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB

export class ProviderPayloadTooLargeError extends Error {
  constructor(message = 'Provider response exceeded maximum allowed size') {
    super(message);
    this.name = 'ProviderPayloadTooLargeError';
  }
}

/**
 * Abstract base class with common functionality.
 */
export abstract class BaseProvider implements IVcsProvider {
  abstract readonly type: VcsProvider;
  abstract readonly apiBaseUrl: string;

  public static readonly MAX_RESPONSE_BYTES = MAX_PROVIDER_RESPONSE_BYTES;
  private static readonly DEFAULT_TIMEOUT_MS = 4_000;
  private static readonly DEFAULT_MAX_RETRIES = 2;
  private static readonly DEFAULT_BACKOFF_BASE_MS = 250;
  private static readonly DEFAULT_BACKOFF_MAX_MS = 2_000;

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    maxResponseBytes: number = BaseProvider.MAX_RESPONSE_BYTES
  ): Promise<Response> {
    assertVcsBudget();
    const budget = currentVcsBudget()!;
    const controller = new AbortController();
    const abort = () => controller.abort();
    budget.signal.addEventListener('abort', abort, { once: true });
    if (budget.signal.aborted) abort();
    const timeoutId = setTimeout(() => {
      abort();
      budget.cancel();
    }, Math.min(timeoutMs, Math.max(0, budget.deadline - Date.now())));
    try {
      // PRIVATE-TOKEN must never follow redirects. Include body reads in the
      // timeout; provider JSON parsing uses the already buffered body.
      const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel();
        return new Response(null, { status: response.status, headers: response.headers });
      }

      if ([204, 205, 304].includes(response.status)) {
        await response.body?.cancel();
        return new Response(null, { status: response.status, headers: response.headers });
      }

      const contentLengthHeader = response.headers.get('content-length');
      if (contentLengthHeader) {
        const contentLength = Number.parseInt(contentLengthHeader, 10);
        if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
          await response.body?.cancel();
          throw new ProviderPayloadTooLargeError();
        }
      }

      if (!response.body || typeof response.body.getReader !== 'function') {
        const arrayBuf = await response.arrayBuffer();
        if (arrayBuf.byteLength > maxResponseBytes) {
          throw new ProviderPayloadTooLargeError();
        }
        if (controller.signal.aborted) throw new DOMException('Request timed out', 'AbortError');
        assertVcsBudget();
        return new Response(arrayBuf, {
          status: response.status,
          headers: response.headers,
        });
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > maxResponseBytes) {
              throw new ProviderPayloadTooLargeError();
            }
            chunks.push(value);
          }
        }
      } catch (err) {
        try { await reader.cancel(); } catch { /* best effort cancellation */ }
        throw err;
      } finally {
        reader.releaseLock();
      }

      if (controller.signal.aborted) throw new DOMException('Request timed out', 'AbortError');
      assertVcsBudget();

      const body = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return new Response(body, {
        status: response.status,
        headers: response.headers,
      });
    } finally {
      clearTimeout(timeoutId);
      budget.signal.removeEventListener('abort', abort);
    }
  }

  protected async fetchWithRetry(
    url: string,
    init: RequestInit,
    options?: { timeoutMs?: number; maxRetries?: number; maxResponseBytes?: number }
  ): Promise<Response> {
    if (!currentVcsBudget()) {
      return withVcsBudget(() => this.fetchWithRetry(url, init, options));
    }
    assertVcsBudget();
    const target = new URL(url);
    const trustedOrigin = new URL(this.apiBaseUrl).origin;
    if (target.protocol !== 'https:' || target.origin !== trustedOrigin || target.username || target.password) {
      throw new Error('Unapproved provider API origin');
    }
    const timeoutMs = options?.timeoutMs ?? BaseProvider.DEFAULT_TIMEOUT_MS;
    const maxRetries = options?.maxRetries ?? BaseProvider.DEFAULT_MAX_RETRIES;
    const maxResponseBytes = options?.maxResponseBytes ?? BaseProvider.MAX_RESPONSE_BYTES;

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      assertVcsBudget();
      try {
        return await this.fetchWithTimeout(url, init, timeoutMs, maxResponseBytes);
      } catch (error: unknown) {
        lastError = error;
        if (error instanceof Error && error.name === 'AbortError') currentVcsBudget()!.cancel();
        assertVcsBudget();
        const shouldRetry = attempt < maxRetries &&
          !(error instanceof Error && (error.name === 'AbortError' || error.name === 'ProviderPayloadTooLargeError'));
        if (!shouldRetry) {
          throw error;
        }

        const exponential = BaseProvider.DEFAULT_BACKOFF_BASE_MS * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 100);
        const delay = Math.min(BaseProvider.DEFAULT_BACKOFF_MAX_MS, exponential + jitter);
        const budget = currentVcsBudget()!;
        if (delay >= budget.deadline - Date.now()) {
          budget.cancel();
          throw new DOMException('Provider request deadline exhausted', 'AbortError');
        }
        await vcsRetryDelay(delay, budget.signal);
      }
    }

    // Unreachable, but TypeScript doesn't know that.
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error('Network error');
  }

  abstract getPullRequestForBranch(
    context: ProviderContext,
    branch: string,
    token?: string
  ): Promise<PullRequestContext>;

  abstract getChecksStatus(
    context: ProviderContext,
    branch: string,
    token?: string
  ): Promise<'pending' | 'success' | 'failure' | 'error'>;

  abstract getReviewState(
    context: ProviderContext,
    prNumber: number,
    token?: string
  ): Promise<'approved' | 'changes_requested' | 'commented' | 'pending' | undefined>;

  abstract getDefaultBranch(context: ProviderContext, token?: string): Promise<string>;

  abstract validateToken(token: string): Promise<boolean>;

  abstract getDeepLinks(
    context: ProviderContext,
    branch?: string,
    prNumber?: number
  ): DeepLink[];

  /**
   * Make an authenticated API request.
   */
  protected async fetchWithAuth<T>(
    endpoint: string,
    token: string
  ): Promise<{ success: true; data: T } | { success: false; error: string }> {
    try {
      const response = await this.fetchWithRetry(`${this.apiBaseUrl}${endpoint}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { success: false, error: 'Authentication failed. Check your token.' };
        }
        if (response.status === 404) {
          return { success: false, error: 'Resource not found.' };
        }
        return { success: false, error: `API error: ${response.status}` };
      }

      const data = await response.json() as T;
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error && error.name === 'AbortError'
        ? 'Request cancelled or timed out' : 'Provider request failed' };
    }
  }

  /**
   * Make an unauthenticated API request (for public repos).
   */
  protected async fetchPublic<T>(
    endpoint: string
  ): Promise<{ success: true; data: T } | { success: false; error: string }> {
    try {
      const response = await this.fetchWithRetry(`${this.apiBaseUrl}${endpoint}`, {
        headers: {
          Accept: 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        return { success: false, error: `API error: ${response.status}` };
      }

      const data = await response.json() as T;
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error && error.name === 'AbortError'
        ? 'Request cancelled or timed out' : 'Provider request failed' };
    }
  }
}
