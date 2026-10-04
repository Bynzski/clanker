import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findHarnessProvider, getHarnessProviders } from './harnesses/registry';
import type { AttentionAdapterFiles, LocalAttentionContext } from './harnesses/types';
import type { HarnessSession } from '../shared/types/session';
import { OBSERVER, COMMAND } from './harnesses/attentionSources';
export { ensureAgyAttentionPlugin, agyAttentionPlugin, migrateLegacyAgyAttentionPlugin } from './harnesses/agy/attentionPlugin';
export { claudeAttentionSettings } from './harnesses/claude/attention';
export type { AttentionAdapterFiles } from './harnesses/types';

const ATTENTION_ROOT_PREFIX = 'clanker-attention-';
const OWNER_PID_FILE = '.clanker-pid';
const UNMARKED_ROOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let files: AttentionAdapterFiles | null = null;
const providerFiles = new Map<string, AttentionAdapterFiles>();

export function withoutAttentionEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] =>
    !entry[0].startsWith('CLANKER_ATTENTION_') && !entry[0].startsWith('CLANKER_REMOTE_ATTENTION_') && typeof entry[1] === 'string'));
}

export function ensureAttentionAdapterFiles(): AttentionAdapterFiles {
  if (files) return files;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), ATTENTION_ROOT_PREFIX));
  try {
    fs.writeFileSync(path.join(root, OWNER_PID_FILE), String(process.pid), { mode: 0o600 });
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
  const interpreter = provider?.attention?.interpreter;
  if (!provider || (!prepare && !interpreter)) return infrastructure;
  if (infrastructure.command !== files?.command) throw new Error('Unknown local attention infrastructure');
  const cached = providerFiles.get(provider.descriptor.id);
  if (cached) return cached;
  const resourceRoot = fs.mkdtempSync(path.join(path.dirname(infrastructure.command), `${provider.descriptor.id}-`));
  const scoped = { command: infrastructure.command, resourceRoot };
  try {
    if (interpreter) fs.writeFileSync(path.join(resourceRoot, 'interpreter.mjs'), interpreter, { mode: 0o600 });
    prepare?.(scoped, OBSERVER);
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

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Best-effort removal of attention roots a crashed or killed run left behind. Correctness never
 * depends on it (the plugin guard fails open); it only reclaims disk. A root is removed only when
 * it is a real directory we own whose recorded owner process is gone, or, for roots from builds
 * that recorded no owner, when nothing has touched it for a week. Live roots are never touched. */
export function scavengeStaleAttentionRoots(tmp = os.tmpdir(), now = Date.now()): void {
  const own = files ? path.dirname(files.command) : null;
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  let names: string[];
  try { names = fs.readdirSync(tmp); } catch { return; }
  for (const name of names) {
    if (!/^clanker-attention-[A-Za-z0-9]{6}$/.test(name)) continue;
    const root = path.join(tmp, name);
    if (root === own) continue;
    try {
      const stat = fs.lstatSync(root);
      if (!stat.isDirectory() || (uid !== null && stat.uid !== uid) || !fs.existsSync(path.join(root, 'command.mjs'))) continue;
      let ownerPid = NaN;
      try { ownerPid = Number(fs.readFileSync(path.join(root, OWNER_PID_FILE), 'utf8')); } catch { /* unmarked */ }
      const stale = Number.isInteger(ownerPid) && ownerPid > 0
        ? !processIsAlive(ownerPid)
        : now - stat.mtimeMs > UNMARKED_ROOT_MAX_AGE_MS;
      if (stale) fs.rmSync(root, { recursive: true, force: true });
    } catch { /* leave anything we cannot inspect */ }
  }
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
  rootSessionId?: string, platform: NodeJS.Platform = process.platform,
) {
  const context = { terminalId: '', args, env, files: adapterFiles, rootSessionId, platform };
  const local = findHarnessProvider(harness)?.attention?.local;
  if (!local?.options(context)) return null;
  return local.options({ ...context, files: ensureProviderAttentionResources(harness, adapterFiles) });
}

/** Native session identity Clanker itself validated for a non-fork resume. A fork creates
 * a new native session, and a provider whose resume may re-identify the session cannot be
 * pre-seeded; both start unbound. Renderer-supplied IDs never reach this function. */
export function trustedRootSessionId(harness: string, session: Pick<HarnessSession, 'id'>, fork: boolean): string | undefined {
  if (fork || !findHarnessProvider(harness)?.attention?.resumePreservesSessionId) return undefined;
  return /^[A-Za-z0-9._:-]{1,128}$/.test(session.id) ? session.id : undefined;
}
