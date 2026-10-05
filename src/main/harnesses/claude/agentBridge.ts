import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HarnessAgentBridgeCapability } from '../types';

/**
 * Claude Code: an extra `--mcp-config` file. Without `--strict-mcp-config` Claude merges it with the
 * user's own MCP servers (user, project and local scopes keep working), so nothing is replaced.
 * The credential is never written: the header expands `${CLANKER_MCP_TOKEN}` from the child's
 * environment, and the config lives in the launch's private scratch directory.
 */
export const agentBridge: HarnessAgentBridgeCapability = {
  prepare({ url, serverName, tokenEnvVar, args, scratchDir }) {
    // The user asked for exactly the servers they listed; do not add one.
    if (args.includes('--strict-mcp-config')) return null;
    const file = path.join(scratchDir(), 'claude-mcp.json');
    fs.writeFileSync(file, JSON.stringify({
      mcpServers: { [serverName]: { type: 'http', url, headers: { Authorization: `Bearer \${${tokenEnvVar}}` } } },
    }), { mode: 0o600 });
    // `--mcp-config` is variadic, so it goes last: nothing after it can be swallowed.
    return { args: [...args, '--mcp-config', file], dispose() {} };
  },
};
