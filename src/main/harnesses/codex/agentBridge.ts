import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HarnessAgentBridgeCapability } from '../types';
import { codexConfigOverrides } from './configArgs';

/** The user already defines this MCP server name, on the command line or in config.toml. */
export function codexBridgeConflicts(serverName: string, args: readonly string[], configToml: string): boolean {
  const escaped = serverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const key = new RegExp(`mcp_servers\\s*\\.\\s*["']?${escaped}["']?\\s*[.=\\]]`);
  return args.some((arg) => key.test(arg)) || new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*["']?${escaped}["']?\\s*\\]`, 'm').test(configToml)
    || new RegExp(`^\\s*mcp_servers\\s*\\.\\s*["']?${escaped}["']?\\s*\\.`, 'm').test(configToml);
}

/** The user already defines `developer_instructions`: on the command line, in config.toml, or via a profile. */
export function codexDeveloperInstructionsConflict(args: readonly string[], configToml: string): boolean {
  const key = /^\s*developer_instructions\s*=/;
  const profile = args.some((arg) => arg === '-p' || arg === '--profile' || arg.startsWith('--profile=') || (arg.startsWith('-p') && !arg.startsWith('--')));
  return profile || codexConfigOverrides(args).some((value) => key.test(value)) || /^\s*developer_instructions\s*=/m.test(configToml);
}

/**
 * Codex: `-c mcp_servers.<name>.*` overrides. Overrides are merged per key into the user's config,
 * so their own `[mcp_servers.*]` entries are untouched; only the (distinct) bridge name is added.
 * Compatibility fallback: Codex 0.160.1 excludes these keys from shared-daemon launches.
 * Profiles/custom loaders are excluded too; forcing --remote drops hook/MCP overrides.
 * Keep the warning visible; see docs/codex-shared-server-compatibility.md (#107).
 * The credential is read by Codex from `bearer_token_env_var`, never placed in argv.
 */
export const agentBridge: HarnessAgentBridgeCapability = {
  prepare({ url, serverName, tokenEnvVar, args, env, instructions }) {
    const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
    let configToml = '';
    try { configToml = fs.readFileSync(path.join(home, 'config.toml'), 'utf8'); } catch { /* absent */ }
    if (codexBridgeConflicts(serverName, args, configToml)) return null;
    const overrides = [
      '-c', `mcp_servers.${serverName}.url=${JSON.stringify(url)}`,
      '-c', `mcp_servers.${serverName}.bearer_token_env_var=${JSON.stringify(tokenEnvVar)}`,
    ];
    // Codex defers MCP tools behind `tool_search` and never shows the server's own instructions to the
    // model (observed: asked, it reported seeing neither the tool nor any instructions), so with a strong
    // prior for `git worktree` it never reaches for the Clanker tool. Its `developer_instructions` launch
    // override carries the guidance instead, but ONLY where the user has none of their own: a user's
    // instructions are never replaced or merged by guessing.
    if (instructions && !codexDeveloperInstructionsConflict(args, configToml)) {
      overrides.push('-c', `developer_instructions=${JSON.stringify(instructions)}`);
    }
    // Overrides are options of the top-level command: they precede a `resume`/`fork` subcommand.
    const subcommandIndex = args.findIndex((arg) => arg === 'resume' || arg === 'fork');
    return {
      args: subcommandIndex < 0 ? [...overrides, ...args]
        : [...args.slice(0, subcommandIndex), ...overrides, ...args.slice(subcommandIndex)],
      dispose() {},
    };
  },
};
