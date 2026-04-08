/**
 * VCS Store
 * Zustand store for VCS credential and provider state.
 */

import { create } from 'zustand';
import type { VcsProvider } from '../components/git/types';

export type { VcsProvider } from '../components/git/types';

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

export type VcsStore = VcsCredentialState & VcsCredentialActions;

const initialState: VcsCredentialState = {
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

export const useVcsStore = create<VcsStore>((set) => ({
  ...initialState,

  setSshKey: (status) =>
    set(() => ({
      sshKey: status,
      error: null,
    })),

  setStoredPat: (provider, pat) =>
    set((state) => ({
      storedPats: {
        ...state.storedPats,
        [provider]: pat,
      },
      error: null,
    })),

  removeStoredPat: (provider) =>
    set((state) => ({
      storedPats: {
        ...state.storedPats,
        [provider]: null,
      },
      error: null,
    })),

  setRemoteCredentialStatus: (remoteName, status) =>
    set((state) => ({
      remoteCredentials: {
        ...state.remoteCredentials,
        [remoteName]: status,
      },
      error: null,
    })),

  setLoading: (loading) =>
    set(() => ({
      isLoading: loading,
    })),

  setError: (error) =>
    set(() => ({
      error,
      isLoading: false,
    })),

  clearCredentials: () =>
    set(() => ({
      ...initialState,
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
