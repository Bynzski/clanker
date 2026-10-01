import { hermesModelArgs } from './launch';
import type { HarnessProvider } from '../types';

export const hermesProvider = {
  descriptor: { id: 'hermes', name: 'Hermes', iconKey: 'hermes', legacyIcon: '☿' },
  launch: { command: 'hermes', args: ['--tui'], modelArg: '-m', modelArgs: hermesModelArgs, localEnvironment: (flags?: string) => ({ HERMES_YOLO_MODE: /(?:^|\s)--yolo(?:\s|$)/.test(flags ?? '') ? '1' : '' }) },
} satisfies HarnessProvider;
