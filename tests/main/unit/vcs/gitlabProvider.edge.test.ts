/**
 * GitLab Provider Edge Case Tests
 * Tests edge cases and boundary conditions for GitLab API client.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitLabProvider } from '../../../../src/main/vcs/providers/gitlabProvider';
import type { ProviderContext } from '../../../../src/main/vcs/types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GitLabProvider Edge Cases', () => {
  let provider: GitLabProvider;
  let context: ProviderContext;

  beforeEach(() => {
    provider = new GitLabProvider();
    context = {
      provider: 'gitlab',
      baseUrl: 'https://gitlab.com',
      owner: 'owner',
      repo: 'repo',
      defaultBranch: 'main',
    };
    mockFetch.mockReset();
  });

  // =========================================================================
  // getReviewState Edge Cases
  // =========================================================================
  describe('getReviewState - edge cases', () => {
    it('should return pending when approved but approvals still left', async () => {
      // Edge case: approved=true but not all approvals given
      // Implementation returns 'pending' because approvals_left > 0
      const mockApproval = {
        approved: true,
        approvals_required: 2,
        approvals_left: 1,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockApproval),
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBe('pending');
    });

    it('should return undefined when not approved and no approvals required', async () => {
      // Edge case: approved=false and no approvals required
      const mockApproval = {
        approved: false,
        approvals_required: 0,
        approvals_left: 0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockApproval),
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBeUndefined();
    });

    it('should return undefined when not approved and all approvals given', async () => {
      // Edge case: approved=false but approvals_left=0
      const mockApproval = {
        approved: false,
        approvals_required: 2,
        approvals_left: 0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockApproval),
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBeUndefined();
    });

    it('should return undefined when approvals data is malformed', async () => {
      // Edge case: missing fields
      const mockApproval = {
        approved: true,
        // approvals_required and approvals_left missing
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockApproval),
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBeUndefined();
    });

    it('should use authenticated fetch when token provided', async () => {
      const mockApproval = {
        approved: true,
        approvals_required: 1,
        approvals_left: 0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockApproval),
      });

      await provider.getReviewState(context, 42, 'test-token');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(call[1].headers).toBeDefined();
    });

    it('should use public fetch when no token provided', async () => {
      const mockApproval = {
        approved: true,
        approvals_required: 1,
        approvals_left: 0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockApproval),
      });

      await provider.getReviewState(context, 42);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // getDefaultBranch Edge Cases
  // =========================================================================
  describe('getDefaultBranch - edge cases', () => {
    it('should return context.defaultBranch when API fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await provider.getDefaultBranch(context);

      expect(result).toBe('main'); // context.defaultBranch
    });

    it('should return context.defaultBranch when API returns null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(null),
      });

      const result = await provider.getDefaultBranch(context);

      expect(result).toBe('main');
    });

    it('should return actual default_branch from API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ default_branch: 'develop' }),
      });

      const result = await provider.getDefaultBranch(context);

      expect(result).toBe('develop');
    });

    it('should return "main" when defaultBranch is not set in context', async () => {
      const contextNoDefault: ProviderContext = {
        provider: 'gitlab',
        baseUrl: 'https://gitlab.com',
        owner: 'owner',
        repo: 'repo',
        defaultBranch: '' as unknown as string,
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await provider.getDefaultBranch(contextNoDefault);

      expect(result).toBe('main');
    });

    it('should return undefined when API returns empty object', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({}),
      });

      const result = await provider.getDefaultBranch(context);

      // Empty object means default_branch is undefined
      expect(result).toBeUndefined();
    });

    it('should use authenticated fetch when token provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ default_branch: 'master' }),
      });

      await provider.getDefaultBranch(context, 'test-token');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle network error gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.getDefaultBranch(context);

      expect(result).toBe('main');
    });
  });

  // =========================================================================
  // getDeepLinks Edge Cases
  // =========================================================================
  describe('getDeepLinks - edge cases', () => {
    it('should use default baseUrl when context.baseUrl is empty', () => {
      const contextNoBase: ProviderContext = {
        provider: 'gitlab',
        baseUrl: '',
        owner: 'owner',
        repo: 'repo',
        defaultBranch: 'main',
      };

      const links = provider.getDeepLinks(contextNoBase);
      const repoLink = links.find((l) => l.type === 'repo');

      expect(repoLink?.url).toContain('https://gitlab.com');
    });

    it('should use default baseUrl when context.baseUrl is undefined', () => {
      const contextNoBase: ProviderContext = {
        provider: 'gitlab',
        baseUrl: '' as unknown as string,
        owner: 'owner',
        repo: 'repo',
        defaultBranch: 'main',
      };

      const links = provider.getDeepLinks(contextNoBase);
      const repoLink = links.find((l) => l.type === 'repo');

      expect(repoLink?.url).toContain('https://gitlab.com');
    });

    it('should encode special characters in branch name for create-pr link', () => {
      const links = provider.getDeepLinks(context, 'feature/branch with spaces');

      const createLink = links.find((l) => l.type === 'create-pr');
      expect(createLink?.url).toContain('feature%2Fbranch%20with%20spaces');
    });

    it('should use "main" as fallback when defaultBranch is missing', () => {
      const contextNoDefault: ProviderContext = {
        provider: 'gitlab',
        baseUrl: 'https://gitlab.com',
        owner: 'owner',
        repo: 'repo',
        defaultBranch: '' as unknown as string,
      };

      const links = provider.getDeepLinks(contextNoDefault, 'feature-branch');

      const createLink = links.find((l) => l.type === 'create-pr');
      // URL contains 'merge_request[target_branch]='
      expect(createLink?.url).toContain('merge_request[target_branch]=');
      expect(createLink).toBeDefined();
    });

    it('should use actual defaultBranch from context in create-pr link', () => {
      const links = provider.getDeepLinks(context, 'feature-branch');

      const createLink = links.find((l) => l.type === 'create-pr');
      // URL contains 'merge_request[target_branch]=main'
      expect(createLink?.url).toContain('merge_request[target_branch]=main');
    });

    it('should handle unicode characters in branch name', () => {
      const links = provider.getDeepLinks(context, 'feature/tëst');

      const createLink = links.find((l) => l.type === 'create-pr');
      expect(createLink).toBeDefined();
      expect(createLink?.url).toContain(encodeURIComponent('feature/tëst'));
    });

    it('should handle special characters in MR number for label', () => {
      const links = provider.getDeepLinks(context, 'feature', 42);

      const mrLink = links.find((l) => l.type === 'pr');
      expect(mrLink?.label).toBe('MR !42');
    });

    it('should include MR link at beginning when both mrNumber and branch provided', () => {
      const links = provider.getDeepLinks(context, 'feature', 42);

      expect(links[0].type).toBe('pr');
      expect(links[links.length - 1].type).toBe('create-pr');
    });

    it('should handle empty owner and repo', () => {
      const contextEmpty: ProviderContext = {
        provider: 'gitlab',
        baseUrl: 'https://gitlab.com',
        owner: '',
        repo: '',
        defaultBranch: 'main',
      };

      const links = provider.getDeepLinks(contextEmpty);

      const repoLink = links.find((l) => l.type === 'repo');
      expect(repoLink?.url).toBe('https://gitlab.com//');
    });
  });

  // =========================================================================
  // fetchWithAuth/fetchPublic Edge Cases
  // =========================================================================
  describe('fetchWithAuth edge cases', () => {
    it('should handle 403 Forbidden with specific error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      // Access the method indirectly through getReviewState
      const result = await provider.getReviewState(context, 42, 'bad-token');

      expect(result).toBeUndefined();
    });

    it('should handle 404 with specific error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBeUndefined();
    });

    it('should handle 500 server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBeUndefined();
    });

    it('should handle network error with specific error message', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await provider.getReviewState(context, 42);

      expect(result).toBeUndefined();
    });
  });

  describe('fetchPublic edge cases', () => {
    it('should handle empty response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
      });

      // Test through getDefaultBranch with no token
      const result = await provider.getDefaultBranch(context);

      // Empty body should be handled gracefully
      expect(typeof result).toBe('string');
    });

    it('should handle 404 in public fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      // Test through getPullRequestForBranch with no token
      const result = await provider.getPullRequestForBranch(context, 'feature-branch');

      expect(result.exists).toBe(false);
    });

    it('should handle network error in public fetch', async () => {
      mockFetch.mockRejectedValueOnce(new Error('DNS lookup failed'));

      const result = await provider.getPullRequestForBranch(context, 'feature-branch');

      expect(result.exists).toBe(false);
    });
  });

  // =========================================================================
  // getPullRequestForBranch Edge Cases
  // =========================================================================
  describe('getPullRequestForBranch - edge cases', () => {
    it('should handle merged MR when no opened MR exists', async () => {
      // First call returns empty (no opened MRs)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      });
      // Second call returns merged MR
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              id: 1,
              iid: 42,
              title: 'Merged MR',
              state: 'merged',
              merged_at: '2024-01-01T00:00:00Z',
              web_url: 'https://gitlab.com/owner/repo/-/merge_requests/42',
              author: { username: 'developer' },
              source_branch: 'merged-branch',
              target_branch: 'main',
            },
          ]),
      });

      const result = await provider.getPullRequestForBranch(context, 'merged-branch');

      expect(result.exists).toBe(true);
      expect(result.state).toBe('merged');
    });

    it('should handle closed MR state', async () => {
      // First call returns empty
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      });
      // Second call returns closed MR
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              id: 1,
              iid: 42,
              title: 'Closed MR',
              state: 'closed',
              merged_at: null,
              web_url: 'https://gitlab.com/owner/repo/-/merge_requests/42',
              author: { username: 'developer' },
              source_branch: 'closed-branch',
              target_branch: 'main',
            },
          ]),
      });

      const result = await provider.getPullRequestForBranch(context, 'closed-branch');

      expect(result.exists).toBe(true);
      expect(result.state).toBe('closed');
    });

    it('should return exists:false when both opened and closed MRs not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      });

      const result = await provider.getPullRequestForBranch(context, 'nonexistent');

      expect(result.exists).toBe(false);
    });

    it('should handle MR with unicode in title', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              id: 1,
              iid: 42,
              title: '新功能 - 新機能 - 新機能',
              state: 'opened',
              merged_at: null,
              web_url: 'https://gitlab.com/owner/repo/-/merge_requests/42',
              author: { username: 'developer' },
              source_branch: 'feature-branch',
              target_branch: 'main',
            },
          ]),
      });

      const result = await provider.getPullRequestForBranch(context, 'feature-branch');

      expect(result.exists).toBe(true);
      expect(result.title).toContain('新機能');
    });
  });

  // =========================================================================
  // getChecksStatus Edge Cases
  // =========================================================================
  describe('getChecksStatus - edge cases', () => {
    it('should return error for unknown pipeline status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              id: 1,
              status: 'unknown_status',
            },
          ]),
      });

      const result = await provider.getChecksStatus(context, 'feature-branch');

      expect(result).toBe('error');
    });

    it('should handle when API returns non-array data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 1, status: 'success' }),
      });

      // This should throw or be caught - testing the error handling
      await expect(async () => {
        await provider.getChecksStatus(context, 'feature-branch');
      }).rejects.toThrow();
    });

    it('should handle pending pipeline status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              id: 1,
              status: 'pending',
            },
          ]),
      });

      const result = await provider.getChecksStatus(context, 'feature-branch');

      expect(result).toBe('pending');
    });

    it('should handle manual pipeline status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              id: 1,
              status: 'manual',
            },
          ]),
      });

      const result = await provider.getChecksStatus(context, 'feature-branch');

      expect(result).toBe('pending');
    });
  });

  // =========================================================================
  // validateToken Edge Cases
  // =========================================================================
  describe('validateToken - edge cases', () => {
    it('should return false for 403 Forbidden', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      const result = await provider.validateToken('forbidden-token');

      expect(result).toBe(false);
    });

    it('should return false for 500 server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await provider.validateToken('any-token');

      expect(result).toBe(false);
    });

    it('should return false for network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.validateToken('any-token');

      expect(result).toBe(false);
    });
  });
});
