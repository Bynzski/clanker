import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentLocation } from '../shared/types/agentAttention';
import type { CheckoutContext } from '../shared/types/checkoutContext';
import { toNativePath } from '../shared/pathNormalize';
import { normalizeWorkspacePath } from '../shared/workspaceIdentity';
import { isPathContained } from './remote/remotePaths';

/**
 * Agent location: where a harness reports its agent is working now. A harness can move without
 * its process changing directory (Claude Code tracks the directory a Bash `cd` leaves it in), so
 * this is the agent's own report, carried over the authenticated attention channel.
 *
 * Presentation only. It never authorizes a root, re-binds a terminal's launch context, or relaxes
 * a safety check: a terminal stays confined to, and counted against, the context it launched in.
 */

/** Largest reported directory accepted, in UTF-8 bytes. Keeps every attention frame within its bound. */
export const MAX_AGENT_LOCATION_BYTES = 1024;

export type AgentLocationTransport = 'local' | 'remote';

/** Maps a reported directory to the published location for one terminal; null rejects the report. */
export type AgentLocationResolver = (terminalId: string, transport: AgentLocationTransport, reported: string) => AgentLocation | null;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * The reported directory in the registry's canonical form (resolved, POSIX separators, no trailing
 * slash), or null when it is not an absolute, bounded, printable path. A local path is not
 * symlink-resolved here, exactly like registered roots; matching against roots is symlink-aware.
 * A remote path is a host path and is only normalized.
 */
export function canonicalAgentLocation(
  reported: unknown, transport: AgentLocationTransport, platform: NodeJS.Platform = process.platform,
): string | null {
  if (typeof reported !== 'string' || !reported || Buffer.byteLength(reported) > MAX_AGENT_LOCATION_BYTES
    || CONTROL_CHARACTERS.test(reported)) {
    return null;
  }
  if (transport === 'remote') {
    return path.posix.isAbsolute(reported) ? normalizeWorkspacePath(path.posix.normalize(reported)) : null;
  }
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return pathApi.isAbsolute(reported) ? normalizeWorkspacePath(pathApi.resolve(reported)) : null;
}

/**
 * The real form of a local path, even when it does not exist (a removed worktree, a subdirectory not
 * created yet): its nearest existing ancestor is resolved and the missing tail re-appended, so a
 * symlinked parent (or, on Windows, an 8.3 short name) never makes two spellings of one place differ.
 */
const realOrNearest = (nativePath: string): string => {
  const missing: string[] = [];
  let current = path.resolve(nativePath);
  for (;;) {
    try { return path.join(fs.realpathSync.native(current), ...missing.reverse()); } catch { /* walk up */ }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(nativePath);
    missing.push(path.basename(current));
    current = parent;
  }
};

function localDepth(root: string, target: string): number | null {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return root.length;
}

/**
 * The registered context whose root contains `location`, preferring the most specific root (a
 * worktree nested inside the main checkout wins over the main checkout). Local comparisons resolve
 * symlinks on both sides, falling back to the lexical path for a directory that no longer exists;
 * remote host paths compare lexically.
 */
export function locateCheckoutContext(
  location: string, contexts: readonly CheckoutContext[], transport: AgentLocationTransport,
): CheckoutContext | null {
  let best: { context: CheckoutContext; depth: number } | null = null;
  const target = transport === 'local' ? realOrNearest(toNativePath(location, process.platform)) : location;
  for (const context of contexts) {
    let depth: number | null;
    if (transport === 'local') {
      depth = localDepth(realOrNearest(toNativePath(context.path, process.platform)), target);
    } else {
      depth = isPathContained(context.path, location) ? context.path.length : null;
    }
    if (depth !== null && (!best || depth > best.depth)) best = { context, depth };
  }
  return best?.context ?? null;
}

/** Location without context resolution, for a broker that has no workspace knowledge. */
export const unresolvedAgentLocation: AgentLocationResolver = (_terminalId, transport, reported) => {
  const canonical = canonicalAgentLocation(reported, transport);
  return canonical ? { path: canonical, checkoutContextId: null } : null;
};

/**
 * Main's resolver: canonicalize the report, then match it against the checkout contexts registered
 * for the terminal's own workspace. A terminal without a workspace still has a location, in no context.
 */
export function createAgentLocationResolver(deps: {
  getTerminal: (terminalId: string) => { workspaceId?: string } | undefined;
  getCheckoutContexts: (workspaceId: string) => readonly CheckoutContext[];
}): AgentLocationResolver {
  return (terminalId, transport, reported) => {
    const canonical = canonicalAgentLocation(reported, transport);
    if (!canonical) return null;
    const workspaceId = deps.getTerminal(terminalId)?.workspaceId;
    const context = workspaceId ? locateCheckoutContext(canonical, deps.getCheckoutContexts(workspaceId), transport) : null;
    return { path: canonical, checkoutContextId: context?.id ?? null };
  };
}

/**
 * Agents left without a lifecycle source: their harness spawns its hook commands in the agent's own
 * working directory (Codex: verified that no hook can start once it is gone), and the location the
 * agent last reported is inside a checkout that no longer exists. Their open turns can never be
 * settled, so the broker should stop presenting them as running.
 */
export function strandedAgentTerminals(params: {
  terminals: ReadonlyMap<string, { harnessId?: string }>;
  goneContextIds: readonly string[];
  locationOf: (terminalId: string) => AgentLocation | null;
  hooksRunInAgentDirectory: (harnessId: string) => boolean;
}): string[] {
  const gone = new Set(params.goneContextIds);
  if (gone.size === 0) return [];
  const stranded: string[] = [];
  for (const [terminalId, terminal] of params.terminals) {
    if (!terminal.harnessId || !params.hooksRunInAgentDirectory(terminal.harnessId)) continue;
    const contextId = params.locationOf(terminalId)?.checkoutContextId;
    if (contextId && gone.has(contextId)) stranded.push(terminalId);
  }
  return stranded;
}
