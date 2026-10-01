import { HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import { remote } from './remoteAttention';
import { local, SOURCE, prepareResources } from './attention';
import { remoteSessions } from './remoteSessions';
import { buildInvocation } from './invocation';
import { defineHarness, type HarnessProvider } from '../types';

export const piProvider = defineHarness({
  descriptor: HARNESS_DESCRIPTORS.pi,
  models: { discover: async () => (await import('./models')).discoverModels() },
  sessions: {
    discoveryOrder: 2,
    remote: remoteSessions,
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'native', build: (session, flags) => buildInvocation(session, true, flags) },
    selectionFlags: ['--session', '--continue', '-c', '--resume', '-r', '--fork'],
    discover: async (workspace: string) => (await import('./sessions')).discoverPiSessions(workspace),
  },
  attention: { prepareResources, local, remote, sources: () => ({ 'pi.ts': SOURCE }) },
  aiCommit: { command: 'pi', args: ['--print'], modelArg: '--model', timeoutMs: 45000,
    buildInvocation: ({ model, prompt }) => ({ command: 'pi', args: [...['--print'], ...(model ? ['--model', model] : [])], stdin: prompt, timeoutMs: 45000 }),
  },
  launch: { command: 'pi', args: [], modelArg: '--model' },
} satisfies HarnessProvider);
