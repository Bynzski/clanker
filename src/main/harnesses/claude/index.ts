import { remote } from './remoteAttention';
import { local } from './attention';
import { remoteSessions } from './remoteSessions';
import { buildInvocation } from './invocation';
import type { HarnessProvider } from '../types';

export const claudeProvider = {
  descriptor: { id: 'claude', name: 'Claude', iconKey: 'claude', legacyIcon: '✨' },
  sessions: {
    remote: remoteSessions,
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'native', build: (session, flags) => buildInvocation(session, true, flags) },
    selectionFlags: ['--resume', '-r', '--continue', '-c', '--fork-session'],
    discover: async (workspace: string) => (await import('./sessions')).discoverClaudeSessions(workspace) },
  attention: { local, remote },
  launch: { command: 'claude', args: [], modelArg: '--model' },
} satisfies HarnessProvider;
