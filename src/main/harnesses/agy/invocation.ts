import type { HarnessSession } from '../../../shared/types/session';

export function buildInvocation(session: HarnessSession, fork = false, userFlags?: string) {
  const flags = userFlags?.trim() ? userFlags.trim().split(/\s+/) : [];
  // Local fork intentionally reuses resume; the CLI has no native fork.
  void fork;
  return { command: 'agy', args: ['--conversation', session.id, ...(session.modelId ? ['--model', session.modelId] : []), ...flags] };
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
export function validateLocal(session: HarnessSession): HarnessSession {
  if (typeof session.id !== 'string' || !SESSION_ID.test(session.id.trim())) throw new Error('Antigravity session ID is invalid');
  let modelId = session.modelId;
  if (modelId !== undefined) {
    if (typeof modelId !== 'string' || (modelId.trim() && !MODEL_ID.test(modelId.trim()))) throw new Error('Antigravity model ID is invalid');
    modelId = modelId.trim() || undefined;
  }
  return { ...session, id: session.id.trim(), modelId };
}
export function validateRemote(session: HarnessSession): boolean { return SESSION_ID.test(session.id); }
