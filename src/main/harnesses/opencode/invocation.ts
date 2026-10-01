import type { HarnessSession } from '../../../shared/types/session';

export function buildInvocation(session: HarnessSession, fork = false, userFlags?: string) {
  const flags = userFlags?.trim() ? userFlags.trim().split(/\s+/) : [];
  return { command: 'opencode', args: ['--session', session.id, ...(fork ? ['--fork'] : []), ...flags] };
}
