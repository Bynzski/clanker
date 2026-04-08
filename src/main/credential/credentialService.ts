/**
 * Credential Service
 * Manages VCS credentials including SSH keys and Personal Access Tokens.
 * Uses Electron's safeStorage for encrypted PAT storage.
 */

import * as fs from 'fs';
import * as path from 'path';
import { safeStorage } from 'electron';
import Store from 'electron-store';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  CredentialStatus,
  CredentialSaveResult,
  GlobalCredentialStatus,
  PatConfig,
  SavePatRequest,
  SshKeyConfig,
} from './types';
import type { VcsProvider } from '../gitService';
import {
  deleteSshKey,
  getDefaultSshKeyPaths,
  generateSshKey as generateSshKeyInternal,
  readPublicKey as readPublicKeyInternal,
  sshKeyExists,
} from './sshKeyService';

const execFileAsync = promisify(execFile);

/**
 * Store schema for encrypted credentials.
 */
interface CredentialStoreSchema {
  /** Encrypted PATs by provider */
  encryptedPats: Record<string, string>; // provider -> encrypted token
  /** PAT metadata (unencrypted) */
  patMetadata: Record<string, Omit<PatConfig, 'provider'>>;
  /** SSH key configuration */
  sshKeyConfig: SshKeyConfig | null;
}

const credentialStore = new Store<CredentialStoreSchema>({
  name: 'vcs-credentials',
  encryptionKey: 'clanker-grid-vcs', // Additional encryption layer
});

/**
 * Get the global SSH config file path.
 */
function getSshConfigPath(): string {
  return path.join(process.env.HOME || process.env.USERPROFILE || '', '.ssh', 'config');
}

/**
 * Try to extract the hostname from a Git remote URL or SCP-style remote.
 */
export function extractRemoteHostname(remoteUrl?: string): string | null {
  if (!remoteUrl) {
    return null;
  }

  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.hostname || null;
  } catch {
    const scpMatch = trimmed.match(/@([^:/]+)[/:]/);
    if (scpMatch) {
      return scpMatch[1];
    }
    return null;
  }
}

/**
 * Detect the git credential helper for a given remote.
 */
async function detectCredentialHelper(remoteUrl?: string): Promise<string | null> {
  try {
    const hostname = extractRemoteHostname(remoteUrl);
    const args = hostname
      ? ['config', '--get', `credential.${hostname}.helper`]
      : ['config', '--get', 'credential.helper'];

    const { stdout } = await execFileAsync('git', args);
    const helper = stdout.trim();
    return helper.length > 0 ? helper : null;
  } catch {
    // No credential helper configured
    return null;
  }
}

/**
 * Save a Personal Access Token for a provider.
 */
export async function savePat(request: SavePatRequest): Promise<CredentialSaveResult> {
  const { provider, token, scope } = request;

  if (!token || token.trim().length === 0) {
    return { success: false, error: 'Token cannot be empty' };
  }

  try {
    // Check if safeStorage is available
    if (!safeStorage.isEncryptionAvailable()) {
      // Fallback: store with basic obfuscation (not secure, but functional)
      console.warn('safeStorage not available, using basic storage');
      const encoded = Buffer.from(token).toString('base64');
      credentialStore.set(`encryptedPats.${provider}`, encoded);
    } else {
      // Encrypt and store
      const encrypted = safeStorage.encryptString(token);
      credentialStore.set(`encryptedPats.${provider}`, encrypted.toString('base64'));
    }

    // Store metadata
    credentialStore.set(`patMetadata.${provider}`, {
      scope: scope || ['repo'],
      storedAt: new Date().toISOString(),
      validated: false,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save PAT';
    return { success: false, error: message };
  }
}

/**
 * Retrieve a stored PAT for a provider.
 */
export function getPat(provider: VcsProvider): { success: boolean; token?: string; error?: string } {
  try {
    const encrypted = credentialStore.get(`encryptedPats.${provider}`) as string | undefined;
    if (!encrypted) {
      return { success: false, error: 'No token stored for this provider' };
    }

    let token: string;
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(encrypted, 'base64');
      token = safeStorage.decryptString(buffer);
    } else {
      // Fallback decoding
      token = Buffer.from(encrypted, 'base64').toString('utf-8');
    }

    return { success: true, token };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve PAT';
    return { success: false, error: message };
  }
}

/**
 * Delete a stored PAT for a provider.
 */
export function deletePat(provider: VcsProvider): CredentialSaveResult {
  try {
    credentialStore.delete(`encryptedPats.${provider}` as any);
    credentialStore.delete(`patMetadata.${provider}` as any);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete PAT';
    return { success: false, error: message };
  }
}

/**
 * Get PAT metadata for a provider.
 */
export function getPatMetadata(provider: VcsProvider): PatConfig | null {
  const metadata = credentialStore.get(`patMetadata.${provider}`) as {
    scope?: string[];
    storedAt?: string;
    validated?: boolean;
  } | undefined;
  if (!metadata) {
    return null;
  }

  return {
    provider,
    scope: metadata.scope || ['repo'],
    storedAt: metadata.storedAt || new Date().toISOString(),
    validated: metadata.validated || false,
  };
}

/**
 * Generate an SSH key for VCS use.
 */
export async function generateSshKey(): Promise<{
  success: boolean;
  publicKey?: string;
  fingerprint?: string;
  error?: string;
}> {
  const result = await generateSshKeyInternal();

  if (result.success && result.publicKey) {
    // Store key metadata
    const { privateKeyPath, publicKeyPath } = getDefaultSshKeyPaths();
    credentialStore.set('sshKeyConfig', {
      privateKeyPath,
      publicKeyPath,
      keyType: 'ssh-ed25519',
      fingerprint: result.fingerprint || '',
      createdAt: new Date().toISOString(),
    });
  }

  return result;
}

/**
 * Read the public SSH key.
 */
export function readPublicKey(): { success: boolean; publicKey?: string; error?: string } {
  return readPublicKeyInternal();
}

/**
 * Check if SSH key exists.
 */
export function checkSshKeyExists(): boolean {
  return sshKeyExists();
}

/**
 * Get SSH key configuration.
 */
export function getSshKeyConfig(): SshKeyConfig | null {
  return credentialStore.get('sshKeyConfig') || null;
}

/**
 * Delete the SSH key pair.
 */
export async function deleteSshKeyPair(): Promise<CredentialSaveResult> {
  const result = await deleteSshKey();
  if (result.success) {
    credentialStore.delete('sshKeyConfig');
  }
  return result;
}

/**
 * Get credential status for a remote.
 */
export async function getCredentialStatus(
  remoteName: string,
  remoteUrl: string,
  provider: VcsProvider
): Promise<CredentialStatus> {
  const credentialHelper = await detectCredentialHelper(remoteUrl);
  const hasSshKey = sshKeyExists();
  const sshKeyConfig = hasSshKey ? getSshKeyConfig() : undefined;
  const hasPat = !!credentialStore.get(`encryptedPats.${provider}`);
  const patMetadata = getPatMetadata(provider);

  return {
    remoteName,
    provider,
    hasSshKey,
    sshKey: sshKeyConfig || undefined,
    hasPat,
    pat: patMetadata || undefined,
    credentialHelper,
  };
}

/**
 * Get global credential status.
 */
export function getGlobalCredentialStatus(): GlobalCredentialStatus {
  const { privateKeyPath } = getDefaultSshKeyPaths();

  // Collect stored PATs
  const storedPats: PatConfig[] = [];
  const providers: VcsProvider[] = ['github', 'gitlab', 'bitbucket'];

  for (const provider of providers) {
    const metadata = getPatMetadata(provider);
    if (metadata) {
      storedPats.push(metadata);
    }
  }

  return {
    defaultSshKeyPath: privateKeyPath,
    hasDefaultSshKey: sshKeyExists(),
    storedPats,
    credentialHelpers: {}, // Populated per-remote
  };
}

/**
 * Configure SSH to use the generated key for a specific host.
 */
export async function configureSshForHost(hostname: string): Promise<CredentialSaveResult> {
  const { privateKeyPath } = getDefaultSshKeyPaths();
  const sshConfigPath = getSshConfigPath();

  // Check if config file exists
  let configContent = '';
  if (fs.existsSync(sshConfigPath)) {
    configContent = fs.readFileSync(sshConfigPath, 'utf-8');
  }

  // Check if host already configured
  const hostPattern = new RegExp(`^Host\\s+${hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
  if (hostPattern.test(configContent)) {
    return { success: true }; // Already configured
  }

  // Append host configuration
  const newConfig = `
Host ${hostname}
  IdentityFile ${privateKeyPath}
  IdentitiesOnly yes
`;

  try {
    // Ensure .ssh directory exists
    const sshDir = path.dirname(sshConfigPath);
    if (!fs.existsSync(sshDir)) {
      fs.mkdirSync(sshDir, { mode: 0o700 });
    }

    fs.appendFileSync(sshConfigPath, newConfig);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to configure SSH';
    return { success: false, error: message };
  }
}
