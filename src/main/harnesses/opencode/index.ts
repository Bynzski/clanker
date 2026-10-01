import type { HarnessProvider } from '../types';

export const opencodeProvider = {
  descriptor: { id: 'opencode', name: 'OpenCode', iconKey: 'opencode', legacyIcon: '⚡' },
  launch: { command: 'opencode', args: [], modelArg: '-m' },
} satisfies HarnessProvider;
