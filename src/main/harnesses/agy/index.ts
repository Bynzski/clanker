import type { HarnessProvider } from '../types';

export const agyProvider = {
  descriptor: { id: 'agy', name: 'Antigravity', iconKey: 'agy', legacyIcon: '🪐' },
  launch: { command: 'agy', args: [], modelArg: '--model' },
} satisfies HarnessProvider;
