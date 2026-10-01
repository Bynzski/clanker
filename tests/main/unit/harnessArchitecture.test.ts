import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_HARNESS_IDS } from '../../../src/shared/harnessIds';

// Deliberately scoped: identity matching, renderer presentation, and provider
// internals are valid. Shared feature orchestrators must not dispatch on IDs.
const orchestrators = [
  'harnessCatalog.ts', 'harnessLaunch.ts', 'sessionHistory.ts', 'sessionLaunch.ts',
  'agentAttentionAdapters.ts', 'aiCommit.ts', 'ipc/terminalIpc.ts', 'ipc/sessionIpc.ts',
  'ipc/remoteSessionInvocation.ts', 'ipc/aiCommitIpc.ts',
  'remote/sshSessionDiscovery.ts', 'remote/sshAgentAttention.ts', 'remote/sshEnvironment.ts',
];
describe('harness architecture boundaries', () => {
  it.each(orchestrators)('%s does not rebuild a harness dispatch matrix', (file) => {
    const source = readFileSync(resolve('src/main', file), 'utf8');
    for (const id of KNOWN_HARNESS_IDS) {
      expect(source).not.toMatch(new RegExp(`(?:===|!==|==|!=)\\s*['"]${id}['"]`));
      expect(source).not.toMatch(new RegExp(`\\b${id}\\s*:`));
      expect(source).not.toMatch(new RegExp(`case\\s+['"]${id}['"]`));
    }
  });
});
