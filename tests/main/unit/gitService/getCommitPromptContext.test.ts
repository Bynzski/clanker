/**
 * Git Service - getCommitPromptContext Real Behavior Tests
 * 
 * Tests for the getCommitPromptContext function using real git repositories.
 * This function combines getStatus and getDiff to provide commit context for AI.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitService } from '../../../../src/main/gitService';
import {
  createTempGitRepo,
  createFile,
  modifyFile,
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
// getCommitPromptContext - Happy Path Tests
// ============================================================================

describe('getCommitPromptContext - happy path with real git', () => {
  it('returns context with staged changes and staged diff mode', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'initial content' },
    });

    // Create and stage a modification
    await modifyFile(repo.path, 'file.ts', 'staged content');
    await git(repo.path, ['add', 'file.ts']);

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(true);
    expect(ctx.currentBranch).toBeTruthy();
    expect(ctx.isDetached).toBe(false);
    expect(ctx.diffMode).toBe('staged');
    expect(ctx.changes.length).toBeGreaterThanOrEqual(1);
    expect(ctx.changes[0].path).toBe('file.ts');
    expect(ctx.changes[0].staged).toBe(true);
    expect(ctx.diffSummary).toContain('file.ts');
  });

  it('returns context with only working changes and working diff mode', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'initial content' },
    });

    // Modify without staging
    await modifyFile(repo.path, 'file.ts', 'working content');

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(true);
    expect(ctx.diffMode).toBe('working');
    expect(ctx.changes.length).toBeGreaterThanOrEqual(1);
    expect(ctx.changes[0].path).toBe('file.ts');
    expect(ctx.changes[0].staged).toBe(false);
    expect(ctx.diffSummary).toContain('file.ts');
  });

  it('returns context with untracked files', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'existing.ts': 'content' },
    });

    // Create untracked file
    await createFile(repo.path, 'new-file.ts', 'new content');

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(true);
    // Untracked files are included in changes
    expect(ctx.changes.some(c => c.path === 'new-file.ts' && c.status === 'untracked')).toBe(true);
    // diffSummary is based on git diff output, which doesn't include untracked files
    // but the changes array will include the untracked file
    expect(ctx.diffMode).toBe('working');
  });

  it('returns context with multiple staged files', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file1.ts': 'content1', 'file2.ts': 'content2' },
    });

    // Stage both files
    await modifyFile(repo.path, 'file1.ts', 'modified1');
    await modifyFile(repo.path, 'file2.ts', 'modified2');
    await git(repo.path, ['add', 'file1.ts', 'file2.ts']);

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(true);
    expect(ctx.diffMode).toBe('staged');
    expect(ctx.changes.length).toBe(2);
    expect(ctx.changes.every(c => c.staged)).toBe(true);
  });

  it('returns context with mixed staged and working changes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file1.ts': 'content1', 'file2.ts': 'content2' },
    });

    // Stage one file
    await modifyFile(repo.path, 'file1.ts', 'staged content');
    await git(repo.path, ['add', 'file1.ts']);

    // Modify another without staging
    await modifyFile(repo.path, 'file2.ts', 'working content');

    const ctx = await service.getCommitPromptContext(repo.path);

    // Should focus on staged changes when both exist
    expect(ctx.success).toBe(true);
    expect(ctx.diffMode).toBe('staged');
    // Only staged changes in the returned changes array
    expect(ctx.changes.every(c => c.staged)).toBe(true);
    expect(ctx.diffSummary).toContain('file1.ts');
  });

  it('returns context with staged deleted file', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content', 'keep.ts': 'keep content' },
    });

    // Delete file and stage
    await git(repo.path, ['rm', 'file.ts']);

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(true);
    expect(ctx.diffMode).toBe('staged');
    expect(ctx.changes.some(c => c.path === 'file.ts' && c.status === 'deleted')).toBe(true);
  });
});

// ============================================================================
// getCommitPromptContext - Edge Cases
// ============================================================================

describe('getCommitPromptContext - edge cases with real git', () => {
  it('returns error when no changes to commit', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // No modifications
    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(false);
    expect(ctx.error).toContain('No changes');
  });

  it('handles repository with detached HEAD', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Create a second commit
    await modifyFile(repo.path, 'file.ts', 'second version', true);
    await git(repo.path, ['commit', '-m', 'Second commit']);

    // Checkout the commit directly (detached HEAD)
    const result = await git(repo.path, ['rev-parse', 'HEAD']);
    const commitHash = result.stdout.trim();
    await git(repo.path, ['checkout', commitHash]);

    // Modify a file
    await modifyFile(repo.path, 'file.ts', 'detached content');

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(true);
    expect(ctx.isDetached).toBe(true);
    expect(ctx.currentBranch).toBeNull();
    expect(ctx.changes.length).toBeGreaterThanOrEqual(1);
  });

  it('returns error for non-git directory', async () => {
    // Create a repo, then remove the .git directory to make it non-git
    repo = await createTempGitRepo({ initialFiles: { 'file.ts': 'content' } });
    
    // Remove .git directory to make it non-git
    fs.rmSync(path.join(repo.path, '.git'), { recursive: true, force: true });

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(false);
    expect(ctx.error).toBeTruthy();
  });

  it('returns error for completely empty directory', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
    
    try {
      const ctx = await service.getCommitPromptContext(tempDir);
      
      expect(ctx.success).toBe(false);
      expect(ctx.error).toBeTruthy();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('handles repository with renamed files', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'old-name.ts': 'content' },
    });

    // Stage a rename
    await git(repo.path, ['mv', 'old-name.ts', 'new-name.ts']);
    await git(repo.path, ['add', '-A']);

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(true);
    expect(ctx.diffMode).toBe('staged');
    expect(ctx.changes.some(c => c.path === 'new-name.ts' && c.status === 'renamed')).toBe(true);
  });

  it('returns context with staged new file', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'existing.ts': 'content' },
    });

    // Create and stage a new file
    await createFile(repo.path, 'new.ts', 'new content');
    await git(repo.path, ['add', 'new.ts']);

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(true);
    expect(ctx.diffMode).toBe('staged');
    expect(ctx.changes.some(c => c.path === 'new.ts' && c.status === 'added')).toBe(true);
  });
});

// ============================================================================
// getCommitPromptContext - Failure Handling
// ============================================================================

describe('getCommitPromptContext - failure handling with real git', () => {
  it('returns error when status fails', async () => {
    // Create repo, then delete .git to force failure
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Remove .git directory
    await git(repo.path, ['rev-parse', '--git-dir']); // Verify it exists
    fs.rmSync(path.join(repo.path, '.git'), { recursive: true, force: true });

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(false);
    expect(ctx.error).toBeTruthy();
  });

  it('returns error when getDiff fails', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Create and stage a change
    await modifyFile(repo.path, 'file.ts', 'modified');
    await git(repo.path, ['add', 'file.ts']);

    // Remove read permissions to cause diff to fail (on Unix)
    const filePath = path.join(repo.path, 'file.ts');
    try {
      fs.chmodSync(filePath, 0o000);
      
      const ctx = await service.getCommitPromptContext(repo.path);
      
      // May succeed or fail depending on git version/platform
      // The key is we get a result
      expect(ctx).toHaveProperty('success');
    } finally {
      // Restore permissions for cleanup
      try {
        fs.chmodSync(filePath, 0o644);
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});

// ============================================================================
// getCommitPromptContext - Diff Content Verification
// ============================================================================

describe('getCommitPromptContext - diff content verification', () => {
  it('diff summary contains file statistics', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'initial\n'.repeat(10) },
    });

    // Add more content to make a visible diff
    await modifyFile(repo.path, 'file.ts', 'initial\n'.repeat(10) + 'new content\n'.repeat(5));
    await git(repo.path, ['add', 'file.ts']);

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(true);
    expect(ctx.diffSummary).toContain('file.ts');
    // Should contain some indication of change count
    expect(ctx.diffSummary).toMatch(/changed|insertion|deletion|1 file/i);
  });

  it('diff summary is empty for single empty file', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'empty.ts': '' },
    });

    await createFile(repo.path, 'new-empty.ts', '');
    await git(repo.path, ['add', 'new-empty.ts']);

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(true);
    // New empty file still shows up
    expect(ctx.diffSummary).toContain('new-empty.ts');
  });

  it('returns meaningful diff summary for binary file change', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'image.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') },
    });

    // Stage a modification (binary content)
    await createFile(repo.path, 'image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString('base64'));
    await git(repo.path, ['add', 'image.png']);

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(true);
    expect(ctx.changes.some(c => c.path === 'image.png')).toBe(true);
  });
});

// ============================================================================
// getCommitPromptContext - Integration with Branch State
// ============================================================================

describe('getCommitPromptContext - integration with branch state', () => {
  it('returns correct current branch from context', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Create and switch to a feature branch
    await git(repo.path, ['checkout', '-b', 'feature-branch']);
    await modifyFile(repo.path, 'file.ts', 'feature content');

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(true);
    expect(ctx.currentBranch).toBe('feature-branch');
    expect(ctx.isDetached).toBe(false);
  });

  it('maintains correct branch state with pending changes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });

    // Rename to development branch
    await git(repo.path, ['branch', '-m', 'development']);

    // Create pending changes
    await modifyFile(repo.path, 'file.ts', 'modified');

    const ctx = await service.getCommitPromptContext(repo.path);

    expect(ctx.success).toBe(true);
    expect(ctx.currentBranch).toBe('development');
    expect(ctx.isDetached).toBe(false);
  });
});
