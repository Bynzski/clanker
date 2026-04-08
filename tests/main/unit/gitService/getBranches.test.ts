/**
 * Git Service - getBranches Real Behavior Tests
 * 
 * Tests for the getBranches function using real git repositories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitService } from '../../../../src/main/gitService';
import { createTempGitRepo, git } from '../../../../tests/setup/gitTestHelpers';

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

describe('getBranches - happy path with real git', () => {
  it('returns single branch in fresh repo', async () => {
    repo = await createTempGitRepo({});
    
    const branches = await service.getBranches(repo.path);
    
    expect(branches).toHaveLength(1);
    expect(branches[0].name).toBe('main');
    expect(branches[0].isCurrent).toBe(true);
  });

  it('returns multiple branches with correct current marker', async () => {
    repo = await createTempGitRepo({});
    
    // Create multiple branches
    await git(repo.path, ['branch', 'feature']);
    await git(repo.path, ['branch', 'bugfix']);
    
    const branches = await service.getBranches(repo.path);
    
    expect(branches).toHaveLength(3);
    
    // Check main is current
    const mainBranch = branches.find(b => b.name === 'main');
    expect(mainBranch).toBeDefined();
    expect(mainBranch!.isCurrent).toBe(true);
    
    // Check other branches are not current
    const featureBranch = branches.find(b => b.name === 'feature');
    expect(featureBranch).toBeDefined();
    expect(featureBranch!.isCurrent).toBe(false);
    
    const bugfixBranch = branches.find(b => b.name === 'bugfix');
    expect(bugfixBranch).toBeDefined();
    expect(bugfixBranch!.isCurrent).toBe(false);
  });

  it('returns correct current branch after switching', async () => {
    repo = await createTempGitRepo({});
    
    // Create and switch to a new branch
    await git(repo.path, ['checkout', '-b', 'feature-branch']);
    
    const branches = await service.getBranches(repo.path);
    
    expect(branches).toHaveLength(2);
    
    const featureBranch = branches.find(b => b.name === 'feature-branch');
    expect(featureBranch).toBeDefined();
    expect(featureBranch!.isCurrent).toBe(true);
    
    const mainBranch = branches.find(b => b.name === 'main');
    expect(mainBranch).toBeDefined();
    expect(mainBranch!.isCurrent).toBe(false);
  });

  it('returns branches after commits on different branches', async () => {
    repo = await createTempGitRepo({});
    
    // Create a feature branch with commits
    await git(repo.path, ['checkout', '-b', 'feature']);
    await git(repo.path, ['add', '-A']);
    await git(repo.path, ['commit', '-m', 'Add feature file']);
    
    const branches = await service.getBranches(repo.path);
    
    // Should show both main and feature
    const branchNames = branches.map(b => b.name);
    expect(branchNames).toContain('main');
    expect(branchNames).toContain('feature');
    expect(branches.find(b => b.name === 'feature')!.isCurrent).toBe(true);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('getBranches - edge cases with real git', () => {
  it('handles detached HEAD state correctly', async () => {
    repo = await createTempGitRepo({});
    
    // Get the commit hash and checkout to create detached HEAD
    const { stdout } = await git(repo.path, ['rev-parse', 'HEAD']);
    await git(repo.path, ['checkout', stdout.trim()]);
    
    const branches = await service.getBranches(repo.path);
    
    // In detached HEAD, git shows "(HEAD detached at <hash>)" with a * marker
    // but there should be no actual branch names with * (just the detached pointer)
    // The detached HEAD entry will have isCurrent: true but no real branch name
    const detachedEntry = branches.find(b => b.name.includes('(HEAD detached'));
    expect(detachedEntry).toBeDefined();
    expect(detachedEntry!.isCurrent).toBe(true);
    
    // Real branches should have isCurrent: false
    const mainBranch = branches.find(b => b.name === 'main');
    expect(mainBranch).toBeDefined();
    expect(mainBranch!.isCurrent).toBe(false);
  });

  it('handles branch with slash in name', async () => {
    repo = await createTempGitRepo({});
    
    // Git allows slashes in branch names
    await git(repo.path, ['branch', 'feature/auth']);
    await git(repo.path, ['branch', 'bugfix/security']);
    
    const branches = await service.getBranches(repo.path);
    
    expect(branches).toHaveLength(3);
    
    const featureBranch = branches.find(b => b.name === 'feature/auth');
    expect(featureBranch).toBeDefined();
    
    const bugfixBranch = branches.find(b => b.name === 'bugfix/security');
    expect(bugfixBranch).toBeDefined();
  });

  it('handles branch with hyphen in name', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature-long-name']);
    
    const branches = await service.getBranches(repo.path);
    
    const featureBranch = branches.find(b => b.name === 'feature-long-name');
    expect(featureBranch).toBeDefined();
    expect(featureBranch!.isCurrent).toBe(false);
  });

  it('handles many branches', async () => {
    repo = await createTempGitRepo({});
    
    // Create many branches
    for (let i = 0; i < 10; i++) {
      await git(repo.path, ['branch', `branch-${i}`]);
    }
    
    const branches = await service.getBranches(repo.path);
    
    expect(branches).toHaveLength(11); // main + 10 branches
    expect(branches.filter(b => b.isCurrent)).toHaveLength(1);
    expect(branches.filter(b => !b.isCurrent)).toHaveLength(10);
  });

  it('handles branch with unicode characters', async () => {
    repo = await createTempGitRepo({});
    
    // Git allows unicode in branch names (though not recommended)
    await git(repo.path, ['branch', 'feature-日本語']);
    
    const branches = await service.getBranches(repo.path);
    
    const unicodeBranch = branches.find(b => b.name === 'feature-日本語');
    expect(unicodeBranch).toBeDefined();
  });

  it('handles deleted branch correctly', async () => {
    repo = await createTempGitRepo({});
    
    await git(repo.path, ['branch', 'feature']);
    await git(repo.path, ['branch', 'bugfix']);
    
    // Delete one branch
    await git(repo.path, ['branch', '-d', 'feature']);
    
    const branches = await service.getBranches(repo.path);
    
    const branchNames = branches.map(b => b.name);
    expect(branchNames).not.toContain('feature');
    expect(branchNames).toContain('bugfix');
    expect(branchNames).toContain('main');
  });
});

// ============================================================================
// Failure Handling
// ============================================================================

describe('getBranches - failure handling with real git', () => {
  it('throws error for non-git directory', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    try {
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'content');
      repo = { path: tempDir, cleanup: () => {} };
      
      // git branch should fail for non-repo
      await expect(service.getBranches(repo.path)).rejects.toThrow();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('throws error for non-existent path', async () => {
    await expect(service.getBranches('/non/existent/path')).rejects.toThrow();
  });
});

// ============================================================================
// Regression Tests
// ============================================================================

describe('getBranches - regression tests for original bugs', () => {
  it('correctly parses current branch marker after branch creation', async () => {
    repo = await createTempGitRepo({});
    
    // Create a branch and switch to it
    await git(repo.path, ['checkout', '-b', 'test-branch']);
    
    const branches = await service.getBranches(repo.path);
    
    // The current branch should be marked
    const currentBranch = branches.find(b => b.isCurrent);
    expect(currentBranch).toBeDefined();
    expect(currentBranch!.name).toBe('test-branch');
    
    // Should not have multiple current branches
    expect(branches.filter(b => b.isCurrent)).toHaveLength(1);
  });

  it('correctly identifies all branches after multiple operations', async () => {
    repo = await createTempGitRepo({});
    
    // Multiple branch operations
    await git(repo.path, ['branch', 'branch-a']);
    await git(repo.path, ['branch', 'branch-b']);
    await git(repo.path, ['checkout', '-b', 'branch-c']);
    await git(repo.path, ['branch', '-d', 'branch-a']);
    
    const branches = await service.getBranches(repo.path);
    const branchNames = branches.map(b => b.name);
    
    expect(branchNames).toContain('main');
    expect(branchNames).toContain('branch-b');
    expect(branchNames).toContain('branch-c');
    expect(branchNames).not.toContain('branch-a');
    expect(branches.find(b => b.name === 'branch-c')!.isCurrent).toBe(true);
  });
});
