import type { HarnessSession } from '../../../shared/types/session';
import { assertLocalOpenCodeOperation } from './compatibility';

export function buildInvocation(session: HarnessSession, fork = false, userFlags?: string, transport: 'local' | 'ssh' = 'local') {
  if (fork && transport === 'local') assertLocalOpenCodeOperation('fork');
  const flags = userFlags?.trim() ? userFlags.trim().split(/\s+/) : [];
  return { command: 'opencode', args: ['--session', session.id, ...(fork ? ['--fork'] : []), ...flags] };
}
