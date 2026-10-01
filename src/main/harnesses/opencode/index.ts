import type { HarnessProvider } from '../types';

export const opencodeProvider = {
  descriptor: { id: 'opencode', name: 'OpenCode', iconKey: 'opencode', legacyIcon: '⚡' },
  launch: { command: 'opencode', args: [], modelArg: '-m', env: { OPENCODE_PERMISSION: JSON.stringify({ bash: { '*': 'allow' }, edit: 'allow' }) } },
} satisfies HarnessProvider;
