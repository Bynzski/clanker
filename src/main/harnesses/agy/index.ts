import { aiCommit } from './aiCommit';
import { disposeAllAgyAttention } from './attentionPlugin';
import { HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import { remote } from './remoteAttention';
import { local } from './attention';
import { remoteSessions } from './remoteSessions';
import { agyUsage } from './usage';
import { buildInvocation, validateLocal, validateRemote } from './invocation';
import { defineHarness, type HarnessProvider } from '../types';

export const agyProvider = defineHarness({
  descriptor: HARNESS_DESCRIPTORS.agy,
  models: { discover: async () => (await import('./models')).discoverModels(), fallback: [
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
    { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
    { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  ] },
  sessions: {
    discoveryOrder: 5,
    validateLocal,
    validateRemote,
    remote: remoteSessions,
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'emulated', build: (session, flags) => buildInvocation(session, true, flags), transports: ['local'] },
    selectionFlags: ['--conversation'],
    discover: async (workspace: string) => (await import('./sessions')).discoverAgySessions(workspace),
  },
  attention: { disposeResources: disposeAllAgyAttention, local, remote },
  aiCommit,
  usage: agyUsage,
  launch: { command: 'agy', args: [], modelArg: '--model' },
} satisfies HarnessProvider);
