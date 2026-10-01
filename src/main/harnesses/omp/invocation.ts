import type { HarnessSession } from '../../../shared/types/session';

export function buildInvocation(session: HarnessSession, fork = false, userFlags?: string) {
  const flags = userFlags?.trim() ? userFlags.trim().split(/\s+/) : [];
  return { command: 'omp', args: [fork ? '--fork' : '--resume', session.filePath ?? session.id, ...(session.modelId ? ['--model', session.modelId] : []), ...flags] };
}
