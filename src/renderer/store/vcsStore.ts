/**
 * VCS Store
 * Zustand store for VCS credential and provider state.
 */

import { create } from 'zustand';
import type {
  DeepLink,
  DeepLinkType,
  ProviderContext,
  PullRequestContext,
  VcsProvider,
} from '../../shared/types/vcs';

export type { VcsProvider, DeepLink, DeepLinkType, ProviderContext, PullRequestContext };

/**
 * PAT configuration for a provider.
 */
export interface StoredPat {
  provider: VcsProvider;
  scope: string[];
  storedAt: string;
  validated: boolean;
}

/**
 * SSH key status.
 */
export interface SshKeyStatus {
  exists: boolean;
  publicKey?: string;
  fingerprint?: string;
}

/**
 * Credential status for a remote.
 */
export interface RemoteCredentialStatus {
  remoteName: string;
  provider: VcsProvider;
  hasSshKey: boolean;
  hasPat: boolean;
  credentialHelper: string | null;
}

/**
 * Global VCS credential state.
 */
export interface VcsCredentialState {
  /** SSH key status */
  sshKey: SshKeyStatus;
  /** Stored PATs by provider */
  storedPats: Record<VcsProvider, StoredPat | null>;
  /** Credential status per remote */
  remoteCredentials: Record<string, RemoteCredentialStatus>;
  /** Whether credentials are being loaded */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
}

/**
 * Actions for credential management.
 */
interface VcsCredentialActions {
  /** Set SSH key status */
  setSshKey: (status: SshKeyStatus) => void;
  /** Set PAT for a provider */
  setStoredPat: (provider: VcsProvider, pat: StoredPat | null) => void;
  /** Remove PAT for a provider */
  removeStoredPat: (provider: VcsProvider) => void;
  /** Set credential status for a remote */
  setRemoteCredentialStatus: (remoteName: string, status: RemoteCredentialStatus) => void;
  /** Set loading state */
  setLoading: (loading: boolean) => void;
  /** Set error message */
  setError: (error: string | null) => void;
  /** Clear all credential state */
  clearCredentials: () => void;
}

/**
 * Provider context state for the current workspace.
 */
export interface VcsContextState {
  /** Provider context */
  provider: ProviderContext | null;
  /** Pull request info */
  pullRequest: PullRequestContext | null;
  /** Available deep links */
  deepLinks: DeepLink[];
  /** Whether context is loading */
  isLoading: boolean;
  /** Error message */
  error: string | null;
}

/**
 * Actions for provider context.
 */
interface VcsContextActions {
  /** Set provider context */
  setProviderContext: (provider: ProviderContext | null) => void;
  /** Set pull request info */
  setPullRequest: (pullRequest: PullRequestContext | null) => void;
  /** Set deep links */
  setDeepLinks: (deepLinks: DeepLink[]) => void;
  /** Clear context state */
  clearContext: () => void;
}

/**
 * Combined VCS state type.
 */
export type VcsStore = VcsCredentialState & VcsContextState & VcsCredentialActions & VcsContextActions;

/**
 * Initial credential state.
 */
const initialCredentialState: VcsCredentialState = {
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
};

/**
 * Initial context state.
 */
const initialContextState: VcsContextState = {
  provider: null,
  pullRequest: null,
  deepLinks: [],
  isLoading: false,
  error: null,
};

export const useVcsStore = create<VcsStore>((set) => ({
  ...initialCredentialState,
  ...initialContextState,

  // Credential actions
  setSshKey: (status: SshKeyStatus) =>
    set(() => ({
      sshKey: status,
      error: null,
    })),

  setStoredPat: (provider: VcsProvider, pat: StoredPat | null) =>
    set((state) => ({
      storedPats: {
        ...state.storedPats,
        [provider]: pat,
      },
      error: null,
    })),

  removeStoredPat: (provider: VcsProvider) =>
    set((state) => ({
      storedPats: {
        ...state.storedPats,
        [provider]: null,
      },
      error: null,
    })),

  setRemoteCredentialStatus: (remoteName: string, status: RemoteCredentialStatus) =>
    set((state) => ({
      remoteCredentials: {
        ...state.remoteCredentials,
        [remoteName]: status,
      },
      error: null,
    })),

  setLoading: (loading: boolean) =>
    set(() => ({
      isLoading: loading,
    })),

  setError: (error: string | null) =>
    set(() => ({
      error,
      isLoading: false,
    })),

  clearCredentials: () =>
    set(() => ({
      ...initialCredentialState,
    })),

  // Context actions
  setProviderContext: (provider: ProviderContext | null) =>
    set(() => ({
      provider,
      error: null,
    })),

  setPullRequest: (pullRequest: PullRequestContext | null) =>
    set(() => ({
      pullRequest,
      error: null,
    })),

  setDeepLinks: (deepLinks: DeepLink[]) =>
    set(() => ({
      deepLinks,
    })),

  clearContext: () =>
    set(() => ({
      ...initialContextState,
    })),
}));

/**
 * Selector to get PAT for a specific provider.
 */
export function usePat(provider: VcsProvider) {
  return useVcsStore((state) => state.storedPats[provider]);
}

/**
 * Selector to get SSH key status.
 */
export function useSshKey() {
  return useVcsStore((state) => state.sshKey);
}

/**
 * Selector to get credential loading state.
 */
export function useCredentialsLoading() {
  return useVcsStore((state) => state.isLoading);
}

/**
 * Selector to get credential error.
 */
export function useCredentialsError() {
  return useVcsStore((state) => state.error);
}

/**
 * Selector to get provider context.
 */
export function useProviderContext() {
  return useVcsStore((state) => ({
    provider: state.provider,
    pullRequest: state.pullRequest,
    deepLinks: state.deepLinks,
    isLoading: state.isLoading,
    error: state.error,
  }));
}
