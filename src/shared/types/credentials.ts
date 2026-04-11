/**
 * Shared Credential types used by both main and renderer.
 * These types define the contract for credential IPC operations.
 */

import type { VcsProvider } from './vcs';

export interface CredentialOperationResult {
  success: boolean;
  error?: string;
}

export interface SshKeyGenerationResult {
  success: boolean;
  publicKey?: string;
  fingerprint?: string;
  error?: string;
}

export interface PublicKeyResult {
  success: boolean;
  publicKey?: string;
  fingerprint?: string;
  error?: string;
}

export interface PatResult {
  success: boolean;
  token?: string;
  error?: string;
}

export interface SshKeyConfig {
  privateKeyPath: string;
  publicKeyPath: string;
  keyType: string;
  fingerprint: string;
  createdAt: string;
}

export interface StoredPat {
  provider: string;
  scope: string[];
  storedAt: string;
  validated: boolean;
}

export interface CredentialStatusResult {
  remoteName: string;
  provider: VcsProvider;
  hasSshKey: boolean;
  hasPat: boolean;
  credentialHelper: string | null;
}

export interface GlobalCredentialStatusResult {
  defaultSshKeyPath: string;
  hasDefaultSshKey: boolean;
  storedPats: StoredPat[];
  credentialHelpers: Record<string, string>;
}
