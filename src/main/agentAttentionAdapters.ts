import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findHarnessProvider, getHarnessProviders } from './harnesses/registry';
import type { AttentionAdapterFiles, LocalAttentionContext } from './harnesses/types';
import { OBSERVER, COMMAND } from './harnesses/attentionSources';
export { acquireAgyAttentionPlugin, releaseAgyAttentionPlugin, agyAttentionPlugin } from './harnesses/agy/attentionPlugin';
export { claudeAttentionSettings } from './harnesses/claude/attention';
export type { AttentionAdapterFiles } from './harnesses/types';

let files: AttentionAdapterFiles | null = null;
const providerFiles = new Map<string, AttentionAdapterFiles>();

export function withoutAttentionEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] =>
    !entry[0].startsWith('CLANKER_ATTENTION_') && !entry[0].startsWith('CLANKER_REMOTE_ATTENTION_') && typeof entry[1] === 'string'));
}

export function ensureAttentionAdapterFiles(): AttentionAdapterFiles {
  if (files) return files;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-attention-'));
  try {
    fs.writeFileSync(path.join(root, 'observer.mjs'), OBSERVER, { mode: 0o600 });
    const command = path.join(root, 'command.mjs');
    fs.writeFileSync(command, COMMAND, { mode: 0o600 });
    const prepared = { command };
    files = prepared;
    return files;
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/** Synchronous preparation is serialized by the main process. Cache only complete
 * resources; each provider owns an isolated directory so rollback cannot damage
 * another provider or invalidate the shared command bridge. */
export function ensureProviderAttentionResources(harness: string, infrastructure = ensureAttentionAdapterFiles()): AttentionAdapterFiles {
  const provider = findHarnessProvider(harness);
  const prepare = provider?.attention?.prepareResources;
  if (!provider || !prepare) return infrastructure;
  if (infrastructure.command !== files?.command) throw new Error('Unknown local attention infrastructure');
  const cached = providerFiles.get(provider.descriptor.id);
  if (cached) return cached;
  const resourceRoot = fs.mkdtempSync(path.join(path.dirname(infrastructure.command), `${provider.descriptor.id}-`));
  const scoped = { command: infrastructure.command, resourceRoot };
  try {
    prepare(scoped, OBSERVER);
    providerFiles.set(provider.descriptor.id, scoped);
    return scoped;
  } catch (error) {
    fs.rmSync(resourceRoot, { recursive: true, force: true });
    throw error;
  }
}

/** Canonical launch preparation keeps lazy resources and lifecycle acquisition
 * together. Conflicting configuration needs neither files nor a lease. */
export function prepareLocalAttention(harness: string, context: LocalAttentionContext) {
  const local = findHarnessProvider(harness)?.attention?.local;
  if (!local || local.plan(context).status === 'blocked') return null;
  return local.prepare({ ...context, files: ensureProviderAttentionResources(harness, context.files) });
}

export function removeAttentionAdapterFiles(): void {
  for (const provider of getHarnessProviders()) provider.attention?.disposeResources?.();
  if (!files) return;
  fs.rmSync(path.dirname(files.command), { recursive: true, force: true });
  files = null;
  providerFiles.clear();
}

/** Compatibility injection query. Resource ownership uses prepare() at launch. */
export function attentionLaunchOptions(
  harness: string, args: string[], env: NodeJS.ProcessEnv, adapterFiles: AttentionAdapterFiles,
  sessionId?: string, platform: NodeJS.Platform = process.platform,
) {
  const context = { terminalId: '', args, env, files: adapterFiles, sessionId, platform };
  const local = findHarnessProvider(harness)?.attention?.local;
  if (!local?.options(context)) return null;
  return local.options({ ...context, files: ensureProviderAttentionResources(harness, adapterFiles) });
}
