/**
 * VCS Store Tests
 * Tests for VCS credential and provider state management.
 * 
 * This store manages:
 * - SSH key status
 * - Personal Access Tokens (PATs) by provider
 * - Remote credential status
 * - Provider context (repo, PR info, deep links)
 * 
 * All tests use real Zustand state - no mocks needed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useVcsStore } from '../../../src/renderer/store/vcsStore';
import type {
  SshKeyStatus,
  StoredPat,
  RemoteCredentialStatus,
  ProviderContext,
  PullRequestContext,
  DeepLink,
  VcsProvider,
} from '../../../src/renderer/store/vcsStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset the vcsStore to initial state before each test. */
function resetStore() {
  useVcsStore.setState({
    sshKey: { exists: false },
    storedPats: {
      github: null,
      gitlab: null,
      bitbucket: null,
      unknown: null,
    },
    remoteCredentials: {},
    isLoading: false,
    error: null,
    provider: null,
    pullRequest: null,
    deepLinks: [],
  });
}

beforeEach(() => {
  resetStore();
});

function getStore() {
  return useVcsStore.getState();
}

// ===========================================================================
// Initial State
// ===========================================================================
describe('initial state', () => {
  it('has SSH key marked as not existing', () => {
    expect(getStore().sshKey).toEqual({ exists: false });
  });

  it('has no stored PATs', () => {
    const { storedPats } = getStore();
    expect(storedPats.github).toBeNull();
    expect(storedPats.gitlab).toBeNull();
    expect(storedPats.bitbucket).toBeNull();
    expect(storedPats.unknown).toBeNull();
  });

  it('has no remote credentials', () => {
    expect(getStore().remoteCredentials).toEqual({});
  });

  it('has no provider context', () => {
    expect(getStore().provider).toBeNull();
  });

  it('has no pull request context', () => {
    expect(getStore().pullRequest).toBeNull();
  });

  it('has no deep links', () => {
    expect(getStore().deepLinks).toEqual([]);
  });

  it('is not loading', () => {
    expect(getStore().isLoading).toBe(false);
  });

  it('has no error', () => {
    expect(getStore().error).toBeNull();
  });
});

// ===========================================================================
// SSH Key Actions
// ===========================================================================
describe('setSshKey', () => {
  it('updates SSH key status', () => {
    const status: SshKeyStatus = {
      exists: true,
      publicKey: 'ssh-ed25519 AAAA...',
      fingerprint: 'SHA256:abc123',
    };

    getStore().setSshKey(status);

    expect(getStore().sshKey).toEqual(status);
  });

  it('clears error when setting SSH key', () => {
    getStore().setError('Previous error');
    getStore().setSshKey({ exists: true });

    expect(getStore().error).toBeNull();
  });

  it('can mark SSH key as not existing', () => {
    getStore().setSshKey({ exists: true });
    getStore().setSshKey({ exists: false });

    expect(getStore().sshKey.exists).toBe(false);
  });
});

// ===========================================================================
// PAT Actions
// ===========================================================================
describe('setStoredPat', () => {
  const createPat = (provider: VcsProvider): StoredPat => ({
    provider,
    scope: ['repo'],
    storedAt: '2024-01-15T10:30:00Z',
    validated: true,
  });

  it('stores PAT for github', () => {
    const pat = createPat('github');
    getStore().setStoredPat('github', pat);

    expect(getStore().storedPats.github).toEqual(pat);
  });

  it('stores PAT for gitlab', () => {
    const pat = createPat('gitlab');
    getStore().setStoredPat('gitlab', pat);

    expect(getStore().storedPats.gitlab).toEqual(pat);
  });

  it('stores PAT for bitbucket', () => {
    const pat = createPat('bitbucket');
    getStore().setStoredPat('bitbucket', pat);

    expect(getStore().storedPats.bitbucket).toEqual(pat);
  });

  it('clears error when storing PAT', () => {
    getStore().setError('Previous error');
    getStore().setStoredPat('github', createPat('github'));

    expect(getStore().error).toBeNull();
  });

  it('can set null to remove PAT', () => {
    getStore().setStoredPat('github', createPat('github'));
    getStore().setStoredPat('github', null);

    expect(getStore().storedPats.github).toBeNull();
  });

  it('preserves other providers when setting one PAT', () => {
    getStore().setStoredPat('github', createPat('github'));
    getStore().setStoredPat('gitlab', createPat('gitlab'));

    expect(getStore().storedPats.github).not.toBeNull();
    expect(getStore().storedPats.gitlab).not.toBeNull();
    expect(getStore().storedPats.bitbucket).toBeNull();
  });

  it('stores PAT with unvalidated status', () => {
    const pat: StoredPat = {
      provider: 'github',
      scope: ['repo'],
      storedAt: '2024-01-15T10:30:00Z',
      validated: false,
    };
    getStore().setStoredPat('github', pat);

    expect(getStore().storedPats.github?.validated).toBe(false);
  });
});

describe('removeStoredPat', () => {
  it('removes PAT for github', () => {
    getStore().setStoredPat('github', {
      provider: 'github',
      scope: ['repo'],
      storedAt: '2024-01-15T10:30:00Z',
      validated: true,
    });

    getStore().removeStoredPat('github');

    expect(getStore().storedPats.github).toBeNull();
  });

  it('clears error when removing PAT', () => {
    getStore().setStoredPat('github', {
      provider: 'github',
      scope: ['repo'],
      storedAt: '2024-01-15T10:30:00Z',
      validated: true,
    });
    getStore().setError('Previous error');
    getStore().removeStoredPat('github');

    expect(getStore().error).toBeNull();
  });

  it('does nothing if PAT already null', () => {
    getStore().removeStoredPat('github');
    expect(getStore().storedPats.github).toBeNull();
  });
});

// ===========================================================================
// Remote Credential Actions
// ===========================================================================
describe('setRemoteCredentialStatus', () => {
  const createCredentialStatus = (remoteName: string, provider: VcsProvider): RemoteCredentialStatus => ({
    remoteName,
    provider,
    hasSshKey: true,
    hasPat: false,
    credentialHelper: 'git credential',
  });

  it('stores credential status for origin remote', () => {
    const status = createCredentialStatus('origin', 'github');
    getStore().setRemoteCredentialStatus('origin', status);

    expect(getStore().remoteCredentials.origin).toEqual(status);
  });

  it('stores credential status for upstream remote', () => {
    const status = createCredentialStatus('upstream', 'github');
    getStore().setRemoteCredentialStatus('upstream', status);

    expect(getStore().remoteCredentials.upstream).toEqual(status);
  });

  it('clears error when setting credential status', () => {
    getStore().setError('Previous error');
    getStore().setRemoteCredentialStatus('origin', createCredentialStatus('origin', 'github'));

    expect(getStore().error).toBeNull();
  });

  it('updates existing remote credential', () => {
    getStore().setRemoteCredentialStatus('origin', createCredentialStatus('origin', 'github'));
    const updated: RemoteCredentialStatus = {
      ...createCredentialStatus('origin', 'github'),
      hasPat: true,
    };

    getStore().setRemoteCredentialStatus('origin', updated);

    expect(getStore().remoteCredentials.origin.hasPat).toBe(true);
  });

  it('can store multiple remotes', () => {
    getStore().setRemoteCredentialStatus('origin', createCredentialStatus('origin', 'github'));
    getStore().setRemoteCredentialStatus('upstream', createCredentialStatus('upstream', 'gitlab'));

    expect(Object.keys(getStore().remoteCredentials)).toHaveLength(2);
  });
});

// ===========================================================================
// Loading and Error Actions
// ===========================================================================
describe('setLoading', () => {
  it('sets loading to true', () => {
    getStore().setLoading(true);
    expect(getStore().isLoading).toBe(true);
  });

  it('sets loading to false', () => {
    getStore().setLoading(true);
    getStore().setLoading(false);
    expect(getStore().isLoading).toBe(false);
  });
});

describe('setError', () => {
  it('sets error message', () => {
    getStore().setError('Connection failed');
    expect(getStore().error).toBe('Connection failed');
  });

  it('sets loading to false when error occurs', () => {
    getStore().setLoading(true);
    getStore().setError('Failed');

    expect(getStore().isLoading).toBe(false);
  });

  it('can clear error with null', () => {
    getStore().setError('Error');
    getStore().setError(null);
    expect(getStore().error).toBeNull();
  });

  it('clears previous error when setting new one', () => {
    getStore().setError('First error');
    getStore().setError('Second error');
    expect(getStore().error).toBe('Second error');
  });
});

// ===========================================================================
// Context Actions
// ===========================================================================
describe('setProviderContext', () => {
  const createContext = (): ProviderContext => ({
    provider: 'github',
    baseUrl: 'https://github.com',
    owner: 'owner',
    repo: 'repo',
    defaultBranch: 'main',
  });

  it('sets provider context', () => {
    const context = createContext();
    getStore().setProviderContext(context);

    expect(getStore().provider).toEqual(context);
  });

  it('clears error when setting provider context', () => {
    getStore().setError('Previous error');
    getStore().setProviderContext(createContext());

    expect(getStore().error).toBeNull();
  });

  it('can set null to clear provider context', () => {
    getStore().setProviderContext(createContext());
    getStore().setProviderContext(null);

    expect(getStore().provider).toBeNull();
  });

  it('sets gitlab provider context', () => {
    const context: ProviderContext = {
      provider: 'gitlab',
      baseUrl: 'https://gitlab.com',
      owner: 'group',
      repo: 'project',
      defaultBranch: 'master',
    };
    getStore().setProviderContext(context);

    expect(getStore().provider?.provider).toBe('gitlab');
  });

  it('sets bitbucket provider context', () => {
    const context: ProviderContext = {
      provider: 'bitbucket',
      baseUrl: 'https://bitbucket.org',
      owner: 'team',
      repo: 'workspace',
      defaultBranch: 'main',
    };
    getStore().setProviderContext(context);

    expect(getStore().provider?.provider).toBe('bitbucket');
  });
});

describe('setPullRequest', () => {
  const createPullRequest = (): PullRequestContext => ({
    exists: true,
    number: 42,
    title: 'Add new feature',
    state: 'open',
    url: 'https://github.com/owner/repo/pull/42',
    checksStatus: 'success',
    reviewState: 'approved',
    author: 'developer',
  });

  it('sets pull request context', () => {
    const pr = createPullRequest();
    getStore().setPullRequest(pr);

    expect(getStore().pullRequest).toEqual(pr);
  });

  it('can set null to clear pull request', () => {
    getStore().setPullRequest(createPullRequest());
    getStore().setPullRequest(null);

    expect(getStore().pullRequest).toBeNull();
  });

  it('sets PR with closed state', () => {
    const pr: PullRequestContext = {
      exists: true,
      number: 10,
      title: 'Closed PR',
      state: 'closed',
    };
    getStore().setPullRequest(pr);

    expect(getStore().pullRequest?.state).toBe('closed');
  });

  it('sets PR with merged state', () => {
    const pr: PullRequestContext = {
      exists: true,
      number: 15,
      title: 'Merged PR',
      state: 'merged',
    };
    getStore().setPullRequest(pr);

    expect(getStore().pullRequest?.state).toBe('merged');
  });

  it('sets PR with failed checks', () => {
    const pr: PullRequestContext = {
      exists: true,
      number: 20,
      title: 'PR with failures',
      state: 'open',
      checksStatus: 'failure',
    };
    getStore().setPullRequest(pr);

    expect(getStore().pullRequest?.checksStatus).toBe('failure');
  });

  it('sets PR with pending checks', () => {
    const pr: PullRequestContext = {
      exists: true,
      number: 25,
      title: 'PR with pending checks',
      state: 'open',
      checksStatus: 'pending',
    };
    getStore().setPullRequest(pr);

    expect(getStore().pullRequest?.checksStatus).toBe('pending');
  });

  it('sets PR with changes requested review', () => {
    const pr: PullRequestContext = {
      exists: true,
      number: 30,
      title: 'PR needing changes',
      state: 'open',
      reviewState: 'changes_requested',
    };
    getStore().setPullRequest(pr);

    expect(getStore().pullRequest?.reviewState).toBe('changes_requested');
  });
});

describe('setDeepLinks', () => {
  const createDeepLinks = (): DeepLink[] => [
    { type: 'repo', url: 'https://github.com/owner/repo', label: 'Repository' },
    { type: 'branches', url: 'https://github.com/owner/repo/branches', label: 'Branches' },
    { type: 'issues', url: 'https://github.com/owner/repo/issues', label: 'Issues' },
  ];

  it('sets deep links', () => {
    const links = createDeepLinks();
    getStore().setDeepLinks(links);

    expect(getStore().deepLinks).toEqual(links);
  });

  it('sets empty array to clear deep links', () => {
    getStore().setDeepLinks(createDeepLinks());
    getStore().setDeepLinks([]);

    expect(getStore().deepLinks).toEqual([]);
  });

  it('sets PR deep link', () => {
    const links: DeepLink[] = [
      { type: 'pr', url: 'https://github.com/owner/repo/pull/42', label: 'PR #42' },
      { type: 'repo', url: 'https://github.com/owner/repo', label: 'Repository' },
    ];
    getStore().setDeepLinks(links);

    expect(getStore().deepLinks[0].type).toBe('pr');
  });

  it('sets create-pr deep link', () => {
    const links: DeepLink[] = [
      {
        type: 'create-pr',
        url: 'https://github.com/owner/repo/compare/main...feature',
        label: 'Create Pull Request',
      },
    ];
    getStore().setDeepLinks(links);

    expect(getStore().deepLinks[0].type).toBe('create-pr');
  });

  it('sets releases deep link', () => {
    const links: DeepLink[] = [
      { type: 'releases', url: 'https://github.com/owner/repo/releases', label: 'Releases' },
    ];
    getStore().setDeepLinks(links);

    expect(getStore().deepLinks[0].type).toBe('releases');
  });

  it('sets actions deep link', () => {
    const links: DeepLink[] = [
      { type: 'actions', url: 'https://github.com/owner/repo/actions', label: 'Actions' },
    ];
    getStore().setDeepLinks(links);

    expect(getStore().deepLinks[0].type).toBe('actions');
  });
});

// ===========================================================================
// Clear Actions
// ===========================================================================
describe('clearCredentials', () => {
  it('resets SSH key to not existing', () => {
    getStore().setSshKey({ exists: true, publicKey: 'ssh-ed25519 AAA' });
    getStore().clearCredentials();

    expect(getStore().sshKey).toEqual({ exists: false });
  });

  it('clears all stored PATs', () => {
    getStore().setStoredPat('github', {
      provider: 'github',
      scope: ['repo'],
      storedAt: '2024-01-15T10:30:00Z',
      validated: true,
    });
    getStore().setStoredPat('gitlab', {
      provider: 'gitlab',
      scope: ['repo'],
      storedAt: '2024-01-15T10:30:00Z',
      validated: true,
    });
    getStore().clearCredentials();

    expect(getStore().storedPats.github).toBeNull();
    expect(getStore().storedPats.gitlab).toBeNull();
  });

  it('clears remote credentials', () => {
    getStore().setRemoteCredentialStatus('origin', {
      remoteName: 'origin',
      provider: 'github',
      hasSshKey: true,
      hasPat: true,
      credentialHelper: null,
    });
    getStore().clearCredentials();

    expect(getStore().remoteCredentials).toEqual({});
  });

  it('resets loading state', () => {
    getStore().setLoading(true);
    getStore().clearCredentials();

    expect(getStore().isLoading).toBe(false);
  });

  it('clears error', () => {
    getStore().setError('Error');
    getStore().clearCredentials();

    expect(getStore().error).toBeNull();
  });

  it('does not affect provider context', () => {
    getStore().setProviderContext({
      provider: 'github',
      baseUrl: 'https://github.com',
      owner: 'owner',
      repo: 'repo',
      defaultBranch: 'main',
    });
    getStore().clearCredentials();

    expect(getStore().provider).not.toBeNull();
  });
});

describe('clearContext', () => {
  it('clears provider context', () => {
    getStore().setProviderContext({
      provider: 'github',
      baseUrl: 'https://github.com',
      owner: 'owner',
      repo: 'repo',
      defaultBranch: 'main',
    });
    getStore().clearContext();

    expect(getStore().provider).toBeNull();
  });

  it('clears pull request context', () => {
    getStore().setPullRequest({
      exists: true,
      number: 42,
      title: 'Test PR',
      state: 'open',
    });
    getStore().clearContext();

    expect(getStore().pullRequest).toBeNull();
  });

  it('clears deep links', () => {
    getStore().setDeepLinks([
      { type: 'repo', url: 'https://github.com/owner/repo', label: 'Repository' },
    ]);
    getStore().clearContext();

    expect(getStore().deepLinks).toEqual([]);
  });

  it('does not affect credential state', () => {
    getStore().setSshKey({ exists: true });
    getStore().setStoredPat('github', {
      provider: 'github',
      scope: ['repo'],
      storedAt: '2024-01-15T10:30:00Z',
      validated: true,
    });
    getStore().clearContext();

    expect(getStore().sshKey.exists).toBe(true);
    expect(getStore().storedPats.github).not.toBeNull();
  });
});

// ===========================================================================
// State Transitions (Integration Scenarios)
// ===========================================================================
describe('state transitions', () => {
  describe('credential loading flow', () => {
    it('transitions from loading to loaded', () => {
      // Start loading
      getStore().setLoading(true);

      // Set credentials
      getStore().setSshKey({ exists: true, fingerprint: 'SHA256:abc' });
      getStore().setStoredPat('github', {
        provider: 'github',
        scope: ['repo'],
        storedAt: '2024-01-15T10:30:00Z',
        validated: true,
      });

      // Finish loading
      getStore().setLoading(false);

      const state = getStore();
      expect(state.isLoading).toBe(false);
      expect(state.sshKey.exists).toBe(true);
      expect(state.storedPats.github).not.toBeNull();
    });

    it('handles loading error', () => {
      getStore().setLoading(true);
      getStore().setError('Failed to load credentials');

      const state = getStore();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Failed to load credentials');
    });
  });

  describe('provider context loading flow', () => {
    it('loads context then PR info', () => {
      // Set provider first
      getStore().setProviderContext({
        provider: 'github',
        baseUrl: 'https://github.com',
        owner: 'owner',
        repo: 'repo',
        defaultBranch: 'main',
      });

      // Then set PR info
      getStore().setPullRequest({
        exists: true,
        number: 42,
        title: 'Add feature',
        state: 'open',
      });

      // Then set deep links
      getStore().setDeepLinks([
        { type: 'repo', url: 'https://github.com/owner/repo', label: 'Repository' },
        { type: 'pr', url: 'https://github.com/owner/repo/pull/42', label: 'PR #42' },
      ]);

      const state = getStore();
      expect(state.provider?.owner).toBe('owner');
      expect(state.pullRequest?.number).toBe(42);
      expect(state.deepLinks).toHaveLength(2);
    });

    it('handles provider with no PR', () => {
      getStore().setProviderContext({
        provider: 'github',
        baseUrl: 'https://github.com',
        owner: 'owner',
        repo: 'repo',
        defaultBranch: 'main',
      });
      getStore().setPullRequest({ exists: false });
      getStore().setDeepLinks([
        { type: 'repo', url: 'https://github.com/owner/repo', label: 'Repository' },
      ]);

      const state = getStore();
      expect(state.pullRequest?.exists).toBe(false);
      expect(state.deepLinks).toHaveLength(1);
    });
  });

  describe('workspace switch simulation', () => {
    it('clears context when switching workspaces', () => {
      // Simulate workspace A with GitHub context
      getStore().setProviderContext({
        provider: 'github',
        baseUrl: 'https://github.com',
        owner: 'owner',
        repo: 'repo-a',
        defaultBranch: 'main',
      });

      // Switch to workspace B (different repo)
      getStore().clearContext();
      getStore().setProviderContext({
        provider: 'gitlab',
        baseUrl: 'https://gitlab.com',
        owner: 'group',
        repo: 'repo-b',
        defaultBranch: 'master',
      });

      const state = getStore();
      expect(state.provider?.provider).toBe('gitlab');
      expect(state.provider?.repo).toBe('repo-b');
    });

    it('preserves global credentials across workspace switches', () => {
      // Set global credentials in workspace A
      getStore().setSshKey({ exists: true });
      getStore().setStoredPat('github', {
        provider: 'github',
        scope: ['repo'],
        storedAt: '2024-01-15T10:30:00Z',
        validated: true,
      });

      // Switch to workspace B
      getStore().clearContext();
      getStore().setProviderContext({
        provider: 'gitlab',
        baseUrl: 'https://gitlab.com',
        owner: 'group',
        repo: 'repo-b',
        defaultBranch: 'master',
      });

      // Credentials should still be there
      expect(getStore().sshKey.exists).toBe(true);
      expect(getStore().storedPats.github).not.toBeNull();
    });
  });

  describe('credential validation flow', () => {
    it('stores unvalidated PAT then updates after validation', () => {
      // Store PAT without validation
      getStore().setStoredPat('github', {
        provider: 'github',
        scope: ['repo'],
        storedAt: '2024-01-15T10:30:00Z',
        validated: false,
      });
      expect(getStore().storedPats.github?.validated).toBe(false);

      // After validation (simulated)
      getStore().setStoredPat('github', {
        provider: 'github',
        scope: ['repo'],
        storedAt: '2024-01-15T10:30:00Z',
        validated: true,
      });
      expect(getStore().storedPats.github?.validated).toBe(true);
    });
  });
});

// ===========================================================================
// Edge Cases
// ===========================================================================
describe('edge cases', () => {
  it('handles unknown provider credential status', () => {
    getStore().setRemoteCredentialStatus('origin', {
      remoteName: 'origin',
      provider: 'unknown',
      hasSshKey: false,
      hasPat: false,
      credentialHelper: null,
    });

    expect(getStore().remoteCredentials.origin.provider).toBe('unknown');
  });

  it('handles unknown provider context', () => {
    // Unknown provider should still be stored in context
    // (contextService decides how to handle it)
    getStore().setProviderContext({
      provider: 'unknown',
      baseUrl: '',
      owner: '',
      repo: '',
      defaultBranch: 'main',
    });

    expect(getStore().provider?.provider).toBe('unknown');
  });

  it('handles setting PAT for unknown provider', () => {
    getStore().setStoredPat('unknown', {
      provider: 'unknown',
      scope: ['repo'],
      storedAt: '2024-01-15T10:30:00Z',
      validated: true,
    });

    expect(getStore().storedPats.unknown).not.toBeNull();
  });

  it('handles multiple rapid state changes', () => {
    // Rapidly switch between states
    getStore().setLoading(true);
    getStore().setError(null);
    getStore().setProviderContext({
      provider: 'github',
      baseUrl: 'https://github.com',
      owner: 'owner',
      repo: 'repo',
      defaultBranch: 'main',
    });
    getStore().setPullRequest({
      exists: true,
      number: 1,
      title: 'PR 1',
      state: 'open',
    });
    getStore().setLoading(false);
    getStore().setError(null);

    const state = getStore();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.provider?.owner).toBe('owner');
    expect(state.pullRequest?.number).toBe(1);
  });

  it('handles empty deep links array', () => {
    getStore().setDeepLinks([]);
    expect(getStore().deepLinks).toEqual([]);

    // Setting empty array is valid
    getStore().setProviderContext({
      provider: 'github',
      baseUrl: 'https://github.com',
      owner: 'owner',
      repo: 'repo',
      defaultBranch: 'main',
    });
    // Deep links might be empty if no PR is detected
  });

  it('handles PR without number', () => {
    const pr: PullRequestContext = {
      exists: true,
      // number is intentionally omitted
      title: 'Draft PR',
      state: 'open',
    };
    getStore().setPullRequest(pr);

    expect(getStore().pullRequest?.exists).toBe(true);
    expect(getStore().pullRequest?.number).toBeUndefined();
  });
});
