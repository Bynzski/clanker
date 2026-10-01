import type { HarnessSession } from '../../../shared/types/session';

export function buildInvocation(session: HarnessSession, fork = false, userFlags?: string) {
  const flags = userFlags?.trim() ? userFlags.trim().split(/\s+/) : [];
  const model = session.modelId && session.provider ? `${session.provider}/${session.modelId}` : session.modelId;
  return { command: 'pi', args: [fork ? '--fork' : '--session', session.filePath ?? session.id, ...(model ? ['--model', model] : []), ...flags] };
}
