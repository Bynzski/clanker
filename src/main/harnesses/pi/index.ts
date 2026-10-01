import { HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import { remote } from './remoteAttention';
import { local, SOURCE } from './attention';
import { remoteSessions } from './remoteSessions';
import { buildInvocation } from './invocation';
import { defineHarness, type HarnessProvider } from '../types';

export const piProvider = defineHarness({
  descriptor: HARNESS_DESCRIPTORS.pi,
  models: { discover: async () => (await import('./models')).discoverModels() },
  sessions: {
    remote: remoteSessions,
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'native', build: (session, flags) => buildInvocation(session, true, flags) },
    selectionFlags: ['--session', '--continue', '-c', '--resume', '-r', '--fork'],
    discover: async (workspace: string) => (await import('./sessions')).discoverPiSessions(workspace),
  },
  attention: { local, remote, sources: () => ({ 'pi.ts': SOURCE }) },
  aiCommit: { command: 'pi', args: [], modelArg: '--model', timeoutMs: 45000 },
  launch: { command: 'pi', args: [], modelArg: '--model' },
} satisfies HarnessProvider);
