import * as os from 'node:os';
import * as path from 'node:path';
import { toNativePath } from '../../../shared/pathNormalize';
import { resolveExistingFileWithinDirectory } from '../../security';
import type { HarnessSession } from '../../../shared/types/session';

export function buildInvocation(session: HarnessSession, fork = false, userFlags?: string) {
  const flags = userFlags?.trim() ? userFlags.trim().split(/\s+/) : [];
  return { command: 'omp', args: [fork ? '--fork' : '--resume', session.filePath ?? session.id, ...(session.modelId ? ['--model', session.modelId] : []), ...flags] };
}

export function validateLocal(session: HarnessSession): HarnessSession {
  const filePath = session.filePath?.endsWith('.jsonl')
    ? resolveExistingFileWithinDirectory(toNativePath(session.filePath, process.platform), path.join(os.homedir(), '.omp', 'agent', 'sessions'))
    : null;
  if (!filePath) throw new Error('OMP session file is invalid');
  return { ...session, filePath };
}
