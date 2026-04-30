/**
 * Git Service - createBranch Real Behavior Tests
 * 
 * Tests for the createBranch function using real git repositories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitService } from '../../../../src/main/gitService';
import {
  createTempGitRepo,
  createFile,
  commit,
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
// Happy Path Tests
// ============================================================================

describe('createBranch - happy path with real git', () => {
  it('creates a new branch successfully', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'feature');
    
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    
    // Verify the branch was created
    const branches = await service.getBranches(repo.path);
    expect(branches.some(b => b.name === 'feature')).toBe(true);
  });

  it('creates branch and switches to it', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'new-feature');
    
    expect(result.success).toBe(true);
    
    // Verify we're now on the new branch
    const currentBranch = await service.getCurrentBranch(repo.path);
    expect(currentBranch).toBe('new-feature');
  });

  it('creates branch from a specific base branch', async () => {
    repo = await createTempGitRepo({});
    
    // Create a commit on main
    await createFile(repo.path, 'file.txt', 'content');
    await git(repo.path, ['add', '-A']);
    await commit(repo.path, 'Add file');
    
    // Create feature branch from main
    const result = await service.createBranch(repo.path, 'feature', 'main');
    
    expect(result.success).toBe(true);
    
    // Verify we're on the new branch
    const currentBranch = await service.getCurrentBranch(repo.path);
    expect(currentBranch).toBe('feature');
    
    // Verify the branch contains the commit from main
    const history = await service.getHistory(repo.path, 5);
    expect(history.some(h => h.subject.includes('Add file'))).toBe(true);
  });

  it('creates branch with slash in name', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'feature/new-feature');
    
    expect(result.success).toBe(true);
    
    // Verify the branch was created
    const branches = await service.getBranches(repo.path);
    expect(branches.some(b => b.name === 'feature/new-feature')).toBe(true);
  });

  it('creates branch with hyphen in name', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'feature-long-name');
    
    expect(result.success).toBe(true);
    
    const branches = await service.getBranches(repo.path);
    expect(branches.some(b => b.name === 'feature-long-name')).toBe(true);
  });

  it('handles multiple branch creations', async () => {
    repo = await createTempGitRepo({});
    
    await service.createBranch(repo.path, 'feature-1');
    await service.createBranch(repo.path, 'feature-2');
    await service.createBranch(repo.path, 'feature-3');
    
    const branches = await service.getBranches(repo.path);
    expect(branches.length).toBe(4); // main + 3 features
    
    const branchNames = branches.map(b => b.name);
    expect(branchNames).toContain('feature-1');
    expect(branchNames).toContain('feature-2');
    expect(branchNames).toContain('feature-3');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('createBranch - edge cases with real git', () => {
  it('rejects empty branch name', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, '');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toContain('empty');
  });

  it('rejects whitespace-only branch name', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, '   ');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch name with newlines', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'bad\nbranch');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch name with tilde', async () => {
    repo = await createTempGitRepo({});
    
    // Tilde is not allowed in branch names
    const result = await service.createBranch(repo.path, 'bad~branch');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch name with caret', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'bad^branch');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch name with colon', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'bad:branch');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch name starting with hyphen', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, '-bad');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch name with double dots', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'bad..name');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch name ending with lock', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'foo.lock');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch name ending with slash', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'foo/');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch name with @{}', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'foo@{bar}');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch name with backslash', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'foo\\bar');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch name with question mark', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'bad?name');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch name with square brackets', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'bad[name]');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects branch name with asterisk', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'bad*name');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects duplicate branch name', async () => {
    repo = await createTempGitRepo({});
    
    // Create first branch
    await service.createBranch(repo.path, 'duplicate');
    
    // Try to create again
    const result = await service.createBranch(repo.path, 'duplicate');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ============================================================================
// Failure Handling
// ============================================================================

describe('createBranch - failure handling with real git', () => {
  it('fails gracefully for non-git directory', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    try {
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'content');
      repo = { path: tempDir, cleanup: async () => {} };
      
      const result = await service.createBranch(repo.path, 'feature');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails gracefully for non-existent path', async () => {
    const result = await service.createBranch('/non/existent/path', 'feature');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ============================================================================
// Regression Tests
// ============================================================================

describe('createBranch - regression tests for original bugs', () => {
  it('correctly trims whitespace from branch names', async () => {
    repo = await createTempGitRepo({});
    
    // The implementation trims whitespace before validation
    // So '  feature  ' becomes 'feature' which is valid
    const result = await service.createBranch(repo.path, '  feature  ');
    
    expect(result.success).toBe(true);
    
    // The branch should be created with trimmed name
    const branches = await service.getBranches(repo.path);
    expect(branches.some(b => b.name === 'feature')).toBe(true);
  });

  it('rejects whitespace-only branch name after trim', async () => {
    repo = await createTempGitRepo({});
    
    // After trim, this becomes empty string which should be rejected
    const result = await service.createBranch(repo.path, '   ');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('creates branch from non-existent base gracefully fails', async () => {
    repo = await createTempGitRepo({});
    
    const result = await service.createBranch(repo.path, 'feature', 'nonexistent');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('preserves current branch after failed creation attempt', async () => {
    repo = await createTempGitRepo({});
    const originalBranch = await service.getCurrentBranch(repo.path);
    
    // Try to create with invalid name
    await service.createBranch(repo.path, 'bad..name');
    
    // Should still be on original branch
    const currentBranch = await service.getCurrentBranch(repo.path);
    expect(currentBranch).toBe(originalBranch);
  });

  it('can create branch with same name after deleting old one', async () => {
    repo = await createTempGitRepo({});
    
    // Create and switch to a branch
    await service.createBranch(repo.path, 'temp-branch');
    
    // Switch back to main
    await service.switchBranch(repo.path, 'main');
    
    // Delete the branch
    await service.deleteBranch(repo.path, 'temp-branch');
    
    // Now create a new branch with the same name
    const result = await service.createBranch(repo.path, 'temp-branch');
    
    expect(result.success).toBe(true);
  });
});
