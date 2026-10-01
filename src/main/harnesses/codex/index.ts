import { remote } from './remoteAttention';
import { local } from './attention';
import { remoteSessions } from './remoteSessions';
import { buildInvocation } from './invocation';
import type { HarnessProvider } from '../types';

export const codexProvider = {
  descriptor: { id: 'codex', name: 'Codex', iconKey: 'codex', legacyIcon: '🧠' },
  models: { discover: async () => (await import('./models')).discoverModels() },
  sessions: {
    remote: remoteSessions,
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'native', build: (session, flags) => buildInvocation(session, true, flags) },
    selectionFlags: ['resume', 'fork'],
    discover: async (workspace: string) => (await import('./sessions')).discoverCodexSessions(workspace) },
  attention: { local, remote },
  aiCommit: { command: 'codex', args: ['exec'], modelArg: '-m', timeoutMs: 60000 },
  launch: { command: 'codex', args: [], modelArg: '-m' },
} satisfies HarnessProvider;
