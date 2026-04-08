/**
 * Bitbucket Provider Tests
 * Tests for Bitbucket API client functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BitbucketProvider } from '../../../../src/main/vcs/providers/bitbucketProvider';
import type { ProviderContext } from '../../../../src/main/vcs/types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('BitbucketProvider', () => {
  let provider: BitbucketProvider;
  let context: ProviderContext;

  beforeEach(() => {
    provider = new BitbucketProvider();
    context = {
      provider: 'bitbucket',
      baseUrl: 'https://bitbucket.org',
      owner: 'workspace',
      repo: 'repo',
      defaultBranch: 'main',
    };
    mockFetch.mockReset();
  });

  describe('type', () => {
    it('should have correct type', () => {
      expect(provider.type).toBe('bitbucket');
    });
  });

  describe('apiBaseUrl', () => {
    it('should have correct API base URL', () => {
      expect(provider.apiBaseUrl).toBe('https://api.bitbucket.org/2.0');
    });
  });

  describe('getPullRequestForBranch', () => {
    it('should return PR context when PR exists', async () => {
      const mockPr = {
        id: 123,
        title: 'Add new feature',
        state: 'OPEN',
        source: { branch: { name: 'feature-branch' } },
        destination: { branch: { name: 'main' } },
        author: {
          account_id: 'abc123',
          nickname: 'developer',
          display_name: 'Developer Name',
        },
        links: {
          html: { href: 'https://bitbucket.org/workspace/repo/pull-requests/123' },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ values: [mockPr] }),
      });

      const result = await provider.getPullRequestForBranch(context, 'feature-branch');

      expect(result.exists).toBe(true);
      expect(result.number).toBe(123);
      expect(result.title).toBe('Add new feature');
      expect(result.state).toBe('open');
      expect(result.url).toBe('https://bitbucket.org/workspace/repo/pull-requests/123');
    });

    it('should return exists:false when no PR exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ values: [] }),
      }).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ values: [] }),
      });

      const result = await provider.getPullRequestForBranch(context, 'nonexistent-branch');

      expect(result.exists).toBe(false);
    });

    it('should handle merged PRs', async () => {
      const mockPr = {
        id: 123,
        title: 'Merged PR',
        state: 'MERGED',
        source: { branch: { name: 'merged-branch' } },
        destination: { branch: { name: 'main' } },
        author: {
          account_id: 'abc123',
          nickname: 'developer',
          display_name: 'Developer Name',
        },
        links: {
          html: { href: 'https://bitbucket.org/workspace/repo/pull-requests/123' },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ values: [] }),
      }).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ values: [mockPr] }),
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
    it('should return pending for Bitbucket (simplified check)', async () => {
      // Bitbucket doesn't easily expose commit SHA without additional API calls
      const mockPr = {
        id: 123,
        title: 'Test PR',
        state: 'OPEN',
        source: { branch: { name: 'feature-branch' } },
        destination: { branch: { name: 'main' } },
        author: {
          account_id: 'abc123',
          nickname: 'developer',
          display_name: 'Developer Name',
        },
        links: {
          html: { href: 'https://bitbucket.org/workspace/repo/pull-requests/123' },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ values: [mockPr] }),
      });

      const result = await provider.getChecksStatus(context, 'feature-branch');

      // Simplified: returns pending when PR exists
      expect(result).toBe('pending');
    });

    it('should return error when no PR exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ values: [] }),
      });

      const result = await provider.getChecksStatus(context, 'feature-branch');

      expect(result).toBe('error');
    });
  });

  describe('getReviewState', () => {
    it('should return approved when reviewers approved', async () => {
      const mockParticipants = {
        values: [
          {
            user: { account_id: 'author', nickname: 'author', display_name: 'Author', type: 'user' },
            role: 'AUTHOR',
            approved: false,
            state: 'pending',
          },
          {
            user: { account_id: 'reviewer1', nickname: 'reviewer1', display_name: 'Reviewer 1', type: 'user' },
            role: 'REVIEWER',
            approved: true,
            state: 'approved',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockParticipants,
      });

      const result = await provider.getReviewState(context, 123);

      expect(result).toBe('approved');
    });

    it('should return changes_requested when reviewer requested changes', async () => {
      const mockParticipants = {
        values: [
          {
            user: { account_id: 'author', nickname: 'author', display_name: 'Author', type: 'user' },
            role: 'AUTHOR',
            approved: false,
            state: 'pending',
          },
          {
            user: { account_id: 'reviewer1', nickname: 'reviewer1', display_name: 'Reviewer 1', type: 'user' },
            role: 'REVIEWER',
            approved: false,
            state: 'changes_requested',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockParticipants,
      });

      const result = await provider.getReviewState(context, 123);

      expect(result).toBe('changes_requested');
    });

    it('should return pending when no reviewers', async () => {
      const mockParticipants = {
        values: [
          {
            user: { account_id: 'author', nickname: 'author', display_name: 'Author', type: 'user' },
            role: 'AUTHOR',
            approved: false,
            state: 'pending',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockParticipants,
      });

      const result = await provider.getReviewState(context, 123);

      expect(result).toBe('pending');
    });

    it('should return undefined on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await provider.getReviewState(context, 123);

      expect(result).toBeUndefined();
    });
  });

  describe('validateToken', () => {
    it('should return true for valid token', async () => {
      const mockUser = {
        account_id: 'abc123',
        nickname: 'testuser',
        display_name: 'Test User',
        type: 'user',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockUser,
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
    it('should return deep links for Bitbucket', () => {
      const links = provider.getDeepLinks(context);

      expect(links.length).toBeGreaterThan(0);
      expect(links.map((l) => l.type)).toContain('repo');
      expect(links.map((l) => l.type)).toContain('branches');
      expect(links.map((l) => l.type)).toContain('issues');
    });

    it('should include PR link when prNumber provided', () => {
      const links = provider.getDeepLinks(context, 'feature-branch', 123);

      const prLink = links.find((l) => l.type === 'pr');
      expect(prLink).toBeDefined();
      expect(prLink?.url).toContain('/pull-requests/123');
    });

    it('should include create PR link when branch provided', () => {
      const links = provider.getDeepLinks(context, 'feature-branch');

      const createLink = links.find((l) => l.type === 'create-pr');
      expect(createLink).toBeDefined();
      expect(createLink?.url).toContain('feature-branch');
    });

    it('should use workspace/repo format for Bitbucket', () => {
      const links = provider.getDeepLinks(context);
      const repoLink = links.find((l) => l.type === 'repo');

      expect(repoLink?.url).toContain('/workspace/repo');
    });
  });
});
