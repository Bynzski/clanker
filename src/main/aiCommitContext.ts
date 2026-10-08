import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { resolveExistingFileWithinDirectory } from './security';
import type { GitStatusEntry } from './gitService';

const MAX_CONTEXT_BYTES = 40 * 1024;
const MAX_FILE_BYTES = 8 * 1024;

/** Local-only, bounded untracked content. Never follow an untracked link outside the root. */
export async function buildCommitDiffContext(root: string, diff: string, changes: GitStatusEntry[]): Promise<string> {
  let output = Buffer.from(diff).subarray(0, MAX_CONTEXT_BYTES).toString('utf8');
  if (Buffer.byteLength(diff) > MAX_CONTEXT_BYTES) output += '\n[Tracked patch truncated]';
  for (const change of changes.filter((entry) => entry.status === 'untracked').slice(0, 32)) {
    if (Buffer.byteLength(output) + MAX_FILE_BYTES + 512 > MAX_CONTEXT_BYTES) {
      output += '\n[Additional untracked content omitted]';
      break;
    }
    const candidate = path.resolve(root, change.path);
    const safePath = resolveExistingFileWithinDirectory(candidate, root);
    output += `\nUntracked file: ${change.path.slice(0, 256)}\n`;
    if (!safePath) { output += '[Unavailable or outside checkout]\n'; continue; }
    try {
      const file = await open(safePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
      try {
        // Recheck canonical identity after opening; only bounded regular files are read.
        const opened = await file.stat();
        const current = await stat(safePath);
        if (resolveExistingFileWithinDirectory(candidate, root) !== safePath || !opened.isFile()
          || opened.ino !== current.ino || opened.dev !== current.dev) {
          output += '[Unavailable]\n'; continue;
        }
        const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        output += buffer.subarray(0, bytesRead).includes(0) ? '[Binary file]\n'
          : buffer.subarray(0, Math.min(bytesRead, MAX_FILE_BYTES)).toString('utf8') + (bytesRead > MAX_FILE_BYTES ? '\n[File truncated]\n' : '\n');
      } finally { await file.close(); }
    } catch { output += '[Unable to read file]\n'; }
  }
  return output;
}
