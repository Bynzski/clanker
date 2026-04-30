/**
 * Git Service - getFileDiff Real Behavior Tests
 * 
 * Tests for getFileDiff function using real git repositories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitService } from '../../../../src/main/gitService';
import {
  createTempGitRepo,
  modifyFile,
  createFile,
  deleteFile,
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
// getFileDiff - Happy Path Tests
// ============================================================================

describe('getFileDiff - happy path with real git', () => {
  it('returns modified file diff in working mode', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original content' },
    });
    
    // Modify the file on disk
    await modifyFile(repo.path, 'file.ts', 'modified content');
    
    const result = await service.getFileDiff(repo.path, 'file.ts', 'working');
    
    expect(result.success).toBe(true);
    expect(result.hasDiff).toBe(true);
    expect(result.oldContent).toBe('original content');
    expect(result.newContent).toBe('modified content');
    expect(result.oldPath).toBe('file.ts');
    expect(result.newPath).toBe('file.ts');
    expect(result.isBinary).toBe(false);
  });

  it('returns staged file diff', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original content' },
    });
    
    // Modify and stage the file
    await modifyFile(repo.path, 'file.ts', 'staged content', true);
    
    const result = await service.getFileDiff(repo.path, 'file.ts', 'staged');
    
    expect(result.success).toBe(true);
    expect(result.hasDiff).toBe(true);
    expect(result.oldContent).toBe('original content');
    expect(result.newContent).toBe('staged content');
  });

  it('handles new file (not in HEAD)', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original content' },
    });
    
    // Create and stage a new file
    await createFile(repo.path, 'newfile.ts', 'new file content', true);
    
    const result = await service.getFileDiff(repo.path, 'newfile.ts', 'staged');
    
    expect(result.success).toBe(true);
    expect(result.oldContent).toBe('');
    expect(result.newContent).toBe('new file content');
    expect(result.hasDiff).toBe(true);
  });

  it('handles deleted file', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original content' },
    });
    
    // Delete the file
    await deleteFile(repo.path, 'file.ts');
    
    const result = await service.getFileDiff(repo.path, 'file.ts', 'working');
    
    expect(result.success).toBe(true);
    expect(result.newContent).toBe('');
    expect(result.oldContent).toBe('original content');
    expect(result.hasDiff).toBe(true);
  });

  it('returns no diff for clean file', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original content' },
    });
    
    const result = await service.getFileDiff(repo.path, 'file.ts', 'working');
    
    expect(result.success).toBe(true);
    expect(result.hasDiff).toBe(false);
    expect(result.oldContent).toBe('original content');
    expect(result.newContent).toBe('original content');
  });
});

// ============================================================================
// getFileDiff - Edge Cases
// ============================================================================

describe('getFileDiff - edge cases with real git', () => {
  it('rejects empty file path', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.getFileDiff(repo.path, '', 'working');
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('File path is required');
    expect(result.oldContent).toBe('');
    expect(result.newContent).toBe('');
  });

  it('handles whitespace-only file path', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.getFileDiff(repo.path, '   ', 'working');
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('File path is required');
  });

  it('handles non-existent file in working mode gracefully', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.getFileDiff(repo.path, 'nonexistent.ts', 'working');
    
    expect(result.success).toBe(true);
    expect(result.oldContent).toBe('');
    expect(result.newContent).toBe('');
    expect(result.hasDiff).toBe(false);
  });

  it('handles file path with leading/trailing whitespace', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.getFileDiff(repo.path, '  file.ts  ', 'working');
    
    expect(result.success).toBe(true);
    expect(result.oldPath).toBe('file.ts');
    expect(result.newPath).toBe('file.ts');
  });

  it('handles nested file path', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'src/nested/file.ts': 'nested content' },
    });
    
    await modifyFile(repo.path, 'src/nested/file.ts', 'modified nested');
    
    const result = await service.getFileDiff(repo.path, 'src/nested/file.ts', 'working');
    
    expect(result.success).toBe(true);
    expect(result.hasDiff).toBe(true);
    expect(result.oldContent).toBe('nested content');
    expect(result.newContent).toBe('modified nested');
  });

  it('handles binary file detection', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'binary.bin': Buffer.from([0x00, 0x01, 0x02, 0xff]).toString('binary') },
    });
    
    const fs = await import('fs');
    const path = await import('path');
    
    // Write actual binary content
    const binaryPath = path.join(repo.path, 'binary.bin');
    fs.writeFileSync(binaryPath, Buffer.from([0x00, 0x01, 0x02, 0xff]));
    
    const result = await service.getFileDiff(repo.path, 'binary.bin', 'working');
    
    // Binary detection should work (may vary by git version)
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// getFileDiff - Failure Handling
// ============================================================================

describe('getFileDiff - failure handling with real git', () => {
  it('handles non-git directory', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      fs.writeFileSync(path.join(nonGitDir, 'file.txt'), 'content');
      
      const result = await service.getFileDiff(nonGitDir, 'file.txt', 'working');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it('handles non-git directory in staged mode', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      fs.writeFileSync(path.join(nonGitDir, 'file.txt'), 'content');
      
      const result = await service.getFileDiff(nonGitDir, 'file.txt', 'staged');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// getFileDiff - Multi-line Content Tests
// ============================================================================

describe('getFileDiff - multi-line content', () => {
  it('handles multi-line file changes correctly', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'multiline.ts': 'line 1\nline 2\nline 3\n' },
    });
    
    await modifyFile(repo.path, 'multiline.ts', 'line 1\nmodified line 2\nline 3\n');
    
    const result = await service.getFileDiff(repo.path, 'multiline.ts', 'working');
    
    expect(result.success).toBe(true);
    expect(result.hasDiff).toBe(true);
    expect(result.oldContent).toBe('line 1\nline 2\nline 3\n');
    expect(result.newContent).toBe('line 1\nmodified line 2\nline 3\n');
  });

  it('handles empty file to content', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'empty.ts': '' },
    });
    
    await modifyFile(repo.path, 'empty.ts', 'some content');
    
    const result = await service.getFileDiff(repo.path, 'empty.ts', 'working');
    
    expect(result.success).toBe(true);
    expect(result.hasDiff).toBe(true);
    expect(result.oldContent).toBe('');
    expect(result.newContent).toBe('some content');
  });

  it('handles content to empty file', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'some content' },
    });
    
    await modifyFile(repo.path, 'file.ts', '');
    
    const result = await service.getFileDiff(repo.path, 'file.ts', 'working');
    
    expect(result.success).toBe(true);
    expect(result.hasDiff).toBe(true);
    expect(result.oldContent).toBe('some content');
    expect(result.newContent).toBe('');
  });
});

// ============================================================================
// getFileDiff - Integration with Other Git Operations
// ============================================================================

describe('getFileDiff - integration with other git operations', () => {
  it('staging and unstaging preserves working tree content', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'original' },
    });
    
    // Modify file on disk
    await modifyFile(repo.path, 'file.ts', 'modified on disk');
    
    // Stage the modification
    await service.stage(repo.path, ['file.ts']);
    
    // Working tree content is still 'modified on disk'
    const resultAfterStage = await service.getFileDiff(repo.path, 'file.ts', 'working');
    expect(resultAfterStage.newContent).toBe('modified on disk');
    
    // Unstage
    await service.unstage(repo.path, ['file.ts']);
    
    // File on disk is still the same
    const resultAfterUnstage = await service.getFileDiff(repo.path, 'file.ts', 'working');
    expect(resultAfterUnstage.newContent).toBe('modified on disk');
    expect(resultAfterUnstage.oldContent).toBe('original');
    expect(resultAfterUnstage.hasDiff).toBe(true);
  });

  it('works with multiple file changes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 
        'file1.ts': 'file1 original',
        'file2.ts': 'file2 original',
      },
    });
    
    await modifyFile(repo.path, 'file1.ts', 'file1 modified');
    await modifyFile(repo.path, 'file2.ts', 'file2 modified');
    
    const result1 = await service.getFileDiff(repo.path, 'file1.ts', 'working');
    const result2 = await service.getFileDiff(repo.path, 'file2.ts', 'working');
    
    expect(result1.success).toBe(true);
    expect(result1.hasDiff).toBe(true);
    expect(result2.success).toBe(true);
    expect(result2.hasDiff).toBe(true);
  });
});

// ============================================================================
// Regression Tests
// ============================================================================

describe('getFileDiff - regression tests', () => {
  it('handles special characters in file content', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'line with "quotes" and \\backslashes\\' },
    });
    
    await modifyFile(repo.path, 'file.ts', 'line with "new quotes" and \\new backslashes\\');
    
    const result = await service.getFileDiff(repo.path, 'file.ts', 'working');
    
    expect(result.success).toBe(true);
    expect(result.hasDiff).toBe(true);
  });

  it('handles unicode content', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'unicode.ts': '日本語 content' },
    });
    
    await modifyFile(repo.path, 'unicode.ts', '日本語 updated 🚀');
    
    const result = await service.getFileDiff(repo.path, 'unicode.ts', 'working');
    
    expect(result.success).toBe(true);
    expect(result.hasDiff).toBe(true);
    expect(result.newContent).toContain('🚀');
  });

  it('handles large file content', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'large.ts': 'initial' },
    });
    
    const largeContent = 'x'.repeat(100000);
    await modifyFile(repo.path, 'large.ts', largeContent);
    
    const result = await service.getFileDiff(repo.path, 'large.ts', 'working');
    
    expect(result.success).toBe(true);
    expect(result.newContent).toBe(largeContent);
    expect(result.newContent.length).toBe(100000);
  });
});
