import type { HarnessProvider } from '../types';

export const codexProvider = {
  descriptor: { id: 'codex', name: 'Codex', iconKey: 'codex', legacyIcon: '🧠' },
  models: { discover: async () => (await import('./models')).discoverModels() },
  sessions: { discover: async (workspace: string) => (await import('./sessions')).discoverCodexSessions(workspace) },
  launch: { command: 'codex', args: [], modelArg: '-m' },
} satisfies HarnessProvider;
