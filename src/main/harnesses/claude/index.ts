import type { HarnessProvider } from '../types';

export const claudeProvider = {
  descriptor: { id: 'claude', name: 'Claude', iconKey: 'claude', legacyIcon: '✨' },
  launch: { command: 'claude', args: [], modelArg: '--model' },
} satisfies HarnessProvider;
