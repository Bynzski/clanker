import type { HarnessProvider } from '../types';

export const piProvider = {
  descriptor: { id: 'pi', name: 'Pi', iconKey: 'pi', legacyIcon: 'π' },
  models: { discover: async () => (await import('./models')).discoverModels() },
  launch: { command: 'pi', args: [], modelArg: '--model' },
} satisfies HarnessProvider;
