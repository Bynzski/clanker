/**
 * GitLab Provider
 * GitLab REST API client for VCS context.
 */

import { BaseProvider } from './baseProvider';
import type {
  ProviderContext,
  PullRequestContext,
  DeepLink,
} from '../types';

/**
 * GitLab merge request response type.
 */
interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  merged_at: string | null;
  web_url: string;
  author: {
    username: string;
  };
  source_branch: string;
  target_branch: string;
}

/**
 * GitLab pipeline status response type.
 */
interface GitLabPipeline {
  id: number;
  status: 'pending' | 'running' | 'success' | 'failed' | 'canceled' | 'skipped' | 'manual';
}

/**
 * GitLab user info response type.
 */
interface GitLabUser {
  id: number;
  username: string;
  state: string;
}

interface GitLabProject {
  default_branch: string;
}

/**
 * GitLab API provider implementation.
 */
export class GitLabProvider extends BaseProvider {
  readonly type = 'gitlab' as const;
  readonly apiBaseUrl = 'https://gitlab.com/api/v4';

  /**
   * Get the API base URL for a GitLab instance.
   * GitLab may be self-hosted with a custom URL.
   */
  private getApiBaseUrl(context: ProviderContext): string {
    // If context has a custom baseUrl, construct API URL from it
    if (context.baseUrl && context.baseUrl !== 'https://gitlab.com') {
      // Remove trailing slash and construct API URL
      const base = context.baseUrl.replace(/\/$/, '');
      return `${base}/api/v4`;
    }
    return this.apiBaseUrl;
  }

  /**
   * Get project identifier for GitLab API.
   * Can be ID, path with namespace, or URL-encoded path.
   */
  private getProjectId(context: ProviderContext): string {
    return encodeURIComponent(`${context.owner}/${context.repo}`);
  }

  /**
   * Make an authenticated API request to GitLab.
   */
  protected async fetchWithAuth<T>(
    endpoint: string,
    token: string,
    context?: ProviderContext
  ): Promise<{ success: true; data: T } | { success: false; error: string }> {
    const baseUrl = context ? this.getApiBaseUrl(context) : this.apiBaseUrl;

    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: {
          'PRIVATE-TOKEN': token,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { success: false, error: 'Authentication failed. Check your token.' };
        }
        if (response.status === 404) {
          return { success: false, error: 'Resource not found.' };
        }
        return { success: false, error: `GitLab API error: ${response.status}` };
      }

      // Handle empty responses
      const text = await response.text();
      if (!text) {
        return { success: true, data: null as unknown as T };
      }

      const data = JSON.parse(text) as T;
      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error';
      return { success: false, error: message };
    }
  }

  /**
   * Make an unauthenticated API request (for public projects).
   */
  protected async fetchPublic<T>(
    endpoint: string,
    context?: ProviderContext
  ): Promise<{ success: true; data: T } | { success: false; error: string }> {
    const baseUrl = context ? this.getApiBaseUrl(context) : this.apiBaseUrl;

    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { success: false, error: 'Resource not found.' };
        }
        return { success: false, error: `GitLab API error: ${response.status}` };
      }

      const text = await response.text();
      if (!text) {
        return { success: true, data: null as unknown as T };
      }

      const data = JSON.parse(text) as T;
      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error';
      return { success: false, error: message };
    }
  }

  /**
   * Get MR (Merge Request) information for a branch.
   * Uses the merge_requests endpoint with source_branch filter.
   */
  async getPullRequestForBranch(
    context: ProviderContext,
    branch: string,
    token?: string
  ): Promise<PullRequestContext> {
    const projectId = this.getProjectId(context);
    const endpoint = `/projects/${projectId}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=opened&per_page=1`;

    let result;
    if (token) {
      result = await this.fetchWithAuth<GitLabMergeRequest[]>(endpoint, token, context);
    } else {
      result = await this.fetchPublic<GitLabMergeRequest[]>(endpoint, context);
    }

    if (!result.success) {
      // Return empty context on error - not critical
      return { exists: false };
    }

    const mrs = result.data;
    if (!mrs || mrs.length === 0) {
      // Also check closed/merged MRs for context
      return this.getMergedOrClosedMr(context, branch, token);
    }

    // Take the most recent MR (first in list is most recent)
    const mr = mrs[0];

    return {
      exists: true,
      number: mr.iid,
      title: mr.title,
      state: mr.state === 'opened' ? 'open' : mr.state === 'merged' ? 'merged' : 'closed',
      url: mr.web_url,
      author: mr.author.username,
    };
  }

  /**
   * Check for merged or closed MRs for the branch.
   */
  private async getMergedOrClosedMr(
    context: ProviderContext,
    branch: string,
    token?: string
  ): Promise<PullRequestContext> {
    const projectId = this.getProjectId(context);
    const endpoint = `/projects/${projectId}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=all&per_page=1`;

    let result;
    if (token) {
      result = await this.fetchWithAuth<GitLabMergeRequest[]>(endpoint, token, context);
    } else {
      result = await this.fetchPublic<GitLabMergeRequest[]>(endpoint, context);
    }

    if (!result.success || !result.data || result.data.length === 0) {
      return { exists: false };
    }

    const mr = result.data[0];

    return {
      exists: true,
      number: mr.iid,
      title: mr.title,
      state: mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'closed',
      url: mr.web_url,
      author: mr.author.username,
    };
  }

  /**
   * Get pipeline (CI) status for the latest pipeline on the branch.
   */
  async getChecksStatus(
    context: ProviderContext,
    branch: string,
    token?: string
  ): Promise<'pending' | 'success' | 'failure' | 'error'> {
    const projectId = this.getProjectId(context);

    // Get latest pipeline for the branch
    const pipelineEndpoint = `/projects/${projectId}/pipelines?ref=${encodeURIComponent(branch)}&per_page=1`;

    let pipelineResult;
    if (token) {
      pipelineResult = await this.fetchWithAuth<GitLabPipeline[]>(pipelineEndpoint, token, context);
    } else {
      pipelineResult = await this.fetchPublic<GitLabPipeline[]>(pipelineEndpoint, context);
    }

    if (!pipelineResult.success || !pipelineResult.data || pipelineResult.data.length === 0) {
      return 'error';
    }

    const pipeline = pipelineResult.data[0];

    switch (pipeline.status) {
      case 'success':
        return 'success';
      case 'failed':
        return 'failure';
      case 'pending':
      case 'running':
      case 'manual':
        return 'pending';
      case 'canceled':
      case 'skipped':
        return 'error';
      default:
        return 'error';
    }
  }

  /**
   * Get review/approval state for an MR.
   * GitLab has a separate approvals API.
   */
  async getReviewState(
    context: ProviderContext,
    mrIid: number,
    token?: string
  ): Promise<'approved' | 'changes_requested' | 'commented' | 'pending' | undefined> {
    const projectId = this.getProjectId(context);
    const endpoint = `/projects/${projectId}/merge_requests/${mrIid}/approvals`;

    type GitLabApprovalResponse = {
      approved: boolean;
      approvals_required: number;
      approvals_left: number;
    };

    let result;
    if (token) {
      result = await this.fetchWithAuth<GitLabApprovalResponse>(endpoint, token, context);
    } else {
      result = await this.fetchPublic<GitLabApprovalResponse>(endpoint, context);
    }

    if (!result.success) {
      return undefined;
    }

    const approvals = result.data;

    // If approved and no approvals left, it's approved
    if (approvals.approved && approvals.approvals_left === 0) {
      return 'approved';
    }

    // If approvals required > 0 and approvals left > 0, pending
    if (approvals.approvals_required > 0 && approvals.approvals_left > 0) {
      return 'pending';
    }

    return undefined;
  }

  async getDefaultBranch(context: ProviderContext, token?: string): Promise<string> {
    const projectId = this.getProjectId(context);
    const endpoint = `/projects/${projectId}`;
    let result;
    if (token) {
      result = await this.fetchWithAuth<GitLabProject>(endpoint, token, context);
    } else {
      result = await this.fetchPublic<GitLabProject>(endpoint, context);
    }

    if (!result.success || !result.data) {
      return context.defaultBranch || 'main';
    }

    return result.data.default_branch;
  }

  /**
   * Validate a GitLab token has required scopes.
   * GitLab uses personal access tokens with scopes.
   */
  async validateToken(token: string): Promise<boolean> {
    // Try to get current user info
    const result = await this.fetchWithAuth<GitLabUser>('/user', token);
    return result.success;
  }

  /**
   * Get available deep links for GitLab.
   */
  getDeepLinks(
    context: ProviderContext,
    branch?: string,
    mrNumber?: number
  ): DeepLink[] {
    const baseUrl = context.baseUrl || 'https://gitlab.com';
    const path = `/${context.owner}/${context.repo}`;

    const links: DeepLink[] = [
      {
        type: 'repo',
        url: `${baseUrl}${path}`,
        label: 'Repository',
      },
      {
        type: 'branches',
        url: `${baseUrl}${path}/-/branches`,
        label: 'Branches',
      },
      {
        type: 'issues',
        url: `${baseUrl}${path}/-/issues`,
        label: 'Issues',
      },
      {
        type: 'releases',
        url: `${baseUrl}${path}/-/releases`,
        label: 'Releases',
      },
      {
        type: 'actions',
        url: `${baseUrl}${path}/-/pipelines`,
        label: 'Pipelines',
      },
    ];

    if (mrNumber) {
      links.unshift({
        type: 'pr',
        url: `${baseUrl}${path}/-/merge_requests/${mrNumber}`,
        label: `MR !${mrNumber}`,
      });
    }

    if (branch) {
      links.push({
        type: 'create-pr',
        url: `${baseUrl}${path}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(branch)}&merge_request[target_branch]=${encodeURIComponent(
          context.defaultBranch || 'main'
        )}`,
        label: 'Create Merge Request',
      });
    }

    return links;
  }
}
