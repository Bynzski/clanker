import { HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import { remote } from './remoteAttention';
import { local, INTERPRETER } from './attention';
import { remoteSessions } from './remoteSessions';
import { buildInvocation } from './invocation';
import { codexUsage } from './usage';
import { codexAccounts } from './accounts';
import { agentBridge } from './agentBridge';
import { checkoutRehome } from './rehome';
import { defineHarness, type HarnessProvider } from '../types';

export const codexProvider = defineHarness({
  descriptor: HARNESS_DESCRIPTORS.codex,
  models: {
    discover: async () => (await import('./models')).discoverModels(),
    discoverInEnvironment: async (executor) => (await import('./models')).discoverModelsIn(executor),
    compatibility: { cacheParseFailureAsEmpty: true },
  },
  sessions: {
    resumesWithoutOriginalDirectory: true,
    discoveryOrder: 1,
    remote: remoteSessions,
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'native', build: (session, flags) => buildInvocation(session, true, flags) },
    selectionFlags: ['resume', 'fork'],
    discover: async (workspace: string) => (await import('./sessions')).discoverCodexSessions(workspace),
  },
  attention: { interpreter: INTERPRETER, resumePreservesSessionId: true, hooksRunInAgentDirectory: true, local, remote },
  usage: codexUsage,
  agentBridge,
  checkoutRehome,
  accounts: codexAccounts,
  aiCommit: { modelArg: '-m',
    buildInvocation: ({ model, prompt }) => ({ command: 'codex', args: [...['exec'], ...(model ? ['-m', model] : [])], stdin: prompt, timeoutMs: 60000 }),
  },
  launch: { command: 'codex', args: [], modelArg: '-m' },
} satisfies HarnessProvider);
