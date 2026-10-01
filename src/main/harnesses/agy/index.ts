import { buildInvocation } from './invocation';
import type { HarnessProvider } from '../types';

export const agyProvider = {
  descriptor: { id: 'agy', name: 'Antigravity', iconKey: 'agy', legacyIcon: '🪐' },
  models: { discover: async () => (await import('./models')).discoverModels(), fallback: [
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
    { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
    { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  ] },
  sessions: {
    resume: { support: 'native', build: (session, flags) => buildInvocation(session, false, flags) },
    fork: { support: 'emulated', build: (session, flags) => buildInvocation(session, true, flags), transports: ['local'] },
    selectionFlags: ['--conversation'],
    discover: async (workspace: string) => (await import('./sessions')).discoverAgySessions(workspace) },
  launch: { command: 'agy', args: [], modelArg: '--model' },
} satisfies HarnessProvider;
