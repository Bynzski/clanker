import { HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import { remote } from './remoteAttention';
import { hermesModelArgs } from './launch';
import { hermesUsage } from './usage';
import { hermesProfiles } from './profiles';
import { defineHarness, type HarnessProvider } from '../types';

export const hermesProvider = defineHarness({
  descriptor: HARNESS_DESCRIPTORS.hermes,
  models: { discover: async (refresh?: boolean) => (await import('./models')).discoverModels(refresh), explicitRefresh: true },
  attention: { remote },
  usage: hermesUsage,
  profiles: hermesProfiles,
  launch: { command: 'hermes', args: ['--tui'], modelArg: '-m', modelArgs: hermesModelArgs, localEnvironment: (flags?: string) => ({ HERMES_YOLO_MODE: /(?:^|\s)--yolo(?:\s|$)/.test(flags ?? '') ? '1' : '' }) },
} satisfies HarnessProvider);
