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
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, {
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
      const message = error instanceof Error ? error.message : 'Network error';
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
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, {
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
      const message = error instanceof Error ? error.message : 'Network error';
      return { success: false, error: message };
    }
  }
}
