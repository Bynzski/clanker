import { parsePiCommitOutput } from '../aiCommitOutput';
import { HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import { agentBridge } from './agentBridge';
import { remote } from './remoteAttention';
import { local, prepareResources } from './attention';
import { remoteSessions } from './remoteSessions';
import { buildInvocation, validateLocal } from './invocation';
import { defineHarness, type HarnessProvider } from '../types';

export const piProvider = defineHarness({
  descriptor: HARNESS_DESCRIPTORS.pi,
  models: {
    discover: async () => (await import('./models')).discoverModels(),
    discoverInEnvironment: async (executor) => (await import('./models')).discoverModelsIn(executor),
  },
  sessions: {
    discoveryOrder: 2,
    validateLocal,
    remote: remoteSessions,
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'native', build: (session, flags) => buildInvocation(session, true, flags) },
    selectionFlags: ['--session', '--continue', '-c', '--resume', '-r', '--fork'],
    discover: async (workspace: string) => (await import('./sessions')).discoverPiSessions(workspace),
  },
  attention: { resumePreservesSessionId: true, authority: 'partial', source: 'native', prepareResources, local, remote },
  aiCommit: { modelArg: '--model', parseOutput: parsePiCommitOutput,
    buildInvocation: ({ model, prompt }) => ({ command: 'pi', args: ['--print', '--mode', 'json', '--no-session', '--no-tools', '--no-extensions', ...(model ? ['--model', model] : [])], stdin: prompt, timeoutMs: 45000 }),
  },
  agentBridge,
  launch: { command: 'pi', args: [], modelArg: '--model' },
} satisfies HarnessProvider);
