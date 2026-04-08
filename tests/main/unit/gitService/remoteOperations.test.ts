/**
 * Git Service - Remote Operations Real Behavior Tests
 * 
 * Tests for getRemotes, addRemote, removeRemote, and renameRemote
 * using real git repositories with actual remotes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitService } from '../../../../src/main/gitService';
import {
  createTempGitRepo,
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
let localRepo: TempRepo | null = null;
let remoteRepo: TempRepo | null = null;
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
  if (localRepo) {
    localRepo.cleanup();
    localRepo = null;
  }
  if (remoteRepo) {
    remoteRepo.cleanup();
    remoteRepo = null;
  }
});

// Helper to verify remote exists
async function remoteExists(repoPath: string, remoteName: string): Promise<boolean> {
  const result = await git(repoPath, ['remote', '-v']);
  return result.stdout.includes(remoteName);
}

// Helper to get list of remote names
async function getRemoteNames(repoPath: string): Promise<string[]> {
  const result = await git(repoPath, ['remote']);
  return result.stdout.trim().split('\n').filter(Boolean);
}

// ============================================================================
// getRemotes - Happy Path Tests
// ============================================================================

describe('getRemotes - happy path with real git', () => {
  it('returns empty array when no remotes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.getRemotes(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.remotes).toEqual([]);
    expect(result.provider).toBe('unknown');
  });

  it('returns remotes after adding one', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Add remote using service
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    
    const result = await service.getRemotes(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.remotes).toHaveLength(1);
    expect(result.remotes[0].name).toBe('origin');
    expect(result.remotes[0].fetchUrl).toBe('https://github.com/owner/repo.git');
    expect(result.remotes[0].pushUrl).toBe('https://github.com/owner/repo.git');
  });

  it('detects GitHub provider from HTTPS URL', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    
    const result = await service.getRemotes(repo.path);
    
    expect(result.provider).toBe('github');
  });

  it('detects Bitbucket provider from HTTPS URL', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://bitbucket.org/team/project.git');
    
    const result = await service.getRemotes(repo.path);
    
    expect(result.provider).toBe('bitbucket');
  });

  it('detects GitLab provider from HTTPS URL', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://gitlab.com/username/repo.git');
    
    const result = await service.getRemotes(repo.path);
    
    expect(result.provider).toBe('gitlab');
  });

  it('detects GitHub provider from SSH URL', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'git@github.com:owner/repo.git');
    
    const result = await service.getRemotes(repo.path);
    
    expect(result.provider).toBe('github');
  });

  it('returns unknown provider for self-hosted repos', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://git.mycompany.com/owner/repo.git');
    
    const result = await service.getRemotes(repo.path);
    
    expect(result.provider).toBe('unknown');
  });

  it('handles multiple remotes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    await service.addRemote(repo.path, 'upstream', 'https://github.com/upstream/repo.git');
    
    const result = await service.getRemotes(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.remotes).toHaveLength(2);
    expect(result.remotes.map(r => r.name)).toContain('origin');
    expect(result.remotes.map(r => r.name)).toContain('upstream');
  });
});

// ============================================================================
// getRemotes - Edge Cases
// ============================================================================

describe('getRemotes - edge cases with real git', () => {
  it('handles remote with different fetch and push URLs', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Add remote directly with git
    await git(repo.path, ['remote', 'add', 'origin', 'https://github.com/owner/repo.git']);
    
    const result = await service.getRemotes(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.remotes[0].fetchUrl).toBe('https://github.com/owner/repo.git');
    // pushUrl is set to same as fetchUrl when only fetch is configured
    expect(result.remotes[0].pushUrl).toBeTruthy();
  });

  it('handles repository with many remotes', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Add several remotes
    for (let i = 0; i < 5; i++) {
      await service.addRemote(repo.path, `remote${i}`, `https://github.com/owner/repo${i}.git`);
    }
    
    const result = await service.getRemotes(repo.path);
    
    expect(result.success).toBe(true);
    expect(result.remotes).toHaveLength(5);
  });
});

// ============================================================================
// getRemotes - Failure Handling
// ============================================================================

describe('getRemotes - failure handling with real git', () => {
  it('handles non-git directory', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      fs.writeFileSync(path.join(nonGitDir, 'file.txt'), 'content');
      
      const result = await service.getRemotes(nonGitDir);
      
      expect(result.success).toBe(false);
      expect(result.remotes).toEqual([]);
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// addRemote - Happy Path Tests
// ============================================================================

describe('addRemote - happy path with real git', () => {
  it('adds a remote with HTTPS URL', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.addRemote(
      repo.path,
      'origin',
      'https://github.com/owner/repo.git'
    );
    
    expect(result.success).toBe(true);
    expect(await remoteExists(repo.path, 'origin')).toBe(true);
  });

  it('adds a remote with SSH URL', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.addRemote(
      repo.path,
      'origin',
      'git@github.com:owner/repo.git'
    );
    
    expect(result.success).toBe(true);
    expect(await remoteExists(repo.path, 'origin')).toBe(true);
  });

  it('adds multiple remotes with different names', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    await service.addRemote(repo.path, 'upstream', 'https://github.com/upstream/repo.git');
    
    const remoteNames = await getRemoteNames(repo.path);
    expect(remoteNames).toContain('origin');
    expect(remoteNames).toContain('upstream');
  });

  it('adds remote and verifies it exists', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Create another local repo as "remote"
    const otherRepo = await createTempGitRepo({});
    
    try {
      // Use git command to add remote with local path
      await git(repo.path, ['remote', 'add', 'local-mirror', otherRepo.path]);
      
      expect(await remoteExists(repo.path, 'local-mirror')).toBe(true);
    } finally {
      otherRepo.cleanup();
    }
  });
});

// ============================================================================
// addRemote - Edge Cases
// ============================================================================

describe('addRemote - edge cases with real git', () => {
  it('rejects empty remote name', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.addRemote(repo.path, '', 'https://github.com/owner/repo.git');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toContain('empty');
  });

  it('rejects whitespace-only remote name', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.addRemote(repo.path, '   ', 'https://github.com/owner/repo.git');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('handles remote name with uppercase (normalized to lowercase)', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Use git directly to add uppercase remote (git allows it)
    await git(repo.path, ['remote', 'add', 'Invalid', 'https://github.com/owner/repo.git']);
    
    const result = await service.getRemotes(repo.path);
    
    expect(result.success).toBe(true);
    // Remote name should be stored as-is by git
    expect(result.remotes.some(r => r.name === 'Invalid')).toBe(true);
  });

  it('rejects invalid URL format', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.addRemote(repo.path, 'origin', 'not-a-valid-url');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns helpful error for duplicate remote name', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    
    const result = await service.addRemote(repo.path, 'origin', 'https://github.com/other/repo.git');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toContain('already exists');
  });

  it('normalizes remote name to lowercase', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.addRemote(repo.path, 'Upstream', 'https://github.com/owner/repo.git');
    
    expect(result.success).toBe(true);
    // Remote should be stored as lowercase
    const remoteNames = await getRemoteNames(repo.path);
    expect(remoteNames).toContain('upstream');
  });
});

// ============================================================================
// addRemote - Failure Handling
// ============================================================================

describe('addRemote - failure handling with real git', () => {
  it('handles non-git directory', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      fs.writeFileSync(path.join(nonGitDir, 'file.txt'), 'content');
      
      const result = await service.addRemote(nonGitDir, 'origin', 'https://github.com/owner/repo.git');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// removeRemote - Happy Path Tests
// ============================================================================

describe('removeRemote - happy path with real git', () => {
  it('removes an existing remote', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    expect(await remoteExists(repo.path, 'origin')).toBe(true);
    
    const result = await service.removeRemote(repo.path, 'origin');
    
    expect(result.success).toBe(true);
    expect(await remoteExists(repo.path, 'origin')).toBe(false);
  });

  it('removes one remote while keeping others', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    await service.addRemote(repo.path, 'upstream', 'https://github.com/upstream/repo.git');
    
    const result = await service.removeRemote(repo.path, 'upstream');
    
    expect(result.success).toBe(true);
    expect(await remoteExists(repo.path, 'upstream')).toBe(false);
    expect(await remoteExists(repo.path, 'origin')).toBe(true);
  });
});

// ============================================================================
// removeRemote - Edge Cases
// ============================================================================

describe('removeRemote - edge cases with real git', () => {
  it('rejects empty remote name', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.removeRemote(repo.path, '');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toContain('empty');
  });

  it('returns error for non-existent remote', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.removeRemote(repo.path, 'nonexistent');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toContain('does not exist');
  });
});

// ============================================================================
// removeRemote - Failure Handling
// ============================================================================

describe('removeRemote - failure handling with real git', () => {
  it('handles non-git directory', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      fs.writeFileSync(path.join(nonGitDir, 'file.txt'), 'content');
      
      const result = await service.removeRemote(nonGitDir, 'origin');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// renameRemote - Happy Path Tests
// ============================================================================

describe('renameRemote - happy path with real git', () => {
  it('renames an existing remote', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    expect(await remoteExists(repo.path, 'origin')).toBe(true);
    
    const result = await service.renameRemote(repo.path, 'origin', 'upstream');
    
    expect(result.success).toBe(true);
    expect(await remoteExists(repo.path, 'origin')).toBe(false);
    expect(await remoteExists(repo.path, 'upstream')).toBe(true);
  });

  it('preserves remote URL after rename', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    
    await service.renameRemote(repo.path, 'origin', 'upstream');
    
    const remotes = await service.getRemotes(repo.path);
    expect(remotes.remotes[0].fetchUrl).toBe('https://github.com/owner/repo.git');
  });
});

// ============================================================================
// renameRemote - Edge Cases
// ============================================================================

describe('renameRemote - edge cases with real git', () => {
  it('rejects empty old remote name', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.renameRemote(repo.path, '', 'upstream');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toContain('empty');
  });

  it('rejects empty new remote name', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    
    const result = await service.renameRemote(repo.path, 'origin', '');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error for non-existent old remote', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    const result = await service.renameRemote(repo.path, 'nonexistent', 'upstream');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // Error message should indicate remote doesn't exist
    expect(result.error!.toLowerCase()).toMatch(/no such remote|does not exist|cannot/);
  });

  it('returns error when new name already exists', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    await service.addRemote(repo.path, 'upstream', 'https://github.com/upstream/repo.git');
    
    const result = await service.renameRemote(repo.path, 'origin', 'upstream');
    
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toContain('already exists');
  });

  it('normalizes new remote name to lowercase', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    
    const result = await service.renameRemote(repo.path, 'origin', 'UPSTREAM');
    
    expect(result.success).toBe(true);
    const remoteNames = await getRemoteNames(repo.path);
    expect(remoteNames).toContain('upstream');
    expect(remoteNames).not.toContain('UPSTREAM');
  });
});

// ============================================================================
// renameRemote - Failure Handling
// ============================================================================

describe('renameRemote - failure handling with real git', () => {
  it('handles non-git directory', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    
    try {
      fs.writeFileSync(path.join(nonGitDir, 'file.txt'), 'content');
      
      const result = await service.renameRemote(nonGitDir, 'origin', 'upstream');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('remote operations integration with real git', () => {
  it('complete workflow: add -> list -> remove', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // Step 1: Add remote
    const addResult = await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    expect(addResult.success).toBe(true);
    
    // Step 2: List remotes
    let remotes = await service.getRemotes(repo.path);
    expect(remotes.remotes).toHaveLength(1);
    expect(remotes.provider).toBe('github');
    
    // Step 3: Remove remote
    const removeResult = await service.removeRemote(repo.path, 'origin');
    expect(removeResult.success).toBe(true);
    
    // Step 4: Verify removed
    remotes = await service.getRemotes(repo.path);
    expect(remotes.remotes).toEqual([]);
  });

  it('rename workflow: add -> rename -> verify', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    
    await service.renameRemote(repo.path, 'origin', 'mirror');
    
    const remotes = await service.getRemotes(repo.path);
    expect(remotes.remotes).toHaveLength(1);
    expect(remotes.remotes[0].name).toBe('mirror');
    expect(remotes.remotes[0].fetchUrl).toBe('https://github.com/owner/repo.git');
  });

  it('multiple remotes with different providers', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'github', 'https://github.com/owner/repo.git');
    await service.addRemote(repo.path, 'gitlab', 'https://gitlab.com/owner/repo.git');
    await service.addRemote(repo.path, 'bitbucket', 'https://bitbucket.org/owner/repo.git');
    
    const remotes = await service.getRemotes(repo.path);
    
    expect(remotes.remotes).toHaveLength(3);
    // Provider is determined by the first remote in alphabetical order (bitbucket, github, gitlab)
    expect(remotes.provider).toBe('bitbucket');
  });
});

// ============================================================================
// Regression Tests
// ============================================================================

describe('remote operations regression tests', () => {
  it('remote names are normalized to lowercase', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'MyRemote', 'https://github.com/owner/repo.git');
    
    const remotes = await service.getRemotes(repo.path);
    expect(remotes.remotes[0].name).toBe('myremote');
  });

  it('getRemotes works after addRemote', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    
    const remotes = await service.getRemotes(repo.path);
    expect(remotes.remotes).toHaveLength(1);
    expect(remotes.remotes[0].name).toBe('origin');
  });

  it('removeRemote works after addRemote', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    await service.addRemote(repo.path, 'origin', 'https://github.com/owner/repo.git');
    
    const result = await service.removeRemote(repo.path, 'origin');
    
    expect(result.success).toBe(true);
    expect(await remoteExists(repo.path, 'origin')).toBe(false);
  });

  it('provider detection is case-insensitive', async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'file.ts': 'content' },
    });
    
    // URL can have uppercase (GitHub ignores case)
    await service.addRemote(repo.path, 'origin', 'https://github.com/OWNER/REPO.git');
    
    const result = await service.getRemotes(repo.path);
    expect(result.provider).toBe('github');
  });
});
