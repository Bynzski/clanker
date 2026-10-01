import { remote } from './remoteAttention';
import { local, SOURCE } from './attention';
import { remoteSessions } from './remoteSessions';
import { buildInvocation } from './invocation';
import type { HarnessProvider } from '../types';

export const piProvider = {
  descriptor: { id: 'pi', name: 'Pi', iconKey: 'pi', legacyIcon: 'π' },
  models: { discover: async () => (await import('./models')).discoverModels() },
  sessions: {
    remote: remoteSessions,
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'native', build: (session, flags) => buildInvocation(session, true, flags) },
    selectionFlags: ['--session', '--continue', '-c', '--resume', '-r', '--fork'],
    discover: async (workspace: string) => (await import('./sessions')).discoverPiSessions(workspace) },
  attention: { local, remote, sources: () => ({ 'pi.ts': SOURCE }) },
  launch: { command: 'pi', args: [], modelArg: '--model' },
} satisfies HarnessProvider;
