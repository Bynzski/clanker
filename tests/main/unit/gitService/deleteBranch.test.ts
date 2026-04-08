/**
 * Git Service - deleteBranch/forceDeleteBranch Real Behavior Tests
 * 
 * Tests for the deleteBranch and forceDeleteBranch functions using real git repositories.
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
// deleteBranch Happy Path Tests
// ============================================================================

describe('deleteBranch - happy path with real git', () => {
  it('deletes an existing branch', async () => {
    repo = await createTempGitRepo({});
    
    // Create a branch
    await git(repo.path, ['branch', 'feature']);
    
    const result = await service.deleteBranch(repo.path, 'feature');
    
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    
    // Verify branch is gone
    const branches = await service.getBranches(repo.path);
    expect(branches.some(b => b.name === 'feature')).toBe(false);
  });

  it('deletes branch when not on that branch', async () => {
    repo = await createTempGitRepo({});
    
    // Create and switch to main, create feature branch
    await git(repo.path, ['branch', 'feature']);
    
    // Delete should succeed since we're on main
    const result = await service.deleteBranch(repo.path, 'feature');
    
    expect(result.success).toBe(true);
    
    const branches = await service.getBranches(repo.path);
    expect(branches.map(b => b.name)).not.toContain('feature');
  });

  it('deletes multiple branches in sequence', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'b1']);
    await git(repo.path, ['branch', 'b2']);
    await git(repo.path, ['branch', 'b3']);
    
    await service.deleteBranch(repo.path, 'b1');
    await service.deleteBranch(repo.path, 'b2');
    await service.deleteBranch(repo.path, 'b3');
    
    const branches = await service.getBranches(repo.path);
    const branchNames = branches.map(b => b.name);
    expect(branchNames).not.toContain('b1');
    expect(branchNames).not.toContain('b2');
    expect(branchNames).not.toContain('b3');
  });

  it('handles branch with slash in name', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature/new']);
    
    const result = await service.deleteBranch(repo.path, 'feature/new');
    
    expect(result.success).toBe(true);
    
    const branches = await service.getBranches(repo.path);
    expect(branches.map(b => b.name)).not.toContain('feature/new');
  });

  it('handles branch with hyphen in name', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature-long']);
    
    const result = await service.deleteBranch(repo.path, 'feature-long');
    
    expect(result.success).toBe(true);
  });

  it('reports blockedByUnmergedCommits for unmerged branch', async () => {
    repo = await createTempGitRepo({});
    
    // Create branch and add commits but don't merge
    await git(repo.path, ['checkout', '-b', 'unmerged']);
    await createFile(repo.path, 'unmerged.txt', 'content');
    await git(repo.path, ['add', 'unmerged.txt']);
    await git(repo.path, ['commit', '-m', 'Add unmerged']);
    await service.switchBranch(repo.path, 'main');
    
    // Try to delete unmerged branch - should fail
    const result = await service.deleteBranch(repo.path, 'unmerged');
    
    expect(result.success).toBe(false);
    expect(result.blockedByUnmergedCommits).toBe(true);
  });

  it('allows deleting unmerged branch with force', async () => {
    repo = await createTempGitRepo({});
    
    // Create branch and add commits but don't merge
    await git(repo.path, ['checkout', '-b', 'unmerged']);
    await createFile(repo.path, 'unmerged.txt', 'content');
    await git(repo.path, ['add', 'unmerged.txt']);
    await git(repo.path, ['commit', '-m', 'Add unmerged']);
    await service.switchBranch(repo.path, 'main');
    
    // Force delete should succeed
    const result = await service.forceDeleteBranch(repo.path, 'unmerged');
    
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// deleteBranch Edge Cases
// ============================================================================

describe('deleteBranch - edge cases with real git', () => {
  it('refuses to delete the current branch', async () => {
    repo = await createTempGitRepo({});
    
    const currentBranch = await service.getCurrentBranch(repo.path);
    
    const result = await service.deleteBranch(repo.path, currentBranch!);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toContain('current');
  });

  it('refuses to delete non-existent branch', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.deleteBranch(repo.path, 'nonexistent');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects empty branch name', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.deleteBranch(repo.path, '');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toContain('empty');
  });

  it('rejects whitespace-only branch name', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.deleteBranch(repo.path, '   ');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('allows deleting already deleted branch gracefully', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature']);
    await service.deleteBranch(repo.path, 'feature');
    
    // Try to delete again
    const result = await service.deleteBranch(repo.path, 'feature');
    
    // Should fail but not crash
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// deleteBranch Failure Handling
// ============================================================================

describe('deleteBranch - failure handling with real git', () => {
  it('throws for non-git directory', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    try {
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'content');
      repo = { path: tempDir, cleanup: () => {} };
      
      // Implementation throws for non-git directories
      await expect(service.deleteBranch(repo.path, 'feature')).rejects.toThrow();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('throws for non-existent path', async () => {
    // Implementation throws for non-existent paths
    await expect(service.deleteBranch('/non/existent/path', 'feature')).rejects.toThrow();
  });
});

// ============================================================================
// deleteBranch Regression Tests
// ============================================================================

describe('deleteBranch - regression tests for original bugs', () => {
  it('correctly trims whitespace from branch names', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature']);
    
    // The implementation trims whitespace
    const result = await service.deleteBranch(repo.path, '  feature  ');
    
    expect(result.success).toBe(true);
    
    const branches = await service.getBranches(repo.path);
    expect(branches.map(b => b.name)).not.toContain('feature');
  });

  it('preserves current branch after failed deletion', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature']);
    
    const originalBranch = await service.getCurrentBranch(repo.path);
    
    // Try to delete non-existent branch
    await service.deleteBranch(repo.path, 'nonexistent');
    
    // Should still be on original branch
    expect(await service.getCurrentBranch(repo.path)).toBe(originalBranch);
    
    // Delete should still work
    const result = await service.deleteBranch(repo.path, 'feature');
    expect(result.success).toBe(true);
  });

  it('correctly identifies unmerged commits', async () => {
    repo = await createTempGitRepo({});
    
    // Create feature branch with commits
    await git(repo.path, ['checkout', '-b', 'feature']);
    await createFile(repo.path, 'f1.txt', 'f1');
    await git(repo.path, ['add', '-A']);
    await git(repo.path, ['commit', '-m', 'F1']);
    await createFile(repo.path, 'f2.txt', 'f2');
    await git(repo.path, ['add', '-A']);
    await git(repo.path, ['commit', '-m', 'F2']);
    await service.switchBranch(repo.path, 'main');
    
    // Delete should be blocked (unmerged)
    const result = await service.deleteBranch(repo.path, 'feature');
    expect(result.success).toBe(false);
    expect(result.blockedByUnmergedCommits).toBe(true);
  });

  it('allows deleting merged branch without blocking', async () => {
    repo = await createTempGitRepo({});
    
    // Create and merge feature branch
    await git(repo.path, ['checkout', '-b', 'feature']);
    await createFile(repo.path, 'feature.txt', 'content');
    await git(repo.path, ['add', '-A']);
    await git(repo.path, ['commit', '-m', 'Add feature']);
    await service.switchBranch(repo.path, 'main');
    await service.mergeBranch(repo.path, 'feature');
    
    // Delete should succeed
    const result = await service.deleteBranch(repo.path, 'feature');
    expect(result.success).toBe(true);
    expect(result.blockedByUnmergedCommits).toBeUndefined();
  });
});

// ============================================================================
// forceDeleteBranch Happy Path Tests
// ============================================================================

describe('forceDeleteBranch - happy path with real git', () => {
  it('force deletes a branch with unmerged commits', async () => {
    repo = await createTempGitRepo({});
    
    // Create branch with unmerged commits
    await git(repo.path, ['checkout', '-b', 'unmerged']);
    await createFile(repo.path, 'unmerged.txt', 'content');
    await git(repo.path, ['add', 'unmerged.txt']);
    await git(repo.path, ['commit', '-m', 'Add unmerged']);
    await service.switchBranch(repo.path, 'main');
    
    // Force delete should succeed
    const result = await service.forceDeleteBranch(repo.path, 'unmerged');
    
    expect(result.success).toBe(true);
    
    const branches = await service.getBranches(repo.path);
    expect(branches.map(b => b.name)).not.toContain('unmerged');
  });

  it('force deletes already deleted branch gracefully', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature']);
    await service.forceDeleteBranch(repo.path, 'feature');
    
    // Try to delete again
    const result = await service.forceDeleteBranch(repo.path, 'feature');
    
    // Should fail but not crash
    expect(result.success).toBe(false);
  });

  it('force deletes branch with complex history', async () => {
    repo = await createTempGitRepo({});
    
    // Create branch with multiple commits
    await git(repo.path, ['checkout', '-b', 'complex']);
    for (let i = 0; i < 5; i++) {
      await createFile(repo.path, `file${i}.txt`, `content ${i}`);
      await git(repo.path, ['add', '-A']);
      await git(repo.path, ['commit', `-m`, `Commit ${i}`]);
    }
    await service.switchBranch(repo.path, 'main');
    
    // Force delete should work
    const result = await service.forceDeleteBranch(repo.path, 'complex');
    
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// forceDeleteBranch Edge Cases
// ============================================================================

describe('forceDeleteBranch - edge cases with real git', () => {
  it('refuses to delete the current branch', async () => {
    repo = await createTempGitRepo({});
    
    const currentBranch = await service.getCurrentBranch(repo.path);
    
    const result = await service.forceDeleteBranch(repo.path, currentBranch!);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toContain('current');
  });

  it('refuses to delete non-existent branch', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.forceDeleteBranch(repo.path, 'nonexistent');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects empty branch name', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.forceDeleteBranch(repo.path, '');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toContain('empty');
  });
});
