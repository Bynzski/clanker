// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useVcsStore } from '../../../../src/renderer/store/vcsStore';
import ProviderMenu from '../../../../src/renderer/components/git/ProviderMenu';
import type { DeepLink, ProviderContext } from '../../../../src/renderer/store/vcsStore';

// Mock lucide icons
vi.mock('lucide-react', () => ({
  ExternalLink: ({ size, className }: { size: number; className?: string }) => (
    <span data-testid="external-link" data-size={size} className={className}>ExternalLink</span>
  ),
  GitBranch: ({ size, className }: { size: number; className?: string }) => (
    <span data-testid="git-branch" data-size={size} className={className}>GitBranch</span>
  ),
  GitPullRequest: ({ size, className }: { size: number; className?: string }) => (
    <span data-testid="git-pull-request" data-size={size} className={className}>GitPullRequest</span>
  ),
  AlertCircle: ({ size, className }: { size: number; className?: string }) => (
    <span data-testid="alert-circle" data-size={size} className={className}>AlertCircle</span>
  ),
  ChevronDown: ({ size, className }: { size: number; className?: string }) => (
    <span data-testid="chevron-down" data-size={size} className={className}>ChevronDown</span>
  ),
  Loader2: ({ size, className }: { size: number; className?: string }) => (
    <span data-testid="loader-2" data-size={size} className={className}>Loader2</span>
  ),
}));

// Mock electron API
const mockVcsOpenDeepLink = vi.fn().mockResolvedValue(true);

const mockElectronAPI = {
  vcsOpenDeepLink: mockVcsOpenDeepLink,
};

// Helper to create provider context with required fields
function createProviderContext(overrides?: Partial<ProviderContext>): ProviderContext {
  return {
    provider: 'github',
    owner: 'test-owner',
    repo: 'test-repo',
    baseUrl: 'https://github.com',
    defaultBranch: 'main',
    ...overrides,
  };
}

describe('ProviderMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(window, 'electronAPI', {
      value: mockElectronAPI,
      writable: true,
    });

    useVcsStore.setState({
      provider: null,
      pullRequest: null,
      deepLinks: [],
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // =========================================================================
  // Basic Rendering
  // =========================================================================
  describe('basic rendering', () => {
    it('renders trigger button', () => {
      render(
        <ProviderMenu
          provider={null}
          deepLinks={[]}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      expect(document.querySelector('.provider-menu-trigger')).toBeTruthy();
    });

    it('shows chevron icon when not loading and has provider', () => {
      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={[]}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      // Open the menu first
      fireEvent.click(document.querySelector('.provider-menu-trigger')!);

      expect(document.querySelector('.provider-menu-chevron')).toBeTruthy();
    });

    it('shows loader when isLoading is true', () => {
      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={[]}
          isLoading={true}
          error={null}
          workspacePath="/workspace"
        />
      );

      expect(document.querySelector('.spin')).toBeTruthy();
    });

    it('shows ExternalLink icon when not loading', () => {
      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={[]}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      expect(document.querySelector('[data-testid="external-link"]')).toBeTruthy();
    });
  });

  // =========================================================================
  // Button States
  // =========================================================================
  describe('button states', () => {
    it('trigger is disabled when loading', () => {
      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={[]}
          isLoading={true}
          error={null}
          workspacePath="/workspace"
        />
      );

      const button = document.querySelector('.provider-menu-trigger') as HTMLButtonElement;
      expect(button).toHaveProperty('disabled', true);
    });

    it('trigger is disabled when no provider', () => {
      render(
        <ProviderMenu
          provider={null}
          deepLinks={[]}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      const button = document.querySelector('.provider-menu-trigger') as HTMLButtonElement;
      expect(button).toHaveProperty('disabled', true);
    });

    it('trigger is enabled when provider exists and not loading', () => {
      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={[]}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      const button = document.querySelector('.provider-menu-trigger') as HTMLButtonElement;
      expect(button).toHaveProperty('disabled', false);
    });
  });

  // =========================================================================
  // Menu Toggle
  // =========================================================================
  describe('menu toggle', () => {
    it('clicking trigger toggles menu open', () => {
      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={[]}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      const trigger = document.querySelector('.provider-menu-trigger')!;
      fireEvent.click(trigger);

      expect(document.querySelector('.provider-menu-dropdown')).toBeTruthy();
    });

    it('clicking trigger twice closes menu', () => {
      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={[]}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      const trigger = document.querySelector('.provider-menu-trigger')!;
      fireEvent.click(trigger);
      expect(document.querySelector('.provider-menu-dropdown')).toBeTruthy();

      fireEvent.click(trigger);
      expect(document.querySelector('.provider-menu-dropdown')).toBeNull();
    });

    it('chevron rotates when open', () => {
      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={[]}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      const trigger = document.querySelector('.provider-menu-trigger')!;
      fireEvent.click(trigger);

      const chevron = document.querySelector('.provider-menu-chevron');
      expect(chevron).toHaveClass('open');
    });
  });

  // =========================================================================
  // Menu Content
  // =========================================================================
  describe('menu content', () => {
    it('shows provider repo name in header', () => {
      render(
        <ProviderMenu
          provider={createProviderContext({ owner: 'test-owner', repo: 'test-repo' })}
          deepLinks={[]}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);

      const repoName = document.querySelector('.provider-repo-name');
      expect(repoName).toBeTruthy();
      expect(repoName?.textContent).toBe('test-owner/test-repo');
    });

    it('shows error when error prop provided', () => {
      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={[]}
          isLoading={false}
          error="Failed to load context"
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);

      const error = document.querySelector('.provider-menu-error');
      expect(error).toBeTruthy();
      expect(error?.textContent).toContain('Failed to load context');
    });

    it('shows links when deepLinks provided', () => {
      const deepLinks: DeepLink[] = [
        { type: 'pr', label: 'View PR', url: 'https://github.com/test/pr' },
        { type: 'branches', label: 'Branches', url: 'https://github.com/test/branches' },
      ];

      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={deepLinks}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);

      const links = document.querySelectorAll('.provider-menu-link');
      expect(links).toHaveLength(2);
    });

    it('shows empty state when no links', () => {
      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={[]}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);

      const empty = document.querySelector('.provider-menu-empty');
      expect(empty).toBeTruthy();
      expect(empty?.textContent).toBe('No links available');
    });
  });

  // =========================================================================
  // Link Behavior
  // =========================================================================
  describe('link behavior', () => {
    it('calls onLinkClick callback when link clicked', () => {
      const deepLinks: DeepLink[] = [
        { type: 'pr', label: 'View PR', url: 'https://github.com/test/pr' },
      ];
      const onLinkClick = vi.fn();

      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={deepLinks}
          isLoading={false}
          error={null}
          onLinkClick={onLinkClick}
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);
      fireEvent.click(document.querySelector('.provider-menu-link')!);

      expect(onLinkClick).toHaveBeenCalledWith(deepLinks[0]);
    });

    it('calls vcsOpenDeepLink when link clicked', () => {
      const deepLinks: DeepLink[] = [
        { type: 'pr', label: 'View PR', url: 'https://github.com/test/pr' },
      ];

      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={deepLinks}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);
      fireEvent.click(document.querySelector('.provider-menu-link')!);

      expect(mockVcsOpenDeepLink).toHaveBeenCalledWith('/workspace', 'pr');
    });

    it('closes menu after link click', () => {
      const deepLinks: DeepLink[] = [
        { type: 'pr', label: 'View PR', url: 'https://github.com/test/pr' },
      ];

      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={deepLinks}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);
      expect(document.querySelector('.provider-menu-dropdown')).toBeTruthy();

      fireEvent.click(document.querySelector('.provider-menu-link')!);

      expect(document.querySelector('.provider-menu-dropdown')).toBeNull();
    });

    it('shows refresh button in header', () => {
      const onRefresh = vi.fn();

      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={[]}
          isLoading={false}
          error={null}
          onRefresh={onRefresh}
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);

      const refreshBtn = document.querySelector('.provider-menu-refresh');
      expect(refreshBtn).toBeTruthy();
    });

    it('calls onRefresh when refresh button clicked', () => {
      const onRefresh = vi.fn();

      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={[]}
          isLoading={false}
          error={null}
          onRefresh={onRefresh}
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);
      fireEvent.click(document.querySelector('.provider-menu-refresh')!);

      expect(onRefresh).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Click Outside
  // =========================================================================
  describe('click outside', () => {
    it('closes menu when clicking outside', () => {
      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={[]}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);
      expect(document.querySelector('.provider-menu-dropdown')).toBeTruthy();

      fireEvent.mouseDown(document.body);

      expect(document.querySelector('.provider-menu-dropdown')).toBeNull();
    });

    it('does not close menu when clicking inside', () => {
      const deepLinks: DeepLink[] = [
        { type: 'pr', label: 'View PR', url: 'https://github.com/test/pr' },
      ];

      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={deepLinks}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);
      expect(document.querySelector('.provider-menu-dropdown')).toBeTruthy();

      // Click inside the dropdown
      fireEvent.mouseDown(document.querySelector('.provider-menu-dropdown')!);

      expect(document.querySelector('.provider-menu-dropdown')).toBeTruthy();
    });
  });

  // =========================================================================
  // getLinkIcon helper
  // =========================================================================
  describe('getLinkIcon helper', () => {
    it('shows GitPullRequest icon for pr type', () => {
      const deepLinks: DeepLink[] = [
        { type: 'pr', label: 'View PR', url: 'https://github.com/test/pr' },
      ];

      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={deepLinks}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);

      expect(document.querySelector('[data-testid="git-pull-request"]')).toBeTruthy();
    });

    it('shows GitBranch icon for branches type', () => {
      const deepLinks: DeepLink[] = [
        { type: 'branches', label: 'Branches', url: 'https://github.com/test/branches' },
      ];

      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={deepLinks}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);

      expect(document.querySelector('[data-testid="git-branch"]')).toBeTruthy();
    });

    it('shows ExternalLink icon for other types', () => {
      // Use a valid DeepLinkType - 'releases' is a valid type
      const deepLinks: DeepLink[] = [
        { type: 'releases', label: 'Releases', url: 'https://github.com/test/releases' },
      ];

      render(
        <ProviderMenu
          provider={createProviderContext({})}
          deepLinks={deepLinks}
          isLoading={false}
          error={null}
          workspacePath="/workspace"
        />
      );

      fireEvent.click(document.querySelector('.provider-menu-trigger')!);

      // The external link icon appears at the end of each link
      expect(document.querySelector('.provider-menu-link-arrow')).toBeTruthy();
    });
  });
});