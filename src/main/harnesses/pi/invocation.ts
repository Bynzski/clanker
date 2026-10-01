import { toNativePath } from '../../../shared/pathNormalize';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveExistingFileWithinDirectory } from '../../security';
import { HarnessCapabilityError } from '../types';
import { invocationSessionRoot } from './sessionRoots';
import { discoverPiSessionFile } from './sessions';
import type { HarnessSession } from '../../../shared/types/session';

export function buildInvocation(session: HarnessSession, fork = false, userFlags?: string) {
  const flags = userFlags?.trim() ? userFlags.trim().split(/\s+/) : [];
  const model = session.modelId && session.provider ? `${session.provider}/${session.modelId}` : session.modelId;
  return { command: 'pi', args: [fork ? '--fork' : '--session', session.filePath ?? session.id, ...(model ? ['--model', model] : []), ...flags] };
}

/** Never use a renderer path as authority. Resolve identity from the configured
 * store afresh and require canonical regular files before parsing metadata. */
export async function validateLocal(session: HarnessSession, context: { workspacePath: string; userFlags?: string }): Promise<HarnessSession> {
  const { root, flat } = invocationSessionRoot(context.workspacePath, context.userFlags);
  const invalid = () => new HarnessCapabilityError('not-configured', 'Pi session file is invalid or no longer available');
  let entries: fs.Dirent[];
  try {
    if (fs.realpathSync(root) !== root) throw invalid();
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch { throw invalid(); }
  const directories = flat ? [root] : entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
  const matches: HarnessSession[] = [];
  for (const directory of directories) {
    if (fs.realpathSync(directory) !== directory) throw invalid();
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const candidate = path.join(directory, entry.name);
      const canonical = resolveExistingFileWithinDirectory(candidate, root);
      if (canonical !== candidate) throw invalid();
      const trusted = await discoverPiSessionFile(canonical, context.workspacePath);
      if (trusted?.id === session.id) matches.push(trusted);
    }
  }
  if (matches.length !== 1) throw invalid();
  const cwd = toNativePath(matches[0].cwd, process.platform);
  try {
    const workspace = fs.realpathSync(context.workspacePath);
    const canonicalCwd = fs.realpathSync(cwd);
    const relative = path.relative(workspace, canonicalCwd);
    if (!path.isAbsolute(cwd) || path.resolve(cwd) !== cwd || canonicalCwd !== cwd
      || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw invalid();
  } catch { throw invalid(); }
  // A stale or forged path is rejected even if the ID still exists elsewhere.
  if (session.filePath) {
    const supplied = toNativePath(session.filePath, process.platform);
    if (path.resolve(supplied) !== supplied || supplied !== matches[0].filePath) throw invalid();
  }
  return matches[0];
}
