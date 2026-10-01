import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findHarnessProvider, getHarnessProviders } from './harnesses/registry';
import type { AttentionAdapterFiles } from './harnesses/types';
import { OBSERVER, COMMAND } from './harnesses/attentionSources';
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
  try {
    fs.writeFileSync(path.join(root, 'observer.mjs'), OBSERVER, { mode: 0o600 });
    const command = path.join(root, 'command.mjs');
    fs.writeFileSync(command, COMMAND, { mode: 0o600 });
    const prepared = { command };
    for (const provider of getHarnessProviders()) provider.attention?.prepareResources?.(prepared, OBSERVER);
    files = prepared;
    return files;
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function removeAttentionAdapterFiles(): void {
  for (const provider of getHarnessProviders()) provider.attention?.disposeResources?.();
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
