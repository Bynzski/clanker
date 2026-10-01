import type { HarnessProvider } from '../types';

export const hermesProvider = {
  descriptor: { id: 'hermes', name: 'Hermes', iconKey: 'hermes', legacyIcon: '☿' },
  launch: { command: 'hermes', args: ['--tui'], modelArg: '-m' },
} satisfies HarnessProvider;
