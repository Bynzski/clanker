import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GitWorktreeChanges, GitWorktreeInspectionResult } from '../shared/types/git';

export const MAX_WORKTREE_CHANGE_EXAMPLES = 20;

/** Parse NUL-delimited porcelain v1, including the extra source record for renames/copies. */
export function parseWorktreeChanges(stdout: string): GitWorktreeChanges {
  const changes: GitWorktreeChanges = {
    tracked: { count: 0, paths: [] }, untracked: { count: 0, paths: [] }, ignored: { count: 0, paths: [] },
  };
  const records = stdout.split('\0');
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') throw new Error('Invalid Git status record');
    const status = record.slice(0, 2);
    const relative = record.slice(3);
    if (path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.split('/').includes('..')) {
      throw new Error('Git status path is outside the checkout');
    }
    const group = status === '!!' ? changes.ignored : status === '??' ? changes.untracked : changes.tracked;
    group.count++;
    if (group.paths.length < MAX_WORKTREE_CHANGE_EXAMPLES && Buffer.byteLength(relative) <= 4096) group.paths.push(relative);
    if (/[RC]/.test(status)) {
      if (!records[++index]) throw new Error('Invalid Git rename record');
    }
  }
  return changes;
}

/** Missing/older inspection detail can never authorize an ignored-only override. */
export function canRemoveWorktree(inspection: GitWorktreeInspectionResult, discardIgnored = false): boolean {
  if (!inspection.success || typeof inspection.hasChanges !== 'boolean') return false;
  if (!inspection.hasChanges) return true;
  const changes = inspection.changes;
  return discardIgnored && !!changes && changes.tracked.count === 0 && changes.untracked.count === 0 && changes.ignored.count > 0;
}

/** Validate host-supplied detail before using it to authorize ignored-only removal. */
export function validateWorktreeChanges(value: unknown, hasChanges: boolean): GitWorktreeChanges {
  if (!value || typeof value !== 'object') throw new Error('Invalid worktree change detail');
  const result = value as GitWorktreeChanges;
  for (const key of ['tracked', 'untracked', 'ignored'] as const) {
    const group = result[key];
    if (!group || !Number.isSafeInteger(group.count) || group.count < 0 || !Array.isArray(group.paths)
      || group.paths.length > MAX_WORKTREE_CHANGE_EXAMPLES || group.paths.length > group.count
      || !group.paths.every((entry) => typeof entry === 'string' && entry.length > 0 && !entry.includes('\0')
        && Buffer.byteLength(entry) <= 4096 && !path.posix.isAbsolute(entry) && !path.win32.isAbsolute(entry)
        && !entry.split('/').includes('..'))) throw new Error('Invalid worktree change detail');
  }
  if ((result.tracked.count + result.untracked.count + result.ignored.count > 0) !== hasChanges) {
    throw new Error('Inconsistent worktree change detail');
  }
  return result;
}

/** Inspect initialized submodules too: parent status omits their ignored files. */
export async function inspectWorktreeChanges(
  root: string, execGit: (cwd: string, args: string[]) => Promise<{ stdout: string }>,
): Promise<GitWorktreeChanges> {
  const canonicalRoot = fs.realpathSync.native(root);
  const visited = new Set<string>();
  const changes: GitWorktreeChanges = parseWorktreeChanges('');
  const inspect = async (cwd: string): Promise<void> => {
    const canonical = fs.realpathSync.native(cwd);
    const relative = path.relative(canonicalRoot, canonical);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      || visited.has(canonical) || visited.size >= 128) throw new Error('Submodule inspection exceeded its root or repository limit');
    visited.add(canonical);
    const { stdout } = await execGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none']);
    const own = parseWorktreeChanges(stdout);
    for (const key of ['tracked', 'untracked', 'ignored'] as const) {
      changes[key].count += own[key].count;
      for (const entry of own[key].paths) {
        const example = path.posix.join(relative.split(path.sep).join('/'), entry);
        if (changes[key].paths.length < MAX_WORKTREE_CHANGE_EXAMPLES && Buffer.byteLength(example) <= 4096) changes[key].paths.push(example);
      }
    }
    const index = await execGit(cwd, ['ls-files', '--stage', '-z']);
    for (const record of index.stdout.split('\0')) {
      if (!record.startsWith('160000 ')) continue;
      const submodule = path.resolve(cwd, record.slice(record.indexOf('\t') + 1));
      const subRelative = path.relative(canonicalRoot, submodule);
      if (subRelative === '..' || subRelative.startsWith(`..${path.sep}`) || path.isAbsolute(subRelative)) {
        throw new Error('Submodule path is outside the checkout');
      }
      // Do not inspect through a symlink or a repository outside this checkout.
      if (fs.realpathSync.native(submodule) !== submodule) throw new Error('Submodule path is no longer canonical');
      if (!fs.existsSync(path.join(submodule, '.git'))) {
        if (fs.readdirSync(submodule).length) changes.untracked.count++;
        continue;
      }
      const top = await execGit(submodule, ['rev-parse', '--show-toplevel']);
      if (fs.realpathSync.native(top.stdout.trimEnd()) !== submodule) throw new Error('Submodule repository identity changed');
      await inspect(submodule);
    }
  };
  await inspect(canonicalRoot);
  return changes;
}
