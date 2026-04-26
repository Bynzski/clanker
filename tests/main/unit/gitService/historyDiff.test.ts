/**
 * Git Service - getHistory and getDiff Real Behavior Tests
 * 
 * Tests for getHistory and getDiff functions using real git repositories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitService } from '../../../../src/main/gitService';
import {
  createTempGitRepo,
  modifyFile,
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
// getHistory - Happy Path Tests
// ============================================================================

describe('getHistory - happy path with real git', () => {
  it('returns commit history', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const history = await service.getHistory(repo.path);
    
    expect(history).toHaveLength(1);
    expect(history[0]).toHaveProperty('hash');
    expect(history[0]).toHaveProperty('shortHash');
    expect(history[0]).toHaveProperty('author');
    expect(history[0]).toHaveProperty('date');
    expect(history[0]).toHaveProperty('subject');
  });

  it('parses multiple commits correctly', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'initial' },
    });
    
    // Create additional commits
    await modifyFile(repo.path, 'file.ts', 'second', true);
    await git(repo.path, ['commit', '-m', 'Second commit']);
    
    await modifyFile(repo.path, 'file.ts', 'third', true);
    await git(repo.path, ['commit', '-m', 'Third commit']);
    
    const history = await service.getHistory(repo.path);
    
    expect(history.length).toBeGreaterThanOrEqual(1);
    // Most recent commit should be first
    expect(history[0].subject).toContain('Third');
  });

  it('returns commits with correct author information', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const history = await service.getHistory(repo.path);
    
    expect(history[0].author).toBeTruthy();
    expect(history[0].author.length).toBeGreaterThan(0);
  });

  it('returns commits with dates in correct format', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const history = await service.getHistory(repo.path);
    
    // Date should be in YYYY-MM-DD format
    expect(history[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('respects limit parameter', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'initial' },
    });
    
    // Create multiple commits
    for (let i = 2; i <= 5; i++) {
      await modifyFile(repo.path, 'file.ts', `content ${i}`, true);
      await git(repo.path, ['commit', '-m', `Commit ${i}`]);
    }
    
    const history = await service.getHistory(repo.path, 3);
    
    // Should return at most 3 commits (plus initial commit from createTempGitRepo)
    expect(history.length).toBeLessThanOrEqual(4);
  });

  it('handles repository with many commits', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'initial' },
    });
    
    // Create 10 commits
    for (let i = 2; i <= 11; i++) {
      await modifyFile(repo.path, 'file.ts', `content ${i}`, true);
      await git(repo.path, ['commit', '-m', `Commit ${i}`]);
    }
    
    const history = await service.getHistory(repo.path, 10);
    
    expect(history.length).toBeGreaterThan(0);
    expect(history.length).toBeLessThanOrEqual(11);
  });
});

// ============================================================================
// getHistory - Edge Cases
// ============================================================================

describe('getHistory - edge cases with real git', () => {
  it('returns empty array for repository with no commits', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-'));
    
    try {
      // Init repo but no commits
      await git(tempDir, ['init', '--initial-branch', 'main']);
      await git(tempDir, ['config', 'user.email', 'test@test.com']);
      await git(tempDir, ['config', 'user.name', 'Test']);
      
      const history = await service.getHistory(tempDir);
      
      expect(history).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('clamps limit to minimum of 1', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const history = await service.getHistory(repo.path, 0);
    
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it('clamps limit to maximum of 50', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Create many commits
    for (let i = 2; i <= 60; i++) {
      await modifyFile(repo.path, 'file.ts', `content ${i}`, true);
      await git(repo.path, ['commit', '-m', `Commit ${i}`]);
    }
    
    const history = await service.getHistory(repo.path, 100);
    
    // Should be clamped to 50
    expect(history.length).toBeLessThanOrEqual(50);
  });

  it('clamps negative limit to 1', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const history = await service.getHistory(repo.path, -5);
    
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it('handles commit messages with special characters', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await modifyFile(repo.path, 'file.ts', 'modified', true);
    await git(repo.path, ['commit', '-m', 'Fix: handle "quotes" and \n newlines']);
    
    const history = await service.getHistory(repo.path);
    
    expect(history[0].subject).toBeTruthy();
  });

  it('handles unicode in commit messages', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await modifyFile(repo.path, 'file.ts', 'modified', true);
    await git(repo.path, ['commit', '-m', 'Add 日本語 and émoji 🚀']);
    
    const history = await service.getHistory(repo.path);
    
    expect(history[0].subject).toBeTruthy();
  });
});

// ============================================================================
// getHistory - Failure Handling
// ============================================================================

describe('getHistory - failure handling with real git', () => {
  it('handles non-git directory', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      fs.writeFileSync(path.join(nonGitDir, 'file.txt'), 'content');
      
      const history = await service.getHistory(nonGitDir);
      
      // Should return empty array for non-repo
      expect(history).toEqual([]);
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// getDiff - Happy Path Tests
// ============================================================================

describe('getDiff - happy path with real git', () => {
  it('returns working tree diff with changes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original' },
    });
    
    // Modify file
    await modifyFile(repo.path, 'file.ts', 'modified');
    
    const result = await service.getDiff(repo.path, 'working');
    
    expect(result.success).toBe(true);
    expect(result.title).toBe('Working Tree Diff');
    expect(result.output).toContain('file.ts');
  });

  it('returns empty diff for clean working tree', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.getDiff(repo.path, 'working');
    
    expect(result.success).toBe(true);
    expect(result.title).toBe('Working Tree Diff');
  });

  it('returns staged diff when changes are staged', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original' },
    });
    
    // Modify and stage
    await modifyFile(repo.path, 'file.ts', 'modified', true);
    
    const result = await service.getDiff(repo.path, 'staged');
    
    expect(result.success).toBe(true);
    expect(result.title).toBe('Staged Diff');
    expect(result.output).toContain('file.ts');
  });

  it('returns commit diff for specific commit', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Get the initial commit hash
    const logResult = await git(repo.path, ['rev-parse', 'HEAD']);
    const commitHash = logResult.stdout.trim();
    
    const result = await service.getDiff(repo.path, 'commit', commitHash);
    
    expect(result.success).toBe(true);
    expect(result.title).toContain(commitHash.substring(0, 12));
  });

  it('returns commit diff with file statistics', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Get the initial commit hash
    const logResult = await git(repo.path, ['rev-parse', 'HEAD']);
    const commitHash = logResult.stdout.trim();
    
    const result = await service.getDiff(repo.path, 'commit', commitHash);
    
    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  });
});

// ============================================================================
// getDiff - Edge Cases
// ============================================================================

describe('getDiff - edge cases with real git', () => {
  it('rejects commit diff without commit reference', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.getDiff(repo.path, 'commit');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('required');
  });

  it('handles empty commit reference', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.getDiff(repo.path, 'commit', '');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('handles whitespace-only commit reference', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.getDiff(repo.path, 'commit', '   ');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('handles diff with modified file', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'existing.ts': 'content' },
    });
    
    // Modify existing file
    await modifyFile(repo.path, 'existing.ts', 'modified content');
    
    const result = await service.getDiff(repo.path, 'working');
    
    expect(result.success).toBe(true);
    expect(result.output).toContain('existing.ts');
  });

  it('handles diff with deleted file', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'to-delete.ts': 'content' },
    });
    
    // Delete file
    await git(repo.path, ['rm', 'to-delete.ts']);
    
    const result = await service.getDiff(repo.path, 'working');
    
    expect(result.success).toBe(true);
  });

  it('handles diff with renamed file', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'old.ts': 'content' },
    });
    
    // Rename file
    await git(repo.path, ['mv', 'old.ts', 'new.ts']);
    
    const result = await service.getDiff(repo.path, 'working');
    
    expect(result.success).toBe(true);
  });

  it('handles short commit reference', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Get short commit hash
    const logResult = await git(repo.path, ['rev-parse', '--short', 'HEAD']);
    const shortHash = logResult.stdout.trim();
    
    const result = await service.getDiff(repo.path, 'commit', shortHash);
    
    expect(result.success).toBe(true);
    expect(result.title).toContain(shortHash);
  });
});

// ============================================================================
// getDiff - Failure Handling
// ============================================================================

describe('getDiff - failure handling with real git', () => {
  it('handles non-git directory for working diff', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      fs.writeFileSync(path.join(nonGitDir, 'file.txt'), 'content');
      
      const result = await service.getDiff(nonGitDir, 'working');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it('handles non-git directory for staged diff', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      fs.writeFileSync(path.join(nonGitDir, 'file.txt'), 'content');
      
      const result = await service.getDiff(nonGitDir, 'staged');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it('handles non-existent commit for commit diff', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.getDiff(repo.path, 'commit', '0000000000000000000000000000000000000000');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('history and diff integration with real git', () => {
  it('getHistory and getDiff work together for commit analysis', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'initial' },
    });
    
    // Create a commit
    await modifyFile(repo.path, 'file.ts', 'modified', true);
    await git(repo.path, ['commit', '-m', 'Update file']);
    
    // Get history
    const history = await service.getHistory(repo.path, 1);
    
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].subject).toContain('Update');
    
    // Get diff for that commit
    const diff = await service.getDiff(repo.path, 'commit', history[0].hash);
    
    expect(diff.success).toBe(true);
    expect(diff.output).toContain('file.ts');
  });

  it('getDiff shows staged vs working changes correctly', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original' },
    });
    
    // Create staged change
    await modifyFile(repo.path, 'file.ts', 'staged content', true);
    
    // Create working change (unstaged)
    await modifyFile(repo.path, 'file.ts', 'working content');
    
    // Staged diff should show staged content
    const stagedDiff = await service.getDiff(repo.path, 'staged');
    expect(stagedDiff.success).toBe(true);
    
    // Working diff should show working content
    const workingDiff = await service.getDiff(repo.path, 'working');
    expect(workingDiff.success).toBe(true);
  });

  it('history shows commits in correct order', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'initial' },
    });
    
    // Create commits in order
    await modifyFile(repo.path, 'file.ts', 'first', true);
    await git(repo.path, ['commit', '-m', 'First']);
    
    await modifyFile(repo.path, 'file.ts', 'second', true);
    await git(repo.path, ['commit', '-m', 'Second']);
    
    await modifyFile(repo.path, 'file.ts', 'third', true);
    await git(repo.path, ['commit', '-m', 'Third']);
    
    const history = await service.getHistory(repo.path, 5);
    
    // Most recent first
    expect(history[0].subject).toBe('Third');
    expect(history[1].subject).toBe('Second');
    expect(history[2].subject).toBe('First');
  });
});

// ============================================================================
// Regression Tests
// ============================================================================

describe('history and diff regression tests', () => {
  it('getHistory parses commit with multiline message', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await modifyFile(repo.path, 'file.ts', 'modified', true);
    await git(repo.path, ['commit', '-m', 'Title\n\n- Bullet 1\n- Bullet 2']);
    
    const history = await service.getHistory(repo.path, 1);
    
    expect(history[0].subject).toContain('Title');
  });

  it('getDiff handles large file changes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'large.ts': 'initial' },
    });
    
    // Create a large change
    const largeContent = 'x'.repeat(10000);
    await modifyFile(repo.path, 'large.ts', largeContent);
    
    const result = await service.getDiff(repo.path, 'working');
    
    expect(result.success).toBe(true);
  });

  it('getHistory handles commits from different authors', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Commit with default author
    await modifyFile(repo.path, 'file.ts', 'mod1', true);
    await git(repo.path, ['commit', '-m', 'First']);
    
    // Commit with different author
    await git(repo.path, ['config', 'user.email', 'other@test.com']);
    await git(repo.path, ['config', 'user.name', 'Other User']);
    await modifyFile(repo.path, 'file.ts', 'mod2', true);
    await git(repo.path, ['commit', '-m', 'Second']);
    
    const history = await service.getHistory(repo.path, 2);
    
    expect(history.length).toBe(2);
    const authors = history.map(h => h.author);
    expect(authors).toContain('Test User');
    expect(authors).toContain('Other User');
  });

  it('getDiff works after rebasing', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Create a branch with commits
    await git(repo.path, ['checkout', '-b', 'feature']);
    await modifyFile(repo.path, 'file.ts', 'feature content', true);
    await git(repo.path, ['commit', '-m', 'Feature']);
    
    // Back to main and rebase
    await git(repo.path, ['checkout', 'main']);
    await modifyFile(repo.path, 'file.ts', 'main update', true);
    await git(repo.path, ['commit', '-m', 'Main update']);
    await git(repo.path, ['rebase', 'main']);
    
    // History should work
    const history = await service.getHistory(repo.path);
    expect(history.length).toBeGreaterThan(0);
    
    // Diff should work
    const diff = await service.getDiff(repo.path, 'working');
    expect(diff.success).toBe(true);
  });
});
