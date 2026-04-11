/**
 * Base VCS Provider Interface
 * Abstract interface for VCS provider implementations.
 */

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

/**
 * Abstract base class with common functionality.
 */
export abstract class BaseProvider implements IVcsProvider {
  abstract readonly type: VcsProvider;
  abstract readonly apiBaseUrl: string;

  private static readonly DEFAULT_TIMEOUT_MS = 12_000;
  private static readonly DEFAULT_MAX_RETRIES = 2;
  private static readonly DEFAULT_BACKOFF_BASE_MS = 250;
  private static readonly DEFAULT_BACKOFF_MAX_MS = 2_000;

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    options?: { timeoutMs?: number; maxRetries?: number }
  ): Promise<Response> {
    const timeoutMs = options?.timeoutMs ?? BaseProvider.DEFAULT_TIMEOUT_MS;
    const maxRetries = options?.maxRetries ?? BaseProvider.DEFAULT_MAX_RETRIES;

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.fetchWithTimeout(url, init, timeoutMs);
      } catch (error: unknown) {
        lastError = error;
        const shouldRetry = attempt < maxRetries;
        if (!shouldRetry) {
          throw error;
        }

        const exponential = BaseProvider.DEFAULT_BACKOFF_BASE_MS * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 100);
        const delay = Math.min(BaseProvider.DEFAULT_BACKOFF_MAX_MS, exponential + jitter);
        await new Promise((resolve) => setTimeout(resolve, delay));
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
      const message = error instanceof Error
        ? (error.name === 'AbortError' ? 'Request timed out' : error.message)
        : 'Network error';
      return { success: false, error: message };
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
      const message = error instanceof Error
        ? (error.name === 'AbortError' ? 'Request timed out' : error.message)
        : 'Network error';
      return { success: false, error: message };
    }
  }
}
