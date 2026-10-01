import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { hookNodeExecutable } from '../localAttention';

interface ActiveAgyAttentionPlugin {
  directory: string;
  terminalIds: Set<string>;
}

const AGY_PLUGIN_NAME = 'clanker-grid-attention';
const AGY_PLUGIN_OWNER_MARKER = '.clanker-grid-owner';
const AGY_PLUGIN_OWNER = 'clanker-grid:agy-attention:v1\n';

let activeAgyPlugin: ActiveAgyAttentionPlugin | null = null;
export function agyAttentionPlugin(command: string, platform: NodeJS.Platform): {
  pluginJson: { $schema: string; name: string; description: string };
  hooksJson: Record<string, unknown>;
} {
  const nodeCommand = hookNodeExecutable(platform);
  const interactionTools = 'ask_question|ask_permission|notify_user';
  return {
    pluginJson: {
      $schema: 'https://antigravity.google/schemas/v1/plugin.json',
      name: AGY_PLUGIN_NAME,
      description: 'Clanker agent attention plugin',
    },
    hooksJson: {
      'clanker-attention': {
        PreInvocation: [{ type: 'command', command: `${nodeCommand} "${command}" PreInvocation`, timeout: 10 }],
        PostInvocation: [{ type: 'command', command: `${nodeCommand} "${command}" PostInvocation`, timeout: 10 }],
        PreToolUse: [{ matcher: interactionTools, hooks: [{ type: 'command', command: `${nodeCommand} "${command}" PreToolUse`, timeout: 10 }] }],
        PostToolUse: [{ matcher: interactionTools, hooks: [{ type: 'command', command: `${nodeCommand} "${command}" PostToolUse`, timeout: 10 }] }],
        Stop: [{ type: 'command', command: `${nodeCommand} "${command}" Stop`, timeout: 10 }],
      },
    },
  };
}

function removeOwnedAgyAttentionPlugin(directory: string): void {
  const marker = path.join(directory, AGY_PLUGIN_OWNER_MARKER);
  try {
    if (fs.readFileSync(marker, 'utf8') !== AGY_PLUGIN_OWNER) return;
  } catch {
    return;
  }
  for (const filename of ['plugin.json', 'hooks.json', AGY_PLUGIN_OWNER_MARKER]) {
    fs.rmSync(path.join(directory, filename), { force: true });
  }
  try {
    fs.rmdirSync(directory);
  } catch {
    // Preserve unrecognized files rather than recursively deleting user data.
  }
}

export function acquireAgyAttentionPlugin(
  terminalId: string,
  adapterFiles: AttentionAdapterFiles,
  homeDir = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): void {
  const directory = path.join(homeDir, '.gemini', 'config', 'plugins', AGY_PLUGIN_NAME);
  if (activeAgyPlugin) {
    if (activeAgyPlugin.directory !== directory) {
      throw new Error('Antigravity attention plugin is already active under a different home directory');
    }
    activeAgyPlugin.terminalIds.add(terminalId);
    return;
  }

  if (fs.existsSync(directory)) {
    const marker = path.join(directory, AGY_PLUGIN_OWNER_MARKER);
    if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8') !== AGY_PLUGIN_OWNER) {
      throw new Error(`Refusing to overwrite an unowned Antigravity plugin at ${directory}`);
    }
  } else {
    fs.mkdirSync(directory, { recursive: true });
  }

  try {
    fs.writeFileSync(path.join(directory, AGY_PLUGIN_OWNER_MARKER), AGY_PLUGIN_OWNER, { mode: 0o600 });
    const { pluginJson, hooksJson } = agyAttentionPlugin(adapterFiles.command, platform);
    fs.writeFileSync(path.join(directory, 'plugin.json'), JSON.stringify(pluginJson, null, 2), { mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'hooks.json'), JSON.stringify(hooksJson, null, 2), { mode: 0o600 });
  } catch (error) {
    removeOwnedAgyAttentionPlugin(directory);
    throw error;
  }

  activeAgyPlugin = { directory, terminalIds: new Set([terminalId]) };
}

export function releaseAgyAttentionPlugin(terminalId: string): void {
  if (!activeAgyPlugin) return;
  activeAgyPlugin.terminalIds.delete(terminalId);
  if (activeAgyPlugin.terminalIds.size > 0) return;
  removeOwnedAgyAttentionPlugin(activeAgyPlugin.directory);
  activeAgyPlugin = null;
}

export function disposeAllAgyAttention(): void {
  if (!activeAgyPlugin) return;
  removeOwnedAgyAttentionPlugin(activeAgyPlugin.directory);
  activeAgyPlugin = null;
}
