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

const GIT_TEST_ENV = {
  ...process.env,
  GIT_PAGER: 'cat',
  GIT_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no',
  GIT_TERMINAL_PROMPT: '0',
};

function gitExecOptions(cwd: string) {
  return {
    cwd,
    env: GIT_TEST_ENV,
    timeout: 15000,
    windowsHide: true,
  } as const;
}

async function removeTempDir(dirPath: string): Promise<void> {
  // On Windows, git.exe may still hold directory handles after the test
  // completes. Use async retries with yields so the process can release
  // locks between attempts.
  const maxAttempts = 30;
  const delayMs = 100;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (!fs.existsSync(dirPath)) return;
      throw err;
    }
  }
}

export interface TempGitRepo {
  /** Path to the temporary repository */
  path: string;
  /** Cleanup function to remove the repo */
  cleanup: () => Promise<void>;
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

  // Initialize repository with an explicit branch name. Do not rely on the
  // runner's global init.defaultBranch, which varies across environments.
  await execFileAsync('git', ['init', '--initial-branch', initialBranch], gitExecOptions(tempDir));

  // Configure git for test environment using LOCAL config (avoids --global lock contention)
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], gitExecOptions(tempDir));
  await execFileAsync('git', ['config', 'user.name', 'Test User'], gitExecOptions(tempDir));
  await execFileAsync('git', ['config', 'core.autocrlf', 'false'], gitExecOptions(tempDir));

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
    await execFileAsync('git', ['add', '.'], gitExecOptions(tempDir));
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], gitExecOptions(tempDir));
  }

  return {
    path: tempDir,
    cleanup: async () => {
      await removeTempDir(tempDir);
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
  await execFileAsync('git', ['init', '--bare', '--initial-branch', options.initialBranch ?? 'main'], gitExecOptions(remoteDir));

  // Create local repo with remote
  const local = await createTempGitRepo(options);

  // Add remote
  await execFileAsync('git', ['remote', 'add', 'origin', remoteDir], gitExecOptions(local.path));

  return {
    local,
    remote: {
      path: remoteDir,
      cleanup: async () => removeTempDir(remoteDir),
    },
  };
}

/**
 * Run a git command in a repository.
 */
export async function git(repoPath: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, gitExecOptions(repoPath));
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
  const statusResult = await git(repoPath, ['status', '--porcelain=v2']);
  const status = statusResult.stdout;
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




