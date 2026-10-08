import { parseOpenCodeCommitOutput } from '../aiCommitOutput';
import { HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import { remote } from './remoteAttention';
import { local, prepareResources } from './attention';
import { remoteSessions } from './remoteSessions';
import { buildInvocation } from './invocation';
import { agentBridge } from './agentBridge';
import { checkoutRehome } from './rehome';
import { defineHarness, type HarnessProvider } from '../types';

export const opencodeProvider = defineHarness({
  descriptor: HARNESS_DESCRIPTORS.opencode,
  models: { discover: async () => (await import('./models')).discoverModels(),
    discoverInEnvironment: async (executor) => (await import('./models')).discoverModelsIn(executor), fallback: [
    { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'openai/gpt-4o', label: 'GPT-4o' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  ] },
  sessions: {
    discoveryOrder: 0,
    remote: remoteSessions,
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'native', build: (session, flags) => buildInvocation(session, true, flags) },
    selectionFlags: ['--session', '-s', '--continue', '-c', '--fork'],
    discover: async (workspace: string) => (await import('./sessions')).discoverOpenCodeSessions(workspace),
  },
  attention: { resumePreservesSessionId: true, source: 'native', prepareResources, local, remote },
  agentBridge,
  checkoutRehome,
  aiCommit: { modelArg: '-m', parseOutput: parseOpenCodeCommitOutput,
    buildInvocation: ({ model, prompt }) => ({ command: 'opencode', args: ['run', '--pure', '--format', 'json', ...(model ? ['-m', model] : [])], env: { OPENCODE_PERMISSION: JSON.stringify({ '*': 'deny' }) }, stdin: prompt, timeoutMs: 90000 }),
  },
  launch: { command: 'opencode', args: [], modelArg: '-m', env: { OPENCODE_PERMISSION: JSON.stringify({ bash: { '*': 'allow' }, edit: 'allow' }) } },
} satisfies HarnessProvider);
