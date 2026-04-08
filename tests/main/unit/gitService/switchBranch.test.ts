/**
 * Git Service - switchBranch Real Behavior Tests
 * 
 * Tests for the switchBranch function using real git repositories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitService } from '../../../../src/main/gitService';
import {
  createTempGitRepo,
  createFile,
  git,
} from '../../../../tests/setup/gitTestHelpers';

interface TempRepo {
  path: string;
  cleanup: () => void;
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

afterEach(() => {
  if (repo) {
    repo.cleanup();
    repo = null;
  }
});

// ============================================================================
// Happy Path Tests
// ============================================================================

describe('switchBranch - happy path with real git', () => {
  it('switches to an existing branch', async () => {
    repo = await createTempGitRepo({});
    
    // Create a branch first
    await git(repo.path, ['branch', 'feature']);
    
    const result = await service.switchBranch(repo.path, 'feature');
    
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    
    // Verify we're on the new branch
    const currentBranch = await service.getCurrentBranch(repo.path);
    expect(currentBranch).toBe('feature');
  });

  it('switches back to the original branch', async () => {
    repo = await createTempGitRepo({});
    
    // Create and switch to a branch
    await git(repo.path, ['checkout', '-b', 'feature']);
    
    // Switch back to main
    const result = await service.switchBranch(repo.path, 'main');
    
    expect(result.success).toBe(true);
    const currentBranch = await service.getCurrentBranch(repo.path);
    expect(currentBranch).toBe('main');
  });

  it('switches to a branch with commit history', async () => {
    repo = await createTempGitRepo({});
    
    // Create branch with commits
    await git(repo.path, ['checkout', '-b', 'feature']);
    await createFile(repo.path, 'feature.txt', 'feature content');
    await git(repo.path, ['add', '-A']);
    await git(repo.path, ['commit', '-m', 'Add feature']);
    
    // Switch back to main
    await service.switchBranch(repo.path, 'main');
    
    // Verify file doesn't exist on main
    const fileExists = fs.existsSync(path.join(repo.path, 'feature.txt'));
    expect(fileExists).toBe(false);
  });

  it('switches between multiple branches', async () => {
    repo = await createTempGitRepo({});
    
    // Create multiple branches
    await git(repo.path, ['branch', 'branch-a']);
    await git(repo.path, ['branch', 'branch-b']);
    await git(repo.path, ['branch', 'branch-c']);
    
    // Switch to each in sequence
    await service.switchBranch(repo.path, 'branch-a');
    expect(await service.getCurrentBranch(repo.path)).toBe('branch-a');
    
    await service.switchBranch(repo.path, 'branch-b');
    expect(await service.getCurrentBranch(repo.path)).toBe('branch-b');
    
    await service.switchBranch(repo.path, 'branch-c');
    expect(await service.getCurrentBranch(repo.path)).toBe('branch-c');
  });

  it('handles branch with slash in name', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature/new']);
    
    const result = await service.switchBranch(repo.path, 'feature/new');
    
    expect(result.success).toBe(true);
    expect(await service.getCurrentBranch(repo.path)).toBe('feature/new');
  });

  it('handles branch with hyphen in name', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature-long']);
    
    const result = await service.switchBranch(repo.path, 'feature-long');
    
    expect(result.success).toBe(true);
    expect(await service.getCurrentBranch(repo.path)).toBe('feature-long');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('switchBranch - edge cases with real git', () => {
  it('rejects empty branch name', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.switchBranch(repo.path, '');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toContain('empty');
  });

  it('rejects whitespace-only branch name', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.switchBranch(repo.path, '   ');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects non-existent branch name', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.switchBranch(repo.path, 'nonexistent');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch with invalid characters', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.switchBranch(repo.path, 'bad~name');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('handles switching to current branch gracefully', async () => {
    repo = await createTempGitRepo({});
    
    const currentBranch = await service.getCurrentBranch(repo.path);
    
    // Switching to the current branch should succeed
    const result = await service.switchBranch(repo.path, currentBranch!);
    
    expect(result.success).toBe(true);
    expect(await service.getCurrentBranch(repo.path)).toBe(currentBranch);
  });

  it('allows switching with untracked files', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature']);
    
    // Create untracked file - untracked files don't belong to any branch
    await createFile(repo.path, 'untracked.txt', 'changes');
    
    // Switching should succeed - untracked files are not branch-specific
    const result = await service.switchBranch(repo.path, 'feature');
    
    expect(result.success).toBe(true);
    
    // File should still exist after switch
    expect(fs.existsSync(path.join(repo.path, 'untracked.txt'))).toBe(true);
  });

  it('allows switching when working tree is clean', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature']);
    
    // No changes, should switch successfully
    const result = await service.switchBranch(repo.path, 'feature');
    
    expect(result.success).toBe(true);
  });

  it('allows switching when changes are staged', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature']);
    
    // Stage changes
    await createFile(repo.path, 'staged.txt', 'staged');
    await git(repo.path, ['add', 'staged.txt']);
    
    const result = await service.switchBranch(repo.path, 'feature');
    
    // Staged changes can be carried over to the new branch
    expect(result.success).toBe(true);
    
    // Switch back to verify staged changes are preserved
    await service.switchBranch(repo.path, 'main');
    const status = await service.getStatus(repo.path);
    expect(status.changes.some(c => c.path === 'staged.txt' && c.staged)).toBe(true);
  });

  it('allows switching when changes are committed', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature']);
    
    // Commit changes
    await createFile(repo.path, 'committed.txt', 'committed');
    await git(repo.path, ['add', 'committed.txt']);
    await git(repo.path, ['commit', '-m', 'Add committed file']);
    
    const result = await service.switchBranch(repo.path, 'feature');
    
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Failure Handling
// ============================================================================

describe('switchBranch - failure handling with real git', () => {
  it('fails gracefully for non-git directory', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    try {
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'content');
      repo = { path: tempDir, cleanup: () => {} };
      
      const result = await service.switchBranch(repo.path, 'feature');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails gracefully for non-existent path', async () => {
    const result = await service.switchBranch('/non/existent/path', 'feature');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('fails when trying to switch to non-existent branch', async () => {
    repo = await createTempGitRepo({});
    
    // Create and switch to a branch
    await git(repo.path, ['checkout', '-b', 'feature']);
    
    // Try to switch to a non-existent branch on current
    const result = await service.switchBranch(repo.path, 'nonexistent-branch');
    
    // Should fail
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ============================================================================
// Regression Tests
// ============================================================================

describe('switchBranch - regression tests for original bugs', () => {
  it('correctly trims whitespace from branch names', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature']);
    
    // The implementation trims whitespace
    const result = await service.switchBranch(repo.path, '  feature  ');
    
    expect(result.success).toBe(true);
    expect(await service.getCurrentBranch(repo.path)).toBe('feature');
  });

  it('switches to branch after failed attempt preserves state', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature']);
    
    const originalBranch = await service.getCurrentBranch(repo.path);
    
    // First try with non-existent branch
    await service.switchBranch(repo.path, 'nonexistent');
    
    // Should still be on original branch
    expect(await service.getCurrentBranch(repo.path)).toBe(originalBranch);
    
    // Now try with valid branch
    const result = await service.switchBranch(repo.path, 'feature');
    
    expect(result.success).toBe(true);
    expect(await service.getCurrentBranch(repo.path)).toBe('feature');
  });

  it('handles rapid successive switches', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'a']);
    await git(repo.path, ['branch', 'b']);
    
    // Rapid switches
    await service.switchBranch(repo.path, 'a');
    await service.switchBranch(repo.path, 'b');
    await service.switchBranch(repo.path, 'main');
    await service.switchBranch(repo.path, 'a');
    
    expect(await service.getCurrentBranch(repo.path)).toBe('a');
  });

  it('correctly identifies current branch after multiple switches', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'f1']);
    await git(repo.path, ['branch', 'f2']);
    
    await service.switchBranch(repo.path, 'f1');
    await service.switchBranch(repo.path, 'f2');
    await service.switchBranch(repo.path, 'main');
    
    // Verify all branches exist
    const branches = await service.getBranches(repo.path);
    const branchNames = branches.map(b => b.name);
    expect(branchNames).toContain('main');
    expect(branchNames).toContain('f1');
    expect(branchNames).toContain('f2');
    
    // Current branch should be main
    expect(await service.getCurrentBranch(repo.path)).toBe('main');
  });
});
