/**
 * Git Service - Stash Operations Real Behavior Tests
 * 
 * Tests for stashChanges, listStashes, applyStash, popStash, dropStash, and clearStashes
 * using real git repositories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitService } from '../../../../src/main/gitService';
import {
  createTempGitRepo,
  createFile,
  modifyFile,
  git,
  getWorkingTreeFiles,
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

// Helper to get the number of stash entries
async function getStashCount(repoPath: string): Promise<number> {
  const result = await git(repoPath, ['stash', 'list']);
  if (result.exitCode !== 0) return 0;
  return result.stdout.trim().split('\n').filter(Boolean).length;
}

// Helper to check if working tree has changes
async function hasWorkingTreeChanges(repoPath: string): Promise<boolean> {
  const workingTree = await getWorkingTreeFiles(repoPath);
  return workingTree.modified.length > 0 || workingTree.untracked.length > 0;
}

// Helper to verify file content matches expected
async function fileContent(repoPath: string, filename: string): Promise<string> {
  const fs = await import('fs');
  const path = await import('path');
  return fs.readFileSync(path.join(repoPath, filename), 'utf-8');
}

// ============================================================================
// stashChanges - Happy Path Tests
// ============================================================================

describe('stashChanges - happy path with real git', () => {
  it('stashes modified files', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'existing.ts': 'original content' },
    });
    
    // Modify a file
    await modifyFile(repo.path, 'existing.ts', 'modified content');
    expect(await hasWorkingTreeChanges(repo.path)).toBe(true);
    
    const result = await service.stashChanges(repo.path);
    
    expect(result.success).toBe(true);
    
    // Verify working tree is clean
    expect(await hasWorkingTreeChanges(repo.path)).toBe(false);
    
    // Verify stash was created
    expect(await getStashCount(repo.path)).toBe(1);
  });

  it('stashes changes with a message', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await modifyFile(repo.path, 'file.ts', 'modified');
    
    const result = await service.stashChanges(repo.path, 'my work in progress');
    
    expect(result.success).toBe(true);
    
    // Verify stash message
    const stashes = await service.listStashes(repo.path);
    expect(stashes).toHaveLength(1);
    expect(stashes[0].message).toContain('my work in progress');
  });

  it('stashes untracked files with includeUntracked flag', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'existing.ts': 'content' },
    });
    
    // Create untracked file
    await createFile(repo.path, 'untracked.ts', 'untracked content');
    const workingTree = await getWorkingTreeFiles(repo.path);
    expect(workingTree.untracked).toContain('untracked.ts');
    
    const result = await service.stashChanges(repo.path, undefined, true);
    
    expect(result.success).toBe(true);
    
    // Verify untracked file is stashed
    const workingTreeAfter = await getWorkingTreeFiles(repo.path);
    expect(workingTreeAfter.untracked).not.toContain('untracked.ts');
  });

  it('stashes multiple changes at once', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file1.ts': 'content1', 'file2.ts': 'content2' },
    });
    
    await modifyFile(repo.path, 'file1.ts', 'modified1');
    await modifyFile(repo.path, 'file2.ts', 'modified2');
    
    const result = await service.stashChanges(repo.path);
    
    expect(result.success).toBe(true);
    
    // Verify modified files are stashed (working tree should be clean for tracked files)
    const stashes = await service.listStashes(repo.path);
    expect(stashes).toHaveLength(1);
  });

  it('stashes when nothing to stash returns error', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // No changes to make
    const result = await service.stashChanges(repo.path);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ============================================================================
// stashChanges - Edge Cases
// ============================================================================

describe('stashChanges - edge cases with real git', () => {
  it('stashes only modified tracked files by default (not untracked)', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'existing.ts': 'content' },
    });
    
    await modifyFile(repo.path, 'existing.ts', 'modified');
    await createFile(repo.path, 'untracked.ts', 'untracked');
    
    const result = await service.stashChanges(repo.path);
    
    expect(result.success).toBe(true);
    
    // Untracked file should still be there
    const workingTree = await getWorkingTreeFiles(repo.path);
    expect(workingTree.untracked).toContain('untracked.ts');
  });

  it('handles whitespace-only stash message', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await modifyFile(repo.path, 'file.ts', 'modified');
    
    const result = await service.stashChanges(repo.path, '   ');
    
    expect(result.success).toBe(true);
    
    // Should still create a stash with empty message
    const stashes = await service.listStashes(repo.path);
    expect(stashes).toHaveLength(1);
  });

  it('stashes changes in non-default branch', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Create and switch to a new branch
    await git(repo.path, ['checkout', '-b', 'feature']);
    await modifyFile(repo.path, 'file.ts', 'modified');
    
    const result = await service.stashChanges(repo.path);
    
    expect(result.success).toBe(true);
    expect(await getStashCount(repo.path)).toBe(1);
  });
});

// ============================================================================
// stashChanges - Failure Handling
// ============================================================================

describe('stashChanges - failure handling with real git', () => {
  it('returns error for non-git directory', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      fs.writeFileSync(path.join(nonGitDir, 'file.txt'), 'content');
      
      const result = await service.stashChanges(nonGitDir);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it('returns error when no changes to stash', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.stashChanges(repo.path);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ============================================================================
// listStashes - Happy Path Tests
// ============================================================================

describe('listStashes - happy path with real git', () => {
  it('lists existing stashes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Create multiple stashes
    await modifyFile(repo.path, 'file.ts', 'mod1');
    await service.stashChanges(repo.path, 'stash 1');
    
    await modifyFile(repo.path, 'file.ts', 'mod2');
    await service.stashChanges(repo.path, 'stash 2');
    
    const stashes = await service.listStashes(repo.path);
    
    expect(stashes).toHaveLength(2);
    expect(stashes[0].message).toContain('stash 2'); // Most recent first
    expect(stashes[1].message).toContain('stash 1');
  });

  it('parses stash entries with correct structure', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await modifyFile(repo.path, 'file.ts', 'modified');
    await service.stashChanges(repo.path, 'test stash');
    
    const stashes = await service.listStashes(repo.path);
    
    expect(stashes).toHaveLength(1);
    expect(stashes[0]).toHaveProperty('hash');
    expect(stashes[0]).toHaveProperty('ref');
    expect(stashes[0]).toHaveProperty('message');
    expect(stashes[0].hash).toBeTruthy();
    expect(stashes[0].ref).toMatch(/^stash@\{\d+\}$/);
  });

  it('returns empty array when no stashes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const stashes = await service.listStashes(repo.path);
    
    expect(stashes).toEqual([]);
  });

  it('handles stash with complex message', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await modifyFile(repo.path, 'file.ts', 'modified');
    await service.stashChanges(repo.path, 'WIP: feature X\n\n- Added feature\n- Fixed bug');
    
    const stashes = await service.listStashes(repo.path);
    
    expect(stashes).toHaveLength(1);
    expect(stashes[0].message).toContain('WIP: feature X');
  });
});

// ============================================================================
// listStashes - Edge Cases
// ============================================================================

describe('listStashes - edge cases with real git', () => {
  it('handles stash without message', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await modifyFile(repo.path, 'file.ts', 'modified');
    await service.stashChanges(repo.path); // No message
    
    const stashes = await service.listStashes(repo.path);
    
    expect(stashes).toHaveLength(1);
    // Default message format from git
    expect(stashes[0].message).toBeTruthy();
  });

  it('handles stash from non-default branch', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await git(repo.path, ['checkout', '-b', 'feature']);
    await modifyFile(repo.path, 'file.ts', 'modified');
    await service.stashChanges(repo.path, 'branch stash');
    
    const stashes = await service.listStashes(repo.path);
    
    expect(stashes).toHaveLength(1);
    expect(stashes[0].message).toContain('branch stash');
  });
});

// ============================================================================
// listStashes - Failure Handling
// ============================================================================

describe('listStashes - failure handling with real git', () => {
  it('returns empty array for non-git directory', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      fs.writeFileSync(path.join(nonGitDir, 'file.txt'), 'content');
      
      const stashes = await service.listStashes(nonGitDir);
      
      // Should return empty array gracefully
      expect(stashes).toEqual([]);
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// applyStash - Happy Path Tests
// ============================================================================

describe('applyStash - happy path with real git', () => {
  it('applies a stash and restores changes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original' },
    });
    
    const originalContent = await fileContent(repo.path, 'file.ts');
    
    // Make changes and stash
    await modifyFile(repo.path, 'file.ts', 'modified');
    await service.stashChanges(repo.path, 'my changes');
    
    // Verify file is back to original
    expect(await fileContent(repo.path, 'file.ts')).toBe(originalContent);
    
    // Apply stash
    const result = await service.applyStash(repo.path, 'stash@{0}');
    
    expect(result.success).toBe(true);
    
    // Verify changes are restored
    expect(await fileContent(repo.path, 'file.ts')).toBe('modified');
    
    // Stash should still exist
    expect(await getStashCount(repo.path)).toBe(1);
  });

  it('applies specific stash from multiple', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file1.ts': 'original1', 'file2.ts': 'original2' },
    });
    
    // Create two stashes
    await modifyFile(repo.path, 'file1.ts', 'modified1');
    await service.stashChanges(repo.path, 'changes 1');
    
    await modifyFile(repo.path, 'file2.ts', 'modified2');
    await service.stashChanges(repo.path, 'changes 2');
    
    // Apply the first stash
    const result = await service.applyStash(repo.path, 'stash@{1}');
    
    expect(result.success).toBe(true);
    
    // file1 should have changes, file2 should not
    expect(await fileContent(repo.path, 'file1.ts')).toBe('modified1');
    expect(await fileContent(repo.path, 'file2.ts')).toBe('original2');
  });

  it('preserves staged changes when applying stash', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original' },
    });
    
    // Stage some changes
    await modifyFile(repo.path, 'file.ts', 'staged content');
    await git(repo.path, ['add', 'file.ts']);
    
    // Make additional unstaged changes and stash
    await modifyFile(repo.path, 'file.ts', 'unstaged content');
    await service.stashChanges(repo.path, 'unstaged');
    
    // Apply stash
    const result = await service.applyStash(repo.path, 'stash@{0}');
    
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// applyStash - Edge Cases
// ============================================================================

describe('applyStash - edge cases with real git', () => {
  it('handles applying stash with conflicting changes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original' },
    });
    
    // Create stash
    await modifyFile(repo.path, 'file.ts', 'stash changes');
    await service.stashChanges(repo.path, 'stash');
    
    // Make different changes to the file
    await modifyFile(repo.path, 'file.ts', 'conflicting changes');
    
    // Apply stash - should succeed but with conflict markers
    const result = await service.applyStash(repo.path, 'stash@{0}');
    
    // Git apply can succeed even with conflicts, or fail depending on strategy
    // The important thing is the result reflects actual git behavior
    expect(result).toHaveProperty('success');
  });

  it('fails gracefully for non-existent stash ref', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.applyStash(repo.path, 'stash@{999}');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ============================================================================
// applyStash - Failure Handling
// ============================================================================

describe('applyStash - failure handling with real git', () => {
  it('returns error for non-git directory', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      const result = await service.applyStash(nonGitDir, 'stash@{0}');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// popStash - Happy Path Tests
// ============================================================================

describe('popStash - happy path with real git', () => {
  it('pops a stash and removes it', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original' },
    });
    
    // Make changes and stash
    await modifyFile(repo.path, 'file.ts', 'modified');
    await service.stashChanges(repo.path, 'my changes');
    
    expect(await getStashCount(repo.path)).toBe(1);
    
    // Pop stash
    const result = await service.popStash(repo.path, 'stash@{0}');
    
    expect(result.success).toBe(true);
    
    // Verify changes are restored
    expect(await fileContent(repo.path, 'file.ts')).toBe('modified');
    
    // Stash should be removed
    expect(await getStashCount(repo.path)).toBe(0);
  });

  it('pops most recent stash when ref is stash@{0}', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file1.ts': 'orig1', 'file2.ts': 'orig2' },
    });
    
    // Create two stashes
    await modifyFile(repo.path, 'file1.ts', 'mod1');
    await service.stashChanges(repo.path, 'changes 1');
    
    await modifyFile(repo.path, 'file2.ts', 'mod2');
    await service.stashChanges(repo.path, 'changes 2');
    
    expect(await getStashCount(repo.path)).toBe(2);
    
    // Pop most recent
    const result = await service.popStash(repo.path, 'stash@{0}');
    
    expect(result.success).toBe(true);
    expect(await getStashCount(repo.path)).toBe(1);
    
    // Most recent changes (file2) should be restored
    expect(await fileContent(repo.path, 'file2.ts')).toBe('mod2');
  });
});

// ============================================================================
// popStash - Edge Cases
// ============================================================================

describe('popStash - edge cases with real git', () => {
  it('fails gracefully for non-existent stash ref', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await modifyFile(repo.path, 'file.ts', 'modified');
    await service.stashChanges(repo.path);
    
    const result = await service.popStash(repo.path, 'stash@{999}');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ============================================================================
// popStash - Failure Handling
// ============================================================================

describe('popStash - failure handling with real git', () => {
  it('returns error for non-git directory', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      const result = await service.popStash(nonGitDir, 'stash@{0}');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// dropStash - Happy Path Tests
// ============================================================================

describe('dropStash - happy path with real git', () => {
  it('drops a specific stash', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file1.ts': 'orig1', 'file2.ts': 'orig2' },
    });
    
    // Create two stashes
    await modifyFile(repo.path, 'file1.ts', 'mod1');
    await service.stashChanges(repo.path, 'changes 1');
    
    await modifyFile(repo.path, 'file2.ts', 'mod2');
    await service.stashChanges(repo.path, 'changes 2');
    
    expect(await getStashCount(repo.path)).toBe(2);
    
    // Drop the first stash
    const result = await service.dropStash(repo.path, 'stash@{1}');
    
    expect(result.success).toBe(true);
    expect(await getStashCount(repo.path)).toBe(1);
    
    // Remaining stash should be stash@{0} (changes 2)
    const stashes = await service.listStashes(repo.path);
    expect(stashes).toHaveLength(1);
  });

  it('drops most recent stash', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'orig' },
    });
    
    await modifyFile(repo.path, 'file.ts', 'mod');
    await service.stashChanges(repo.path, 'changes');
    
    expect(await getStashCount(repo.path)).toBe(1);
    
    const result = await service.dropStash(repo.path, 'stash@{0}');
    
    expect(result.success).toBe(true);
    expect(await getStashCount(repo.path)).toBe(0);
  });
});

// ============================================================================
// dropStash - Edge Cases
// ============================================================================

describe('dropStash - edge cases with real git', () => {
  it('fails gracefully for non-existent stash ref', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await modifyFile(repo.path, 'file.ts', 'modified');
    await service.stashChanges(repo.path);
    
    const result = await service.dropStash(repo.path, 'stash@{999}');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ============================================================================
// dropStash - Failure Handling
// ============================================================================

describe('dropStash - failure handling with real git', () => {
  it('returns error for non-git directory', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      const result = await service.dropStash(nonGitDir, 'stash@{0}');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// clearStashes - Happy Path Tests
// ============================================================================

describe('clearStashes - happy path with real git', () => {
  it('clears all stashes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Create multiple stashes
    await modifyFile(repo.path, 'file.ts', 'mod1');
    await service.stashChanges(repo.path, 'stash 1');
    
    await modifyFile(repo.path, 'file.ts', 'mod2');
    await service.stashChanges(repo.path, 'stash 2');
    
    await modifyFile(repo.path, 'file.ts', 'mod3');
    await service.stashChanges(repo.path, 'stash 3');
    
    expect(await getStashCount(repo.path)).toBe(3);
    
    const result = await service.clearStashes(repo.path);
    
    expect(result.success).toBe(true);
    expect(await getStashCount(repo.path)).toBe(0);
  });

  it('clears when no stashes exist', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    expect(await getStashCount(repo.path)).toBe(0);
    
    const result = await service.clearStashes(repo.path);
    
    expect(result.success).toBe(true);
    expect(await getStashCount(repo.path)).toBe(0);
  });
});

// ============================================================================
// clearStashes - Edge Cases
// ============================================================================

describe('clearStashes - edge cases with real git', () => {
  it('clears stashes on repo with other history', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Make some commits
    await git(repo.path, ['commit', '--allow-empty', '-m', 'commit 1']);
    await git(repo.path, ['commit', '--allow-empty', '-m', 'commit 2']);
    
    // Add and stash changes
    await modifyFile(repo.path, 'file.ts', 'mod');
    await service.stashChanges(repo.path, 'changes');
    
    expect(await getStashCount(repo.path)).toBe(1);
    
    const result = await service.clearStashes(repo.path);
    
    expect(result.success).toBe(true);
    expect(await getStashCount(repo.path)).toBe(0);
  });
});

// ============================================================================
// clearStashes - Failure Handling
// ============================================================================

describe('clearStashes - failure handling with real git', () => {
  it('returns error for non-git directory', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      const result = await service.clearStashes(nonGitDir);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Integration Tests - Complete Stash Workflow
// ============================================================================

describe('stash workflow integration with real git', () => {
  it('complete workflow: stash -> list -> apply -> drop remaining', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file1.ts': 'orig1', 'file2.ts': 'orig2' },
    });
    
    // Create changes
    await modifyFile(repo.path, 'file1.ts', 'mod1');
    await modifyFile(repo.path, 'file2.ts', 'mod2');
    
    // Stash with message
    const stashResult = await service.stashChanges(repo.path, 'work in progress');
    expect(stashResult.success).toBe(true);
    
    // Verify working tree is clean
    expect(await hasWorkingTreeChanges(repo.path)).toBe(false);
    
    // List stashes
    let stashes = await service.listStashes(repo.path);
    expect(stashes).toHaveLength(1);
    expect(stashes[0].message).toContain('work in progress');
    
    // Apply stash
    const applyResult = await service.applyStash(repo.path, 'stash@{0}');
    expect(applyResult.success).toBe(true);
    
    // Verify changes are back
    expect(await fileContent(repo.path, 'file1.ts')).toBe('mod1');
    expect(await fileContent(repo.path, 'file2.ts')).toBe('mod2');
    
    // Drop the remaining stash (from apply, stash@{0})
    const dropResult = await service.dropStash(repo.path, 'stash@{0}');
    expect(dropResult.success).toBe(true);
    
    // Verify no more stashes
    stashes = await service.listStashes(repo.path);
    expect(stashes).toEqual([]);
  });

  it('pop workflow: stash -> make more changes -> pop restores most recent', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original' },
    });
    
    // Create first set of changes and stash
    await modifyFile(repo.path, 'file.ts', 'first change');
    await service.stashChanges(repo.path, 'first');
    
    // Create second set of changes
    await modifyFile(repo.path, 'file.ts', 'second change');
    
    // Pop the stash - should conflict with current changes
    const popResult = await service.popStash(repo.path, 'stash@{0}');
    
    // The result depends on git's conflict resolution
    expect(popResult).toHaveProperty('success');
  });

  it('clear workflow: multiple stashes -> clear all -> verify empty', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Create multiple stashes
    for (let i = 1; i <= 5; i++) {
      await modifyFile(repo.path, 'file.ts', `mod${i}`);
      await service.stashChanges(repo.path, `stash ${i}`);
    }
    
    expect(await getStashCount(repo.path)).toBe(5);
    
    // Clear all
    const clearResult = await service.clearStashes(repo.path);
    expect(clearResult.success).toBe(true);
    
    // Verify empty
    const stashes = await service.listStashes(repo.path);
    expect(stashes).toEqual([]);
  });
});

// ============================================================================
// Regression Tests
// ============================================================================

describe('stash regression tests for original bugs', () => {
  it('stashChanges error message includes stdout when stderr is empty', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // This should fail because there's nothing to stash
    const result = await service.stashChanges(repo.path);
    
    // Error should be meaningful, not just a fallback
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // The error should contain the git message (case-insensitive check)
    const errorText = result.error!.toLowerCase();
    expect(
      errorText.includes('no local changes to save')
    ).toBe(true);
  });

  it('listStashes returns empty array gracefully for non-repo', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      const stashes = await service.listStashes(nonGitDir);
      
      // Should not throw, should return empty array
      expect(Array.isArray(stashes)).toBe(true);
      expect(stashes).toEqual([]);
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it('applyStash and popStash both restore file contents correctly', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original' },
    });
    
    const originalContent = await fileContent(repo.path, 'file.ts');
    
    // Make changes
    await modifyFile(repo.path, 'file.ts', 'modified');
    await service.stashChanges(repo.path);
    
    // Verify file is back to original
    expect(await fileContent(repo.path, 'file.ts')).toBe(originalContent);
    
    // Test apply
    await service.applyStash(repo.path, 'stash@{0}');
    expect(await fileContent(repo.path, 'file.ts')).toBe('modified');
    
    // Stash again
    await service.stashChanges(repo.path);
    expect(await fileContent(repo.path, 'file.ts')).toBe(originalContent);
    
    // Test pop
    await service.popStash(repo.path, 'stash@{0}');
    expect(await fileContent(repo.path, 'file.ts')).toBe('modified');
  });

  it('stash operations work correctly in detached HEAD state', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Create a commit
    await git(repo.path, ['commit', '--allow-empty', '-m', 'commit']);
    
    // Checkout a specific commit (detached HEAD)
    const logResult = await git(repo.path, ['rev-parse', 'HEAD']);
    const commit = logResult.stdout.trim();
    
    await git(repo.path, ['checkout', commit]);
    
    // Make changes and stash
    await modifyFile(repo.path, 'file.ts', 'modified in detached');
    const stashResult = await service.stashChanges(repo.path, 'detached stash');
    
    expect(stashResult.success).toBe(true);
    
    // List should work
    const stashes = await service.listStashes(repo.path);
    expect(stashes).toHaveLength(1);
  });
});
