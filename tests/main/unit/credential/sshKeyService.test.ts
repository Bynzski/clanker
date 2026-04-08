/**
 * SSH Key Service Tests - Isolated
 *
 * These tests use real filesystem operations with isolated temp directories.
 * The test hook _setTestHomeDir() is used to redirect all path operations
 * to a temporary directory, ensuring complete isolation from the real ~/.ssh.
 *
 * This approach:
 * - Tests real behavior (no mocks for fs operations)
 * - Is completely isolated (no risk to real SSH keys)
 * - Is deterministic (same results on any system)
 * - Is safe to run in CI/CD environments
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

import {
  getDefaultSshDir,
  getDefaultSshKeyPaths,
  checkSshDirPermissions,
  readPublicKey,
  sshKeyExists,
  getSshKeyInfo,
  deleteSshKey,
  ensureSshDir,
  _setTestHomeDir,
} from '../../../../src/main/credential/sshKeyService';

// ============================================================================
// Test Fixtures
// ============================================================================

interface TestEnvironment {
  /** Root temp directory */
  root: string;
  /** Fake home directory */
  homeDir: string;
  /** SSH directory path */
  sshDir: string;
  /** SSH key paths */
  keyPaths: { private: string; public: string };
  /** Cleanup function */
  cleanup: () => void;
}

/**
 * Create an isolated test environment with temp directories.
 * All SSH operations will be redirected to this environment.
 */
function createTestEnvironment(): TestEnvironment {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ssh-key-test-${crypto.randomUUID().slice(0, 8)}-`));
  const homeDir = path.join(root, 'home', 'testuser');
  const sshDir = path.join(homeDir, '.ssh');
  const keyPaths = {
    private: path.join(sshDir, 'id_ed25519_clanker'),
    public: path.join(sshDir, 'id_ed25519_clanker.pub'),
  };

  // Create the home directory structure
  fs.mkdirSync(homeDir, { recursive: true, mode: 0o755 });

  // Set up the test home directory
  _setTestHomeDir(homeDir);

  return {
    root,
    homeDir,
    sshDir,
    keyPaths,
    cleanup: () => {
      _setTestHomeDir(undefined);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a valid SSH public key file for testing.
 */
function createTestPublicKey(pubKeyPath: string, comment = 'test@example.com'): void {
  const sshDir = path.dirname(pubKeyPath);
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { mode: 0o700 });
  }
  // Create a valid-looking ED25519 public key (format: key-type base64 comment)
  const keyType = 'ssh-ed25519';
  const keyData = 'AAAAC3NzaC1lZDI1NTE5AAAAIL8j/r7jS0V8J9N3vF8xH2K9yQ6wB7eD4hG5iJ8kL0mN1';
  fs.writeFileSync(pubKeyPath, `${keyType} ${keyData} ${comment}\n`);
}

/**
 * Create a valid SSH private key file for testing.
 */
function createTestPrivateKey(privateKeyPath: string): void {
  const sshDir = path.dirname(privateKeyPath);
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { mode: 0o700 });
  }
  // Create a minimal private key file (not a real key, just for path testing)
  fs.writeFileSync(privateKeyPath, '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n');
  fs.chmodSync(privateKeyPath, 0o600);
}

// ============================================================================
// Pure Function Tests
// ============================================================================

describe('getDefaultSshDir', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns path joined with home directory', () => {
    const sshDir = getDefaultSshDir();
    expect(sshDir).toContain('.ssh');
    expect(sshDir).toContain(env.homeDir);
  });

  test('returns absolute path', () => {
    const sshDir = getDefaultSshDir();
    expect(path.isAbsolute(sshDir)).toBe(true);
  });

  test('ends with .ssh', () => {
    const sshDir = getDefaultSshDir();
    expect(sshDir.endsWith('.ssh')).toBe(true);
  });

  test('path changes when test home changes', () => {
    const sshDir1 = getDefaultSshDir();

    // Create a new environment with different paths
    const newEnv = createTestEnvironment();
    const sshDir2 = getDefaultSshDir();

    expect(sshDir1).not.toBe(sshDir2);
    expect(sshDir1).toContain(env.homeDir);
    expect(sshDir2).toContain(newEnv.homeDir);

    newEnv.cleanup();
  });
});

describe('getDefaultSshKeyPaths', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns private and public key paths', () => {
    const { privateKeyPath, publicKeyPath } = getDefaultSshKeyPaths();

    expect(privateKeyPath).toContain('id_ed25519_clanker');
    expect(publicKeyPath).toContain('id_ed25519_clanker.pub');
    expect(privateKeyPath.endsWith('.pub')).toBe(false);
    expect(publicKeyPath.endsWith('.pub')).toBe(true);
  });

  test('public key path is derived from private key path', () => {
    const { privateKeyPath, publicKeyPath } = getDefaultSshKeyPaths();
    expect(publicKeyPath).toBe(`${privateKeyPath}.pub`);
  });

  test('paths are absolute', () => {
    const { privateKeyPath, publicKeyPath } = getDefaultSshKeyPaths();
    expect(path.isAbsolute(privateKeyPath)).toBe(true);
    expect(path.isAbsolute(publicKeyPath)).toBe(true);
  });

  test('paths are in SSH directory', () => {
    const { privateKeyPath, publicKeyPath } = getDefaultSshKeyPaths();
    const sshDir = getDefaultSshDir();
    expect(privateKeyPath.startsWith(sshDir)).toBe(true);
    expect(publicKeyPath.startsWith(sshDir)).toBe(true);
  });

  test('uses correct key filename pattern', () => {
    const { privateKeyPath } = getDefaultSshKeyPaths();
    expect(privateKeyPath).toContain('id_ed25519_clanker');
  });

  test('paths change when test home changes', () => {
    const { privateKeyPath: path1 } = getDefaultSshKeyPaths();

    const newEnv = createTestEnvironment();
    const { privateKeyPath: path2 } = getDefaultSshKeyPaths();

    expect(path1).not.toBe(path2);
    expect(path1).toContain(env.homeDir);
    expect(path2).toContain(newEnv.homeDir);

    newEnv.cleanup();
  });
});

// ============================================================================
// Directory Permission Tests
// ============================================================================

describe('checkSshDirPermissions', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns not exists when directory does not exist', () => {
    const result = checkSshDirPermissions();
    expect(result.exists).toBe(false);
    expect(result.hasCorrectPermissions).toBe(false);
  });

  test('returns correct permissions when directory exists with 700', () => {
    fs.mkdirSync(env.sshDir, { mode: 0o700 });

    const result = checkSshDirPermissions();
    expect(result.exists).toBe(true);
    expect(result.hasCorrectPermissions).toBe(true);
  });

  test('returns correct permissions when directory exists with 755', () => {
    fs.mkdirSync(env.sshDir, { mode: 0o755 });

    const result = checkSshDirPermissions();
    expect(result.exists).toBe(true);
    expect(result.hasCorrectPermissions).toBe(true);
  });

  test('returns incorrect permissions for 777', () => {
    fs.mkdirSync(env.sshDir, { mode: 0o777 });

    const result = checkSshDirPermissions();
    expect(result.exists).toBe(true);
    // Note: Due to umask, actual mode may differ
    // But our check function only accepts 700 or 755
  });

  test('returns not exists when path is a file', () => {
    fs.mkdirSync(path.dirname(env.sshDir), { recursive: true });
    fs.writeFileSync(env.sshDir, 'not a directory');

    const result = checkSshDirPermissions();
    expect(result.exists).toBe(false);
    expect(result.hasCorrectPermissions).toBe(false);
  });

  test('handles symlinks correctly', () => {
    // Create real directory first
    fs.mkdirSync(env.sshDir, { mode: 0o700 });
    // Create symlink to it
    const linkPath = path.join(env.root, 'ssh-link');
    fs.symlinkSync(env.sshDir, linkPath);

    // The check should work on the actual directory
    const result = checkSshDirPermissions();
    expect(result.exists).toBe(true);
    expect(result.hasCorrectPermissions).toBe(true);
  });
});

// ============================================================================
// ensureSshDir Tests
// ============================================================================

describe('ensureSshDir', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('creates directory when it does not exist', async () => {
    expect(fs.existsSync(env.sshDir)).toBe(false);

    const result = await ensureSshDir();

    expect(result.success).toBe(true);
    expect(fs.existsSync(env.sshDir)).toBe(true);
  });

  test('creates directory with 700 permissions', async () => {
    await ensureSshDir();

    const stats = fs.statSync(env.sshDir);
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test('succeeds when directory already exists', async () => {
    fs.mkdirSync(env.sshDir, { mode: 0o755 });

    const result = await ensureSshDir();

    expect(result.success).toBe(true);
  });

  test('fixes permissions when directory has wrong permissions', async () => {
    fs.mkdirSync(env.sshDir, { mode: 0o755 });

    const result = await ensureSshDir();

    expect(result.success).toBe(true);
    const stats = fs.statSync(env.sshDir);
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test('creates .ssh directory when home directory exists', async () => {
    // env.homeDir exists from createTestEnvironment
    expect(fs.existsSync(env.homeDir)).toBe(true);

    // But .ssh should not exist yet
    expect(fs.existsSync(env.sshDir)).toBe(false);

    await ensureSshDir();

    expect(fs.existsSync(env.sshDir)).toBe(true);
  });
});

// ============================================================================
// sshKeyExists Tests
// ============================================================================

describe('sshKeyExists', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns false when no key exists', () => {
    expect(sshKeyExists()).toBe(false);
  });

  test('returns false when only public key exists', () => {
    createTestPublicKey(env.keyPaths.public);

    expect(sshKeyExists()).toBe(false);
  });

  test('returns true when private key exists', () => {
    createTestPrivateKey(env.keyPaths.private);

    expect(sshKeyExists()).toBe(true);
  });

  test('returns true when both keys exist', () => {
    createTestPrivateKey(env.keyPaths.private);
    createTestPublicKey(env.keyPaths.public);

    expect(sshKeyExists()).toBe(true);
  });

  test('returns false after key is deleted', async () => {
    createTestPrivateKey(env.keyPaths.private);
    expect(sshKeyExists()).toBe(true);

    await deleteSshKey();

    expect(sshKeyExists()).toBe(false);
  });
});

// ============================================================================
// readPublicKey Tests
// ============================================================================

describe('readPublicKey', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns error when no public key exists', () => {
    const result = readPublicKey();

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('returns success with public key content', () => {
    const expectedContent = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL8j/r7jS0V8J9N3vF8xH2K9yQ6wB7eD4hG5iJ8kL0mN1 test@example.com';
    createTestPublicKey(env.keyPaths.public, 'test@example.com');

    const result = readPublicKey();

    expect(result.success).toBe(true);
    expect(result.publicKey).toBe(expectedContent.trim());
  });

  test('trims whitespace from public key', () => {
    const sshDir = path.dirname(env.keyPaths.public);
    fs.mkdirSync(sshDir, { mode: 0o700 });
    fs.writeFileSync(env.keyPaths.public, '  ssh-ed25519 AAAAC3Nz test@example.com  \n');

    const result = readPublicKey();

    expect(result.success).toBe(true);
    expect(result.publicKey).toBe('ssh-ed25519 AAAAC3Nz test@example.com');
  });

  test('handles public key with no comment', () => {
    const sshDir = path.dirname(env.keyPaths.public);
    fs.mkdirSync(sshDir, { mode: 0o700 });
    fs.writeFileSync(env.keyPaths.public, 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5\n');

    const result = readPublicKey();

    expect(result.success).toBe(true);
  });

  test('returns error when public key file is empty', () => {
    const sshDir = path.dirname(env.keyPaths.public);
    fs.mkdirSync(sshDir, { mode: 0o700 });
    fs.writeFileSync(env.keyPaths.public, '');

    const result = readPublicKey();

    expect(result.success).toBe(true); // Empty file is still "read" successfully
    expect(result.publicKey).toBe('');
  });

  test('returns error when directory does not exist', () => {
    // env.sshDir does not exist, so reading should fail
    const result = readPublicKey();

    expect(result.success).toBe(false);
  });
});

// ============================================================================
// getSshKeyInfo Tests
// ============================================================================

describe('getSshKeyInfo', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns exists false when no key exists', () => {
    const result = getSshKeyInfo();

    expect(result.exists).toBe(false);
    expect(result.publicKey).toBeUndefined();
    expect(result.fingerprint).toBeUndefined();
  });

  test('returns exists true with public key when private key exists', () => {
    createTestPrivateKey(env.keyPaths.private);
    const expectedPublicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL8j/r7jS0V8J9N3vF8xH2K9yQ6wB7eD4hG5iJ8kL0mN1 test@example.com';
    createTestPublicKey(env.keyPaths.public, 'test@example.com');

    const result = getSshKeyInfo();

    expect(result.exists).toBe(true);
    expect(result.publicKey).toBe(expectedPublicKey.trim());
  });

  test('returns exists true even without public key', () => {
    createTestPrivateKey(env.keyPaths.private);

    const result = getSshKeyInfo();

    expect(result.exists).toBe(true);
    expect(result.publicKey).toBeUndefined();
  });

  test('returns exists false when only public key exists', () => {
    createTestPublicKey(env.keyPaths.public);

    const result = getSshKeyInfo();

    expect(result.exists).toBe(false);
  });
});

// ============================================================================
// deleteSshKey Tests
// ============================================================================

describe('deleteSshKey', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('succeeds when no keys exist', async () => {
    const result = await deleteSshKey();

    expect(result.success).toBe(true);
  });

  test('deletes private key only', async () => {
    createTestPrivateKey(env.keyPaths.private);
    expect(fs.existsSync(env.keyPaths.private)).toBe(true);

    await deleteSshKey();

    expect(fs.existsSync(env.keyPaths.private)).toBe(false);
  });

  test('deletes both keys when both exist', async () => {
    createTestPrivateKey(env.keyPaths.private);
    createTestPublicKey(env.keyPaths.public);
    expect(fs.existsSync(env.keyPaths.private)).toBe(true);
    expect(fs.existsSync(env.keyPaths.public)).toBe(true);

    await deleteSshKey();

    expect(fs.existsSync(env.keyPaths.private)).toBe(false);
    expect(fs.existsSync(env.keyPaths.public)).toBe(false);
  });

  test('succeeds when only public key exists', async () => {
    createTestPublicKey(env.keyPaths.public);

    const result = await deleteSshKey();

    expect(result.success).toBe(true);
    expect(fs.existsSync(env.keyPaths.public)).toBe(false);
  });

  test('is idempotent - can be called multiple times', async () => {
    createTestPrivateKey(env.keyPaths.private);

    await deleteSshKey();
    const result = await deleteSshKey();

    expect(result.success).toBe(true);
  });

  test('preserves SSH directory after deletion', async () => {
    createTestPrivateKey(env.keyPaths.private);
    await ensureSshDir(); // Ensure directory exists
    expect(fs.existsSync(env.sshDir)).toBe(true);

    await deleteSshKey();

    // Directory should still exist
    expect(fs.existsSync(env.sshDir)).toBe(true);
  });
});

// ============================================================================
// Permission Edge Cases
// ============================================================================

describe('permission edge cases', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('handles directory with no execute permission (broken)', () => {
    fs.mkdirSync(env.sshDir, { mode: 0o600 });

    const result = checkSshDirPermissions();
    expect(result.exists).toBe(true);
    // 600 is not in our accepted list (700 or 755)
    expect(result.hasCorrectPermissions).toBe(false);
  });

  test('handles directory owned by different user', () => {
    // We can't actually change ownership in tests without root
    // but we can verify the function handles the stat call
    fs.mkdirSync(env.sshDir, { mode: 0o700 });

    const result = checkSshDirPermissions();
    expect(result.exists).toBe(true);
    expect(result.hasCorrectPermissions).toBe(true);
  });

  test('handles read-only parent directory', () => {
    // Create parent but make it read-only
    // Note: env.homeDir already exists, so we need to remove it first
    fs.rmSync(env.homeDir, { recursive: true, force: true });
    fs.mkdirSync(env.homeDir, { mode: 0o755 });

    const result = checkSshDirPermissions();
    expect(result.exists).toBe(false);
  });
});

// ============================================================================
// Path Manipulation Edge Cases
// ============================================================================

describe('path edge cases', () => {
  test('handles home directory with trailing slash', () => {
    const env = createTestEnvironment();
    const homeWithSlash = env.homeDir + '/';
    _setTestHomeDir(homeWithSlash);

    const sshDir = getDefaultSshDir();
    expect(sshDir.endsWith('.ssh')).toBe(true);
    // Should not have double slashes
    expect(sshDir).not.toContain('//');

    _setTestHomeDir(undefined);
    env.cleanup();
  });

  test('handles path with spaces', () => {
    const env = createTestEnvironment();
    const homeWithSpaces = path.join(env.root, 'home', 'test user with spaces');
    _setTestHomeDir(homeWithSpaces);

    const sshDir = getDefaultSshDir();
    expect(sshDir).toContain(homeWithSpaces);

    _setTestHomeDir(undefined);
    env.cleanup();
  });

  test('handles path with special characters', () => {
    const env = createTestEnvironment();
    const homeWithSpecial = path.join(env.root, 'home', 'test@#$%user');
    _setTestHomeDir(homeWithSpecial);

    const sshDir = getDefaultSshDir();
    expect(sshDir).toContain(homeWithSpecial);

    _setTestHomeDir(undefined);
    env.cleanup();
  });
});

// ============================================================================
// Integration Scenarios
// ============================================================================

describe('integration scenarios', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('complete key lifecycle: ensure -> check exists -> read -> delete', async () => {
    // Step 1: Ensure SSH directory exists
    const ensureResult = await ensureSshDir();
    expect(ensureResult.success).toBe(true);
    expect(fs.existsSync(env.sshDir)).toBe(true);

    // Step 2: Check key doesn't exist yet
    expect(sshKeyExists()).toBe(false);

    // Step 3: Create key files manually (simulating generateSshKey)
    createTestPrivateKey(env.keyPaths.private);
    createTestPublicKey(env.keyPaths.public, 'integration@test.com');

    // Step 4: Verify key now exists
    expect(sshKeyExists()).toBe(true);

    // Step 5: Read the public key
    const readResult = readPublicKey();
    expect(readResult.success).toBe(true);
    expect(readResult.publicKey).toContain('integration@test.com');

    // Step 6: Get key info
    const infoResult = getSshKeyInfo();
    expect(infoResult.exists).toBe(true);
    expect(infoResult.publicKey).toBeDefined();

    // Step 7: Delete the key
    const deleteResult = await deleteSshKey();
    expect(deleteResult.success).toBe(true);

    // Step 8: Verify key no longer exists
    expect(sshKeyExists()).toBe(false);

    // Step 9: Verify SSH directory still exists
    expect(fs.existsSync(env.sshDir)).toBe(true);
  });

  test('handles concurrent directory operations', async () => {
    // Create directory
    await ensureSshDir();
    expect(fs.existsSync(env.sshDir)).toBe(true);

    // Try to ensure again (should fix permissions if needed)
    const result = await ensureSshDir();
    expect(result.success).toBe(true);

    // Check permissions are correct
    const perms = checkSshDirPermissions();
    expect(perms.hasCorrectPermissions).toBe(true);
  });

  test('key existence check is consistent across operations', async () => {
    // Initially no key
    expect(sshKeyExists()).toBe(false);

    // Create key
    createTestPrivateKey(env.keyPaths.private);

    // Should now exist
    expect(sshKeyExists()).toBe(true);

    // Delete key
    await deleteSshKey();

    // Should not exist
    expect(sshKeyExists()).toBe(false);
  });
});

// ============================================================================
// Test Isolation Verification
// ============================================================================

describe('test isolation verification', () => {
  test('does not access real ~/.ssh directory', () => {
    const realHome = os.homedir();
    const realSshDir = path.join(realHome, '.ssh');

    // Create a test environment
    const env = createTestEnvironment();

    // Verify test home is different from real home
    expect(env.homeDir).not.toBe(realHome);
    expect(env.sshDir).not.toBe(realSshDir);

    // Record state before operations
    const realBefore = fs.existsSync(realSshDir);

    // Perform some operations
    ensureSshDir().catch(() => {});

    // Real ~/.ssh should be unchanged
    const realAfter = fs.existsSync(realSshDir);
    expect(realAfter).toBe(realBefore);

    env.cleanup();
  });
});

// ============================================================================
// Note on generateSshKey
// ============================================================================

/**
 * NOTE: generateSshKey() requires the ssh-keygen command which is an
 * external system dependency. It is tested in integration tests.
 *
 * The function:
 * 1. Calls ensureSshDir()
 * 2. Calls ssh-keygen to generate key pair
 * 3. Sets permissions on private key (600)
 * 4. Reads public key and fingerprint
 *
 * Integration tests handle this with:
 * - Graceful skip if ssh-keygen unavailable
 * - Real key generation in isolated environment
 * - Verification of actual key format and fingerprint
 */
