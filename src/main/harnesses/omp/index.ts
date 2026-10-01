import type { HarnessProvider } from '../types';

export const ompProvider = {
  descriptor: { id: 'omp', name: 'Oh My Pi', iconKey: 'omp', legacyIcon: 'π' },
  launch: { command: 'omp', args: [], modelArg: '--model' },
} satisfies HarnessProvider;
