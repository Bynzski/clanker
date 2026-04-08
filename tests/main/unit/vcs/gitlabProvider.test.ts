/**
 * GitLab Provider Tests
 * Tests for GitLab API client functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabProvider } from '../../../../src/main/vcs/providers/gitlabProvider';
import type { ProviderContext } from '../../../../src/main/vcs/types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GitLabProvider', () => {
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

  describe('type', () => {
    it('should have correct type', () => {
      expect(provider.type).toBe('gitlab');
    });
  });

  describe('apiBaseUrl', () => {
    it('should have correct API base URL', () => {
      expect(provider.apiBaseUrl).toBe('https://gitlab.com/api/v4');
    });
  });

  describe('getPullRequestForBranch', () => {
    it('should return PR context when MR exists', async () => {
      const mockMr = {
        id: 1,
        iid: 42,
        title: 'Add new feature',
        state: 'opened',
        merged_at: null,
        web_url: 'https://gitlab.com/owner/repo/-/merge_requests/42',
        author: { username: 'developer' },
        source_branch: 'feature-branch',
        target_branch: 'main',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([mockMr]),
      });

      const result = await provider.getPullRequestForBranch(context, 'feature-branch');

      expect(result.exists).toBe(true);
      expect(result.number).toBe(42);
      expect(result.title).toBe('Add new feature');
      expect(result.state).toBe('open');
      expect(result.url).toBe('https://gitlab.com/owner/repo/-/merge_requests/42');
      expect(result.author).toBe('developer');
    });

    it('should return exists:false when no MR exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      });

      const result = await provider.getPullRequestForBranch(context, 'nonexistent-branch');

      expect(result.exists).toBe(false);
    });

    it('should handle merged MRs', async () => {
      const mockMr = {
        id: 1,
        iid: 42,
        title: 'Merged MR',
        state: 'merged',
        merged_at: '2024-01-01T00:00:00Z',
        web_url: 'https://gitlab.com/owner/repo/-/merge_requests/42',
        author: { username: 'developer' },
        source_branch: 'merged-branch',
        target_branch: 'main',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      }).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([mockMr]),
      });

      const result = await provider.getPullRequestForBranch(context, 'merged-branch');

      expect(result.exists).toBe(true);
      expect(result.state).toBe('merged');
    });

    it('should return empty context on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await provider.getPullRequestForBranch(context, 'feature-branch');

      expect(result.exists).toBe(false);
    });
  });

  describe('getChecksStatus', () => {
    it('should return success for successful pipeline', async () => {
      const mockPipeline = {
        id: 1,
        status: 'success',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([mockPipeline]),
      });

      const result = await provider.getChecksStatus(context, 'feature-branch');

      expect(result).toBe('success');
    });

    it('should return failure for failed pipeline', async () => {
      const mockPipeline = {
        id: 1,
        status: 'failed',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([mockPipeline]),
      });

      const result = await provider.getChecksStatus(context, 'feature-branch');

      expect(result).toBe('failure');
    });

    it('should return pending for running pipeline', async () => {
      const mockPipeline = {
        id: 1,
        status: 'running',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([mockPipeline]),
      });

      const result = await provider.getChecksStatus(context, 'feature-branch');

      expect(result).toBe('pending');
    });

    it('should return error when no pipelines exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      });

      const result = await provider.getChecksStatus(context, 'feature-branch');

      expect(result).toBe('error');
    });
  });

  describe('getReviewState', () => {
    it('should return approved when approved', async () => {
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

      const result = await provider.getReviewState(context, 42);

      expect(result).toBe('approved');
    });

    it('should return pending when approvals required but not given', async () => {
      const mockApproval = {
        approved: false,
        approvals_required: 2,
        approvals_left: 2,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockApproval),
      });

      const result = await provider.getReviewState(context, 42);

      expect(result).toBe('pending');
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
      const mockUser = {
        id: 1,
        username: 'testuser',
        state: 'active',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockUser),
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
  });

  describe('getDeepLinks', () => {
    it('should return deep links for GitLab', () => {
      const links = provider.getDeepLinks(context);

      expect(links.length).toBeGreaterThan(0);
      expect(links.map((l) => l.type)).toContain('repo');
      expect(links.map((l) => l.type)).toContain('branches');
      expect(links.map((l) => l.type)).toContain('issues');
    });

    it('should include MR link when prNumber provided', () => {
      const links = provider.getDeepLinks(context, 'feature-branch', 42);

      const mrLink = links.find((l) => l.type === 'pr');
      expect(mrLink).toBeDefined();
      expect(mrLink?.url).toContain('/merge_requests/42');
    });

    it('should include create MR link when branch provided', () => {
      const links = provider.getDeepLinks(context, 'feature-branch');

      const createLink = links.find((l) => l.type === 'create-pr');
      expect(createLink).toBeDefined();
      expect(createLink?.url).toContain('feature-branch');
    });
  });

  describe('custom baseUrl', () => {
    it('should use custom baseUrl for self-hosted GitLab', () => {
      const customContext: ProviderContext = {
        provider: 'gitlab',
        baseUrl: 'https://gitlab.internal.company.com',
        owner: 'owner',
        repo: 'repo',
        defaultBranch: 'main',
      };

      const links = provider.getDeepLinks(customContext);
      const repoLink = links.find((l) => l.type === 'repo');

      expect(repoLink?.url).toContain('gitlab.internal.company.com');
    });
  });
});
