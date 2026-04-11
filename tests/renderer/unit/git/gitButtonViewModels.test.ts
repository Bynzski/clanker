import { describe, expect, it } from 'vitest';
import {
  getProviderLabel,
  getStatusErrorMessage,
  getUpstreamLabel,
} from '../../../../src/renderer/components/git/gitButtonViewModels';

describe('gitButtonViewModels', () => {
  describe('getStatusErrorMessage', () => {
    it('maps known git status error codes', () => {
      expect(getStatusErrorMessage('git-not-found')).toBe('Git is not installed or not found on PATH');
      expect(getStatusErrorMessage('not-a-repo')).toBe('Not a git repository');
    });

    it('returns null for unknown codes', () => {
      expect(getStatusErrorMessage('unknown')).toBeNull();
      expect(getStatusErrorMessage(null)).toBeNull();
    });
  });

  describe('getUpstreamLabel', () => {
    it('returns null when no upstream exists', () => {
      expect(getUpstreamLabel(null, 0, 0)).toBeNull();
    });

    it('returns synced label when ahead and behind are zero', () => {
      expect(getUpstreamLabel('origin/main', 0, 0)).toBe('up to date');
    });

    it('formats ahead and behind counts for diverged branches', () => {
      expect(getUpstreamLabel('origin/main', 2, 1)).toBe('↑2 ↓1');
    });
  });

  describe('getProviderLabel', () => {
    it('maps known providers to display labels', () => {
      expect(getProviderLabel('github')).toBe('GitHub');
      expect(getProviderLabel('gitlab')).toBe('GitLab');
      expect(getProviderLabel('bitbucket')).toBe('Bitbucket');
    });

    it('falls back to no remote for unknown providers', () => {
      expect(getProviderLabel('unknown')).toBe('no remote');
    });
  });
});
