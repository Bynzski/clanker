/**
 * GitHub Provider
 * GitHub REST API client for VCS context.
 */

import { BaseProvider } from './baseProvider';
import type {
  ProviderContext,
  PullRequestContext,
  DeepLink,
} from '../types';
import { getWebBaseUrl } from '../providerDetector';

interface GitHubRepo {
  default_branch: string;
}

interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: { login: string };
  merged_at: string | null;
}

interface GitHubCommitStatus {
  state: 'pending' | 'success' | 'failure' | 'error';
  statuses: Array<{
    state: string;
    context: string;
  }>;
}

interface GitHubReview {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';
  user: { login: string };
}

/**
 * GitHub API provider implementation.
 */
export class GitHubProvider extends BaseProvider {
  readonly type = 'github' as const;
  readonly apiBaseUrl = 'https://api.github.com';

  /**
   * Get PR information for a branch.
   * Uses the pulls endpoint with head filter to find PR by branch name.
   */
  async getPullRequestForBranch(
    context: ProviderContext,
    branch: string,
    token?: string
  ): Promise<PullRequestContext> {
    // GitHub uses 'owner:branch' format for head filter
    const headFilter = `${context.owner}:${branch}`;
    const endpoint = `/repos/${context.owner}/${context.repo}/pulls?head=${encodeURIComponent(headFilter)}&state=all`;

    let result;
    if (token) {
      result = await this.fetchWithAuth<GitHubPullRequest[]>(endpoint, token);
    } else {
      result = await this.fetchPublic<GitHubPullRequest[]>(endpoint);
    }

    if (!result.success) {
      // Return empty context on error - not critical
      return { exists: false };
    }

    const prs = result.data;
    if (!prs || prs.length === 0) {
      return { exists: false };
    }

    // Take the most recent PR (first in list is most recent)
    const pr = prs[0];

    // Determine merged state
    let state: 'open' | 'closed' | 'merged';
    if (pr.merged_at) {
      state = 'merged';
    } else if (pr.state === 'closed') {
      state = 'closed';
    } else {
      state = 'open';
    }

    return {
      exists: true,
      number: pr.number,
      title: pr.title,
      state,
      url: pr.html_url,
      author: pr.user.login,
    };
  }

  /**
   * Get combined status for the latest commit on a branch.
   */
  async getChecksStatus(
    context: ProviderContext,
    branch: string,
    token?: string
  ): Promise<'pending' | 'success' | 'failure' | 'error'> {
    // First get the commit SHA for the branch
    const refEndpoint = `/repos/${context.owner}/${context.repo}/git/refs/heads/${encodeURIComponent(branch)}`;

    let refResult;
    if (token) {
      refResult = await this.fetchWithAuth<{ object: { sha: string } }>(refEndpoint, token);
    } else {
      refResult = await this.fetchPublic<{ object: { sha: string } }>(refEndpoint);
    }

    if (!refResult.success) {
      return 'error';
    }

    const sha = refResult.data.object.sha;
    const statusEndpoint = `/repos/${context.owner}/${context.repo}/commits/${sha}/status`;

    let statusResult;
    if (token) {
      statusResult = await this.fetchWithAuth<GitHubCommitStatus>(statusEndpoint, token);
    } else {
      statusResult = await this.fetchPublic<GitHubCommitStatus>(statusEndpoint);
    }

    if (!statusResult.success) {
      return 'error';
    }

    const status = statusResult.data;
    switch (status.state) {
      case 'success':
        return 'success';
      case 'failure':
        return 'failure';
      case 'pending':
        return 'pending';
      default:
        return 'error';
    }
  }

  /**
   * Get review state for a PR.
   */
  async getReviewState(
    context: ProviderContext,
    prNumber: number,
    token?: string
  ): Promise<'approved' | 'changes_requested' | 'commented' | 'pending' | undefined> {
    const endpoint = `/repos/${context.owner}/${context.repo}/pulls/${prNumber}/reviews`;

    let result;
    if (token) {
      result = await this.fetchWithAuth<GitHubReview[]>(endpoint, token);
    } else {
      // Reviews may require auth for private repos
      result = await this.fetchPublic<GitHubReview[]>(endpoint);
    }

    if (!result.success) {
      return undefined;
    }

    const reviews = result.data;
    if (!reviews || reviews.length === 0) {
      return 'pending';
    }

    // Find the latest review from each user, then aggregate
    const latestByUser = new Map<string, GitHubReview>();
    for (const review of reviews) {
      if (review.state === 'DISMISSED') continue;
      const existing = latestByUser.get(review.user.login);
      if (!existing) {
        latestByUser.set(review.user.login, review);
      }
    }

    // Check for approvals and changes requested
    const states = Array.from(latestByUser.values()).map((r) => r.state);

    if (states.includes('APPROVED')) {
      return 'approved';
    }
    if (states.includes('CHANGES_REQUESTED')) {
      return 'changes_requested';
    }
    if (states.includes('COMMENTED')) {
      return 'commented';
    }

    return 'pending';
  }

  /**
   * Validate a GitHub token has required scopes.
   */
  async validateToken(token: string): Promise<boolean> {
    const result = await this.fetchWithAuth<{ login: string; scope: string }>('/user', token);
    if (!result.success) {
      return false;
    }
    // Check for repo scope or other appropriate scope
    return true;
  }

  async getDefaultBranch(context: ProviderContext, token?: string): Promise<string> {
    const endpoint = `/repos/${context.owner}/${context.repo}`;
    let result;
    if (token) {
      result = await this.fetchWithAuth<GitHubRepo>(endpoint, token);
    } else {
      result = await this.fetchPublic<GitHubRepo>(endpoint);
    }

    if (!result.success) {
      return context.defaultBranch || 'main';
    }
    return result.data.default_branch;
  }

  /**
   * Get available deep links for GitHub.
   */
  getDeepLinks(
    context: ProviderContext,
    branch?: string,
    prNumber?: number
  ): DeepLink[] {
    const baseUrl = getWebBaseUrl('github');
    const path = `/${context.owner}/${context.repo}`;

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
        url: `${baseUrl}${path}/releases`,
        label: 'Releases',
      },
      {
        type: 'actions',
        url: `${baseUrl}${path}/actions`,
        label: 'Actions',
      },
    ];

    if (prNumber) {
      links.unshift({
        type: 'pr',
        url: `${baseUrl}${path}/pull/${prNumber}`,
        label: `PR #${prNumber}`,
      });
    }

    if (branch) {
      links.push({
        type: 'create-pr',
        url: `${baseUrl}${path}/compare/${encodeURIComponent(context.defaultBranch || 'main')}...${encodeURIComponent(branch)}`,
        label: 'Create Pull Request',
      });
    }

    return links;
  }
}
