import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HarnessAgentBridgeCapability } from '../types';

/** The user already defines this MCP server name, on the command line or in config.toml. */
export function codexBridgeConflicts(serverName: string, args: readonly string[], configToml: string): boolean {
  const escaped = serverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const key = new RegExp(`mcp_servers\\s*\\.\\s*["']?${escaped}["']?\\s*[.=\\]]`);
  return args.some((arg) => key.test(arg)) || new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*["']?${escaped}["']?\\s*\\]`, 'm').test(configToml)
    || new RegExp(`^\\s*mcp_servers\\s*\\.\\s*["']?${escaped}["']?\\s*\\.`, 'm').test(configToml);
}

/**
 * Codex: `-c mcp_servers.<name>.*` overrides. Overrides are merged per key into the user's config,
 * so their own `[mcp_servers.*]` entries are untouched; only the (distinct) bridge name is added.
 * The credential is read by Codex from `bearer_token_env_var`, never placed in argv.
 */
export const agentBridge: HarnessAgentBridgeCapability = {
  prepare({ url, serverName, tokenEnvVar, args, env }) {
    const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
    let configToml = '';
    try { configToml = fs.readFileSync(path.join(home, 'config.toml'), 'utf8'); } catch { /* absent */ }
    if (codexBridgeConflicts(serverName, args, configToml)) return null;
    const overrides = [
      '-c', `mcp_servers.${serverName}.url=${JSON.stringify(url)}`,
      '-c', `mcp_servers.${serverName}.bearer_token_env_var=${JSON.stringify(tokenEnvVar)}`,
    ];
    // Overrides are options of the top-level command: they precede a `resume`/`fork` subcommand.
    const subcommandIndex = args.findIndex((arg) => arg === 'resume' || arg === 'fork');
    return {
      args: subcommandIndex < 0 ? [...overrides, ...args]
        : [...args.slice(0, subcommandIndex), ...overrides, ...args.slice(subcommandIndex)],
      dispose() {},
    };
  },
};
