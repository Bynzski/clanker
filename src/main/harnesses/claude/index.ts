import { HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import { remote } from './remoteAttention';
import { local, prepareResources, INTERPRETER } from './attention';
import { remoteSessions } from './remoteSessions';
import { buildInvocation } from './invocation';
import { claudeUsage } from './usage';
import { claudeAccounts } from './accounts';
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
  // Claude may assign a new session ID on resume, so a resumed ID is never pre-seeded.
  attention: { interpreter: INTERPRETER, prepareResources, local, remote },
  usage: claudeUsage,
  accounts: claudeAccounts,
  launch: { command: 'claude', args: [], modelArg: '--model' },
} satisfies HarnessProvider);
