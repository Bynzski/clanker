import { HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import { remote } from './remoteAttention';
import { local, prepareResources } from './attention';
import { remoteSessions } from './remoteSessions';
import { buildInvocation } from './invocation';
import { claudeUsage } from './usage';
import { defineHarness, type HarnessProvider } from '../types';

export const claudeProvider = defineHarness({
  descriptor: HARNESS_DESCRIPTORS.claude,
  sessions: {
    discoveryOrder: 4,
    remote: remoteSessions,
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'native', build: (session, flags) => buildInvocation(session, true, flags) },
    selectionFlags: ['--resume', '-r', '--continue', '-c', '--fork-session'],
    discover: async (workspace: string) => (await import('./sessions')).discoverClaudeSessions(workspace),
  },
  attention: { prepareResources, local, remote },
  usage: claudeUsage,
  launch: { command: 'claude', args: [], modelArg: '--model' },
} satisfies HarnessProvider);
