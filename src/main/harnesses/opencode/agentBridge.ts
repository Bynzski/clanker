import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarnessAgentBridgeCapability } from '../types';

/**
 * OpenCode: `OPENCODE_CONFIG_CONTENT`, which OpenCode deep-merges over every other config source,
 * so the user's own `mcp` entries stay. The credential is referenced as `{env:...}`, never inlined.
 * If the user already supplies this variable the launch is left alone rather than overwritten.
 *
 * Lifecycle guidance travels as one extra entry of the config's `instructions` array. OpenCode
 * concatenates that array across config sources (measured with 1.18.34: the user's own entries stay and
 * ours is appended), and an entry is a file, so it is a private, launch-owned file in a fresh 0700
 * directory that `dispose` removes. It carries no credential. No project instruction file is touched.
 */
export const agentBridge: HarnessAgentBridgeCapability = {
  prepare({ url, serverName, tokenEnvVar, env, instructions }) {
    if (env.OPENCODE_CONFIG_CONTENT) return null;
    let directory: string | undefined;
    const config: { mcp: Record<string, unknown>; instructions?: string[] } = {
      mcp: { [serverName]: { type: 'remote', url, enabled: true, headers: { Authorization: `Bearer {env:${tokenEnvVar}}` } } },
    };
    if (instructions) {
      try {
        directory = mkdtempSync(join(tmpdir(), 'clanker-opencode-'));
        const file = join(directory, 'clanker-agent-guidance.md');
        writeFileSync(file, instructions, { mode: 0o600 });
        config.instructions = [file];
      } catch {
        // Guidance is an aid; the tools' own descriptions still carry the contract.
        if (directory) rmSync(directory, { recursive: true, force: true });
        directory = undefined;
      }
    }
    const owned = directory;
    return {
      env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
      dispose() { if (owned) rmSync(owned, { recursive: true, force: true }); },
    };
  },
};
