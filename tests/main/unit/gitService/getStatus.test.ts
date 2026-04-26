/**
 * Git Service - getStatus Real Behavior Tests
 * 
 * Tests for the getStatus function using real git repositories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitService } from '../../../../src/main/gitService';
import type { GitStatusResult } from '../../../../src/main/gitService';
import {
  createTempGitRepo,
  createTempGitRepoWithRemote,
  createFile,
  modifyFile,
  deleteFile,
  commit,
  git,
} from '../../../../tests/setup/gitTestHelpers';

const execFileAsync = promisify(execFile);

interface TempRepo {
  path: string;
  cleanup: () => void;
}

// ============================================================================
// Test Setup
// ============================================================================

let repo: TempRepo | null = null;
let service: GitService;
let emittedStatuses: GitStatusResult[] = [];

function resetService() {
  emittedStatuses = [];
  service = new GitService((status) => {
    emittedStatuses.push(status);
  });
}

beforeEach(() => {
  resetService();
});

afterEach(() => {
  if (repo) {
    repo.cleanup();
    repo = null;
  }
});

// ============================================================================
// Happy Path Tests
// ============================================================================

describe('getStatus - happy path with real git', () => {
  it('returns status with modified files', async () => {
    repo = await createTempGitRepo({ initialFiles: { 'README.md': '# Test' } });
    
    // Modify a file
    await modifyFile(repo.path, 'README.md', '# Test\nModified content');
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.isRepo).toBe(true);
    expect(result.currentBranch).toBe('main');
    expect(result.isDetached).toBe(false);
    expect(result.changes.some(c => c.path === 'README.md' && c.status === 'modified')).toBe(true);
  });

  it('returns status with staged changes', async () => {
    repo = await createTempGitRepo({ initialFiles: { 'README.md': '# Test' } });
    
    // Modify and stage
    await modifyFile(repo.path, 'README.md', '# Modified');
    await git(repo.path, ['add', 'README.md']);
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.changes.some(c => c.path === 'README.md' && c.staged === true)).toBe(true);
  });

  it('returns status with new untracked files', async () => {
    repo = await createTempGitRepo({});
    
    // Create new untracked file
    await createFile(repo.path, 'new-file.txt', 'new content');
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.changes.some(c => c.path === 'new-file.txt' && c.status === 'untracked')).toBe(true);
  });

  it('returns status with deleted files', async () => {
    repo = await createTempGitRepo({ initialFiles: { 'file.txt': 'content', 'deleted.txt': 'to be deleted' } });
    
    // Delete a file
    await deleteFile(repo.path, 'deleted.txt');
    await git(repo.path, ['add', 'deleted.txt']);
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.changes.some(c => c.path === 'deleted.txt' && c.status === 'deleted')).toBe(true);
  });

  it('returns status with renamed files', async () => {
    repo = await createTempGitRepo({ initialFiles: { 'old-name.txt': 'content' } });
    
    // Rename using git mv
    await git(repo.path, ['mv', 'old-name.txt', 'new-name.txt']);
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.changes.some(c => c.path === 'new-name.txt' && c.status === 'renamed')).toBe(true);
  });

  it('returns correct branch information', async () => {
    repo = await createTempGitRepo({});
    
    // Create a new branch
    await git(repo.path, ['checkout', '-b', 'feature-branch']);
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.currentBranch).toBe('feature-branch');
    expect(result.isDetached).toBe(false);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('getStatus - edge cases with real git', () => {
  it('handles detached HEAD state correctly', async () => {
    repo = await createTempGitRepo({});
    
    // Get the commit hash and checkout to create detached HEAD
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo.path });
    await git(repo.path, ['checkout', stdout.trim()]);
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.isDetached).toBe(true);
    expect(result.currentBranch).toBeNull();
  });

  it('handles initial repo with no commits', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-empty-test-'));
    try {
      // Initialize repo but don't commit. Use an explicit branch name so the
      // test does not depend on the runner's global init.defaultBranch setting.
      await execFileAsync('git', ['init', '--initial-branch', 'main'], { cwd: tempDir });
      await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir });
      await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: tempDir });
      
      // Create a file and add it but don't commit
      fs.writeFileSync(path.join(tempDir, 'uncommitted.txt'), 'content');
      await execFileAsync('git', ['add', '.'], { cwd: tempDir });
      
      repo = { path: tempDir, cleanup: () => {} };
      
      const result = await service.getStatus(repo.path);
      
      expect(result.success).toBe(true);
      expect(result.isRepo).toBe(true);
      expect(result.currentBranch).toBe('main');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('handles repo with only staged changes (no working tree changes)', async () => {
    repo = await createTempGitRepo({});
    
    // Create and fully commit, then add new file and stage it
    await createFile(repo.path, 'staged.txt', 'staged content');
    await git(repo.path, ['add', 'staged.txt']);
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.changes.some(c => c.path === 'staged.txt' && c.staged === true)).toBe(true);
  });

  it('handles files with special characters in names', async () => {
    repo = await createTempGitRepo({});
    
    // Create files with various names
    await createFile(repo.path, 'file-with-dashes.txt', 'content');
    await createFile(repo.path, 'file_with_underscores.txt', 'content');
    await git(repo.path, ['add', '-A']);
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.changes.some(c => c.path === 'file-with-dashes.txt')).toBe(true);
    expect(result.changes.some(c => c.path === 'file_with_underscores.txt')).toBe(true);
  });

  it('handles deeply nested directory structures', async () => {
    repo = await createTempGitRepo({});
    
    // Create deeply nested structure
    const deepPath = 'a/b/c/d/e/nested-file.txt';
    await createFile(repo.path, deepPath, 'deep content');
    await git(repo.path, ['add', '-A']);
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.changes.some(c => c.path === deepPath)).toBe(true);
  });

  it('handles binary files', async () => {
    repo = await createTempGitRepo({});
    
    // Create a binary file
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
    const binaryPath = path.join(repo.path, 'binary.bin');
    fs.writeFileSync(binaryPath, binaryContent);
    await git(repo.path, ['add', 'binary.bin']);
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.changes.some(c => c.path === 'binary.bin' && c.status === 'added')).toBe(true);
  });

  it('handles large file content', async () => {
    repo = await createTempGitRepo({});
    
    // Create a large file
    const largeContent = 'x'.repeat(100000);
    await createFile(repo.path, 'large.txt', largeContent);
    await git(repo.path, ['add', '-A']);
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.changes.some(c => c.path === 'large.txt')).toBe(true);
  });
});

// ============================================================================
// Failure Handling
// ============================================================================

describe('getStatus - failure handling with real git', () => {
  it('returns not-a-repo for non-git directory', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    try {
      repo = { path: tempDir, cleanup: () => {} };
      
      const result = await service.getStatus(repo.path);
      
      expect(result.success).toBe(false);
      expect(result.isRepo).toBe(false);
      expect(result.errorCode).toBe('not-a-repo');
      expect(result.error).toBeTruthy();
      expect(result.changes).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns error for non-existent path', async () => {
    const result = await service.getStatus('/non/existent/path');
    
    expect(result.success).toBe(false);
    expect(result.isRepo).toBe(false);
    // Either 'git-not-found' (git not installed/path issue) or 'not-a-repo'
    expect(['git-not-found', 'not-a-repo']).toContain(result.errorCode);
  });

  it('returns error for directory without git repo', async () => {
    // Create a normal directory without git initialization
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
    try {
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'content');
      repo = { path: tempDir, cleanup: () => {} };
      
      const result = await service.getStatus(repo.path);
      
      // Should fail with not-a-repo since there's no git directory
      expect(result.success).toBe(false);
      expect(result.isRepo).toBe(false);
      expect(result.errorCode).toBe('not-a-repo');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Upstream Tracking
// ============================================================================

describe('getStatus - upstream tracking with real git', () => {
  it('returns ahead/behind counts with tracking branch', async () => {
    const { local } = await createTempGitRepoWithRemote({});
    repo = local;
    
    // Push to remote
    await git(repo.path, ['push', '-u', 'origin', 'main']);
    
    // Make a commit locally
    await createFile(repo.path, 'local-change.txt', 'local change');
    await commit(repo.path, 'Local commit');
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.upstream).toContain('origin/main');
    expect(result.ahead).toBeGreaterThanOrEqual(1);
    
    repo.cleanup();
    repo = null;
  });

  it('returns zero ahead/behind when in sync with remote', async () => {
    const { local } = await createTempGitRepoWithRemote({});
    repo = local;
    
    await git(repo.path, ['push', '-u', 'origin', 'main']);
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.upstream).toContain('origin/main');
    expect(result.ahead).toBe(0);
    expect(result.behind).toBe(0);
    
    repo.cleanup();
    repo = null;
  });

  it('returns null upstream when no remote configured', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.getStatus(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.upstream).toBeNull();
    expect(result.ahead).toBe(0);
    expect(result.behind).toBe(0);
  });
});

// ============================================================================
// Result Structure Verification
// ============================================================================

describe('getStatus - result structure verification', () => {
  it('returns complete result structure on success', async () => {
    repo = await createTempGitRepo({});
    await createFile(repo.path, 'test.txt', 'content');
    
    const result = await service.getStatus(repo.path);
    
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('isRepo');
    expect(result).toHaveProperty('currentBranch');
    expect(result).toHaveProperty('isDetached');
    expect(result).toHaveProperty('changes');
    expect(result).toHaveProperty('upstream');
    expect(result).toHaveProperty('ahead');
    expect(result).toHaveProperty('behind');
    
    // Success should not have error fields
    expect(result.errorCode).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('returns complete result structure on failure', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fail-test-'));
    try {
      repo = { path: tempDir, cleanup: () => {} };
      
      const result = await service.getStatus(repo.path);
      
      expect(result.success).toBe(false);
      expect(result.errorCode).toBeDefined();
      expect(result.error).toBeDefined();
      expect(result.changes).toEqual([]);
      expect(result.upstream).toBeNull();
      expect(result.ahead).toBe(0);
      expect(result.behind).toBe(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('changes array entries have correct structure', async () => {
    repo = await createTempGitRepo({});
    await createFile(repo.path, 'modified.txt', 'changed');
    await git(repo.path, ['add', '-A']);
    
    const result = await service.getStatus(repo.path);
    
    for (const change of result.changes) {
      expect(change).toHaveProperty('path');
      expect(change).toHaveProperty('status');
      expect(change).toHaveProperty('staged');
      expect(typeof change.path).toBe('string');
      expect(['modified', 'added', 'deleted', 'untracked', 'renamed']).toContain(change.status);
      expect(typeof change.staged).toBe('boolean');
    }
  });
});

// ============================================================================
// Regression Tests
// ============================================================================

describe('getStatus - regression tests for original bugs', () => {
  it('correctly parses unstaged modification without trim corruption', async () => {
    repo = await createTempGitRepo({});
    
    // Create a file and modify it without staging
    await createFile(repo.path, 'unstaged.txt', 'unstaged content');
    await createFile(repo.path, 'staged.txt', 'staged content');
    await git(repo.path, ['add', 'staged.txt']);
    
    const result = await service.getStatus(repo.path);
    
    // Both files should be detected
    expect(result.changes.length).toBe(2);
    
    // Unstaged file should have staged: false
    const unstaged = result.changes.find(c => c.path === 'unstaged.txt');
    expect(unstaged).toBeDefined();
    expect(unstaged!.staged).toBe(false);
    
    // Staged file should have staged: true
    const staged = result.changes.find(c => c.path === 'staged.txt');
    expect(staged).toBeDefined();
    expect(staged!.staged).toBe(true);
  });

  it('correctly parses renamed files with tab separator', async () => {
    repo = await createTempGitRepo({});
    
    // Create a file and rename it using git mv
    await createFile(repo.path, 'original.txt', 'content');
    await git(repo.path, ['add', 'original.txt']);
    await commit(repo.path, 'Add original');
    await git(repo.path, ['mv', 'original.txt', 'renamed.txt']);
    
    const result = await service.getStatus(repo.path);
    
    expect(result.changes.some(c => c.path === 'renamed.txt' && c.status === 'renamed')).toBe(true);
  });
});

// ============================================================================
// Cleanup Verification
// ============================================================================

describe('getStatus - cleanup and resource handling', () => {
  it('handles multiple sequential operations', async () => {
    repo = await createTempGitRepo({});
    
    // Multiple operations in sequence
    const result1 = await service.getStatus(repo.path);
    expect(result1.success).toBe(true);
    
    await createFile(repo.path, 'file1.txt', 'content1');
    await git(repo.path, ['add', 'file1.txt']);
    
    const result2 = await service.getStatus(repo.path);
    expect(result2.success).toBe(true);
    expect(result2.changes.length).toBeGreaterThan(result1.changes.length);
    
    await commit(repo.path, 'Add file1');
    
    const result3 = await service.getStatus(repo.path);
    expect(result3.success).toBe(true);
    expect(result3.changes.length).toBe(0);
  });

  it('handles repo being deleted mid-operation gracefully', async () => {
    repo = await createTempGitRepo({});
    
    // Delete the repo while service is using it
    const originalPath = repo.path;
    
    // First call should succeed
    const result1 = await service.getStatus(originalPath);
    expect(result1.success).toBe(true);
    
    // Clean up the repo
    repo.cleanup();
    fs.rmSync(originalPath, { recursive: true, force: true });
    
    // Second call should fail gracefully
    const result2 = await service.getStatus(originalPath);
    expect(result2.success).toBe(false);
    expect(result2.error).toBeTruthy();
    
    repo = null; // Prevent afterEach from trying to clean up again
  });
});
