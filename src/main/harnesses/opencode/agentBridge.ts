import type { HarnessAgentBridgeCapability } from '../types';

/**
 * OpenCode: `OPENCODE_CONFIG_CONTENT`, which OpenCode deep-merges over every other config source,
 * so the user's own `mcp` entries stay. The credential is referenced as `{env:...}`, never inlined.
 * If the user already supplies this variable the launch is left alone rather than overwritten.
 */
export const agentBridge: HarnessAgentBridgeCapability = {
  prepare({ url, serverName, tokenEnvVar, env }) {
    if (env.OPENCODE_CONFIG_CONTENT) return null;
    return {
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          mcp: { [serverName]: { type: 'remote', url, enabled: true, headers: { Authorization: `Bearer {env:${tokenEnvVar}}` } } },
        }),
      },
      dispose() {},
    };
  },
};
