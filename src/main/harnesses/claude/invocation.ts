import type { HarnessSession } from '../../../shared/types/session';

export function buildInvocation(session: HarnessSession, fork = false, userFlags?: string) {
  const flags = userFlags?.trim() ? userFlags.trim().split(/\s+/) : [];
  return { command: 'claude', args: ['--resume', session.id, ...(fork ? ['--fork-session'] : []), ...(session.modelId ? ['--model', session.modelId] : []), ...flags] };
}
