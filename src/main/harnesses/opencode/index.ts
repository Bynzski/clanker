import { buildInvocation } from './invocation';
import type { HarnessProvider } from '../types';

export const opencodeProvider = {
  descriptor: { id: 'opencode', name: 'OpenCode', iconKey: 'opencode', legacyIcon: '⚡' },
  models: { discover: async () => (await import('./models')).discoverModels(), fallback: [
    { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'openai/gpt-4o', label: 'GPT-4o' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  ] },
  sessions: {
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'native', build: (session, flags) => buildInvocation(session, true, flags) },
    selectionFlags: ['--session', '-s', '--continue', '-c', '--fork'],
    discover: async (workspace: string) => (await import('./sessions')).discoverOpenCodeSessions(workspace) },
  launch: { command: 'opencode', args: [], modelArg: '-m', env: { OPENCODE_PERMISSION: JSON.stringify({ bash: { '*': 'allow' }, edit: 'allow' }) } },
} satisfies HarnessProvider;
