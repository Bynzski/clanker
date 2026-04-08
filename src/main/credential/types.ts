/**
 * Type definitions for VCS credential management.
 * Supports SSH keys and Personal Access Tokens for GitHub, GitLab, and Bitbucket.
 */

import type { VcsProvider } from '../gitService';

export type { VcsProvider };

/**
 * SSH key configuration for a remote.
 */
export interface SshKeyConfig {
  /** Path to the private key file */
  privateKeyPath: string;
  /** Path to the public key file */
  publicKeyPath: string;
  /** Key type (e.g., 'ssh-ed25519', 'rsa') */
  keyType: string;
  /** Fingerprint for identification */
  fingerprint: string;
  /** When the key was generated */
  createdAt: string;
}

/**
 * Personal Access Token configuration for a provider.
 */
export interface PatConfig {
  /** Provider this PAT belongs to */
  provider: VcsProvider;
  /** Scope of the token (e.g., 'repo', 'workflow') */
  scope: string[];
  /** When the token was stored */
  storedAt: string;
  /** Whether the token has been validated */
  validated: boolean;
}

/**
 * Credential status for a remote repository.
 */
export interface CredentialStatus {
  /** Remote name (e.g., 'origin') */
  remoteName: string;
  /** Provider type */
  provider: VcsProvider;
  /** Whether an SSH key exists for this remote */
  hasSshKey: boolean;
  /** SSH key details if available */
  sshKey?: SshKeyConfig;
  /** Whether a PAT exists for this provider */
  hasPat: boolean;
  /** PAT details if available */
  pat?: PatConfig;
  /** Git credential helper in use */
  credentialHelper: string | null;
}

/**
 * Result of SSH key generation.
 */
export interface SshKeyGenerationResult {
  success: boolean;
  publicKey?: string;
  fingerprint?: string;
  error?: string;
}

/**
 * Result of credential save operation.
 */
export interface CredentialSaveResult {
  success: boolean;
  error?: string;
}

/**
 * Global credential store status.
 */
export interface GlobalCredentialStatus {
  /** Default SSH key location */
  defaultSshKeyPath: string;
  /** SSH key exists at default location */
  hasDefaultSshKey: boolean;
  /** Stored PATs by provider */
  storedPats: PatConfig[];
  /** Configured credential helpers by remote */
  credentialHelpers: Record<string, string>;
}

/**
 * Request to save a PAT.
 */
export interface SavePatRequest {
  provider: VcsProvider;
  token: string;
  scope?: string[];
}
