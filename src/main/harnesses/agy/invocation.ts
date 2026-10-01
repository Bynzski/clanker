import type { HarnessSession } from '../../../shared/types/session';

export function buildInvocation(session: HarnessSession, fork = false, userFlags?: string) {
  const flags = userFlags?.trim() ? userFlags.trim().split(/\s+/) : [];
  // Local fork intentionally reuses resume; the CLI has no native fork.
  void fork;
  return { command: 'agy', args: ['--conversation', session.id, ...(session.modelId ? ['--model', session.modelId] : []), ...flags] };
}
