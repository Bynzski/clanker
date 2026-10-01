import { remote } from './remoteAttention';
import { local, SOURCE } from './attention';
import { remoteSessions } from './remoteSessions';
import { buildInvocation } from './invocation';
import type { HarnessProvider } from '../types';

export const ompProvider = {
  descriptor: { id: 'omp', name: 'Oh My Pi', iconKey: 'omp', legacyIcon: 'π' },
  models: { discover: async () => (await import('./models')).discoverModels() },
  sessions: {
    remote: remoteSessions,
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'native', build: (session, flags) => buildInvocation(session, true, flags) },
    selectionFlags: ['--resume', '-r', '--continue', '-c', '--fork'],
    discover: async (workspace: string) => (await import('./sessions')).discoverOmpSessions(workspace) },
  attention: { local, remote, sources: () => ({ 'omp.ts': SOURCE }) },
  aiCommit: { command: 'omp', args: ['--print', '--no-session', '--no-tools', '--no-extensions'], modelArg: '--model', timeoutMs: 60000 },
  launch: { command: 'omp', args: [], modelArg: '--model' },
} satisfies HarnessProvider;
