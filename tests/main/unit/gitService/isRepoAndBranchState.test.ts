/**
 * Git Service - isRepo and getBranchState Real Behavior Tests
 * 
 * Tests for the isRepo and getBranchState functions using real git repositories.
 * These are fundamental functions used throughout the gitService.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitService } from '../../../../src/main/gitService';
import {
  createTempGitRepo,
  git,
} from '../../../../tests/setup/gitTestHelpers';

interface TempRepo {
  path: string;
  cleanup: () => Promise<void>;
}

// ============================================================================
// Test Setup
// ============================================================================

let repo: TempRepo | null = null;
let service: GitService;

function resetService() {
  service = new GitService(() => {});
}

beforeEach(() => {
  resetService();
});

afterEach(async () => {
  if (repo) {
    await repo.cleanup();
    repo = null;
  }
});

// ============================================================================
// isRepo - Happy Path Tests
// ============================================================================

describe('isRepo - happy path with real git', () => {
  it('returns true for a valid git repository', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    const result = await service.isRepo(repo.path);

    expect(result).toBe(true);
  });

  it('returns true for a repository with commits', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Add another commit
    await git(repo.path, ['commit', '--allow-empty', '-m', 'Second commit']);

    const result = await service.isRepo(repo.path);

    expect(result).toBe(true);
  });

  it('returns true for a bare repository', async () => {
    // Create a bare repository
    const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-bare-'));
    await git(bareDir, ['init', '--bare', '--initial-branch', 'main']);

    const result = await service.isRepo(bareDir);

    // Cleanup
    fs.rmSync(bareDir, { recursive: true, force: true });

    expect(result).toBe(true);
  });
});

// ============================================================================
// isRepo - Edge Cases
// ============================================================================

describe('isRepo - edge cases with real git', () => {
  it('returns false for an empty directory', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));

    try {
      const result = await service.isRepo(emptyDir);
      expect(result).toBe(false);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('returns false for a directory with only non-git files', async () => {
    // Create a plain directory with no git repo anywhere in the path
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-'));
    fs.mkdirSync(path.join(plainDir, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(plainDir, 'subdir', 'readme.txt'), 'readme');

    const subDir = path.join(plainDir, 'subdir');
    const result = await service.isRepo(subDir);

    // Cleanup
    fs.rmSync(plainDir, { recursive: true, force: true });

    expect(result).toBe(false);
  });

  it('returns false when .git directory is removed', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Remove .git directory
    fs.rmSync(path.join(repo.path, '.git'), { recursive: true, force: true });

    const result = await service.isRepo(repo.path);

    expect(result).toBe(false);
  });

  it('returns false for a file path', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    const filePath = path.join(repo.path, 'file.ts');

    const result = await service.isRepo(filePath);

    expect(result).toBe(false);
  });

  it('returns false for a non-existent path', async () => {
    const nonExistent = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());

    const result = await service.isRepo(nonExistent);

    expect(result).toBe(false);
  });
});

// ============================================================================
// isRepo - Failure Handling
// ============================================================================

describe('isRepo - failure handling with real git', () => {
  it('handles permission denied gracefully', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Make .git directory unreadable (if running as root, this may not work)
    const gitDir = path.join(repo.path, '.git');
    try {
      fs.chmodSync(gitDir, 0o000);
      const result = await service.isRepo(repo.path);
      // May return false or throw depending on system
      expect(typeof result).toBe('boolean');
    } catch {
      // Permission errors are acceptable
    } finally {
      // Restore permissions for cleanup
      try {
        fs.chmodSync(gitDir, 0o755);
      } catch {
        // Ignore
      }
    }
  });
});

// ============================================================================
// getBranchState - Happy Path Tests
// ============================================================================

describe('getBranchState - happy path with real git', () => {
  it('returns full branch state for a repository', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    const result = await service.getBranchState(repo.path);

    expect(result.success).toBe(true);
    expect(result.isRepo).toBe(true);
    expect(result.currentBranch).toBeTruthy();
    expect(result.isDetached).toBe(false);
    expect(Array.isArray(result.branches)).toBe(true);
  });

  it('returns correct current branch', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    const result = await service.getBranchState(repo.path);

    expect(result.success).toBe(true);
    expect(result.currentBranch).toBe('main');
  });

  it('returns list of all branches', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Create additional branches
    await git(repo.path, ['branch', 'feature']);
    await git(repo.path, ['branch', 'bugfix']);

    const result = await service.getBranchState(repo.path);

    expect(result.success).toBe(true);
    expect(result.branches.length).toBeGreaterThanOrEqual(3);
    expect(result.branches.some(b => b.name === 'main')).toBe(true);
    expect(result.branches.some(b => b.name === 'feature')).toBe(true);
    expect(result.branches.some(b => b.name === 'bugfix')).toBe(true);
  });

  it('marks current branch correctly', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Create and switch to a feature branch
    await git(repo.path, ['checkout', '-b', 'feature']);

    const result = await service.getBranchState(repo.path);

    expect(result.success).toBe(true);
    expect(result.currentBranch).toBe('feature');
    const currentBranch = result.branches.find(b => b.isCurrent);
    expect(currentBranch).toBeTruthy();
    expect(currentBranch?.name).toBe('feature');
  });
});

// ============================================================================
// getBranchState - Edge Cases
// ============================================================================

describe('getBranchState - edge cases with real git', () => {
  it('returns error for non-git directory', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));

    try {
      const result = await service.getBranchState(emptyDir);

      expect(result.success).toBe(false);
      expect(result.isRepo).toBe(false);
      expect(result.branches).toEqual([]);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('returns error when .git directory is removed', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Remove .git directory
    fs.rmSync(path.join(repo.path, '.git'), { recursive: true, force: true });

    const result = await service.getBranchState(repo.path);

    expect(result.success).toBe(false);
    expect(result.isRepo).toBe(false);
    expect(result.branches).toEqual([]);
  });

  it('handles detached HEAD state', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Create second commit
    await git(repo.path, ['commit', '--allow-empty', '-m', 'Second commit']);

    // Get commit hash and checkout to create detached HEAD
    const result = await git(repo.path, ['rev-parse', 'HEAD']);
    const commitHash = result.stdout.trim();
    await git(repo.path, ['checkout', commitHash]);

    const branchState = await service.getBranchState(repo.path);

    expect(branchState.success).toBe(true);
    expect(branchState.isDetached).toBe(true);
    expect(branchState.currentBranch).toBeNull();
  });

  it('handles repository with only one branch', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    const result = await service.getBranchState(repo.path);

    expect(result.success).toBe(true);
    expect(result.branches.length).toBe(1);
    expect(result.branches[0].name).toBe('main');
    expect(result.branches[0].isCurrent).toBe(true);
  });

  it('handles repository without initial commit', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
      initialCommit: false,
    });

    const result = await service.getBranchState(repo.path);

    // Should still work - empty repo is still a repo
    expect(result.success).toBe(true);
    expect(result.isRepo).toBe(true);
  });
});

// ============================================================================
// getBranchState - Failure Handling
// ============================================================================

describe('getBranchState - failure handling with real git', () => {
  it('returns error for file path instead of directory', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    const filePath = path.join(repo.path, 'file.ts');

    const result = await service.getBranchState(filePath);

    expect(result.success).toBe(false);
    expect(result.isRepo).toBe(false);
  });

  it('returns error for non-existent path', async () => {
    const nonExistent = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());

    const result = await service.getBranchState(nonExistent);

    expect(result.success).toBe(false);
    expect(result.isRepo).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ============================================================================
// getBranchState - Integration with Other Operations
// ============================================================================

describe('getBranchState - integration with other operations', () => {
  it('updates after creating a new branch', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    const initialResult = await service.getBranchState(repo.path);
    expect(initialResult.branches.length).toBe(1);

    await git(repo.path, ['branch', 'new-feature']);

    const updatedResult = await service.getBranchState(repo.path);
    expect(updatedResult.branches.length).toBe(2);
    expect(updatedResult.branches.some(b => b.name === 'new-feature')).toBe(true);
  });

  it('updates after deleting a branch', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    await git(repo.path, ['branch', 'to-delete']);
    await git(repo.path, ['branch', '-d', 'to-delete']);

    const result = await service.getBranchState(repo.path);

    expect(result.branches.length).toBe(1);
    expect(result.branches.every(b => b.name !== 'to-delete')).toBe(true);
  });

  it('updates after switching branches', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    await git(repo.path, ['checkout', '-b', 'feature']);

    const result = await service.getBranchState(repo.path);

    expect(result.currentBranch).toBe('feature');
    const currentBranch = result.branches.find(b => b.isCurrent);
    expect(currentBranch?.name).toBe('feature');
  });

  it('handles renamed branches correctly', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    await git(repo.path, ['branch', '-m', 'main', 'trunk']);

    const result = await service.getBranchState(repo.path);

    expect(result.success).toBe(true);
    expect(result.currentBranch).toBe('trunk');
    expect(result.branches.some(b => b.name === 'trunk')).toBe(true);
    expect(result.branches.every(b => b.name !== 'main')).toBe(true);
  });
});
