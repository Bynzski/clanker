// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ProviderBadge from '../../../../src/renderer/components/git/ProviderBadge';

// Mock lucide icons
vi.mock('lucide-react', () => ({
  ExternalLink: ({ size, className }: { size: number; className?: string }) => (
    <span data-testid="external-link" data-size={size} className={className}>ExternalLink</span>
  ),
  CheckCircle: ({ size, className }: { size: number; className?: string }) => (
    <span data-testid="check-circle" data-size={size} className={className}>CheckCircle</span>
  ),
  XCircle: ({ size, className }: { size: number; className?: string }) => (
    <span data-testid="x-circle" data-size={size} className={className}>XCircle</span>
  ),
  Clock: ({ size, className }: { size: number; className?: string }) => (
    <span data-testid="clock" data-size={size} className={className}>Clock</span>
  ),
  AlertCircle: ({ size, className }: { size: number; className?: string }) => (
    <span data-testid="alert-circle" data-size={size} className={className}>AlertCircle</span>
  ),
}));

// Helper to create PR context without nullable optional fields
function createPrContext(overrides: Partial<{
  exists: boolean;
  number: number;
  provider: 'github';
  title?: string;
  state?: 'open' | 'closed' | 'merged';
  checksStatus?: 'pending' | 'success' | 'failure' | 'error';
  reviewState?: 'approved' | 'changes_requested' | 'commented' | 'pending';
}>): Parameters<typeof ProviderBadge>[0]['pullRequest'] {
  return {
    exists: true,
    number: 42,
    provider: 'github',
    ...overrides,
  };
}

describe('ProviderBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // =========================================================================
  // No PR State
  // =========================================================================
  describe('no PR state', () => {
    it('shows Create PR button when pullRequest is null', () => {
      render(
        <ProviderBadge
          pullRequest={null}
        />
      );

      const button = document.querySelector('.provider-badge');
      expect(button?.textContent).toContain('Create PR');
      expect(button).toHaveClass('create-pr-badge');
    });

    it('shows Create PR button when pullRequest.exists is false', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ exists: false })}
        />
      );

      const button = document.querySelector('.provider-badge');
      expect(button?.textContent).toContain('Create PR');
    });

    it('calls onCreatePr when Create PR button clicked', () => {
      const onCreatePr = vi.fn();

      render(
        <ProviderBadge
          pullRequest={null}
          onCreatePr={onCreatePr}
        />
      );

      const button = document.querySelector('.provider-badge') as HTMLButtonElement;
      button.click();

      expect(onCreatePr).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // PR Badge
  // =========================================================================
  describe('PR badge', () => {
    it('shows PR badge when PR exists', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ state: 'open' })}
        />
      );

      const badge = document.querySelector('.pr-badge');
      expect(badge).toBeTruthy();
    });

    it('shows PR number with hash prefix', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ number: 42, state: 'open' })}
        />
      );

      const numberEl = document.querySelector('.pr-number');
      expect(numberEl?.textContent).toBe('#42');
    });

    it('shows title when provided', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ title: 'Add new feature', state: 'open' })}
        />
      );

      const titleEl = document.querySelector('.pr-title');
      expect(titleEl?.textContent).toBe('Add new feature');
    });

    it('shows state text when provided', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ state: 'open' })}
        />
      );

      const stateEl = document.querySelector('.pr-state');
      expect(stateEl?.textContent).toBe('open');
    });

    it('applies merged state class for merged PR', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ state: 'merged' })}
        />
      );

      const badge = document.querySelector('.pr-badge');
      expect(badge).toHaveClass('merged');
    });

    it('applies open state class for open PR', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ state: 'open' })}
        />
      );

      const badge = document.querySelector('.pr-badge');
      expect(badge).toHaveClass('open');
    });

    it('applies closed state class for closed PR', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ state: 'closed' })}
        />
      );

      const badge = document.querySelector('.pr-badge');
      expect(badge).toHaveClass('closed');
    });

    it('calls onViewPr when badge clicked', () => {
      const onViewPr = vi.fn();

      render(
        <ProviderBadge
          pullRequest={createPrContext({ state: 'open' })}
          onViewPr={onViewPr}
        />
      );

      const badge = document.querySelector('.pr-badge') as HTMLButtonElement;
      badge.click();

      expect(onViewPr).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Status Icons
  // =========================================================================
  describe('status icons', () => {
    it('shows XCircle icon for failure status', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ checksStatus: 'failure', state: 'open' })}
        />
      );

      expect(document.querySelector('[data-testid="x-circle"]')).toBeTruthy();
    });

    it('shows AlertCircle icon for error status', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ checksStatus: 'error', state: 'open' })}
        />
      );

      expect(document.querySelector('[data-testid="alert-circle"]')).toBeTruthy();
    });

    it('shows Clock icon for pending status', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ checksStatus: 'pending', state: 'open' })}
        />
      );

      expect(document.querySelector('[data-testid="clock"]')).toBeTruthy();
    });

    it('applies failure class to status icon', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ checksStatus: 'failure', state: 'open' })}
        />
      );

      const icon = document.querySelector('[data-testid="x-circle"]');
      expect(icon).toHaveClass('failure');
    });

    it('applies error class to status icon', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ checksStatus: 'error', state: 'open' })}
        />
      );

      const icon = document.querySelector('[data-testid="alert-circle"]');
      expect(icon).toHaveClass('error');
    });

    it('applies pending class to status icon', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ checksStatus: 'pending', state: 'open' })}
        />
      );

      const icon = document.querySelector('[data-testid="clock"]');
      expect(icon).toHaveClass('pending');
    });
  });

  // =========================================================================
  // Review State Labels
  // =========================================================================
  describe('review state labels', () => {
    it('shows "Approved" label for approved state', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ reviewState: 'approved', state: 'open' })}
        />
      );

      const label = document.querySelector('.review-state');
      expect(label?.textContent).toBe('Approved');
      expect(label).toHaveClass('approved');
    });

    it('shows "Changes requested" label for changes_requested state', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ reviewState: 'changes_requested', state: 'open' })}
        />
      );

      const label = document.querySelector('.review-state');
      expect(label?.textContent).toBe('Changes requested');
      expect(label).toHaveClass('changes-requested');
    });

    it('shows "Commented" label for commented state', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ reviewState: 'commented', state: 'open' })}
        />
      );

      const label = document.querySelector('.review-state');
      expect(label?.textContent).toBe('Commented');
      expect(label).toHaveClass('commented');
    });

    it('shows "Pending review" label for pending state', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ reviewState: 'pending', state: 'open' })}
        />
      );

      const label = document.querySelector('.review-state');
      expect(label?.textContent).toBe('Pending review');
      expect(label).toHaveClass('pending');
    });
  });

  // =========================================================================
  // Status Indicators Container
  // =========================================================================
  describe('status indicators container', () => {
    it('shows container when reviewState is present', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ reviewState: 'approved', state: 'open' })}
        />
      );

      const indicators = document.querySelector('.pr-status-indicators');
      expect(indicators).toBeTruthy();
    });

    it('shows container when checksStatus is present and not success', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ checksStatus: 'failure', state: 'open' })}
        />
      );

      const indicators = document.querySelector('.pr-status-indicators');
      expect(indicators).toBeTruthy();
    });

    it('shows container with both status and review indicators', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ checksStatus: 'failure', reviewState: 'approved', state: 'open' })}
        />
      );

      const indicators = document.querySelector('.pr-status-indicators');
      expect(indicators).toBeTruthy();

      const statusIndicator = indicators?.querySelector('.status-indicator');
      expect(statusIndicator).toBeTruthy();

      const reviewIndicator = indicators?.querySelector('.review-indicator');
      expect(reviewIndicator).toBeTruthy();
    });

    it('shows review indicator when checksStatus is success', () => {
      render(
        <ProviderBadge
          pullRequest={createPrContext({ checksStatus: 'success', reviewState: 'approved', state: 'open' })}
        />
      );

      const indicators = document.querySelector('.pr-status-indicators');
      // Review indicator IS shown when reviewState is present
      const reviewIndicator = indicators?.querySelector('.review-indicator');
      expect(reviewIndicator).toBeTruthy();
    });
  });
});