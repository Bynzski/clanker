import type { HarnessProvider } from '../types';

export const codexProvider = {
  descriptor: { id: 'codex', name: 'Codex', iconKey: 'codex', legacyIcon: '🧠' },
  launch: { command: 'codex', args: [], modelArg: '-m' },
} satisfies HarnessProvider;
