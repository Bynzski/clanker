import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Main-only evidence that Git ran in an accessible directory with no .git entry. */
export class GitRepositoryAbsentError extends Error {
  constructor(readonly stderr: string) { super(stderr.trim()); }
}

export async function hasLocalGitMetadata(root: string): Promise<boolean> {
  if (!(await fs.stat(root)).isDirectory()) throw new Error('Git directory is unavailable');
  await fs.access(root, fs.constants.R_OK | fs.constants.X_OK);
  try { await fs.lstat(path.join(root, '.git')); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** An exact discovery diagnostic alone also describes corrupt .git directories. Check both. */
export async function withGitRepositoryDiscovery<T>(execute: () => Promise<T>, hasMetadata: () => Promise<boolean>): Promise<T> {
  try { return await execute(); }
  catch (error) {
    const failure = error as { code?: unknown; exitCode?: unknown; stderr?: unknown; killed?: boolean; signal?: unknown };
    const stderr = typeof failure?.stderr === 'string' ? failure.stderr.trim() : '';
    const discoveryFailed = !failure?.killed && !failure?.signal && (failure?.exitCode ?? failure?.code) === 128
      && (/^fatal: not a git repository \(or any of the parent directories\): \.git$/.test(stderr)
        || /^fatal: not a git repository \(or any parent up to mount point [^\n]+\)\nStopping at filesystem boundary \(GIT_DISCOVERY_ACROSS_FILESYSTEM not set\)\.$/.test(stderr));
    if (discoveryFailed && !await hasMetadata().catch(() => true)) throw new GitRepositoryAbsentError(stderr);
    throw error;
  }
}
