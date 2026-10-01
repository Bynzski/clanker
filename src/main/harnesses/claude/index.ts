import type { HarnessProvider } from '../types';

export const claudeProvider = {
  descriptor: { id: 'claude', name: 'Claude', iconKey: 'claude', legacyIcon: '✨' },
  sessions: { discover: async (workspace: string) => (await import('./sessions')).discoverClaudeSessions(workspace) },
  launch: { command: 'claude', args: [], modelArg: '--model' },
} satisfies HarnessProvider;
