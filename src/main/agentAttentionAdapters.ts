import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findHarnessProvider, getHarnessProviders } from './harnesses/registry';
import type { AttentionAdapterFiles } from './harnesses/types';
import { OBSERVER, COMMAND } from './harnesses/attentionSources';
import { SOURCE as PI_SOURCE } from './harnesses/pi/attention';
import { SOURCE as OMP_SOURCE } from './harnesses/omp/attention';
import { SOURCE as OPENCODE_SOURCE } from './harnesses/opencode/attention';
import { claudeAttentionSettings } from './harnesses/claude/attention';
import { disposeAllAgyAttention } from './harnesses/agy/attentionPlugin';
export { acquireAgyAttentionPlugin, releaseAgyAttentionPlugin, agyAttentionPlugin } from './harnesses/agy/attentionPlugin';
export { claudeAttentionSettings } from './harnesses/claude/attention';
export type { AttentionAdapterFiles } from './harnesses/types';

let files: AttentionAdapterFiles | null = null;

export function withoutAttentionEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] =>
    !entry[0].startsWith('CLANKER_ATTENTION_') && !entry[0].startsWith('CLANKER_REMOTE_ATTENTION_') && typeof entry[1] === 'string'));
}

export function attentionAdapterSources(observer: string): Record<string, string> {
  return Object.assign({ 'observer.mjs': observer, 'command.mjs': COMMAND },
    ...getHarnessProviders().map((provider) => provider.attention?.sources?.(observer) ?? {}));
}

export function ensureAttentionAdapterFiles(): AttentionAdapterFiles {
  if (files) return files;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-attention-'));
  const opencodeDirectory = path.join(root, 'opencode');
  try {
    fs.mkdirSync(path.join(opencodeDirectory, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(root, 'observer.mjs'), OBSERVER, { mode: 0o600 });
    const command = path.join(root, 'command.mjs');
    fs.writeFileSync(command, COMMAND, { mode: 0o600 });
    const piExtension = path.join(root, 'pi.ts');
    fs.writeFileSync(piExtension, PI_SOURCE, { mode: 0o600 });
    const ompExtension = path.join(root, 'omp.ts');
    fs.writeFileSync(ompExtension, OMP_SOURCE, { mode: 0o600 });
    fs.writeFileSync(path.join(opencodeDirectory, 'observer.mjs'), OBSERVER, { mode: 0o600 });
    fs.writeFileSync(path.join(opencodeDirectory, 'plugins', 'clanker-attention.js'), OPENCODE_SOURCE, { mode: 0o600 });
    const claudeSettings = path.join(root, 'claude-settings.json');
    fs.writeFileSync(claudeSettings, JSON.stringify(claudeAttentionSettings(command, process.platform)), { mode: 0o600 });
    files = { command, claudeSettings, opencodeDirectory, piExtension, ompExtension };
    return files;
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function removeAttentionAdapterFiles(): void {
  disposeAllAgyAttention();
  if (!files) return;
  fs.rmSync(path.dirname(files.command), { recursive: true, force: true });
  files = null;
}

/** Compatibility injection query. Resource ownership uses prepare() at launch. */
export function attentionLaunchOptions(
  harness: string, args: string[], env: NodeJS.ProcessEnv, adapterFiles: AttentionAdapterFiles,
  sessionId?: string, platform: NodeJS.Platform = process.platform,
) {
  return findHarnessProvider(harness)?.attention?.local?.options({
    terminalId: '', args, env, files: adapterFiles, sessionId, platform,
  }) ?? null;
}
