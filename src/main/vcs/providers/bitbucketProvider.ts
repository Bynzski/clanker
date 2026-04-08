/**
 * Bitbucket Provider
 * Bitbucket REST API client for VCS context.
 * Bitbucket uses a different API structure with workspace/repository mapping.
 */

import { BaseProvider } from './baseProvider';
import type {
  ProviderContext,
  PullRequestContext,
  DeepLink,
} from '../types';

/**
 * Bitbucket pull request response type.
 */
interface BitbucketPullRequest {
  id: number;
  title: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  source: {
    branch: {
      name: string;
    };
  };
  destination: {
    branch: {
      name: string;
    };
  };
  author: {
    account_id: string;
    nickname: string;
    display_name: string;
  };
  links: {
    html: {
      href: string;
    };
  };
}



/**
 * Bitbucket user response type.
 */
interface BitbucketUser {
  account_id: string;
  nickname: string;
  display_name: string;
  type: 'user';
}

/**
 * Bitbucket API provider implementation.
 */
export class BitbucketProvider extends BaseProvider {
  readonly type = 'bitbucket' as const;
  readonly apiBaseUrl = 'https://api.bitbucket.org/2.0';

  /**
   * Get the workspace from the context.
   * Bitbucket uses workspace (slug) instead of owner.
   */
  private getWorkspace(context: ProviderContext): string {
    return context.owner;
  }

  /**
   * Get the repo slug from context.
   */
  private getRepoSlug(context: ProviderContext): string {
    return context.repo;
  }

  /**
   * Make an authenticated API request to Bitbucket.
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
        },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { success: false, error: 'Authentication failed. Check your token.' };
        }
        if (response.status === 404) {
          return { success: false, error: 'Resource not found.' };
        }
        return { success: false, error: `Bitbucket API error: ${response.status}` };
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
        },
      });

      if (!response.ok) {
        return { success: false, error: `Bitbucket API error: ${response.status}` };
      }

      const data = await response.json() as T;
      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error';
      return { success: false, error: message };
    }
  }

  /**
   * Get PR (Pull Request) information for a branch.
   * Bitbucket uses different endpoint structure.
   */
  async getPullRequestForBranch(
    context: ProviderContext,
    branch: string,
    token?: string
  ): Promise<PullRequestContext> {
    const workspace = this.getWorkspace(context);
    const repoSlug = this.getRepoSlug(context);

    // Bitbucket API: GET /repositories/{workspace}/{repo_slug}/pullrequests
    // Filter by source branch
    const endpoint = `/repositories/${workspace}/${repoSlug}/pullrequests?state=OPEN&source.branch.name=${encodeURIComponent(branch)}`;

    let result;
    if (token) {
      result = await this.fetchWithAuth<{ values: BitbucketPullRequest[] }>(endpoint, token);
    } else {
      result = await this.fetchPublic<{ values: BitbucketPullRequest[] }>(endpoint);
    }

    if (!result.success) {
      return { exists: false };
    }

    const prs = result.data.values;
    if (!prs || prs.length === 0) {
      // Also check closed/merged PRs
      return this.getClosedOrMergedPr(context, branch, token);
    }

    const pr = prs[0];

    return {
      exists: true,
      number: pr.id,
      title: pr.title,
      state: this.mapPrState(pr.state),
      url: pr.links.html.href,
      author: pr.author.nickname || pr.author.display_name,
    };
  }

  /**
   * Check for closed or merged PRs.
   */
  private async getClosedOrMergedPr(
    context: ProviderContext,
    branch: string,
    token?: string
  ): Promise<PullRequestContext> {
    const workspace = this.getWorkspace(context);
    const repoSlug = this.getRepoSlug(context);

    const endpoint = `/repositories/${workspace}/${repoSlug}/pullrequests?state=MERGED&source.branch.name=${encodeURIComponent(branch)}`;

    let result;
    if (token) {
      result = await this.fetchWithAuth<{ values: BitbucketPullRequest[] }>(endpoint, token);
    } else {
      result = await this.fetchPublic<{ values: BitbucketPullRequest[] }>(endpoint);
    }

    if (!result.success || !result.data.values || result.data.values.length === 0) {
      return { exists: false };
    }

    const pr = result.data.values[0];

    return {
      exists: true,
      number: pr.id,
      title: pr.title,
      state: 'merged',
      url: pr.links.html.href,
      author: pr.author.nickname || pr.author.display_name,
    };
  }

  /**
   * Map Bitbucket state to our normalized state.
   */
  private mapPrState(state: BitbucketPullRequest['state']): 'open' | 'closed' | 'merged' {
    switch (state) {
      case 'OPEN':
        return 'open';
      case 'MERGED':
        return 'merged';
      case 'DECLINED':
      case 'SUPERSEDED':
        return 'closed';
      default:
        return 'closed';
    }
  }

  /**
   * Get build status for the latest commit on a branch.
   * Bitbucket has a different approach to CI status.
   */
  async getChecksStatus(
    context: ProviderContext,
    branch: string,
    token?: string
  ): Promise<'pending' | 'success' | 'failure' | 'error'> {
    // Bitbucket's commit status API requires knowing the specific commit SHA,
    // which requires additional API calls to resolve branch head.
    // We need to:
    // 1. Get the latest PR for this branch
    // 2. From the PR, we can determine the source branch
    // For now, we do a simplified check that verifies the PR exists.
    // A full implementation would get the commit SHA and query /commit/{sha}/statuses

    const workspace = this.getWorkspace(context);
    const repoSlug = this.getRepoSlug(context);

    // Get the latest PR to verify the branch has a PR
    const prEndpoint = `/repositories/${workspace}/${repoSlug}/pullrequests?state=OPEN&source.branch.name=${encodeURIComponent(branch)}`;

    let prResult;
    if (token) {
      prResult = await this.fetchWithAuth<{ values: BitbucketPullRequest[] }>(prEndpoint, token);
    } else {
      prResult = await this.fetchPublic<{ values: BitbucketPullRequest[] }>(prEndpoint);
    }

    if (!prResult.success || !prResult.data.values || prResult.data.values.length === 0) {
      return 'error';
    }

    // PR exists, but we can't easily determine CI status without commit SHA
    // Return pending as a reasonable default
    return 'pending';
  }

  /**
   * Get review state for a PR.
   * Bitbucket's review model is different from GitHub/GitLab.
   */
  async getReviewState(
    context: ProviderContext,
    prId: number,
    token?: string
  ): Promise<'approved' | 'changes_requested' | 'commented' | 'pending' | undefined> {
    const workspace = this.getWorkspace(context);
    const repoSlug = this.getRepoSlug(context);

    // Get participants in the PR
    const endpoint = `/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/participants`;

    type Participant = {
      user: BitbucketUser;
      role: 'REVIEWER' | 'PARTICIPANT' | 'AUTHOR';
      approved: boolean;
      state: 'approved' | 'changes_requested' | 'pending' | 'COMMENTED' | 'unhaassigned';
    };

    let result;
    if (token) {
      result = await this.fetchWithAuth<{ values: Participant[] }>(endpoint, token);
    } else {
      result = await this.fetchPublic<{ values: Participant[] }>(endpoint);
    }

    if (!result.success) {
      return undefined;
    }

    const participants = result.data.values;
    if (!participants || participants.length === 0) {
      return 'pending';
    }

    // Look for reviewers (not the author)
    const reviewers = participants.filter((p: Participant) => p.role !== 'AUTHOR');

    if (reviewers.length === 0) {
      return 'pending';
    }

    // Check for approvals
    const approvedReviewers = reviewers.filter((r: Participant) => r.approved);
    const changesRequestedReviewers = reviewers.filter((r: Participant) => r.state === 'changes_requested');

    if (approvedReviewers.length > 0 && changesRequestedReviewers.length === 0) {
      return 'approved';
    }

    if (changesRequestedReviewers.length > 0) {
      return 'changes_requested';
    }

    return 'pending';
  }

  /**
   * Validate a Bitbucket token has required scopes.
   */
  async validateToken(token: string): Promise<boolean> {
    const result = await this.fetchWithAuth<BitbucketUser>('/user', token);
    return result.success;
  }

  /**
   * Get available deep links for Bitbucket.
   */
  getDeepLinks(
    context: ProviderContext,
    branch?: string,
    prNumber?: number
  ): DeepLink[] {
    const baseUrl = 'https://bitbucket.org';
    const workspace = this.getWorkspace(context);
    const repoSlug = this.getRepoSlug(context);
    const path = `/${workspace}/${repoSlug}`;

    const links: DeepLink[] = [
      {
        type: 'repo',
        url: `${baseUrl}${path}`,
        label: 'Repository',
      },
      {
        type: 'branches',
        url: `${baseUrl}${path}/branches`,
        label: 'Branches',
      },
      {
        type: 'issues',
        url: `${baseUrl}${path}/issues`,
        label: 'Issues',
      },
      {
        type: 'releases',
        url: `${baseUrl}${path}/downloads`,
        label: 'Downloads',
      },
      {
        type: 'actions',
        url: `${baseUrl}${path}/pipelines`,
        label: 'Pipelines',
      },
    ];

    if (prNumber) {
      links.unshift({
        type: 'pr',
        url: `${baseUrl}${path}/pull-requests/${prNumber}`,
        label: `PR #${prNumber}`,
      });
    }

    if (branch) {
      links.push({
        type: 'create-pr',
        url: `${baseUrl}${path}/pull-requests/new?source_branch=${encodeURIComponent(branch)}`,
        label: 'Create Pull Request',
      });
    }

    return links;
  }
}
