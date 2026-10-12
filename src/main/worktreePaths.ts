import { createHash } from 'crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Destructive-operation identity includes missing tails; permission failures fail closed. */
export function resolveWorktreeUsagePath(usagePath: string): string {
  let existingPath = path.resolve(usagePath);
  const missingSegments: string[] = [];
  while (true) {
    try {
      const resolved = path.join(fs.realpathSync.native(existingPath), ...missingSegments);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(existingPath);
      if (parent === existingPath) throw error;
      missingSegments.unshift(path.basename(existingPath));
      existingPath = parent;
    }
  }
}

/** Stable, bounded directory names shared by local and SSH creation. */
export function worktreeDirectoryName(branch: string): string {
  const readable = branch.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16) || 'branch';
  return `${readable}-${createHash('sha256').update(branch).digest('hex').slice(0, 20)}`;
}
