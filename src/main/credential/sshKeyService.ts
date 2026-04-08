/**
 * SSH Key Service
 * Handles generation, validation, and management of SSH keys for VCS authentication.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import type { SshKeyGenerationResult } from './types';

const execFileAsync = promisify(execFile);

// ============================================================================
// Test Hook for Path Isolation
// ============================================================================

/**
 * Internal state for test isolation.
 * This allows tests to override the home directory without modifying the real system.
 */
let _testHomeDir: string | undefined;

/**
 * Get the home directory, allowing test override.
 * @internal - Only for testing purposes
 */
function _getHomeDir(): string {
  return _testHomeDir ?? os.homedir();
}

/**
 * Set a test home directory for isolated testing.
 * @param homeDir - The home directory to use (e.g., a temp directory)
 * @internal - Only for testing purposes
 */
export function _setTestHomeDir(homeDir: string | undefined): void {
  _testHomeDir = homeDir;
}

/**
 * Get the default SSH key directory for the current platform.
 */
export function getDefaultSshDir(): string {
  return path.join(_getHomeDir(), '.ssh');
}

/**
 * Get the default SSH key paths.
 */
export function getDefaultSshKeyPaths(): { privateKeyPath: string; publicKeyPath: string } {
  const sshDir = getDefaultSshDir();
  return {
    privateKeyPath: path.join(sshDir, 'id_ed25519_clanker'),
    publicKeyPath: path.join(sshDir, 'id_ed25519_clanker.pub'),
  };
}

/**
 * Check if the default SSH directory exists and has correct permissions.
 * On Unix, SSH keys should be 600 for private and 644 for public.
 */
export function checkSshDirPermissions(): { exists: boolean; hasCorrectPermissions: boolean } {
  const sshDir = getDefaultSshDir();

  try {
    const stats = fs.statSync(sshDir);
    if (!stats.isDirectory()) {
      return { exists: false, hasCorrectPermissions: false };
    }

    // Check if permissions are reasonable (700 or 755 for directory)
    const mode = stats.mode & 0o777;
    const hasCorrectPermissions = mode === 0o700 || mode === 0o755;

    return { exists: true, hasCorrectPermissions };
  } catch {
    return { exists: false, hasCorrectPermissions: false };
  }
}

/**
 * Ensure the SSH directory exists with correct permissions.
 */
export async function ensureSshDir(): Promise<{ success: boolean; error?: string }> {
  const sshDir = getDefaultSshDir();

  try {
    if (!fs.existsSync(sshDir)) {
      // Create directory with 700 permissions
      fs.mkdirSync(sshDir, { mode: 0o700 });
    } else {
      // Ensure correct permissions
      fs.chmodSync(sshDir, 0o700);
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create SSH directory';
    return { success: false, error: message };
  }
}

/**
 * Generate an ED25519 SSH key pair for use with VCS providers.
 */
export async function generateSshKey(
  comment?: string
): Promise<SshKeyGenerationResult> {
  const { privateKeyPath, publicKeyPath } = getDefaultSshKeyPaths();
  const sshDirResult = await ensureSshDir();
  if (!sshDirResult.success) {
    return { success: false, error: sshDirResult.error };
  }

  // Check if key already exists
  if (fs.existsSync(privateKeyPath)) {
    return {
      success: false,
      error: `SSH key already exists at ${privateKeyPath}. Remove it first if you want to regenerate.`,
    };
  }

  const keyComment = comment || `clanker-grid-${os.userInfo().username}`;

  try {
    // Generate key using ssh-keygen
    await execFileAsync(
      'ssh-keygen',
      [
        '-t', 'ed25519',
        '-f', privateKeyPath,
        '-N', '', // No passphrase for automated use
        '-C', keyComment,
      ],
      { timeout: 30000 }
    );

    // Set correct permissions on private key (600)
    fs.chmodSync(privateKeyPath, 0o600);

    // Read the public key for return value
    const publicKey = fs.readFileSync(publicKeyPath, 'utf-8').trim();

    // Get fingerprint
    const { stdout: fingerprint } = await execFileAsync('ssh-keygen', [
      '-lf',
      publicKeyPath,
    ]);

    return {
      success: true,
      publicKey,
      fingerprint: fingerprint.trim(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate SSH key';
    return { success: false, error: message };
  }
}

/**
 * Read the public key from the default location.
 */
export function readPublicKey(): { success: boolean; publicKey?: string; error?: string } {
  const { publicKeyPath } = getDefaultSshKeyPaths();

  try {
    if (!fs.existsSync(publicKeyPath)) {
      return { success: false, error: 'Public key not found. Generate an SSH key first.' };
    }

    const publicKey = fs.readFileSync(publicKeyPath, 'utf-8').trim();
    return { success: true, publicKey };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read public key';
    return { success: false, error: message };
  }
}

/**
 * Check if an SSH key exists at the default location.
 */
export function sshKeyExists(): boolean {
  const { privateKeyPath } = getDefaultSshKeyPaths();
  return fs.existsSync(privateKeyPath);
}

/**
 * Get information about the existing SSH key.
 */
export function getSshKeyInfo(): { exists: boolean; fingerprint?: string; publicKey?: string } {
  const { privateKeyPath, publicKeyPath } = getDefaultSshKeyPaths();

  if (!fs.existsSync(privateKeyPath)) {
    return { exists: false };
  }

  try {
    const publicKey = fs.existsSync(publicKeyPath)
      ? fs.readFileSync(publicKeyPath, 'utf-8').trim()
      : undefined;

    // Fingerprint requires async call, which is not available in sync context
    // Return without fingerprint for sync version
    return { exists: true, publicKey };
  } catch {
    return { exists: false };
  }
}

/**
 * Delete the SSH key pair.
 */
export async function deleteSshKey(): Promise<{ success: boolean; error?: string }> {
  const { privateKeyPath, publicKeyPath } = getDefaultSshKeyPaths();

  try {
    if (fs.existsSync(privateKeyPath)) {
      fs.unlinkSync(privateKeyPath);
    }
    if (fs.existsSync(publicKeyPath)) {
      fs.unlinkSync(publicKeyPath);
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete SSH key';
    return { success: false, error: message };
  }
}
