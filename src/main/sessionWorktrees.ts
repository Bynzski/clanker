import * as fs from 'node:fs';
import type { GitWorktreeListResult } from '../shared/types/git';
import type { CheckoutContext } from '../shared/types/checkoutContext';
import type { HarnessSession, SessionCheckout } from '../shared/types/session';
import { LOCAL_ENVIRONMENT_ID } from '../shared/types/environments';
import { toNativePath, toPosixPath } from '../shared/pathNormalize';
import { normalizeWorkspacePath } from '../shared/workspaceIdentity';
import { pathKey, runtimeIsWindows } from '../shared/pathKey';
import type { RegisteredWorkspace, WorkspaceRegistry } from './workspaceRegistry';
import { worktreeDirectoryName } from './worktreePaths';
import type { WorktreeProvenance } from './worktreeProvenance';

/** Hard bounds. Classification (which directories are this repository's worktrees) is separate from scanning. */
export const MAX_LOCAL_SESSION_SCANS = 12;
export const MAX_REMOTE_SESSION_SCOPES = 64;
const MAX_PROVENANCE_BRANCHES = 5000;
const CONTAINER_SUFFIX = '-worktrees';

/**
 * A directory main can show is one of this repository's linked worktrees. Provenance, in order of
 * strength: Git lists it (`listed`), a registered checkout context names it (`registered`), main
 * remembered it from an earlier listing or creation (`remembered`), or its name is the one Clanker
 * generates for a branch of this repository (`generated`; `worktreeDirectoryName` hashes the whole
 * branch name, so a stranger directory under the container never matches). A root is evidence for
 * labelling and routing history only; it never authorizes a launch (see `sessionResumeTarget.ts`).
 */
export interface SessionCheckoutRoot {
  /** Canonical POSIX path. */
  path: string;
  branch: string | null;
  /** False for a prunable/missing worktree and for every remembered or generated historical root. */
  exists: boolean;
  kind: 'listed' | 'registered' | 'remembered' | 'generated';
}

export interface SessionCheckoutPlan {
  environmentId: string;
  /** Canonical POSIX path of the workspace's own root. */
  workspacePath: string;
  /** The repository's main checkout when Git was reachable and the workspace belongs to it. */
  mainPath: string | null;
  /** The `<repo>-worktrees` directory Clanker generates worktrees in (a scan scope, never provenance). */
  container: string | null;
  roots: SessionCheckoutRoot[];
  /** Existing local branches, used to prove a branch can be checked out again. */
  localBranches: ReadonlySet<string>;
  canonical: (posixPath: string) => string;
  ops: SessionPathOps;
}

/** Local paths are compared symlink-resolved where they exist; remote paths are already host-canonical. */
export function canonicalizerFor(environmentId: string): (posixPath: string) => string {
  if (environmentId !== LOCAL_ENVIRONMENT_ID) return (value) => value;
  return (value) => {
    try { return toPosixPath(fs.realpathSync.native(toNativePath(value, process.platform))); } catch { return toPosixPath(value); }
  };
}

/**
 * Path identity for one environment. A remote path is a POSIX host path and is case-sensitive no
 * matter what the desktop runs; only a local path on Windows folds case. `windows` is an explicit
 * seam so this is testable without touching `process.platform`.
 */
export interface SessionPathOps {
  canonical: (posixPath: string) => string;
  same: (left: string, right: string) => boolean;
  /** `child` equals `parent` or lies inside it (never a look-alike sibling prefix). */
  within: (parent: string, child: string) => boolean;
}

export function sessionPathOps(environmentId: string, windows: boolean = runtimeIsWindows()): SessionPathOps {
  const fold = environmentId === LOCAL_ENVIRONMENT_ID && windows;
  const key = (value: string) => pathKey(normalizeWorkspacePath(value), fold);
  return {
    canonical: canonicalizerFor(environmentId),
    same: (left, right) => key(left) === key(right),
    within: (parent, child) => {
      const base = key(parent).replace(/\/+$/, '');
      const target = key(child);
      return target === base || target.startsWith(`${base}/`);
    },
  };
}

/** Absolute path of the directory Clanker generates for `branch` (the same name main and SSH creation use). */
export function generatedWorktreePath(container: string, branch: string): string {
  return `${container}/${worktreeDirectoryName(branch)}`;
}

/**
 * The repository's worktree provenance for a workspace. A workspace equal to or inside the main
 * checkout (including a package subdirectory) gets the repository's isolated worktrees; one inside
 * a linked worktree gets none, so it never pulls in its siblings' conversations. Git being
 * unreachable degrades to the registered contexts alone.
 */
export async function collectSessionCheckoutPlan(params: {
  registry: WorkspaceRegistry;
  workspace: RegisteredWorkspace;
  listWorktrees: () => Promise<GitWorktreeListResult>;
  listBranches?: () => Promise<string[]>;
  provenance?: WorktreeProvenance;
  /** Test seams: the desktop platform's case rule for local paths, and whether a local directory exists. */
  windows?: boolean;
  /** Whether a local checkout directory exists. Defaults to the filesystem. */
  directoryPresent?: (nativePath: string) => boolean;
}): Promise<SessionCheckoutPlan> {
  const { registry, workspace, listWorktrees, listBranches, provenance } = params;
  const environmentId = workspace.location.environmentId;
  const ops = sessionPathOps(environmentId, params.windows);
  const { canonical } = ops;
  const plan: SessionCheckoutPlan = {
    environmentId, workspacePath: canonical(workspace.location.path), mainPath: null, container: null,
    roots: [], localBranches: new Set(), canonical, ops,
  };
  const roots: SessionCheckoutRoot[] = [];
  // Git and the registry can lag behind the disk (a worktree deleted by an agent or a shell, not yet
  // reconciled): a local checkout whose directory is gone is a removed one.
  const present = (posixPath: string): boolean => environmentId !== LOCAL_ENVIRONMENT_ID
    || (params.directoryPresent ?? directoryExists)(toNativePath(posixPath, process.platform));
  const add = (root: SessionCheckoutRoot): void => {
    if (!roots.some((existing) => ops.same(existing.path, root.path))) roots.push(root);
  };

  let listing: GitWorktreeListResult | null = null;
  try {
    const result = await listWorktrees();
    if (result.success) listing = result;
  } catch { /* registered contexts only */ }

  let main: GitWorktreeListResult['worktrees'][number] | undefined;
  if (listing) {
    // Which listed worktree contains the workspace: the most specific one wins.
    let containing: GitWorktreeListResult['worktrees'][number] | undefined;
    for (const entry of listing.worktrees) {
      const entryPath = canonical(toPosixPath(entry.path));
      if (!ops.within(entryPath, plan.workspacePath)) continue;
      if (!containing || entryPath.length > canonical(toPosixPath(containing.path)).length) containing = entry;
    }
    if (containing && !containing.isMain) return plan;
    main = containing;
  }

  for (const entry of listing?.worktrees ?? []) {
    if (entry.isMain) continue;
    {
      const listedPath = canonical(toPosixPath(entry.path));
      add({ path: listedPath, branch: entry.branch, exists: !entry.isPrunable && present(listedPath), kind: 'listed' });
    }
  }
  for (const context of registry.getCheckoutContextsForWorkspace(workspace.workspaceId)) {
    if (context.kind !== 'worktree') continue;
    const contextPath = canonical(context.path);
    add({ path: contextPath, branch: context.branch ?? null, exists: context.missing !== true && present(contextPath), kind: 'registered' });
  }

  const mainPath = main ? canonical(toPosixPath(main.path)).replace(/\/+$/, '') : null;
  const branches = new Set<string>();
  if (mainPath) {
    provenance?.remember(environmentId, mainPath, roots.map((root) => ({ path: root.path, branch: root.branch })));
    for (const remembered of provenance?.recall(environmentId, mainPath) ?? []) {
      add({ path: remembered.path, branch: remembered.branch, exists: false, kind: 'remembered' });
    }
    try { for (const name of await listBranches?.() ?? []) branches.add(name); } catch { /* generated names need branches */ }
  }
  // Only branches Git enumerates now may infer a legacy generated path. A listed, registered or remembered
  // root keeps its own exact path and label and never manufactures another one: a remembered branch is
  // evidence of that one directory, not that Clanker ever generated `<repo>-worktrees/<name>` for it.
  const localBranches = new Set(branches);

  const container = mainPath ? `${mainPath}${CONTAINER_SUFFIX}` : null;
  if (container) {
    for (const branch of [...localBranches].slice(0, MAX_PROVENANCE_BRANCHES)) {
      add({ path: generatedWorktreePath(container, branch), branch, exists: false, kind: 'generated' });
    }
  }
  return { ...plan, mainPath, container, roots, localBranches };
}

/**
 * Remembers Git's linked worktrees for a repository (identified by its main checkout) so history
 * stays attributable after a worktree is removed. Called wherever main observes a listing.
 */
export function recordListedWorktrees(provenance: WorktreeProvenance | undefined, environmentId: string, listing: GitWorktreeListResult): void {
  if (!provenance || !listing.success) return;
  const main = listing.worktrees.find((entry) => entry.isMain);
  if (!main) return;
  const canonical = canonicalizerFor(environmentId);
  const linked = listing.worktrees.filter((entry) => !entry.isMain)
    .map((entry) => ({ path: canonical(toPosixPath(entry.path)), branch: entry.branch }));
  provenance.remember(environmentId, canonical(toPosixPath(main.path)).replace(/\/+$/, ''), linked);
}

/** `collectSessionCheckoutPlan` that never throws: no registry or an unexpected failure means no worktree evidence. */
export async function loadSessionCheckoutPlan(params: {
  registry: WorkspaceRegistry | undefined;
  workspace: RegisteredWorkspace;
  listWorktrees?: () => Promise<GitWorktreeListResult>;
  listBranches?: () => Promise<string[]>;
  provenance?: WorktreeProvenance;
}): Promise<SessionCheckoutPlan | null> {
  if (!params.registry) return null;
  try {
    return await collectSessionCheckoutPlan({
      registry: params.registry, workspace: params.workspace,
      listWorktrees: params.listWorktrees ?? (async () => ({ success: false, worktrees: [] })),
      listBranches: params.listBranches, provenance: params.provenance,
    });
  } catch { return null; }
}

/** The most specific root containing `cwd` (tried as recorded and symlink-resolved). */
export function matchSessionCheckoutRoot(plan: SessionCheckoutPlan, cwd: string): SessionCheckoutRoot | null {
  if (!cwd) return null;
  const candidates = [cwd];
  const resolved = plan.canonical(cwd);
  if (resolved !== cwd) candidates.push(resolved);
  let best: SessionCheckoutRoot | null = null;
  for (const root of plan.roots) {
    if (!candidates.some((candidate) => plan.ops.within(root.path, candidate))) continue;
    if (!best || root.path.length > best.path.length) best = root;
  }
  return best;
}

export function sessionCheckoutFor(plan: SessionCheckoutPlan, cwd: string): SessionCheckout | null {
  const root = matchSessionCheckoutRoot(plan, cwd);
  return root ? { branch: root.branch, path: root.path, exists: root.exists } : null;
}

/**
 * Directories whose conversations may belong in the workspace's history beyond its own root: the
 * generated container (covering every generated worktree, listed or removed), live worktrees and
 * remembered ones, minus anything already inside the workspace or another scope. Container first.
 */
export function sessionScanScopes(plan: SessionCheckoutPlan): string[] {
  const candidates: string[] = [];
  if (plan.container) candidates.push(plan.container);
  for (const kind of ['listed', 'registered', 'remembered'] as const) {
    for (const root of plan.roots) if (root.kind === kind && !candidates.some((entry) => plan.ops.same(entry, root.path))) candidates.push(root.path);
  }
  const kept: string[] = [];
  for (const candidate of candidates) {
    if (plan.ops.within(plan.workspacePath, candidate)) continue;
    if (candidates.some((other) => other !== candidate && !plan.ops.same(other, candidate) && plan.ops.within(other, candidate))) continue;
    kept.push(candidate);
  }
  return kept;
}

/**
 * Keeps the sessions inside the workspace or a proven worktree (a stranger directory under the
 * generated container, or another repository, is dropped), deduplicates, and tags the ones that ran
 * in a linked worktree. Used for local and SSH results alike.
 */
export function classifySessions(plan: SessionCheckoutPlan, sessions: HarnessSession[]): HarnessSession[] {
  const seen = new Set<string>();
  const merged: HarnessSession[] = [];
  for (const session of sessions) {
    const checkout = sessionCheckoutFor(plan, session.cwd);
    if (!checkout && !plan.ops.within(plan.workspacePath, session.cwd) && !plan.ops.within(plan.workspacePath, plan.canonical(session.cwd))) continue;
    const key = `${session.harness}\0${session.accountId ?? ''}\0${session.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(checkout ? { ...session, checkout } : session);
  }
  return merged.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Local history for a workspace plus its worktrees. Each scope costs one all-harness scan, so past
 * `maxScans` a single unfiltered scan replaces them: bounded work, no provenance dropped.
 */
export async function discoverSessionsWithCheckouts(params: {
  plan: SessionCheckoutPlan;
  /** The workspace root as the scan expects it (native). */
  scanWorkspacePath: string;
  discover: (scanPath: string) => Promise<HarnessSession[]>;
  toScanPath?: (posixPath: string) => string;
  maxScans?: number;
  onScanError?: (error: unknown) => void;
}): Promise<HarnessSession[]> {
  const { plan, scanWorkspacePath, discover, toScanPath = (value) => value, maxScans = MAX_LOCAL_SESSION_SCANS } = params;
  const scopes = sessionScanScopes(plan);
  const scans = scopes.length > maxScans
    ? [discover('')]
    : [discover(scanWorkspacePath), ...scopes.map((scope) => discover(toScanPath(scope)).catch((error: unknown): HarnessSession[] => { params.onScanError?.(error); return []; }))];
  return classifySessions(plan, (await Promise.all(scans)).flat());
}

export type SessionResumeRoute =
  | { kind: 'main' }
  | { kind: 'worktree'; root: SessionCheckoutRoot }
  | { kind: 'gone'; root: SessionCheckoutRoot }
  | { kind: 'outside' };

/**
 * Where a conversation resumes, decided from its recorded cwd and main's own plan (a renderer-
 * supplied `checkout` is never consulted): a live worktree, else the workspace root, else (a
 * removed worktree) `gone`, which the caller handles explicitly.
 */
export function routeSessionResume(plan: SessionCheckoutPlan, cwd: string): SessionResumeRoute {
  // A recorded cwd with dot segments could prefix-match a root and still resolve elsewhere.
  if (cwd.split('/').some((segment) => segment === '..' || segment === '.')) return { kind: 'outside' };
  const root = matchSessionCheckoutRoot(plan, cwd);
  if (root?.exists) return { kind: 'worktree', root };
  if (plan.ops.within(plan.workspacePath, cwd) || plan.ops.within(plan.workspacePath, plan.canonical(cwd))) return { kind: 'main' };
  if (root) return { kind: 'gone', root };
  return { kind: 'outside' };
}

/** The registered worktree context for a root, if one is attached to the workspace. */
export function findRegisteredContext(registry: WorkspaceRegistry, workspace: RegisteredWorkspace, plan: SessionCheckoutPlan, rootPath: string): CheckoutContext | null {
  return registry.getCheckoutContextsForWorkspace(workspace.workspaceId)
    .find((context) => context.kind === 'worktree' && plan.ops.same(plan.canonical(context.path), rootPath)) ?? null;
}

export function directoryExists(nativePath: string): boolean {
  try { return fs.statSync(nativePath).isDirectory(); } catch { return false; }
}
