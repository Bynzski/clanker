import type { HarnessSession } from '../../../shared/types/session';

export function buildInvocation(session: HarnessSession, fork = false, userFlags?: string) {
  const flags = userFlags?.trim() ? userFlags.trim().split(/\s+/) : [];
  return { command: 'codex', args: [fork ? 'fork' : 'resume', session.id, ...(session.modelId ? ['-m', session.modelId] : []), ...flags] };
}
