import { createHash } from 'crypto';

/** Stable, bounded directory names shared by local and SSH creation. */
export function worktreeDirectoryName(branch: string): string {
  const readable = branch.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16) || 'branch';
  return `${readable}-${createHash('sha256').update(branch).digest('hex').slice(0, 20)}`;
}
