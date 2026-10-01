import type { HarnessProvider } from '../types';

export const ompProvider = {
  descriptor: { id: 'omp', name: 'Oh My Pi', iconKey: 'omp', legacyIcon: 'π' },
  models: { discover: async () => (await import('./models')).discoverModels() },
  launch: { command: 'omp', args: [], modelArg: '--model' },
} satisfies HarnessProvider;
