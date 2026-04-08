/**
 * Context Service Tests
 * Tests for VCS context orchestration logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getProviderContext } from '../../../../src/main/vcs/contextService';
import * as providerDetector from '../../../../src/main/vcs/providerDetector';
import * as providerRegistry from '../../../../src/main/vcs/providerRegistry';
import * as credentialService from '../../../../src/main/credential/credentialService';
import type { IVcsProvider } from '../../../../src/main/vcs/providers/baseProvider';
import type { ProviderContext, PullRequestContext, DeepLink } from '../../../../src/main/vcs/types';

// Mock the entire modules
vi.mock('../../../../src/main/vcs/providerDetector', () => ({
  buildProviderContext: vi.fn(),
  getProviderDeepLinks: vi.fn(),
  getDeepLinkUrl: vi.fn(),
}));

vi.mock('../../../../src/main/vcs/providerRegistry', () => ({
  getProviderInstance: vi.fn(),
}));

vi.mock('../../../../src/main/credential/credentialService', () => ({
  getPat: vi.fn(),
}));

describe('contextService', () => {
  // Create a fully typed mock provider
  let mockProvider: {
    type: 'github';
    apiBaseUrl: string;
    getPullRequestForBranch: ReturnType<typeof vi.fn>;
    getChecksStatus: ReturnType<typeof vi.fn>;
    getReviewState: ReturnType<typeof vi.fn>;
    getDefaultBranch: ReturnType<typeof vi.fn>;
    validateToken: ReturnType<typeof vi.fn>;
    getDeepLinks: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a mock provider
    mockProvider = {
      type: 'github',
      apiBaseUrl: 'https://api.github.com',
      getPullRequestForBranch: vi.fn().mockResolvedValue({
        exists: false,
      }),
      getChecksStatus: vi.fn().mockResolvedValue('pending'),
      getReviewState: vi.fn().mockResolvedValue(undefined),
      getDefaultBranch: vi.fn().mockResolvedValue('main'),
      validateToken: vi.fn().mockResolvedValue(true),
      getDeepLinks: vi.fn().mockReturnValue([
        { type: 'repo', url: 'https://github.com/owner/repo', label: 'Repository' },
        { type: 'branches', url: 'https://github.com/owner/repo/branches', label: 'Branches' },
      ]),
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getProviderContext', () => {
    describe('provider detection', () => {
      it('should return error when provider cannot be detected', async () => {
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(null);

        const result = await getProviderContext('origin', 'git@unknown:owner/repo.git', 'main');

        expect(result.success).toBe(false);
        expect(result.error).toBe('Could not detect provider from remote URL');
      });

      it('should build context from remote URL', async () => {
        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false });

        await getProviderContext('origin', 'git@github.com:owner/repo.git', 'main');

        expect(providerDetector.buildProviderContext).toHaveBeenCalledWith(
          'origin',
          'git@github.com:owner/repo.git',
          'main'
        );
      });
    });

    describe('unknown provider handling', () => {
      it('should return basic context when provider not implemented', async () => {
        const mockContext: ProviderContext = {
          provider: 'unknown',
          baseUrl: '',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(null);

        const result = await getProviderContext('origin', 'git@unknown:owner/repo.git', 'main');

        expect(result.success).toBe(true);
        expect(result.provider?.provider).toBe('unknown');
        expect(result.pullRequest?.exists).toBe(false);
        expect(result.deepLinks).toEqual([]);
      });
    });

    describe('token handling', () => {
      it('should retrieve token from credential service', async () => {
        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: true, token: 'ghp_test_token' });

        await getProviderContext('origin', 'git@github.com:owner/repo.git', 'main');

        expect(credentialService.getPat).toHaveBeenCalledWith('github');
      });

      it('should not pass token when not available', async () => {
        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false });

        await getProviderContext('origin', 'git@github.com:owner/repo.git', 'main');

        // Verify token was not passed
        expect(mockProvider.getPullRequestForBranch).toHaveBeenCalledWith(
          expect.anything(),
          'main',
          undefined
        );
      });
    });

    describe('default branch resolution', () => {
      it('should resolve default branch from provider', async () => {
        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false });

        await getProviderContext('origin', 'git@github.com:owner/repo.git', 'main');

        expect(mockProvider.getDefaultBranch).toHaveBeenCalled();
      });

      it('should update context with resolved default branch', async () => {
        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false });
        vi.mocked(mockProvider.getDefaultBranch!).mockResolvedValue('develop');

        const result = await getProviderContext('origin', 'git@github.com:owner/repo.git', 'main');

        expect(result.provider?.defaultBranch).toBe('develop');
      });
    });

    describe('PR detection', () => {
      it('should fetch PR for current branch', async () => {
        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false });

        await getProviderContext('origin', 'git@github.com:owner/repo.git', 'feature-branch');

        expect(mockProvider.getPullRequestForBranch).toHaveBeenCalledWith(
          expect.anything(),
          'feature-branch',
          undefined
        );
      });

      it('should return PR info when exists', async () => {
        const mockPr: PullRequestContext = {
          exists: true,
          number: 42,
          title: 'Add feature',
          state: 'open',
          url: 'https://github.com/owner/repo/pull/42',
        };
        vi.mocked(mockProvider.getPullRequestForBranch).mockResolvedValue(mockPr);

        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false });

        const result = await getProviderContext('origin', 'git@github.com:owner/repo.git', 'feature-branch');

        expect(result.pullRequest?.exists).toBe(true);
        expect(result.pullRequest?.number).toBe(42);
        expect(result.pullRequest?.title).toBe('Add feature');
      });

      it('should not fetch checks when no PR exists', async () => {
        vi.mocked(mockProvider.getPullRequestForBranch).mockResolvedValue({ exists: false });

        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false });

        await getProviderContext('origin', 'git@github.com:owner/repo.git', 'main');

        expect(mockProvider.getChecksStatus).not.toHaveBeenCalled();
        expect(mockProvider.getReviewState).not.toHaveBeenCalled();
      });
    });

    describe('checks status', () => {
      it('should fetch checks status when PR exists', async () => {
        const mockPr: PullRequestContext = {
          exists: true,
          number: 42,
          title: 'Add feature',
          state: 'open',
          url: 'https://github.com/owner/repo/pull/42',
        };
        vi.mocked(mockProvider.getPullRequestForBranch).mockResolvedValue(mockPr);
        vi.mocked(mockProvider.getChecksStatus).mockResolvedValue('success');

        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false });

        const result = await getProviderContext('origin', 'git@github.com:owner/repo.git', 'feature-branch');

        expect(mockProvider.getChecksStatus).toHaveBeenCalled();
        expect(result.pullRequest?.checksStatus).toBe('success');
      });

      it('should default to error when checks fetch returns error', async () => {
        const mockPr: PullRequestContext = {
          exists: true,
          number: 42,
          title: 'Add feature',
          state: 'open',
        };
        vi.mocked(mockProvider.getPullRequestForBranch).mockResolvedValue(mockPr);
        // getChecksStatus returns 'error' on failure, doesn't throw
        vi.mocked(mockProvider.getChecksStatus).mockResolvedValue('error');

        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false });

        const result = await getProviderContext('origin', 'git@github.com:owner/repo.git', 'feature-branch');

        expect(result.pullRequest?.checksStatus).toBe('error');
      });
    });

    describe('review state', () => {
      it('should fetch review state when PR exists with number', async () => {
        const mockPr: PullRequestContext = {
          exists: true,
          number: 42,
          title: 'Add feature',
          state: 'open',
        };
        vi.mocked(mockProvider.getPullRequestForBranch).mockResolvedValue(mockPr);
        vi.mocked(mockProvider.getReviewState).mockResolvedValue('approved');

        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false });

        const result = await getProviderContext('origin', 'git@github.com:owner/repo.git', 'feature-branch');

        expect(mockProvider.getReviewState).toHaveBeenCalledWith(
          expect.anything(),
          42,
          undefined
        );
        expect(result.pullRequest?.reviewState).toBe('approved');
      });

      it('should not fetch review when PR has no number', async () => {
        const mockPr: PullRequestContext = {
          exists: true,
          // number is undefined
          title: 'Draft',
          state: 'open',
        };
        vi.mocked(mockProvider.getPullRequestForBranch).mockResolvedValue(mockPr);

        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false });

        await getProviderContext('origin', 'git@github.com:owner/repo.git', 'feature-branch');

        expect(mockProvider.getReviewState).not.toHaveBeenCalled();
      });
    });

    describe('deep links generation', () => {
      it('should generate deep links for current branch', async () => {
        const expectedLinks: DeepLink[] = [
          { type: 'repo', url: 'https://github.com/owner/repo', label: 'Repository' },
          { type: 'pr', url: 'https://github.com/owner/repo/pull/42', label: 'PR #42' },
          { type: 'create-pr', url: 'https://github.com/owner/repo/compare/main...feature', label: 'Create Pull Request' },
        ];
        vi.mocked(mockProvider.getDeepLinks).mockReturnValue(expectedLinks);

        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false });

        const result = await getProviderContext('origin', 'git@github.com:owner/repo.git', 'feature');

        expect(mockProvider.getDeepLinks).toHaveBeenCalledWith(
          expect.anything(),
          'feature',
          undefined // PR number from this call
        );
        expect(result.deepLinks).toEqual(expectedLinks);
      });

      it('should include PR number in deep links when available', async () => {
        const mockPr: PullRequestContext = {
          exists: true,
          number: 42,
          title: 'Add feature',
          state: 'open',
        };
        vi.mocked(mockProvider.getPullRequestForBranch).mockResolvedValue(mockPr);

        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false });

        await getProviderContext('origin', 'git@github.com:owner/repo.git', 'feature');

        expect(mockProvider.getDeepLinks).toHaveBeenCalledWith(
          expect.anything(),
          'feature',
          42 // Should include PR number
        );
      });
    });

    describe('full context assembly', () => {
      it('should return complete context with all fields', async () => {
        const mockPr: PullRequestContext = {
          exists: true,
          number: 42,
          title: 'Add feature',
          state: 'open',
          url: 'https://github.com/owner/repo/pull/42',
          author: 'developer',
        };
        vi.mocked(mockProvider.getPullRequestForBranch).mockResolvedValue(mockPr);
        vi.mocked(mockProvider.getChecksStatus).mockResolvedValue('success');
        vi.mocked(mockProvider.getReviewState).mockResolvedValue('approved');
        vi.mocked(mockProvider.getDefaultBranch).mockResolvedValue('main');
        vi.mocked(mockProvider.getDeepLinks).mockReturnValue([
          { type: 'repo', url: 'https://github.com/owner/repo', label: 'Repository' },
          { type: 'pr', url: 'https://github.com/owner/repo/pull/42', label: 'PR #42' },
        ]);

        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);
        vi.mocked(credentialService.getPat).mockReturnValue({
          success: true,
          token: 'ghp_test_token',
        });

        const result = await getProviderContext('origin', 'git@github.com:owner/repo.git', 'feature');

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
          deepLinks: [
            { type: 'repo', url: 'https://github.com/owner/repo', label: 'Repository' },
            { type: 'pr', url: 'https://github.com/owner/repo/pull/42', label: 'PR #42' },
          ],
        });
      });
    });

    describe('error handling', () => {
      it('should handle provider lookup errors gracefully', async () => {
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(null);

        const result = await getProviderContext('origin', 'invalid-url', 'main');

        expect(result.success).toBe(false);
        expect(result.error).toBe('Could not detect provider from remote URL');
      });

      it('should handle credential service errors by continuing without token', async () => {
        // getProviderToken returns undefined on error, so credential service errors
        // result in no token being used
        vi.mocked(credentialService.getPat).mockReturnValue({ success: false, error: 'Service error' });

        const mockContext: ProviderContext = {
          provider: 'github',
          baseUrl: 'https://github.com',
          owner: 'owner',
          repo: 'repo',
          defaultBranch: 'main',
        };
        vi.mocked(providerDetector.buildProviderContext).mockReturnValue(mockContext);
        vi.mocked(providerRegistry.getProviderInstance).mockReturnValue(mockProvider as IVcsProvider);

        const result = await getProviderContext('origin', 'git@github.com:owner/repo.git', 'main');

        expect(result.success).toBe(true);
        // Token should be undefined since credential service returned failure
        expect(mockProvider.getPullRequestForBranch).toHaveBeenCalledWith(
          expect.anything(),
          'main',
          undefined
        );
      });
    });
  });
});
