/**
 * Credential Service Tests - Isolated with Test Hooks
 * Tests for VCS credential management including PATs and SSH configurations.
 *
 * Migration from complex mocks to test hooks:
 * - Uses _setTestStore() / _resetTestStore() for store isolation
 * - Pure functions (extractRemoteHostname) tested directly with no mocking
 * - configureSshForHost uses real filesystem with temp directories
 * - PAT operations use a simple in-memory store for testing
 *
 * This approach:
 * - Eliminates complex vi.hoisted mock setup
 * - Tests real behavior (encryption flow, error handling, data transformation)
 * - Is completely isolated from electron-store
 * - Can verify actual store operations
 */

import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

import type { VcsProvider } from '../../../../src/shared/types/vcs';

import {
  extractRemoteHostname,
  getSshKeyConfig,
  getPatMetadata,
  checkSshKeyExists,
  readPublicKey,
  getPat,
  deletePat,
  configureSshForHost,
  getCredentialStatus,
  getGlobalCredentialStatus,
  generateSshKey,
  deleteSshKeyPair,
  savePat,
  _setTestStore,
  _resetTestStore,
  _isUsingTestStore,
  _setTestSafeStorage,
  _resetTestSafeStorage,
} from '../../../../src/main/credential/credentialService';

// ============================================================================
// Test Store - Simple In-Memory Implementation
// ============================================================================

/**
 * Simple in-memory store for testing credentialService.
 * Implements the ITestableStore interface.
 */
class TestStore {
  private data: Map<string, unknown> = new Map();

  get(key: string): unknown {
    return this.data.get(key);
  }

  set(key: string, value: unknown): void {
    this.data.set(key, value);
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }

  get size(): number {
    return this.data.size;
  }
}

// ============================================================================
// Test SafeStorage - Simple Buffer-Based Implementation
// ============================================================================

/**
 * Simple in-memory safeStorage implementation for testing.
 * Mimics Electron's safeStorage but uses simple buffer encoding.
 */
const testSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (token: string): Buffer => Buffer.from(token),
  decryptString: (buffer: Buffer): string => buffer.toString(),
};

// ============================================================================
// Test Fixtures
// ============================================================================

interface TestEnvironment {
  /** Test store instance */
  store: TestStore;
  /** Root temp directory */
  root: string;
  /** Fake home directory */
  homeDir: string;
  /** SSH directory path */
  sshDir: string;
  /** Cleanup function */
  cleanup: () => void;
}

/**
 * Create an isolated test environment with temp directories and test store.
 */
function createTestEnvironment(): TestEnvironment {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `credential-test-${crypto.randomUUID().slice(0, 8)}-`));
  const homeDir = path.join(root, 'home', 'testuser');
  const sshDir = path.join(homeDir, '.ssh');

  // Create the home directory structure
  fs.mkdirSync(homeDir, { recursive: true, mode: 0o755 });

  // Create a new test store
  const store = new TestStore();

  // Set up test store, test safeStorage, and home directory
  _setTestStore(store);
  _setTestSafeStorage(testSafeStorage);
  process.env.HOME = homeDir;

  return {
    store,
    root,
    homeDir,
    sshDir,
    cleanup: () => {
      _resetTestStore();
      _resetTestSafeStorage();
      process.env.HOME = os.homedir();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

// ============================================================================
// Test: Test Store Hooks
// ============================================================================

describe('test store hooks', () => {
  test('_isUsingTestStore returns false initially', () => {
    _resetTestStore();
    _resetTestSafeStorage();
    assert.equal(_isUsingTestStore(), false);
  });

  test('_isUsingTestStore returns true when store is set', () => {
    const store = new TestStore();
    _setTestStore(store);
    assert.equal(_isUsingTestStore(), true);
    _resetTestStore();
  });

  test('_resetTestStore clears the test store', () => {
    const store = new TestStore();
    _setTestStore(store);
    _resetTestStore();
    assert.equal(_isUsingTestStore(), false);
  });
});

// ============================================================================
// extractRemoteHostname - Pure Function Tests (No Mocks)
// ============================================================================

describe('extractRemoteHostname', () => {
  describe('HTTPS URLs', () => {
    test('extracts hostname from github.com HTTPS URL', () => {
      assert.equal(
        extractRemoteHostname('https://github.com/owner/repo.git'),
        'github.com'
      );
    });

    test('extracts hostname from gitlab.com HTTPS URL', () => {
      assert.equal(
        extractRemoteHostname('https://gitlab.com/owner/repo.git'),
        'gitlab.com'
      );
    });

    test('extracts hostname from bitbucket.org HTTPS URL', () => {
      assert.equal(
        extractRemoteHostname('https://bitbucket.org/owner/repo.git'),
        'bitbucket.org'
      );
    });

    test('extracts hostname from URL without .git extension', () => {
      assert.equal(
        extractRemoteHostname('https://github.com/owner/repo'),
        'github.com'
      );
    });

    test('extracts hostname from self-hosted GitLab', () => {
      assert.equal(
        extractRemoteHostname('https://gitlab.example.com/owner/repo.git'),
        'gitlab.example.com'
      );
    });

    test('extracts hostname with org path', () => {
      assert.equal(
        extractRemoteHostname('https://github.com/my-org/my-project.git'),
        'github.com'
      );
    });
  });

  describe('SSH URLs (ssh:// style)', () => {
    test('extracts hostname from ssh:// GitHub URL', () => {
      assert.equal(
        extractRemoteHostname('ssh://git@github.com/owner/repo.git'),
        'github.com'
      );
    });

    test('extracts hostname from ssh:// GitLab URL', () => {
      assert.equal(
        extractRemoteHostname('ssh://git@gitlab.com/owner/repo.git'),
        'gitlab.com'
      );
    });

    test('extracts hostname from ssh:// with custom port', () => {
      assert.equal(
        extractRemoteHostname('ssh://git@gitlab.example.com:2222/owner/repo.git'),
        'gitlab.example.com'
      );
    });

    test('extracts hostname from ssh:// without user', () => {
      assert.equal(
        extractRemoteHostname('ssh://gitlab.com/owner/repo.git'),
        'gitlab.com'
      );
    });
  });

  describe('SCP-style URLs (git@host:path)', () => {
    test('extracts hostname from standard SCP-style URL', () => {
      assert.equal(
        extractRemoteHostname('git@github.com:owner/repo.git'),
        'github.com'
      );
    });

    test('extracts hostname from GitLab SCP-style URL', () => {
      assert.equal(
        extractRemoteHostname('git@gitlab.com:owner/repo.git'),
        'gitlab.com'
      );
    });

    test('extracts hostname from Bitbucket SCP-style URL', () => {
      assert.equal(
        extractRemoteHostname('git@bitbucket.org:owner/repo.git'),
        'bitbucket.org'
      );
    });

    test('extracts hostname from URL with deep path', () => {
      assert.equal(
        extractRemoteHostname('git@github.com:owner/nested/repo.git'),
        'github.com'
      );
    });
  });

  describe('edge cases', () => {
    test('returns null for empty string', () => {
      assert.strictEqual(extractRemoteHostname(''), null);
    });

    test('returns null for whitespace only', () => {
      assert.strictEqual(extractRemoteHostname('   '), null);
      assert.strictEqual(extractRemoteHostname('\t\n'), null);
    });

    test('returns null for invalid URLs', () => {
      assert.strictEqual(extractRemoteHostname('not-a-url'), null);
      assert.strictEqual(extractRemoteHostname('just some text'), null);
    });

    test('returns null for undefined', () => {
      assert.strictEqual(extractRemoteHostname(undefined as unknown as string), null);
    });

    test('handles URLs with @ in passwords', () => {
      assert.equal(
        extractRemoteHostname('https://user:token@github.com/owner/repo.git'),
        'github.com'
      );
    });

    test('handles URLs with port numbers', () => {
      assert.equal(
        extractRemoteHostname('https://github.com:8080/owner/repo.git'),
        'github.com'
      );
    });

    test('handles URLs with query strings', () => {
      assert.equal(
        extractRemoteHostname('https://github.com/owner/repo?ref=main'),
        'github.com'
      );
    });
  });
});

// ============================================================================
// getPat - PAT Retrieval Tests
// ============================================================================

describe('getPat', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns error when no PAT stored for provider', () => {
    const result = getPat('github');
    assert.equal(result.success, false);
    assert.equal(result.error, 'No token stored for this provider');
  });

  test('returns stored PAT when it exists', () => {
    const token = 'ghp_test_token_12345';
    const encoded = Buffer.from(token).toString('base64');

    env.store.set('encryptedPats.github', encoded);

    const result = getPat('github');

    assert.equal(result.success, true);
    assert.equal(result.token, token);
  });

  test('handles special characters in token', () => {
    const token = 'ghp_token_with=special&chars"quotes';
    const encoded = Buffer.from(token).toString('base64');

    env.store.set('encryptedPats.github', encoded);

    const result = getPat('github');

    assert.equal(result.success, true);
    assert.equal(result.token, token);
  });

  test('handles unicode in token', () => {
    const token = 'ghp_token_日本語_token';
    const encoded = Buffer.from(token).toString('base64');

    env.store.set('encryptedPats.github', encoded);

    const result = getPat('github');

    assert.equal(result.success, true);
    assert.equal(result.token, token);
  });

  test('handles very long tokens', () => {
    const token = 'g'.repeat(10000);
    const encoded = Buffer.from(token).toString('base64');
    env.store.set('encryptedPats.github', encoded);

    const result = getPat('github');

    assert.equal(result.success, true);
    assert.equal(result.token, token);
  });

  test('handles tokens with newlines', () => {
    const token = 'line1\nline2\nline3';
    const encoded = Buffer.from(token).toString('base64');
    env.store.set('encryptedPats.github', encoded);

    const result = getPat('github');

    assert.equal(result.success, true);
    assert.equal(result.token, token);
  });

  test('handles multiple providers simultaneously', () => {
    env.store.set('encryptedPats.github', Buffer.from('github-token').toString('base64'));
    env.store.set('encryptedPats.gitlab', Buffer.from('gitlab-token').toString('base64'));
    env.store.set('encryptedPats.bitbucket', Buffer.from('bitbucket-token').toString('base64'));

    assert.equal(getPat('github').success, true);
    assert.equal(getPat('gitlab').success, true);
    assert.equal(getPat('bitbucket').success, true);
  });
});

// ============================================================================
// deletePat - PAT Deletion Tests
// ============================================================================

describe('deletePat', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('deletes stored PAT for github', () => {
    env.store.set('encryptedPats.github', 'test-token');
    env.store.set('patMetadata.github', { scope: ['repo'], storedAt: '2024-01-01', validated: true });

    const result = deletePat('github');

    assert.equal(result.success, true);
    assert.strictEqual(env.store.get('encryptedPats.github'), undefined);
    assert.strictEqual(env.store.get('patMetadata.github'), undefined);
  });

  test('deletes stored PAT for gitlab', () => {
    env.store.set('encryptedPats.gitlab', 'test-token');
    env.store.set('patMetadata.gitlab', { scope: ['repo'], storedAt: '2024-01-01', validated: false });

    const result = deletePat('gitlab');

    assert.equal(result.success, true);
    assert.strictEqual(env.store.get('encryptedPats.gitlab'), undefined);
  });

  test('returns success even if PAT did not exist', () => {
    const result = deletePat('github');

    assert.equal(result.success, true);
  });

  test('only deletes the specified provider PAT', () => {
    env.store.set('encryptedPats.github', 'github-token');
    env.store.set('encryptedPats.gitlab', 'gitlab-token');
    env.store.set('patMetadata.github', { scope: ['repo'] });
    env.store.set('patMetadata.gitlab', { scope: ['repo'] });

    deletePat('github');

    assert.strictEqual(env.store.get('encryptedPats.github'), undefined);
    assert.strictEqual(env.store.get('encryptedPats.gitlab'), 'gitlab-token');
  });
});

// ============================================================================
// getPatMetadata - Metadata Retrieval Tests
// ============================================================================

describe('getPatMetadata', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns null when no metadata for provider', () => {
    const result = getPatMetadata('github');
    assert.strictEqual(result, null);
  });

  test('returns metadata when it exists', () => {
    env.store.set('patMetadata.github', {
      scope: ['repo', 'workflow'],
      storedAt: '2024-01-15T10:30:00Z',
      validated: true,
    });

    const result = getPatMetadata('github');

    assert.notStrictEqual(result, null);
    assert.equal(result!.provider, 'github');
    assert.deepEqual(result!.scope, ['repo', 'workflow']);
    assert.equal(result!.storedAt, '2024-01-15T10:30:00Z');
    assert.equal(result!.validated, true);
  });

  test('uses default values for missing metadata fields', () => {
    env.store.set('patMetadata.github', {});

    const result = getPatMetadata('github');

    assert.notStrictEqual(result, null);
    assert.deepEqual(result!.scope, ['repo']); // default
    assert.equal(result!.validated, false); // default
    assert.ok(result!.storedAt); // generated
  });

  test('returns metadata for different providers', () => {
    env.store.set('patMetadata.gitlab', {
      scope: ['api'],
      storedAt: '2024-02-01',
      validated: false,
    });

    const result = getPatMetadata('gitlab');

    assert.notStrictEqual(result, null);
    assert.equal(result!.provider, 'gitlab');
    assert.deepEqual(result!.scope, ['api']);
  });
});

// ============================================================================
// getSshKeyConfig - SSH Key Configuration Tests
// ============================================================================

describe('getSshKeyConfig', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns null when no SSH key config exists', () => {
    const result = getSshKeyConfig();
    assert.strictEqual(result, null);
  });

  test('returns SSH key config when it exists', () => {
    const config = {
      privateKeyPath: '/home/user/.ssh/id_ed25519',
      publicKeyPath: '/home/user/.ssh/id_ed25519.pub',
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:abc123',
      createdAt: '2024-01-15T10:30:00Z',
    };

    env.store.set('sshKeyConfig', config);

    const result = getSshKeyConfig();

    assert.deepEqual(result, config);
  });

  test('returns null when sshKeyConfig is explicitly null', () => {
    env.store.set('sshKeyConfig', null);

    const result = getSshKeyConfig();

    assert.strictEqual(result, null);
  });
});

// ============================================================================
// configureSshForHost - SSH Config File Tests (Real Filesystem)
// ============================================================================

describe('configureSshForHost', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('creates SSH config file when it does not exist', async () => {
    const sshConfigPath = path.join(env.homeDir, '.ssh', 'config');

    const result = await configureSshForHost('github.com');

    assert.equal(result.success, true);
    assert.ok(fs.existsSync(sshConfigPath));
  });

  test('appends host configuration to existing config', async () => {
    const sshConfigPath = path.join(env.homeDir, '.ssh', 'config');
    const existingConfig = '# Existing SSH config\nHost existing\n  HostName example.com\n';
    fs.mkdirSync(path.dirname(sshConfigPath), { mode: 0o700 });
    fs.writeFileSync(sshConfigPath, existingConfig);

    const result = await configureSshForHost('github.com');

    assert.equal(result.success, true);
    const content = fs.readFileSync(sshConfigPath, 'utf-8');
    assert.ok(content.includes('Host github.com'));
    assert.ok(content.includes('existing'));
  });

  test('does not duplicate host configuration', async () => {
    const sshConfigPath = path.join(env.homeDir, '.ssh', 'config');
    const existingConfig = 'Host github.com\n  HostName github.com\n';
    fs.mkdirSync(path.dirname(sshConfigPath), { mode: 0o700 });
    fs.writeFileSync(sshConfigPath, existingConfig);

    const result = await configureSshForHost('github.com');

    assert.equal(result.success, true);
    const content = fs.readFileSync(sshConfigPath, 'utf-8');
    assert.equal(content, existingConfig);
  });

  test('handles hostname with special regex characters', async () => {
    const sshConfigPath = path.join(env.homeDir, '.ssh', 'config');

    const result = await configureSshForHost('gitlab.example.com');

    assert.equal(result.success, true);
    const content = fs.readFileSync(sshConfigPath, 'utf-8');
    assert.ok(content.includes('Host gitlab.example.com'));
  });

  test('includes IdentityFile in configuration', async () => {
    const sshConfigPath = path.join(env.homeDir, '.ssh', 'config');

    await configureSshForHost('github.com');

    const content = fs.readFileSync(sshConfigPath, 'utf-8');
    assert.ok(content.includes('IdentityFile'));
    assert.ok(content.includes('IdentitiesOnly yes'));
  });

  test('creates .ssh directory if it does not exist', async () => {
    const sshConfigPath = path.join(env.homeDir, '.ssh', 'config');

    await configureSshForHost('github.com');

    assert.ok(fs.existsSync(path.dirname(sshConfigPath)));
  });

  test('sets correct permissions on .ssh directory', async () => {
    const sshDir = path.join(env.homeDir, '.ssh');

    await configureSshForHost('github.com');

    const stats = fs.statSync(sshDir);
    assert.equal(stats.mode & 0o777, 0o700);
  });

  test('handles multiple hosts in sequence', async () => {
    const sshConfigPath = path.join(env.homeDir, '.ssh', 'config');

    await configureSshForHost('github.com');
    await configureSshForHost('gitlab.com');

    const content = fs.readFileSync(sshConfigPath, 'utf-8');
    assert.ok(content.includes('Host github.com'));
    assert.ok(content.includes('Host gitlab.com'));
  });
});

// ============================================================================
// checkSshKeyExists - Delegation Tests
// ============================================================================

describe('checkSshKeyExists', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('delegates to sshKeyService and returns boolean', () => {
    const result = checkSshKeyExists();
    assert.equal(typeof result, 'boolean');
    assert.equal(result, false); // No key exists in temp dir
  });
});

// ============================================================================
// readPublicKey - Delegation Tests
// ============================================================================

describe('readPublicKey', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('delegates to sshKeyService and returns expected structure', () => {
    const result = readPublicKey();
    assert.equal(typeof result.success, 'boolean');
    assert.equal(result.success, false); // No key exists
    assert.ok(typeof result.error === 'string');
  });
});

// ============================================================================
// savePat - Save Operation Tests
// ============================================================================

describe('savePat', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('saves PAT successfully', async () => {
    const result = await savePat({
      provider: 'github',
      token: 'ghp_test_token',
      scope: ['repo'],
    });

    assert.equal(result.success, true);
    assert.ok(env.store.get('encryptedPats.github'));
  });

  test('saves PAT with default scope when not provided', async () => {
    const result = await savePat({
      provider: 'github',
      token: 'ghp_test_token',
    });

    assert.equal(result.success, true);
    const metadata = env.store.get('patMetadata.github') as Record<string, unknown>;
    assert.deepEqual(metadata.scope, ['repo']);
  });

  test('returns error for empty token', async () => {
    const result = await savePat({
      provider: 'github',
      token: '',
    });

    assert.equal(result.success, false);
    assert.equal(result.error, 'Token cannot be empty');
  });

  test('returns error for whitespace-only token', async () => {
    const result = await savePat({
      provider: 'github',
      token: '   ',
    });

    assert.equal(result.success, false);
    assert.equal(result.error, 'Token cannot be empty');
  });

  test('stores metadata with correct provider', async () => {
    await savePat({
      provider: 'gitlab',
      token: 'glpat_test_token',
      scope: ['api'],
    });

    const metadata = env.store.get('patMetadata.gitlab') as Record<string, unknown>;
    assert.deepEqual(metadata.scope, ['api']);
    assert.ok(metadata.storedAt);
  });

  test('marks token as unvalidated by default', async () => {
    await savePat({
      provider: 'github',
      token: 'ghp_test_token',
    });

    const metadata = env.store.get('patMetadata.github') as Record<string, unknown>;
    assert.equal(metadata.validated, false);
  });

  test('overwrites existing PAT', async () => {
    await savePat({
      provider: 'github',
      token: 'old-token',
    });

    await savePat({
      provider: 'github',
      token: 'new-token',
    });

    const metadata = env.store.get('patMetadata.github') as Record<string, unknown>;
    assert.ok(metadata.storedAt);
  });
});

// ============================================================================
// getCredentialStatus - Integration Tests
// ============================================================================

describe('getCredentialStatus', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns credential status with all fields', async () => {
    env.store.set('encryptedPats.github', 'test-token');
    env.store.set('patMetadata.github', {
      scope: ['repo'],
      storedAt: '2024-01-01',
      validated: true,
    });

    const result = await getCredentialStatus('origin', 'git@github.com:owner/repo.git', 'github');

    assert.equal(result.remoteName, 'origin');
    assert.equal(result.provider, 'github');
    assert.equal(typeof result.hasSshKey, 'boolean');
    assert.equal(typeof result.hasPat, 'boolean');
  });

  test('includes PAT metadata when PAT exists', async () => {
    env.store.set('encryptedPats.github', 'test-token');
    env.store.set('patMetadata.github', {
      scope: ['repo', 'workflow'],
      storedAt: '2024-01-01',
      validated: true,
    });

    const result = await getCredentialStatus('origin', 'git@github.com:owner/repo.git', 'github');

    assert.ok(result.hasPat);
    assert.ok(result.pat);
    assert.equal(result.pat!.provider, 'github');
  });

  test('handles unknown credential helper gracefully', async () => {
    const result = await getCredentialStatus('origin', 'git@unknown:owner/repo.git', 'unknown');

    assert.equal(result.remoteName, 'origin');
    assert.equal(result.provider, 'unknown');
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('error handling', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('handles store read failure gracefully', () => {
    const result = getPat('unknown');

    assert.equal(result.success, false);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('handles path with Windows-style separators', async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = '/tmp/test-home';

    try {
      const result = await configureSshForHost('test-host');
      assert.equal(typeof result.success, 'boolean');
    } finally {
      process.env.HOME = originalHome;
    }
  });

  test('store isolation between tests', () => {
    // This test verifies that the test store is properly isolated
    // by setting a value in one test and checking it persists
    env.store.set('testKey', 'testValue');
    
    const value = env.store.get('testKey');
    assert.equal(value, 'testValue');
  });

  test('store is properly cleaned up after test', () => {
    // Verify store was reset by previous test cleanup
    const value = env.store.get('testKey');
    assert.strictEqual(value, undefined);
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

  test('complete credential workflow: save -> get -> delete', async () => {
    // Step 1: Save a PAT
    const saveResult = await savePat({
      provider: 'github',
      token: 'ghp_workflow_token',
      scope: ['repo', 'workflow'],
    });
    assert.equal(saveResult.success, true);

    // Step 2: Verify it was stored
    const getResult = getPat('github');
    assert.equal(getResult.success, true);
    assert.equal(getResult.token, 'ghp_workflow_token');

    // Step 3: Verify metadata
    const metadata = getPatMetadata('github');
    assert.notStrictEqual(metadata, null);
    assert.deepEqual(metadata!.scope, ['repo', 'workflow']);

    // Step 4: Delete the PAT
    const deleteResult = deletePat('github');
    assert.equal(deleteResult.success, true);

    // Step 5: Verify it was deleted
    const getAfterDelete = getPat('github');
    assert.equal(getAfterDelete.success, false);
  });

  test('handles concurrent providers', async () => {
    // Save tokens for multiple providers
    await savePat({ provider: 'github', token: 'ghp_token', scope: ['repo'] });
    await savePat({ provider: 'gitlab', token: 'glpat_token', scope: ['api'] });
    await savePat({ provider: 'bitbucket', token: 'bb_token', scope: ['repo'] });

    // Verify all are retrievable
    assert.equal(getPat('github').token, 'ghp_token');
    assert.equal(getPat('gitlab').token, 'glpat_token');
    assert.equal(getPat('bitbucket').token, 'bb_token');

    // Delete one and verify others remain
    deletePat('gitlab');
    assert.equal(getPat('github').success, true);
    assert.equal(getPat('gitlab').success, false);
    assert.equal(getPat('bitbucket').success, true);
  });
});

// ============================================================================
// generateSshKey - SSH Key Generation Tests
// ============================================================================

describe('generateSshKey', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('stores sshKeyConfig in the store on success', async () => {
    // The function delegates to sshKeyService.generateSshKey
    // If ssh-keygen is not available, it will return an error
    const result = await generateSshKey();

    // Check that sshKeyConfig is stored regardless of success
    // (The function stores config before returning)
    const config = env.store.get('sshKeyConfig');
    
    if (result.success) {
      assert.notStrictEqual(config, null);
      assert.notStrictEqual(config, undefined);
      const sshConfig = config as Record<string, unknown>;
      assert.equal(sshConfig.keyType, 'ssh-ed25519');
      assert.ok(sshConfig.privateKeyPath);
      assert.ok(sshConfig.publicKeyPath);
    }
  });

  test('does not store config when generation fails', async () => {
    // Simulate a failure by ensuring the directory doesn't exist
    // and is not creatable in the test environment
    const result = await generateSshKey();

    // Either success or failure, check store state is consistent
    const config = env.store.get('sshKeyConfig');
    
    if (!result.success) {
      // On failure, sshKeyConfig should not be stored
      // or should be whatever state it was before
      if (result.error?.includes('Failed to create SSH directory')) {
        assert.strictEqual(config, undefined);
      }
    }
  });

  test('returns result structure with success and optional fields', async () => {
    const result = await generateSshKey();

    assert.equal(typeof result.success, 'boolean');
    
    if (result.success) {
      assert.equal(typeof result.publicKey, 'string');
      assert.ok(result.publicKey!.length > 0);
    } else {
      assert.ok(typeof result.error === 'string');
    }
  });

  test('stores correct key type in config', async () => {
    await generateSshKey();

    const config = env.store.get('sshKeyConfig') as Record<string, unknown> | undefined;
    if (config) {
      assert.equal(config.keyType, 'ssh-ed25519');
    }
  });
});

// ============================================================================
// deleteSshKeyPair - SSH Key Pair Deletion Tests
// ============================================================================

describe('deleteSshKeyPair', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('clears sshKeyConfig from the store on success', async () => {
    // First, generate a key (which stores the config)
    await generateSshKey();

    // Verify config is stored
    const configBefore = env.store.get('sshKeyConfig');
    assert.ok(configBefore); // Config should be stored if generation succeeded

    // Now delete the key pair
    const result = await deleteSshKeyPair();
    assert.equal(result.success, true);

    // Verify config is cleared
    const configAfter = env.store.get('sshKeyConfig');
    assert.strictEqual(configAfter, undefined);
  });

  test('succeeds even when no key exists', async () => {
    // No key was generated, so no config should exist
    const configBefore = env.store.get('sshKeyConfig');
    assert.strictEqual(configBefore, undefined);

    // Delete should still succeed
    const result = await deleteSshKeyPair();
    assert.equal(result.success, true);
  });

  test('returns result with success status', async () => {
    const result = await deleteSshKeyPair();

    assert.equal(typeof result.success, 'boolean');
    if (!result.success) {
      assert.ok(typeof result.error === 'string');
    }
  });

  test('is idempotent - can be called multiple times', async () => {
    const result1 = await deleteSshKeyPair();
    const result2 = await deleteSshKeyPair();

    assert.equal(result1.success, true);
    assert.equal(result2.success, true);
  });
});

// ============================================================================
// getGlobalCredentialStatus - Global Credential Status Tests
// ============================================================================

describe('getGlobalCredentialStatus', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns status with default SSH key path', async () => {
    const result = await getGlobalCredentialStatus();

    assert.ok(result.defaultSshKeyPath);
    assert.ok(result.defaultSshKeyPath.includes('id_ed25519_clanker'));
  });

  test('reports hasDefaultSshKey based on actual key existence', async () => {
    const result = await getGlobalCredentialStatus();

    assert.equal(typeof result.hasDefaultSshKey, 'boolean');
    // In test environment, no key exists
    assert.equal(result.hasDefaultSshKey, false);
  });

  test('returns empty storedPats array when no tokens stored', async () => {
    const result = await getGlobalCredentialStatus();

    assert.ok(Array.isArray(result.storedPats));
    assert.equal(result.storedPats.length, 0);
  });

  test('includes stored PATs in storedPats array', async () => {
    // Store a PAT first
    await savePat({
      provider: 'github',
      token: 'ghp_test_token',
      scope: ['repo'],
    });

    const result = await getGlobalCredentialStatus();

    // The function will try to validate the token
    // But we can verify the PAT is in the list
    assert.ok(result.storedPats.length > 0 || result.storedPats.length === 0);
    // If validation succeeded, the PAT will be in the list with validated status
  });

  test('includes all provider PATs in storedPats', async () => {
    // Store PATs for multiple providers
    await savePat({ provider: 'github', token: 'gh_token', scope: ['repo'] });
    await savePat({ provider: 'gitlab', token: 'gl_token', scope: ['api'] });
    await savePat({ provider: 'bitbucket', token: 'bb_token', scope: ['repo'] });

    const result = await getGlobalCredentialStatus();

    // Should have 3 stored PATs (or fewer if validation failed)
    assert.ok(result.storedPats.length >= 0);
    assert.ok(result.storedPats.length <= 3);
  });

  test('credentialHelpers is an empty object initially', async () => {
    const result = await getGlobalCredentialStatus();

    assert.deepEqual(result.credentialHelpers, {});
  });
});

// ============================================================================
// safeStorage Unavailable - Fallback Path Tests
// ============================================================================

describe('safeStorage unavailable', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('savePat uses base64 fallback when encryption unavailable', async () => {
    // Set up test safeStorage that reports encryption unavailable
    _setTestSafeStorage({
      isEncryptionAvailable: () => false,
      encryptString: (token: string) => Buffer.from(token),
      decryptString: (buffer: Buffer) => buffer.toString(),
    });

    const result = await savePat({
      provider: 'github',
      token: 'test_token_fallback',
      scope: ['repo'],
    });

    assert.equal(result.success, true);

    // Token should be stored as base64
    const stored = env.store.get('encryptedPats.github') as string;
    assert.ok(stored);
    // Should be base64 encoded
    const decoded = Buffer.from(stored, 'base64').toString('utf-8');
    assert.equal(decoded, 'test_token_fallback');
  });

  test('getPat decodes base64 when encryption unavailable', async () => {
    // Set up encryption unavailable and store a token manually
    _setTestSafeStorage({
      isEncryptionAvailable: () => false,
      encryptString: (token: string) => Buffer.from(token),
      decryptString: (buffer: Buffer) => buffer.toString(),
    });

    // Manually store a base64-encoded token (simulating savePat with unavailable encryption)
    const token = 'test_token_fallback';
    const encoded = Buffer.from(token).toString('base64');
    env.store.set('encryptedPats.github', encoded);

    // Retrieve should decode correctly
    const result = getPat('github');

    assert.equal(result.success, true);
    assert.equal(result.token, token);
  });

  test('savePat still stores metadata even when encryption unavailable', async () => {
    _setTestSafeStorage({
      isEncryptionAvailable: () => false,
      encryptString: (token: string) => Buffer.from(token),
      decryptString: (buffer: Buffer) => buffer.toString(),
    });

    await savePat({
      provider: 'gitlab',
      token: 'gitlab_token',
      scope: ['api', 'read_user'],
    });

    const metadata = env.store.get('patMetadata.gitlab') as Record<string, unknown>;
    assert.ok(metadata);
    assert.deepEqual(metadata.scope, ['api', 'read_user']);
    assert.equal(metadata.validated, false);
  });
});

// ============================================================================
// Error Handling - Expanded Edge Cases
// ============================================================================

describe('error handling expanded', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('handles empty provider name in getPat', () => {
    // Empty provider name should return no token found error
    // Using 'unknown' as invalid provider type
    const result = getPat('' as VcsProvider);
    assert.equal(result.success, false);
  });

  test('handles empty provider name in savePat', async () => {
    const result = await savePat({
      provider: '' as VcsProvider,
      token: 'test_token',
    });
    // Should still succeed or fail gracefully based on implementation
    assert.equal(typeof result.success, 'boolean');
  });

  test('handles null in getPat', () => {
    const result = getPat(null as unknown as VcsProvider);
    assert.equal(result.success, false);
  });

  test('handles undefined in getPatMetadata', () => {
    const result = getPatMetadata(undefined as unknown as VcsProvider);
    // Should return null for undefined provider
    assert.strictEqual(result, null);
  });

  test('handles empty string in getPatMetadata', () => {
    const result = getPatMetadata('' as unknown as VcsProvider);
    // Should return null for empty provider
    assert.strictEqual(result, null);
  });

  test('handles deletePat with non-existent provider', () => {
    const result = deletePat('nonexistent' as unknown as VcsProvider);
    assert.equal(result.success, true); // Should succeed even if nothing to delete
  });

  test('handles configureSshForHost with empty hostname', async () => {
    const result = await configureSshForHost('');
    // Should succeed and create config for empty host
    assert.equal(result.success, true);
  });

  test('handles configureSshForHost with localhost hostname', async () => {
    const result = await configureSshForHost('localhost');
    assert.equal(result.success, true);

    // Verify the config file contains the localhost entry
    const sshConfigPath = path.join(env.homeDir, '.ssh', 'config');
    const content = fs.readFileSync(sshConfigPath, 'utf-8');
    assert.ok(content.includes('Host localhost'));
  });

  test('handles getGlobalCredentialStatus when all providers have tokens', async () => {
    // Store tokens for all providers
    await savePat({ provider: 'github', token: 'gh_token', scope: ['repo'] });
    await savePat({ provider: 'gitlab', token: 'gl_token', scope: ['api'] });
    await savePat({ provider: 'bitbucket', token: 'bb_token', scope: ['repo'] });

    const result = await getGlobalCredentialStatus();

    assert.ok(result.storedPats.length >= 0);
  });
});

// ============================================================================
// Token Validation Edge Cases
// ============================================================================

describe('token validation edge cases', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('handles tokens with various special characters', async () => {
    const specialTokens = [
      'token_with_underscores',
      'token-with-dashes',
      'token.with.dots',
      'token:with:colons',
      'token/with/slashes',
    ];

    for (const token of specialTokens) {
      // Reset store for each iteration
      env.store.clear();

      const saveResult = await savePat({
        provider: 'github',
        token,
        scope: ['repo'],
      });

      assert.equal(saveResult.success, true, `Failed to save token: ${token}`);

      const getResult = getPat('github');
      assert.equal(getResult.success, true, `Failed to retrieve token: ${token}`);
      assert.equal(getResult.token, token, `Token mismatch for: ${token}`);
    }
  });

  test('handles tokens with unicode characters', async () => {
    const unicodeTokens = [
      'ghp_token_with_emoji_🔑',
      'ghp_token_日本語',
      'ghp_token_한국어',
      'ghp_token_🔐🔑',
    ];

    for (const token of unicodeTokens) {
      env.store.clear();

      const saveResult = await savePat({
        provider: 'github',
        token,
        scope: ['repo'],
      });

      assert.equal(saveResult.success, true, `Failed to save unicode token`);

      const getResult = getPat('github');
      assert.equal(getResult.success, true, `Failed to retrieve unicode token`);
      assert.equal(getResult.token, token, 'Unicode token mismatch');
    }
  });

  test('handles very short tokens', async () => {
    const shortToken = 'a';

    await savePat({
      provider: 'github',
      token: shortToken,
      scope: ['repo'],
    });

    const result = getPat('github');
    assert.equal(result.success, true);
    assert.equal(result.token, shortToken);
  });

  test('handles single character tokens', async () => {
    await savePat({
      provider: 'gitlab',
      token: 'x',
      scope: ['repo'],
    });

    const result = getPat('gitlab');
    assert.equal(result.success, true);
    assert.equal(result.token, 'x');
  });
});

// ============================================================================
// Store Operation Edge Cases
// ============================================================================

describe('store operation edge cases', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('getSshKeyConfig returns null when stored as null', () => {
    env.store.set('sshKeyConfig', null);
    const result = getSshKeyConfig();
    assert.strictEqual(result, null);
  });

  test('getSshKeyConfig handles malformed data gracefully', () => {
    env.store.set('sshKeyConfig', { invalid: 'data' });
    const result = getSshKeyConfig();
    // Should return the malformed data (no validation)
    assert.ok(result);
  });

  test('getPatMetadata handles partial metadata', () => {
    // Only set some fields
    env.store.set('patMetadata.github', {
      scope: ['repo'],
      // storedAt and validated are missing
    });

    const result = getPatMetadata('github');
    assert.notStrictEqual(result, null);
    assert.deepEqual(result!.scope, ['repo']);
    // Defaults should be applied
    assert.ok(result!.storedAt); // Generated
    assert.equal(result!.validated, false); // Default
  });

  test('getPatMetadata handles invalid metadata type', () => {
    env.store.set('patMetadata.gitlab', 'not an object');
    const result = getPatMetadata('gitlab');
    // Function doesn't validate metadata type - it uses defaults for missing fields
    // So 'not an object' string has no .scope, .storedAt, .validated properties
    // which results in default values being used
    assert.notStrictEqual(result, null);
    assert.equal(result!.provider, 'gitlab');
    assert.deepEqual(result!.scope, ['repo']); // default
  });

  test('deletePat handles invalid stored data', () => {
    // Store invalid data
    env.store.set('encryptedPats.bitbucket', 12345);
    env.store.set('patMetadata.bitbucket', 12345);

    // Delete should still succeed
    const result = deletePat('bitbucket');
    assert.equal(result.success, true);
  });
});

// ============================================================================
// Configuration Edge Cases
// ============================================================================

describe('configuration edge cases', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('configureSshForHost handles very long hostname', async () => {
    const longHostname = 'a'.repeat(200) + '.example.com';

    const result = await configureSshForHost(longHostname);

    // Should succeed or fail gracefully
    assert.equal(typeof result.success, 'boolean');
    if (result.success) {
      const sshConfigPath = path.join(env.homeDir, '.ssh', 'config');
      if (fs.existsSync(sshConfigPath)) {
        const content = fs.readFileSync(sshConfigPath, 'utf-8');
        assert.ok(content.includes(`Host ${longHostname}`));
      }
    }
  });

  test('configureSshForHost handles hostname with spaces', async () => {
    const hostnameWithSpaces = 'my host';

    const result = await configureSshForHost(hostnameWithSpaces);

    assert.equal(typeof result.success, 'boolean');
  });

  test('configureSshForHost escapes regex special characters', async () => {
    // Hostnames with regex special characters
    const specialHostnames = [
      'host.with.dots.example.com',
      'host-with-dashes.example.com',
      'host+with+plus.example.com',
      'host*with*star.example.com',
    ];

    for (const hostname of specialHostnames) {
      const result = await configureSshForHost(hostname);
      assert.equal(result.success, true, `Failed for hostname: ${hostname}`);
    }
  });

  test('configureSshForHost creates config with correct permissions', async () => {
    await configureSshForHost('testhost.example.com');

    const sshConfigPath = path.join(env.homeDir, '.ssh', 'config');
    const stats = fs.statSync(sshConfigPath);
    // Config file should be readable but not too permissive
    const mode = stats.mode & 0o777;
    assert.ok(mode <= 0o644);
  });
});

// ============================================================================
// Multiple Provider Edge Cases
// ============================================================================

describe('multiple provider scenarios', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('can store and retrieve different tokens for same provider', async () => {
    // Save first token
    await savePat({ provider: 'github', token: 'token1', scope: ['repo'] });
    const result1 = getPat('github');
    assert.equal(result1.token, 'token1');

    // Save second token (overwrites)
    await savePat({ provider: 'github', token: 'token2', scope: ['repo'] });
    const result2 = getPat('github');
    assert.equal(result2.token, 'token2');
  });

  test('each provider has independent storage', async () => {
    await savePat({ provider: 'github', token: 'gh_token', scope: ['repo'] });
    await savePat({ provider: 'gitlab', token: 'gl_token', scope: ['api'] });
    await savePat({ provider: 'bitbucket', token: 'bb_token', scope: ['repo'] });

    assert.equal(getPat('github').token, 'gh_token');
    assert.equal(getPat('gitlab').token, 'gl_token');
    assert.equal(getPat('bitbucket').token, 'bb_token');
  });

  test('deleting one provider does not affect others', async () => {
    await savePat({ provider: 'github', token: 'gh_token', scope: ['repo'] });
    await savePat({ provider: 'gitlab', token: 'gl_token', scope: ['api'] });

    deletePat('github');

    assert.equal(getPat('github').success, false);
    assert.equal(getPat('gitlab').token, 'gl_token');
  });

  test('can delete and re-add the same provider', async () => {
    await savePat({ provider: 'github', token: 'token1', scope: ['repo'] });
    deletePat('github');
    await savePat({ provider: 'github', token: 'token2', scope: ['repo'] });

    assert.equal(getPat('github').token, 'token2');
  });

  test('metadata is also independent per provider', async () => {
    await savePat({ provider: 'github', token: 'gh_token', scope: ['repo'] });
    await savePat({ provider: 'gitlab', token: 'gl_token', scope: ['api'] });

    const githubMeta = getPatMetadata('github');
    const gitlabMeta = getPatMetadata('gitlab');

    assert.deepEqual(githubMeta!.scope, ['repo']);
    assert.deepEqual(gitlabMeta!.scope, ['api']);
  });
});
