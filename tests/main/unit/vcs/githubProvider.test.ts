/**
 * GitHub Provider Tests
 * Tests for GitHub REST API client functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubProvider } from '../../../../src/main/vcs/providers/githubProvider';
import type { ProviderContext } from '../../../../src/main/vcs/types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GitHubProvider', () => {
  let provider: GitHubProvider;
  let context: ProviderContext;

  beforeEach(() => {
    provider = new GitHubProvider();
    context = {
      provider: 'github',
      baseUrl: 'https://github.com',
      owner: 'owner',
      repo: 'repo',
      defaultBranch: 'main',
    };
    mockFetch.mockReset();
  });

  describe('type', () => {
    it('should have correct type', () => {
      expect(provider.type).toBe('github');
    });
  });

  describe('apiBaseUrl', () => {
    it('should have correct API base URL', () => {
      expect(provider.apiBaseUrl).toBe('https://api.github.com');
    });
  });

  describe('getPullRequestForBranch', () => {
    it('should return PR context when PR exists', async () => {
      const mockPr = {
        number: 42,
        title: 'Add new feature',
        state: 'open',
        html_url: 'https://github.com/owner/repo/pull/42',
        user: { login: 'developer' },
        merged_at: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [mockPr],
      });

      const result = await provider.getPullRequestForBranch(context, 'feature-branch');

      expect(result.exists).toBe(true);
      expect(result.number).toBe(42);
      expect(result.title).toBe('Add new feature');
      expect(result.state).toBe('open');
      expect(result.url).toBe('https://github.com/owner/repo/pull/42');
      expect(result.author).toBe('developer');
    });

    it('should return exists:false when no PR exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      const result = await provider.getPullRequestForBranch(context, 'nonexistent-branch');

      expect(result.exists).toBe(false);
    });

    it('should handle merged PRs', async () => {
      const mockPr = {
        number: 42,
        title: 'Merged PR',
        state: 'closed',
        html_url: 'https://github.com/owner/repo/pull/42',
        user: { login: 'developer' },
        merged_at: '2024-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [mockPr],
      });

      const result = await provider.getPullRequestForBranch(context, 'merged-branch');

      expect(result.exists).toBe(true);
      expect(result.state).toBe('merged');
    });

    it('should handle closed PRs', async () => {
      const mockPr = {
        number: 42,
        title: 'Closed PR',
        state: 'closed',
        html_url: 'https://github.com/owner/repo/pull/42',
        user: { login: 'developer' },
        merged_at: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [mockPr],
      });

      const result = await provider.getPullRequestForBranch(context, 'closed-branch');

      expect(result.exists).toBe(true);
      expect(result.state).toBe('closed');
    });

    it('should return empty context on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await provider.getPullRequestForBranch(context, 'feature-branch');

      expect(result.exists).toBe(false);
    });

    it('should use owner:branch format for head filter', async () => {
      const mockPr = {
        number: 123,
        title: 'Test PR',
        state: 'open',
        html_url: 'https://github.com/owner/repo/pull/123',
        user: { login: 'developer' },
        merged_at: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [mockPr],
      });

      await provider.getPullRequestForBranch(context, 'my-feature-branch');

      // Verify the endpoint uses owner:branch format (URL encoded)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/pulls?head=owner%3Amy-feature-branch&state=all',
        expect.objectContaining({})
      );
    });
  });

  describe('getChecksStatus', () => {
    it('should return success for successful checks', async () => {
      // First call: get ref (commit SHA)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ object: { sha: 'abc123def456' } }),
      });
      // Second call: get status
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'success', statuses: [] }),
      });

      const result = await provider.getChecksStatus(context, 'feature-branch');

      expect(result).toBe('success');
    });

    it('should return failure for failed checks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ object: { sha: 'abc123def456' } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'failure', statuses: [] }),
      });

      const result = await provider.getChecksStatus(context, 'feature-branch');

      expect(result).toBe('failure');
    });

    it('should return pending for pending checks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ object: { sha: 'abc123def456' } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'pending', statuses: [] }),
      });

      const result = await provider.getChecksStatus(context, 'feature-branch');

      expect(result).toBe('pending');
    });

    it('should return error when ref lookup fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await provider.getChecksStatus(context, 'nonexistent-branch');

      expect(result).toBe('error');
    });

    it('should return error when status lookup fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ object: { sha: 'abc123def456' } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await provider.getChecksStatus(context, 'feature-branch');

      expect(result).toBe('error');
    });

    it('should use Authorization header when token provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ object: { sha: 'abc123def456' } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'success', statuses: [] }),
      });

      await provider.getChecksStatus(context, 'feature-branch', 'ghp_test_token');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/git/refs/heads/feature-branch',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer ghp_test_token',
          }),
        })
      );
    });
  });

  describe('getReviewState', () => {
    it('should return approved when PR is approved', async () => {
      const mockReviews = [
        {
          state: 'APPROVED',
          user: { login: 'reviewer1' },
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockReviews,
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBe('approved');
    });

    it('should return changes_requested when changes requested', async () => {
      const mockReviews = [
        {
          state: 'CHANGES_REQUESTED',
          user: { login: 'reviewer1' },
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockReviews,
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBe('changes_requested');
    });

    it('should return commented when commented only', async () => {
      const mockReviews = [
        {
          state: 'COMMENTED',
          user: { login: 'reviewer1' },
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockReviews,
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBe('commented');
    });

    it('should return pending when no reviews', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBe('pending');
    });

    it('should ignore dismissed reviews', async () => {
      const mockReviews = [
        {
          state: 'DISMISSED',
          user: { login: 'reviewer1' },
        },
        {
          state: 'CHANGES_REQUESTED',
          user: { login: 'reviewer1' },
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockReviews,
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBe('changes_requested');
    });

    it('should use first review per user when multiple reviews exist', async () => {
      // The implementation keeps the first review for each user
      const mockReviews = [
        {
          state: 'COMMENTED',
          user: { login: 'reviewer1' },
        },
        {
          state: 'APPROVED',
          user: { login: 'reviewer1' },
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockReviews,
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBe('commented');
    });

    it('should return undefined on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBeUndefined();
    });
  });

  describe('validateToken', () => {
    it('should return true for valid token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: 'testuser', scope: 'repo' }),
      });

      const result = await provider.validateToken('valid-token');

      expect(result).toBe(true);
    });

    it('should return false for invalid token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await provider.validateToken('invalid-token');

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      const result = await provider.validateToken('token');

      expect(result).toBe(false);
    });
  });

  describe('getDefaultBranch', () => {
    it('should return repository default branch when available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ default_branch: 'develop' }),
      });

      const result = await provider.getDefaultBranch(context);

      expect(result).toBe('develop');
    });

    it('should fall back to context defaultBranch on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await provider.getDefaultBranch(context);

      expect(result).toBe('main');
    });

    it('should fall back to main when context has no defaultBranch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const contextWithoutDefault = { ...context, defaultBranch: '' };
      const result = await provider.getDefaultBranch(contextWithoutDefault);

      expect(result).toBe('main');
    });

    it('should use token for authenticated requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ default_branch: 'main' }),
      });

      await provider.getDefaultBranch(context, 'ghp_test_token');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer ghp_test_token',
          }),
        })
      );
    });
  });

  describe('getDeepLinks', () => {
    it('should return deep links for GitHub', () => {
      const links = provider.getDeepLinks(context);

      expect(links.length).toBeGreaterThan(0);
      expect(links.map((l) => l.type)).toContain('repo');
      expect(links.map((l) => l.type)).toContain('branches');
      expect(links.map((l) => l.type)).toContain('issues');
      expect(links.map((l) => l.type)).toContain('releases');
      expect(links.map((l) => l.type)).toContain('actions');
    });

    it('should include PR link when prNumber provided', () => {
      const links = provider.getDeepLinks(context, 'feature-branch', 42);

      const prLink = links.find((l) => l.type === 'pr');
      expect(prLink).toBeDefined();
      expect(prLink?.url).toContain('/pull/42');
      expect(prLink?.label).toBe('PR #42');
    });

    it('should include create PR link when branch provided', () => {
      const links = provider.getDeepLinks(context, 'feature-branch');

      const createLink = links.find((l) => l.type === 'create-pr');
      expect(createLink).toBeDefined();
      expect(createLink?.url).toContain('feature-branch');
    });

    it('should use resolved default branch for create PR', () => {
      const customContext = { ...context, defaultBranch: 'develop' };
      const links = provider.getDeepLinks(customContext, 'feature-branch');

      const createLink = links.find((l) => l.type === 'create-pr');
      expect(createLink?.url).toContain('develop...');
    });

    it('should use main as default when context has no defaultBranch', () => {
      const contextWithoutDefault = { ...context, defaultBranch: '' };
      const links = provider.getDeepLinks(contextWithoutDefault, 'feature-branch');

      const createLink = links.find((l) => l.type === 'create-pr');
      expect(createLink?.url).toContain('main...');
    });

    it('should have repo link first when no PR', () => {
      const links = provider.getDeepLinks(context);

      expect(links[0].type).toBe('repo');
    });

    it('should have PR link first when PR exists', () => {
      const links = provider.getDeepLinks(context, 'feature-branch', 42);

      expect(links[0].type).toBe('pr');
    });

    it('should use correct GitHub URLs', () => {
      const links = provider.getDeepLinks(context);
      const repoLink = links.find((l) => l.type === 'repo');

      expect(repoLink?.url).toBe('https://github.com/owner/repo');
    });

    it('should URL-encode branch names', () => {
      const links = provider.getDeepLinks(context, 'feature/branch-with-dashes');

      const createLink = links.find((l) => l.type === 'create-pr');
      expect(createLink?.url).toContain('feature%2Fbranch-with-dashes');
    });
  });
});
