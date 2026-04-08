/**
 * Git Test Helpers
 * Utilities for creating and managing real git repositories in tests.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface TempGitRepo {
  /** Path to the temporary repository */
  path: string;
  /** Cleanup function to remove the repo */
  cleanup: () => void;
}

/**
 * Create a real temporary git repository with optional initial content.
 * Uses LOCAL config to avoid race conditions with parallel test execution.
 */
export async function createTempGitRepo(options: {
  /** Initial files to create (filename -> content) */
  initialFiles?: Record<string, string>;
  /** Initial branch name (default: main) */
  initialBranch?: string;
  /** Whether to make an initial commit (default: true) */
  initialCommit?: boolean;
} = {}): Promise<TempGitRepo> {
  const { initialFiles = {}, initialBranch = 'main', initialCommit = true } = options;

  // Create temp directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-'));

  // Initialize repository first
  await execFileAsync('git', ['init'], { cwd: tempDir });

  // Configure git for test environment using LOCAL config (avoids --global lock contention)
  await execFileAsync('git', ['config', 'init.defaultBranch', initialBranch], { cwd: tempDir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: tempDir });

  // Create initial files - ensure at least one file exists for initial commit
  const filesToCreate = { ...initialFiles };
  if (Object.keys(filesToCreate).length === 0) {
    filesToCreate['.gitkeep'] = '';
  }

  for (const [filename, content] of Object.entries(filesToCreate)) {
    const filePath = path.join(tempDir, filename);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content);
  }

  // Stage and commit if requested
  if (initialCommit) {
    await execFileAsync('git', ['add', '.'], { cwd: tempDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: tempDir });
  }

  return {
    path: tempDir,
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

/**
 * Create a git repository with a remote (bare repo).
 */
export async function createTempGitRepoWithRemote(options: {
  /** Initial files */
  initialFiles?: Record<string, string>;
  /** Initial branch */
  initialBranch?: string;
} = {}): Promise<{ local: TempGitRepo; remote: TempGitRepo }> {
  // Create bare remote repo
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-remote-'));
  await execFileAsync('git', ['init', '--bare'], { cwd: remoteDir });

  // Create local repo with remote
  const local = await createTempGitRepo(options);

  // Add remote
  await execFileAsync('git', ['remote', 'add', 'origin', remoteDir], { cwd: local.path });

  return {
    local,
    remote: {
      path: remoteDir,
      cleanup: () => fs.rmSync(remoteDir, { recursive: true, force: true }),
    },
  };
}

/**
 * Run a git command in a repository.
 */
export async function git(repoPath: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd: repoPath });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const execError = error as { code?: number; stderr?: string; stdout?: string };
    return {
      stdout: execError.stdout || '',
      stderr: execError.stderr || '',
      exitCode: execError.code || 1,
    };
  }
}

/**
 * Create a file in a git repo and optionally stage it.
 */
export async function createFile(
  repoPath: string,
  filename: string,
  content: string,
  stage = false
): Promise<void> {
  const filePath = path.join(repoPath, filename);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content);

  if (stage) {
    await git(repoPath, ['add', filename]);
  }
}

/**
 * Modify an existing file in a git repo and optionally stage it.
 */
export async function modifyFile(
  repoPath: string,
  filename: string,
  content: string,
  stage = false
): Promise<void> {
  const filePath = path.join(repoPath, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  fs.writeFileSync(filePath, content);

  if (stage) {
    await git(repoPath, ['add', filename]);
  }
}

/**
 * Delete a file in a git repo and optionally stage it.
 */
export async function deleteFile(
  repoPath: string,
  filename: string,
  stage = false
): Promise<void> {
  const filePath = path.join(repoPath, filename);
  fs.unlinkSync(filePath);

  if (stage) {
    await git(repoPath, ['add', filename]);
  }
}

/**
 * Create a commit with a message.
 */
export async function commit(repoPath: string, message: string): Promise<string> {
  await git(repoPath, ['add', '-A']);
  const result = await git(repoPath, ['commit', '-m', message]);
  if (result.exitCode !== 0) {
    throw new Error(`Git commit failed: ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Get the current branch name.
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
  const result = await git(repoPath, ['branch', '--show-current']);
  return result.stdout.trim();
}

/**
 * Get list of branches.
 */
export async function getBranches(repoPath: string): Promise<string[]> {
  const result = await git(repoPath, ['branch', '--format=%(refname:short)']);
  return result.stdout.trim().split('\n').filter(Boolean);
}

/**
 * Check if a branch exists.
 */
export async function branchExists(repoPath: string, branchName: string): Promise<boolean> {
  const branches = await getBranches(repoPath);
  return branches.includes(branchName);
}

/**
 * Create a branch without switching to it.
 */
export async function createBranch(repoPath: string, branchName: string): Promise<void> {
  const result = await git(repoPath, ['branch', branchName]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create branch: ${result.stderr}`);
  }
}

/**
 * Switch to a branch.
 */
export async function switchBranch(repoPath: string, branchName: string): Promise<void> {
  // Try switch first (git 2.23+), fall back to checkout
  let result = await git(repoPath, ['switch', branchName]);
  if (result.exitCode !== 0) {
    result = await git(repoPath, ['checkout', branchName]);
  }
  if (result.exitCode !== 0) {
    throw new Error(`Failed to switch branch: ${result.stderr}`);
  }
}

/**
 * Delete a branch.
 */
export async function deleteBranch(repoPath: string, branchName: string, force = false): Promise<void> {
  const flag = force ? '-D' : '-d';
  const result = await git(repoPath, ['branch', flag, branchName]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to delete branch: ${result.stderr}`);
  }
}

/**
 * Get git status in porcelain format.
 */
export async function getStatus(repoPath: string): Promise<string> {
  const result = await git(repoPath, ['status', '--porcelain=v2']);
  return result.stdout;
}

/**
 * Get the staged files from git diff --cached --name-only.
 */
export async function getStagedFiles(repoPath: string): Promise<string[]> {
  const result = await git(repoPath, ['diff', '--cached', '--name-only']);
  return result.stdout.trim().split('\n').filter(Boolean);
}

/**
 * Get the working tree status: list of modified, added, deleted files.
 */
export async function getWorkingTreeFiles(repoPath: string): Promise<{
  modified: string[];
  untracked: string[];
  staged: string[];
}> {
  const status = await getStatus(repoPath);
  const modified: string[] = [];
  const untracked: string[] = [];
  const staged: string[] = [];

  for (const line of status.split('\n')) {
    if (!line.trim()) continue;

    // v2 format: 1 XY <sub> <spath> <mtp> <mt>s <mH> <mI> <HASH> <PATH>
    // or: 2 XY <sub> <spath> <mtp> <mt>s <mH> <mI> <OLDPATH> <NEWPATH> <PATHS>
    // or: ? <path>
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ');
      const xy = parts[1];
      const file = parts[parts.length - 1];

      if (xy[1] !== '.' || xy[0] !== '.') {
        staged.push(file);
      }
      if (xy[0] !== '.' || xy[1] !== '.') {
        modified.push(file);
      }
    } else if (line.startsWith('? ')) {
      untracked.push(line.substring(2));
    }
  }

  return { modified, untracked, staged };
}

/**
 * Stash changes.
 */
export async function stash(repoPath: string, message?: string): Promise<void> {
  const args = message ? ['stash', 'push', '-m', message] : ['stash', 'push'];
  const result = await git(repoPath, args);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to stash: ${result.stderr}`);
  }
}

/**
 * Get list of stash entries.
 */
export async function listStashes(repoPath: string): Promise<{ ref: string; message: string }[]> {
  const result = await git(repoPath, ['stash', 'list', '--format=%gd|%s']);
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, ...msgParts] = line.split('|');
      return { ref, message: msgParts.join('|') };
    });
}

/**
 * Apply a stash and optionally drop it.
 */
export async function applyStash(repoPath: string, stashRef: string, pop = false): Promise<void> {
  const cmd = pop ? ['stash', 'pop', stashRef] : ['stash', 'apply', stashRef];
  const result = await git(repoPath, cmd);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to ${pop ? 'pop' : 'apply'} stash: ${result.stderr}`);
  }
}

/**
 * Drop a stash entry.
 */
export async function dropStash(repoPath: string, stashRef: string): Promise<void> {
  const result = await git(repoPath, ['stash', 'drop', stashRef]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to drop stash: ${result.stderr}`);
  }
}

/**
 * Create a conflicting state for merge testing.
 */
export async function createConflict(repoPath: string, branchName: string): Promise<void> {
  // Create and commit on main
  await createFile(repoPath, 'conflict.txt', 'Original content\n', true);
  await commit(repoPath, 'Add conflict file');

  // Create branch and modify
  await createBranch(repoPath, branchName);
  await switchBranch(repoPath, branchName);
  await modifyFile(repoPath, 'conflict.txt', 'Branch content\n', true);
  await commit(repoPath, 'Modify on branch');

  // Switch back to main and modify differently
  await switchBranch(repoPath, 'main');
  await modifyFile(repoPath, 'conflict.txt', 'Main content\n', true);
  await commit(repoPath, 'Modify on main');

  // Attempt merge (will conflict)
  await git(repoPath, ['merge', branchName]);
}

/**
 * Abort an ongoing merge or rebase.
 */
export async function abortMerge(repoPath: string): Promise<void> {
  const result = await git(repoPath, ['merge', '--abort']);
  if (result.exitCode !== 0) {
    // Try rebase abort
    const rebaseResult = await git(repoPath, ['rebase', '--abort']);
    if (rebaseResult.exitCode !== 0) {
      throw new Error(`Failed to abort: ${rebaseResult.stderr}`);
    }
  }
}
