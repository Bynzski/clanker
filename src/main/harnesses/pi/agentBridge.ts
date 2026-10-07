import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessAgentBridgeCapability } from '../types';

/** Pi 1.0.4: session-only registrations, consumed by its built-in MCP extension. */
export function piBridgeSource(serverName: string, url: string, tokenEnvVar: string): string {
  const config = { url, headers: { Authorization: 'Bearer ${' + tokenEnvVar + '}' }, exposure: 'direct' };
  return `export default function (pi) {
  // Older Pi versions have no registration API. Never interfere with the ordinary launch.
  if (typeof pi.registerMcpServer !== 'function' || typeof pi.getCommands !== 'function') return;
  let registered = false;
  pi.on('session_start', () => {
    // Check after all extensions load: disabled/replaced built-ins must stay that way.
    // Pi's public command metadata identifies the built-in independently of install paths.
    const builtin = pi.getCommands().some((command) => command.name === 'mcp'
      && command.sourceInfo?.path === 'builtin:mcp');
    if (!builtin || registered) return;
    try {
      // Pi honors file-configured names (including normalized aliases), --tools and
      // --exclude-tools. Another extension's registration throws; never replace it.
      pi.registerMcpServer(${JSON.stringify(serverName)}, ${JSON.stringify(config)});
      registered = true;
    } catch {
      // A conflicting registration leaves the user's server and ordinary session usable.
    }
  });
}
`;
}

export const agentBridge: HarnessAgentBridgeCapability = {
  prepare({ args, scratchDir, serverName, url, tokenEnvVar }) {
    if (args.some((arg) => arg === '--no-mcp' || arg === '--no-extensions'
      || arg.startsWith('--no-mcp=') || arg.startsWith('--no-extensions='))) return null;
    const extension = join(scratchDir(), 'pi-clanker-mcp.ts');
    writeFileSync(extension, piBridgeSource(serverName, url, tokenEnvVar), { mode: 0o600 });
    return { args: [...args, '--extension', extension], dispose() {} };
  },
};
