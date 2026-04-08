/**
 * Context Service Tests - Real Behavior
 * Tests for VCS context orchestration logic.
 * 
 * Migration from heavy mocks to real behavior:
 * - providerDetector: Uses REAL functions (pure URL parsing)
 * - providerRegistry: Uses REAL provider instances
 * - credentialService: Minimal boundary mock (electron-store integration)
 * - Provider HTTP calls: Minimal fetch mock (legitimate boundary for external API)
 * 
 * This test focuses on the orchestration logic, testing that contextService
 * correctly combines git remote info with provider API data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getProviderContext, getProviderDeepLinks } from '../../../../src/main/vcs/contextService';
import { buildProviderContext } from '../../../../src/main/vcs/providerDetector';
import { getProviderInstance } from '../../../../src/main/vcs/providerRegistry';

import type { PullRequestContext, DeepLink } from '../../../../src/shared/types/vcs';

// ============================================================================
// Minimal Boundary Mocks
// ============================================================================

/**
 * Minimal mock for credentialService.getPat
 * JUSTIFICATION: This function interacts with electron-store which requires
 * the Electron runtime. We test that the orchestration correctly handles
 * both token-present and token-absent scenarios without needing real storage.
 */
const mockGetPat = vi.fn();
vi.mock('../../../../src/main/credential/credentialService', () => ({
  getPat: (...args: unknown[]) => mockGetPat(...args),
}));

/**
 * Minimal mock for global fetch
 * JUSTIFICATION: This is a legitimate boundary - we're testing the orchestration
 * logic, not the HTTP implementation. The providers handle HTTP; we just verify
 * that the orchestration passes correct parameters and handles responses.
 */
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ============================================================================
// Test Fixtures
// ============================================================================

// Note: We use vi.spyOn directly on real providers rather than creating test doubles.
// This keeps tests closer to real behavior while allowing us to control specific methods.

/**
 * Standard GitHub remote URLs for testing.
 */
const TEST_REMOTES = {
  github: {
    ssh: 'git@github.com:owner/repo.git',
    https: 'https://github.com/owner/repo.git',
  },
  gitlab: {
    ssh: 'git@gitlab.com:owner/repo.git',
    https: 'https://gitlab.com/owner/repo.git',
  },
  bitbucket: {
    ssh: 'git@bitbucket.org:owner/repo.git',
    https: 'https://bitbucket.org/owner/repo.git',
  },
  selfHosted: {
    ssh: 'git@gitlab.example.com:owner/repo.git',
    https: 'https://gitlab.example.com/owner/repo.git',
  },
};

// ============================================================================
// Tests
// ============================================================================

describe('contextService - Real Behavior Tests', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPat.mockReturnValue({ success: false });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // --------------------------------------------------------------------------
  // Provider Detection (using REAL buildProviderContext)
  // --------------------------------------------------------------------------

  describe('provider detection with real URL parsing', () => {
    it('should detect GitHub from SSH URL using real parsing', () => {
      const context = buildProviderContext('origin', TEST_REMOTES.github.ssh, 'main');
      expect(context).not.toBeNull();
      expect(context?.provider).toBe('github');
      expect(context?.owner).toBe('owner');
      expect(context?.repo).toBe('repo');
    });

    it('should detect GitHub from HTTPS URL using real parsing', () => {
      const context = buildProviderContext('origin', TEST_REMOTES.github.https, 'main');
      expect(context).not.toBeNull();
      expect(context?.provider).toBe('github');
    });

    it('should detect GitLab from SSH URL using real parsing', () => {
      const context = buildProviderContext('origin', TEST_REMOTES.gitlab.ssh, 'main');
      expect(context).not.toBeNull();
      expect(context?.provider).toBe('gitlab');
    });

    it('should detect Bitbucket from HTTPS URL using real parsing', () => {
      const context = buildProviderContext('origin', TEST_REMOTES.bitbucket.https, 'main');
      expect(context).not.toBeNull();
      expect(context?.provider).toBe('bitbucket');
    });

    it('should detect self-hosted GitLab using real parsing', () => {
      const context = buildProviderContext('origin', TEST_REMOTES.selfHosted.ssh, 'main');
      expect(context).not.toBeNull();
      expect(context?.provider).toBe('gitlab');
    });

    it('should return null for unrecognized providers using real parsing', () => {
      const context = buildProviderContext('origin', 'git@custom.example.com:owner/repo.git', 'main');
      expect(context).toBeNull();
    });

    it('should return null for invalid URLs using real parsing', () => {
      expect(buildProviderContext('origin', 'not-a-url', 'main')).toBeNull();
      expect(buildProviderContext('origin', '', 'main')).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Orchestration: getProviderContext
  // --------------------------------------------------------------------------

  describe('getProviderContext - unknown provider handling', () => {
    it('should return error when provider cannot be detected', async () => {
      const result = await getProviderContext('origin', 'git@unknown:owner/repo.git', 'main');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Could not detect provider from remote URL');
    });

    it('should return error for unrecognized provider hosts', async () => {
      // Use an unrecognized provider - buildProviderContext returns null
      const result = await getProviderContext('origin', 'git@custom.example.com:owner/repo.git', 'main');

      // Should fail because the provider is unknown
      expect(result.success).toBe(false);
      expect(result.error).toBe('Could not detect provider from remote URL');
    });
  });

  describe('getProviderContext - token handling', () => {
    it('should not include token when credential service returns failure', async () => {
      mockGetPat.mockReturnValue({ success: false });

      // Get real provider and spy on its methods
      const realProvider = getProviderInstance('github')!;
      const spy = vi.spyOn(realProvider, 'getPullRequestForBranch');

      await getProviderContext('origin', TEST_REMOTES.github.ssh, 'main');

      // Verify token was undefined
      expect(spy).toHaveBeenCalled();
      const [, , token] = spy.mock.calls[0];
      expect(token).toBeUndefined();
    });

    it('should include token when credential service returns success', async () => {
      mockGetPat.mockReturnValue({ success: true, token: 'ghp_test_token_123' });

      const realProvider = getProviderInstance('github')!;
      const spy = vi.spyOn(realProvider, 'getPullRequestForBranch');

      await getProviderContext('origin', TEST_REMOTES.github.ssh, 'main');

      const [, , token] = spy.mock.calls[0];
      expect(token).toBe('ghp_test_token_123');
    });
  });

  describe('getProviderContext - default branch resolution', () => {
    it('should resolve default branch from provider when not provided', async () => {
      mockGetPat.mockReturnValue({ success: false });

      const realProvider = getProviderInstance('github')!;
      const defaultBranchSpy = vi.spyOn(realProvider, 'getDefaultBranch').mockResolvedValue('develop');

      const result = await getProviderContext('origin', TEST_REMOTES.github.ssh, 'main');

      expect(defaultBranchSpy).toHaveBeenCalled();
      // The result should have the resolved default branch
      expect(result.provider?.defaultBranch).toBe('develop');
    });
  });

  describe('getProviderContext - PR detection', () => {
    it('should handle PR exists scenario', async () => {
      mockGetPat.mockReturnValue({ success: false });

      const mockPr: PullRequestContext = {
        exists: true,
        number: 42,
        title: 'Add feature',
        state: 'open',
        url: 'https://github.com/owner/repo/pull/42',
        author: 'developer',
      };

      const realProvider = getProviderInstance('github')!;
      vi.spyOn(realProvider, 'getPullRequestForBranch').mockResolvedValue(mockPr);
      vi.spyOn(realProvider, 'getChecksStatus').mockResolvedValue('success');
      vi.spyOn(realProvider, 'getReviewState').mockResolvedValue('approved');

      const result = await getProviderContext('origin', TEST_REMOTES.github.ssh, 'feature-branch');

      expect(result.success).toBe(true);
      expect(result.pullRequest?.exists).toBe(true);
      expect(result.pullRequest?.number).toBe(42);
      expect(result.pullRequest?.title).toBe('Add feature');
      expect(result.pullRequest?.checksStatus).toBe('success');
      expect(result.pullRequest?.reviewState).toBe('approved');
    });

    it('should not fetch checks when PR does not exist', async () => {
      mockGetPat.mockReturnValue({ success: false });

      const realProvider = getProviderInstance('github')!;
      const checksSpy = vi.spyOn(realProvider, 'getChecksStatus');

      await getProviderContext('origin', TEST_REMOTES.github.ssh, 'nonexistent-branch');

      expect(checksSpy).not.toHaveBeenCalled();
    });

    it('should not fetch review state when PR has no number', async () => {
      mockGetPat.mockReturnValue({ success: false });

      const mockPr: PullRequestContext = {
        exists: true,
        // number is undefined
        title: 'Draft',
        state: 'open',
      };

      const realProvider = getProviderInstance('github')!;
      vi.spyOn(realProvider, 'getPullRequestForBranch').mockResolvedValue(mockPr);
      const reviewSpy = vi.spyOn(realProvider, 'getReviewState');

      await getProviderContext('origin', TEST_REMOTES.github.ssh, 'draft-branch');

      expect(reviewSpy).not.toHaveBeenCalled();
    });
  });

  describe('getProviderContext - checks status', () => {
    it('should fetch checks status when PR exists', async () => {
      mockGetPat.mockReturnValue({ success: false });

      const mockPr: PullRequestContext = {
        exists: true,
        number: 42,
        title: 'Add feature',
        state: 'open',
      };

      const realProvider = getProviderInstance('github')!;
      vi.spyOn(realProvider, 'getPullRequestForBranch').mockResolvedValue(mockPr);
      vi.spyOn(realProvider, 'getChecksStatus').mockResolvedValue('success');

      const result = await getProviderContext('origin', TEST_REMOTES.github.ssh, 'feature-branch');

      expect(result.pullRequest?.checksStatus).toBe('success');
    });

    it('should default to error when checks fetch returns error', async () => {
      mockGetPat.mockReturnValue({ success: false });

      const mockPr: PullRequestContext = {
        exists: true,
        number: 42,
        title: 'Add feature',
        state: 'open',
      };

      const realProvider = getProviderInstance('github')!;
      vi.spyOn(realProvider, 'getPullRequestForBranch').mockResolvedValue(mockPr);
      vi.spyOn(realProvider, 'getChecksStatus').mockResolvedValue('error');

      const result = await getProviderContext('origin', TEST_REMOTES.github.ssh, 'feature-branch');

      expect(result.pullRequest?.checksStatus).toBe('error');
    });
  });

  describe('getProviderContext - review state', () => {
    it('should fetch review state when PR exists with number', async () => {
      mockGetPat.mockReturnValue({ success: false });

      const mockPr: PullRequestContext = {
        exists: true,
        number: 42,
        title: 'Add feature',
        state: 'open',
      };

      const realProvider = getProviderInstance('github')!;
      vi.spyOn(realProvider, 'getPullRequestForBranch').mockResolvedValue(mockPr);
      vi.spyOn(realProvider, 'getReviewState').mockResolvedValue('approved');

      const result = await getProviderContext('origin', TEST_REMOTES.github.ssh, 'feature-branch');

      expect(result.pullRequest?.reviewState).toBe('approved');
    });
  });

  describe('getProviderContext - deep links', () => {
    it('should generate deep links for current branch', async () => {
      mockGetPat.mockReturnValue({ success: false });

      const expectedLinks: DeepLink[] = [
        { type: 'repo', url: 'https://github.com/owner/repo', label: 'Repository' },
        { type: 'pr', url: 'https://github.com/owner/repo/pull/42', label: 'PR #42' },
        { type: 'create-pr', url: 'https://github.com/owner/repo/compare/main...feature', label: 'Create Pull Request' },
      ];

      const mockPr: PullRequestContext = {
        exists: true,
        number: 42,
        title: 'Add feature',
        state: 'open',
      };

      const realProvider = getProviderInstance('github')!;
      vi.spyOn(realProvider, 'getPullRequestForBranch').mockResolvedValue(mockPr);
      vi.spyOn(realProvider, 'getDeepLinks').mockReturnValue(expectedLinks);

      const result = await getProviderContext('origin', TEST_REMOTES.github.ssh, 'feature');

      expect(result.deepLinks).toEqual(expectedLinks);
    });

    it('should include PR number in deep links when available', async () => {
      mockGetPat.mockReturnValue({ success: false });

      const realProvider = getProviderInstance('github')!;
      const deepLinksSpy = vi.spyOn(realProvider, 'getDeepLinks').mockReturnValue([]);
      // Mock getPullRequestForBranch to return a PR with number 42
      vi.spyOn(realProvider, 'getPullRequestForBranch').mockResolvedValue({
        exists: true,
        number: 42,
        title: 'Add feature',
        state: 'open',
      });

      await getProviderContext('origin', TEST_REMOTES.github.ssh, 'feature');

      expect(deepLinksSpy).toHaveBeenCalledWith(
        expect.anything(),
        'feature',
        42
      );
    });
  });

  describe('getProviderContext - full context assembly', () => {
    it('should return complete context with all fields', async () => {
      mockGetPat.mockReturnValue({ success: true, token: 'ghp_test_token' });

      const mockPr: PullRequestContext = {
        exists: true,
        number: 42,
        title: 'Add feature',
        state: 'open',
        url: 'https://github.com/owner/repo/pull/42',
        author: 'developer',
      };

      const expectedLinks: DeepLink[] = [
        { type: 'repo', url: 'https://github.com/owner/repo', label: 'Repository' },
        { type: 'pr', url: 'https://github.com/owner/repo/pull/42', label: 'PR #42' },
      ];

      const realProvider = getProviderInstance('github')!;
      vi.spyOn(realProvider, 'getPullRequestForBranch').mockResolvedValue(mockPr);
      vi.spyOn(realProvider, 'getChecksStatus').mockResolvedValue('success');
      vi.spyOn(realProvider, 'getReviewState').mockResolvedValue('approved');
      vi.spyOn(realProvider, 'getDefaultBranch').mockResolvedValue('main');
      vi.spyOn(realProvider, 'getDeepLinks').mockReturnValue(expectedLinks);

      const result = await getProviderContext('origin', TEST_REMOTES.github.ssh, 'feature');

      expect(result).toEqual({
        success: true,
        provider: {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        },
        pullRequest: {
          exists: true,
          number: 42,
          title: 'Add feature',
          state: 'open',
          url: 'https://github.com/owner/repo/pull/42',
          author: 'developer',
          checksStatus: 'success',
          reviewState: 'approved',
        },
        deepLinks: expectedLinks,
      });
    });
  });

  describe('getProviderContext - error handling', () => {
    it('should handle provider lookup errors gracefully', async () => {
      const result = await getProviderContext('origin', 'invalid-url', 'main');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Could not detect provider from remote URL');
    });

    it('should handle credential service errors by continuing without token', async () => {
      mockGetPat.mockReturnValue({ success: false, error: 'Service error' });

      const realProvider = getProviderInstance('github')!;
      const prSpy = vi.spyOn(realProvider, 'getPullRequestForBranch');

      const result = await getProviderContext('origin', TEST_REMOTES.github.ssh, 'main');

      expect(result.success).toBe(true);
      // Token should be undefined since credential service returned failure
      const [, , token] = prSpy.mock.calls[0];
      expect(token).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Deep Links - Real Behavior Tests
  // --------------------------------------------------------------------------

  describe('deep links with real URL parsing', () => {
    it('should generate correct deep links for GitHub SSH URL', () => {
      const links = getProviderDeepLinks(TEST_REMOTES.github.ssh, 'feature-branch');
      
      expect(links.length).toBeGreaterThan(0);
      expect(links.map(l => l.type)).toContain('repo');
      expect(links.map(l => l.type)).toContain('create-pr');
      
      const repoLink = links.find(l => l.type === 'repo');
      expect(repoLink?.url).toBe('https://github.com/owner/repo');
    });

    it('should generate correct deep links for GitLab HTTPS URL', () => {
      const links = getProviderDeepLinks(TEST_REMOTES.gitlab.https, 'feature-branch');
      
      expect(links.length).toBeGreaterThan(0);
      expect(links.map(l => l.type)).toContain('repo');
    });

    it('should include PR number in deep links when provided', () => {
      const links = getProviderDeepLinks(TEST_REMOTES.github.ssh, 'feature-branch', 123);
      
      const prLink = links.find(l => l.type === 'pr');
      expect(prLink).toBeDefined();
      expect(prLink?.url).toContain('/pull/123');
      expect(prLink?.label).toBe('PR #123');
    });

    it('should use provided default branch for create PR links', () => {
      const links = getProviderDeepLinks(TEST_REMOTES.github.ssh, 'feature-branch', undefined, 'develop');
      
      const createLink = links.find(l => l.type === 'create-pr');
      expect(createLink?.url).toBe('https://github.com/owner/repo/compare/develop...feature-branch');
    });

    it('should return empty array for unknown provider', () => {
      const links = getProviderDeepLinks('git@custom.example.com:owner/repo.git');
      expect(links).toEqual([]);
    });

    it('should return empty array for empty URL', () => {
      const links = getProviderDeepLinks('');
      expect(links).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle repos with hyphens in owner/repo names', () => {
      const context = buildProviderContext('origin', 'git@github.com:my-org/my-repo.git', 'main');
      expect(context?.owner).toBe('my-org');
      expect(context?.repo).toBe('my-repo');
    });

    it('should handle repos with underscores in names', () => {
      const context = buildProviderContext('origin', 'git@github.com:my_org/my_repo.git', 'main');
      expect(context?.owner).toBe('my_org');
      expect(context?.repo).toBe('my_repo');
    });

    it('should strip .git extension from repo names', () => {
      const context = buildProviderContext('origin', 'git@github.com:owner/repo.git', 'main');
      expect(context?.repo).toBe('repo');
    });

    it('should handle HTTPS URLs without .git extension', () => {
      const context = buildProviderContext('origin', 'https://github.com/owner/repo', 'main');
      expect(context?.repo).toBe('repo');
    });

    it('should handle URLs with extra path segments (edge case)', () => {
      // Real-world: sometimes users add extra paths
      const context = buildProviderContext('origin', 'https://github.com/owner/repo/tree/main', 'main');
      // The URL parser only takes first two path segments
      expect(context?.owner).toBe('owner');
    });
  });
});
