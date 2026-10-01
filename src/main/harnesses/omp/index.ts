import { HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import { remote } from './remoteAttention';
import { local, SOURCE } from './attention';
import { remoteSessions } from './remoteSessions';
import { buildInvocation, validateLocal } from './invocation';
import { defineHarness, type HarnessProvider } from '../types';

export const ompProvider = defineHarness({
  descriptor: HARNESS_DESCRIPTORS.omp,
  models: { discover: async () => (await import('./models')).discoverModels() },
  sessions: {
    validateLocal,
    remote: remoteSessions,
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'native', build: (session, flags) => buildInvocation(session, true, flags) },
    selectionFlags: ['--resume', '-r', '--continue', '-c', '--fork'],
    discover: async (workspace: string) => (await import('./sessions')).discoverOmpSessions(workspace),
  },
  attention: { local, remote, sources: () => ({ 'omp.ts': SOURCE }) },
  aiCommit: { command: 'omp', args: ['--print', '--no-session', '--no-tools', '--no-extensions'], modelArg: '--model', timeoutMs: 60000 },
  launch: { command: 'omp', args: [], modelArg: '--model' },
} satisfies HarnessProvider);
