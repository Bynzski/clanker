/**
 * The isolated-checkout transactions (issue #102). Real: the service, `retireTerminal`, the release
 * counting rule and real directories (containment is judged on the real filesystem). Faked: Git, the
 * resume/PTY, the attention broker and the renderer channel, each recording into one ordered log so the
 * invariants are asserted as order: the replacement is proven before the old process goes, and the old
 * process is gone before its checkout is released or removed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { AgentCheckoutTransitionEvent } from '../../../src/shared/types/checkoutTransition';
import type { HarnessSession } from '../../../src/shared/types/session';
import type { AgentBridgeCaller } from '../../../src/main/agentBridge/capabilities';
import { IsolatedCheckoutService, REPLACEMENT_STARTUP_BUFFER, type LifecycleTerminal } from '../../../src/main/isolatedCheckout/isolatedCheckoutService';
import { retireTerminal } from '../../../src/main/terminalRetirement';
import { toPosixPath } from '../../../src/shared/pathNormalize';

let root: string;
let mainPath: string;
let wtPath: string;
let MAIN: CheckoutContext;
let TREE: CheckoutContext;

const SESSION: HarnessSession = { id: 'native-1', harness: 'claude', title: 't', cwd: '', timestamp: 1 };

interface Options {
  /** Terminal ids already in the table (besides the caller's). */
  others?: Array<{ id: string; ctx: string; cwd: string }>;
  sessionId?: string | null;
  session?: HarnessSession | null;
  branchState?: { success: boolean; isRepo: boolean; currentBranch: string | null; isDetached: boolean; branches: Array<{ name: string; isCurrent: boolean }>; error?: string };
  listing?: unknown;
  clean?: unknown;
  create?: (branch: string) => unknown;
  /** How the replacement behaves. */
  replacement?: 'ok' | 'never-output' | 'exits-at-once' | 'exits-after-output' | 'wrong-context' | 'throws' | 'unregistered';
  release?: { success: boolean; error?: string };
  inspect?: unknown;
  remove?: { success: boolean; error?: string };
  forget?: { success: boolean; error?: string };
  deleteBranch?: { success: boolean; error?: string; blockedByUnmergedCommits?: boolean };
  environmentId?: string;
  harness?: string;
  shuttingDown?: boolean;
}

function makeWorld(options: Options = {}) {
  const log: string[] = [];
  const events: AgentCheckoutTransitionEvent[] = [];
  const terminals = new Map<string, LifecycleTerminal & { cwd?: string }>();
  const harness = options.harness ?? 'claude';
  const contexts = new Map<string, CheckoutContext>([[MAIN.id, MAIN]]);
  const workspace = { workspaceId: 'ws', location: { environmentId: options.environmentId ?? 'local', path: mainPath }, environment: {} };

  const addTerminal = (id: string, ctx: string, cwd: string, extra: Partial<LifecycleTerminal> = {}) => {
    const terminal = {
      workspaceId: 'ws', checkoutContextId: ctx, harnessId: harness, cwd, environmentId: 'local',
      pty: { kill: vi.fn(() => { log.push(`kill ${id}`); }) },
      releaseResources: vi.fn(async () => { log.push(`dispose ${id}`); }),
      ...extra,
    };
    terminals.set(id, terminal);
    return terminal;
  };

  const registry = {
    getWorkspace: (id: string) => (id === 'ws' ? workspace : null),
    resolveCheckoutContext: (id: string, contextId?: string) => (id !== 'ws' ? null : contextId ? contexts.get(contextId) ?? null : MAIN),
    getCheckoutContext: (id: string) => contexts.get(id) ?? null,
    getCheckoutContextsForWorkspace: () => [...contexts.values()],
    getWorktreeResourceId: (id: string) => id,
  };

  const attention = new Map<string, string | null>();
  const sessionId = options.sessionId === undefined ? 'native-1' : options.sessionId;
  let launches = 0;
  const lastReplacement: { id?: string } = {};

  const sessions = {
    findSession: vi.fn(async () => { log.push('findSession'); return options.session === undefined ? { ...SESSION } : options.session; }),
    resumeInCheckout: vi.fn(async (_ws: string, _session: HarnessSession, request: {
      targetContext: CheckoutContext; onOutput?: (d: string) => void; onExit?: () => void; startupBufferLimit?: unknown;
    }) => {
      log.push(`resume -> ${request.targetContext.id === MAIN.id ? 'main' : 'worktree'}`);
      const mode = options.replacement ?? 'ok';
      if (mode === 'throws') throw new Error('resume failed: No conversation found');
      launches += 1;
      const id = `replacement-${launches}`;
      lastReplacement.id = id;
      const bound = mode === 'wrong-context' ? MAIN.id === request.targetContext.id ? TREE.id : MAIN.id : request.targetContext.id;
      const terminal = addTerminal(id, bound, request.targetContext.path);
      if (mode !== 'unregistered') attention.set(id, null);
      terminal.releaseResources = vi.fn(async () => { log.push(`dispose ${id}`); request.onExit?.(); });
      if (mode === 'exits-at-once') queueMicrotask(() => { terminals.delete(id); request.onExit?.(); });
      else if (mode !== 'never-output') queueMicrotask(() => {
        request.onOutput?.('tui');
        if (mode === 'exits-after-output') setTimeout(() => { terminals.delete(id); request.onExit?.(); }, 2);
      });
      return { id, pid: 100 + launches, harnessId: harness, attentionEnabled: true, checkoutContextId: bound, workingDir: toPosixPath(request.targetContext.path) };
    }),
  };

  const git = {
    getBranchState: vi.fn(async () => { log.push('getBranchState'); return options.branchState ?? { success: true, isRepo: true, currentBranch: 'main', isDetached: false, branches: [{ name: 'main', isCurrent: true }] }; }),
    createCheckoutWorktree: vi.fn(async (_ws: string, branch: string, base: string) => {
      log.push(`createWorktree ${branch} from ${base}`);
      if (options.create) return options.create(branch) as never;
      contexts.set(TREE.id, { ...TREE, branch });
      return { success: true, worktree: { path: toPosixPath(wtPath), branch, isMain: false, isLocked: false, isPrunable: false }, checkoutContext: { ...TREE, branch } };
    }),
    listWorktrees: vi.fn(async () => {
      log.push('listWorktrees');
      return (options.listing as never) ?? { success: true, worktrees: [
        { path: mainPath, branch: 'main', isMain: true, isLocked: false, isPrunable: false },
        { path: wtPath, branch: 'task', isMain: false, isLocked: false, isPrunable: false },
      ] };
    }),
    checkWorktreeClean: vi.fn(async () => { log.push('checkClean'); return (options.clean as never) ?? { success: true, hasChanges: false, worktree: { path: wtPath, branch: 'task' } }; }),
    inspectWorktree: vi.fn(async () => { log.push('inspect'); return (options.inspect as never) ?? { success: true, hasChanges: false, worktree: { path: toPosixPath(wtPath), branch: 'task', isMain: false, isLocked: false, isPrunable: false } }; }),
    removeWorktree: vi.fn(async () => { log.push('removeWorktree'); return options.remove ?? { success: true }; }),
    forgetMissingWorktree: vi.fn(async () => { log.push('forgetMissing'); return options.forget ?? { success: true }; }),
    deleteBranch: vi.fn(async (_ws: string, name: string) => { log.push(`deleteBranch ${name}`); return options.deleteBranch ?? { success: true }; }),
    reconcileCheckoutContexts: vi.fn(async () => { log.push('reconcile'); return { success: true }; }),
  };

  const releaseCheckoutContext = vi.fn((_ws: string, id: string) => {
    log.push(`release ${id === TREE.id ? 'worktree' : id}`);
    const result = options.release ?? { success: true };
    if (result.success) contexts.delete(id);
    return result;
  });

  const service = new IsolatedCheckoutService({
    getRegistry: () => registry as never,
    getTerminals: () => terminals,
    attention: {
      snapshot: (id) => (id === 'caller' ? { sessionId, lastOutcome: null } : attention.has(id) ? { sessionId: attention.get(id) ?? null, lastOutcome: null } : null),
      release: (id) => { log.push(`attention.release ${id}`); },
    },
    git: git as never,
    getSessions: () => sessions as never,
    releaseCheckoutContext,
    retireTerminal: (id) => retireTerminal({ terminals, releaseAttention: (terminalId) => { log.push(`attention.release ${terminalId}`); } }, id),
    notify: (event) => { events.push(event); log.push(`notify ${event.kind}`); },
    isShuttingDown: () => options.shuttingDown === true,
    timing: { startDeadlineMs: 150, observationMs: 15 },
  });

  const callerIn = (context: CheckoutContext, terminalId = 'caller'): AgentBridgeCaller => ({
    terminalId, harnessId: harness, workspace: workspace as never, checkoutContext: context, granted: ['x'],
  });
  return { service, log, events, terminals, contexts, git, sessions, registry, addTerminal, releaseCheckoutContext, callerIn, lastReplacement, workspace };
}

type World = ReturnType<typeof makeWorld>;
const call = <T>(world: World, kind: 'create' | 'complete', ctx: CheckoutContext, input: T, signal = new AbortController().signal) =>
  (kind === 'create'
    ? world.service.create(world.callerIn(ctx), input as { branch: string }, signal)
    : world.service.complete(world.callerIn(ctx), input as { deleteBranch?: boolean }, signal));
const text = (result: { data: unknown }) => JSON.stringify(result.data);
const index = (log: string[], entry: string | RegExp) => log.findIndex((line) => (typeof entry === 'string' ? line === entry : entry.test(line)));

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-lifecycle-')));
  mainPath = path.join(root, 'project');
  wtPath = path.join(root, 'project-worktrees', 'task-aaa');
  fs.mkdirSync(path.join(mainPath, 'src'), { recursive: true });
  fs.mkdirSync(wtPath, { recursive: true });
  MAIN = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: toPosixPath(mainPath), kind: 'main', branch: null };
  TREE = { id: 'ws::ckt-1', workspaceId: 'ws', environmentId: 'local', path: toPosixPath(wtPath), kind: 'worktree', branch: 'task', mainCheckoutPath: toPosixPath(mainPath) };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** A world whose caller is a live Claude terminal in the main checkout. */
function inMain(options: Options = {}): World {
  const world = makeWorld(options);
  world.addTerminal('caller', MAIN.id, mainPath);
  for (const other of options.others ?? []) world.addTerminal(other.id, other.ctx, other.cwd);
  return world;
}
/** A world whose caller is a live Claude terminal in the isolated worktree. */
function inTree(options: Options = {}): World {
  const world = makeWorld(options);
  world.contexts.set(TREE.id, TREE);
  world.addTerminal('caller', TREE.id, wtPath);
  for (const other of options.others ?? []) world.addTerminal(other.id, other.ctx, other.cwd);
  return world;
}

describe('create: main checkout -> new isolated worktree', () => {
  it('creates through the trusted Git path, resumes the same conversation in it, and only then retires the old process', async () => {
    const world = inMain();
    const result = await call(world, 'create', MAIN, { branch: 'feature-x' });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(text(result))).toMatchObject({ status: 'moved', checkout: { kind: 'worktree', isolated: true, branch: 'feature-x' } });
    // The order is the contract.
    const order = [
      index(world.log, 'findSession'), index(world.log, 'getBranchState'), index(world.log, /^createWorktree feature-x from main$/),
      index(world.log, 'notify checkout-attached'), index(world.log, 'resume -> worktree'),
      index(world.log, 'notify terminal-replaced'), index(world.log, 'kill caller'),
    ];
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The conversation is looked up from main's own record of the calling terminal, not from the model.
    expect(world.sessions.findSession).toHaveBeenCalledWith('ws', 'claude', 'native-1');
    expect(world.git.createCheckoutWorktree).toHaveBeenCalledWith('ws', 'feature-x', 'main');
  });

  it('takes workspace, terminal and checkout only from the authenticated caller', async () => {
    const world = inMain({ others: [{ id: 'bystander', ctx: MAIN.id, cwd: mainPath }] });
    await call(world, 'create', MAIN, { branch: 'feature-x', terminalId: 'bystander', workspaceId: 'other' } as never);

    expect(world.git.createCheckoutWorktree).toHaveBeenCalledWith('ws', 'feature-x', 'main');
    expect(world.terminals.has('caller')).toBe(false); // the caller was retired
    expect(world.terminals.has('bystander')).toBe(true); // another terminal is never touched
    const replaced = world.events.find((event) => event.kind === 'terminal-replaced');
    expect(replaced).toMatchObject({ workspaceId: 'ws', previousTerminalId: 'caller' });
  });

  it('reports the replacement bound to the new checkout, and attaches the new context before the pane adopts it', async () => {
    const world = inMain();
    await call(world, 'create', MAIN, { branch: 'feature-x' });

    const kinds = world.events.map((event) => event.kind);
    expect(kinds).toEqual(['checkout-attached', 'terminal-replaced', 'notice']);
    const replaced = world.events[1] as Extract<AgentCheckoutTransitionEvent, { kind: 'terminal-replaced' }>;
    expect(replaced.terminal).toMatchObject({ id: world.lastReplacement.id, checkoutContextId: TREE.id, harnessId: 'claude', environmentId: 'local', workingDir: toPosixPath(wtPath) });
    // The terminal table agrees with what was reported.
    expect(world.terminals.get(replaced.terminal.id)).toMatchObject({ checkoutContextId: TREE.id, workspaceId: 'ws' });
    expect(JSON.stringify(world.events)).not.toMatch(/token|credential/i);
  });

  it('retires the old terminal completely: attention released, resources disposed, process killed, out of the table', async () => {
    const world = inMain();
    const old = world.terminals.get('caller')!;
    await call(world, 'create', MAIN, { branch: 'feature-x' });

    expect(world.log).toEqual(expect.arrayContaining(['attention.release caller', 'dispose caller', 'kill caller']));
    expect(old.releaseResources).toHaveBeenCalledTimes(1);
    expect(world.terminals.has('caller')).toBe(false);
    // ...and it never killed the replacement.
    expect(world.log).not.toContain(`kill ${world.lastReplacement.id}`);
    expect(world.terminals.has(world.lastReplacement.id!)).toBe(true);
  });

  it('asks the resume for a large startup buffer, because the pane adopts the process after it starts', async () => {
    const world = inMain();
    await call(world, 'create', MAIN, { branch: 'feature-x' });
    expect(world.sessions.resumeInCheckout).toHaveBeenCalledWith('ws', expect.anything(), expect.objectContaining({
      targetContext: expect.objectContaining({ id: TREE.id }), startupBufferLimit: REPLACEMENT_STARTUP_BUFFER,
    }));
  });

  it('bases a new branch on HEAD when the main checkout is detached', async () => {
    const world = inMain({ branchState: { success: true, isRepo: true, currentBranch: null, isDetached: true, branches: [] } });
    await call(world, 'create', MAIN, { branch: 'feature-x' });
    expect(world.git.createCheckoutWorktree).toHaveBeenCalledWith('ws', 'feature-x', 'HEAD');
  });

  it.each([['an empty name', ''], ['a blank name', '   '], ['a leading dash', '-rf'], ['control characters', 'a\u0000b'], ['a newline', 'a\nb']])('refuses %s before anything is touched', async (_label, branch) => {
    const world = inMain();
    const result = await call(world, 'create', MAIN, { branch });
    expect(result.isError).toBe(true);
    expect(world.git.createCheckoutWorktree).not.toHaveBeenCalled();
    expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
    expect(world.terminals.has('caller')).toBe(true);
  });

  it('is refused from a workspace that is itself a linked worktree, judged from Git\'s listing', async () => {
    const world = inMain({ listing: { success: true, worktrees: [
      { path: path.join(root, 'the-real-project'), branch: 'main', isMain: true, isLocked: false, isPrunable: false },
      { path: mainPath, branch: 'task', isMain: false, isLocked: false, isPrunable: false },
    ] } });
    const result = await call(world, 'create', MAIN, { branch: 'feature-x' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('not from a worktree workspace');
    expect(world.git.createCheckoutWorktree).not.toHaveBeenCalled();
    expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
    expect(world.terminals.has('caller')).toBe(true);
  });

  it('a failed Git listing refuses the request instead of guessing', async () => {
    const world = inMain({ listing: { success: false, worktrees: [], error: 'git unavailable' } });
    const result = await call(world, 'create', MAIN, { branch: 'feature-x' });
    expect(result.isError).toBe(true);
    expect(world.git.createCheckoutWorktree).not.toHaveBeenCalled();
  });

  it('never takes over an existing branch', async () => {
    const world = inMain({ branchState: { success: true, isRepo: true, currentBranch: 'main', isDetached: false, branches: [{ name: 'main', isCurrent: true }, { name: 'feature-x', isCurrent: false }] } });
    const result = await call(world, 'create', MAIN, { branch: 'feature-x' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('already exists');
    expect(world.git.createCheckoutWorktree).not.toHaveBeenCalled();
    expect(world.events).toEqual([]);
  });

  it('reuses this workspace\'s own idle checkout for the branch (a retry), without creating another', async () => {
    const world = inMain();
    world.contexts.set(TREE.id, { ...TREE, branch: 'feature-x' });
    const result = await call(world, 'create', MAIN, { branch: 'feature-x' });

    expect(result.isError).toBeUndefined();
    expect(world.git.createCheckoutWorktree).not.toHaveBeenCalled();
    expect(world.log).toContain('resume -> worktree');
  });

  it('never joins a checkout another conversation is running in', async () => {
    const world = inMain({ others: [{ id: 'busy', ctx: TREE.id, cwd: wtPath }] });
    world.contexts.set(TREE.id, { ...TREE, branch: 'feature-x' });
    const result = await call(world, 'create', MAIN, { branch: 'feature-x' });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('already in use');
    expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
    expect(world.terminals.has('caller')).toBe(true);
  });

  it('is idempotent when the conversation is already in an isolated checkout', async () => {
    const world = inTree();
    const result = await call(world, 'create', TREE, { branch: 'other' });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(text(result))).toMatchObject({ status: 'already-isolated', checkout: { kind: 'worktree', branch: 'task' } });
    expect(world.git.createCheckoutWorktree).not.toHaveBeenCalled();
    expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
    expect(world.terminals.has('caller')).toBe(true);
  });

  describe('failures leave the original conversation running', () => {
    it('a failed worktree creation changes nothing', async () => {
      const world = inMain({ create: () => ({ success: false, error: 'Destination already exists' }) });
      const result = await call(world, 'create', MAIN, { branch: 'feature-x' });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Destination already exists');
      expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
      expect(world.terminals.has('caller')).toBe(true);
      expect(world.events).toEqual([]);
    });

    it('a worktree that was created but could not be attached is reported and kept', async () => {
      const world = inMain({ create: () => ({ success: false, created: true, error: 'created but could not be attached' }) });
      const result = await call(world, 'create', MAIN, { branch: 'feature-x' });

      expect(result.isError).toBe(true);
      expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
      expect(world.terminals.has('caller')).toBe(true);
      expect(world.events).toEqual([expect.objectContaining({ kind: 'notice', tone: 'warning' })]);
    });

    it.each(['throws', 'exits-at-once', 'exits-after-output', 'never-output', 'wrong-context', 'unregistered'] as const)(
      'a replacement that %s: the original keeps running and the new checkout stays visible and recoverable', async (replacement) => {
        const world = inMain({ replacement });
        const result = await call(world, 'create', MAIN, { branch: 'feature-x' });

        expect(result.isError).toBe(true);
        // The original conversation is untouched.
        expect(world.terminals.has('caller')).toBe(true);
        expect(world.log).not.toContain('kill caller');
        expect(world.log).not.toContain('attention.release caller');
        // No pane was handed over.
        expect(world.events.map((event) => event.kind)).not.toContain('terminal-replaced');
        // The checkout that was created is announced so it is listed as an inactive checkout, and the user is told.
        expect(world.events.map((event) => event.kind)).toEqual(expect.arrayContaining(['checkout-attached', 'notice']));
        expect(world.events.find((event) => event.kind === 'notice')).toMatchObject({ tone: 'warning' });
        // The worktree is kept: nothing was removed or released.
        expect(world.git.removeWorktree).not.toHaveBeenCalled();
        expect(world.releaseCheckoutContext).not.toHaveBeenCalled();
        // A replacement that did start is not left running.
        if (replacement !== 'throws' && world.lastReplacement.id) expect(world.terminals.has(world.lastReplacement.id)).toBe(false);
      });

    it('a replacement that survives only until a late exit is still caught by the observation window', async () => {
      const world = inMain({ replacement: 'exits-after-output' });
      const result = await call(world, 'create', MAIN, { branch: 'feature-x' });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/exited/);
    });
  });

  describe('authority and support are refused before anything changes', () => {
    it.each(['pi', 'hermes', 'agy', 'omp'])('an agent that cannot be resumed elsewhere (%s) cannot invoke it', async (harness) => {
      const world = inMain({ harness });
      const result = await call(world, 'create', MAIN, { branch: 'feature-x' });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/cannot be moved/);
      expect(world.git.getBranchState).not.toHaveBeenCalled();
      expect(world.git.createCheckoutWorktree).not.toHaveBeenCalled();
      expect(world.terminals.has('caller')).toBe(true);
    });

    it('a remote (SSH) workspace is refused', async () => {
      const world = inMain({ environmentId: 'vps' });
      const result = await call(world, 'create', MAIN, { branch: 'feature-x' });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('local workspaces only');
      expect(world.git.createCheckoutWorktree).not.toHaveBeenCalled();
    });

    it('an unidentified conversation (no native session yet) is refused before any worktree is created', async () => {
      const world = inMain({ sessionId: null });
      const result = await call(world, 'create', MAIN, { branch: 'feature-x' });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('not identified');
      expect(world.git.createCheckoutWorktree).not.toHaveBeenCalled();
    });

    it('a conversation main cannot find in its history is refused before any worktree is created', async () => {
      const world = inMain({ session: null });
      const result = await call(world, 'create', MAIN, { branch: 'feature-x' });
      expect(result.isError).toBe(true);
      expect(world.git.createCheckoutWorktree).not.toHaveBeenCalled();
      expect(world.terminals.has('caller')).toBe(true);
    });

    it('a terminal that is no longer in main\'s table has no authority', async () => {
      const world = inMain();
      world.terminals.delete('caller');
      const result = await call(world, 'create', MAIN, { branch: 'feature-x' });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('no longer active');
    });

    it('a workspace that changed identity has no authority', async () => {
      const world = inMain();
      const caller = world.callerIn(MAIN);
      (world.registry as { getWorkspace: unknown }).getWorkspace = () => ({ ...world.workspace });
      const result = await world.service.create(caller, { branch: 'feature-x' }, new AbortController().signal);
      expect(result.isError).toBe(true);
    });

    it('one conversation runs one transition at a time', async () => {
      const world = inMain();
      const first = call(world, 'create', MAIN, { branch: 'feature-x' });
      const second = await call(world, 'create', MAIN, { branch: 'feature-y' });
      expect(second.isError).toBe(true);
      expect(text(second)).toContain('already in progress');
      expect((await first).isError).toBeUndefined();
    });

    it('refuses new transitions while shutting down', async () => {
      const world = inMain({ shuttingDown: true });
      const result = await call(world, 'create', MAIN, { branch: 'feature-x' });
      expect(result.isError).toBe(true);
      expect(world.git.createCheckoutWorktree).not.toHaveBeenCalled();
    });
  });

  describe('cancellation', () => {
    it('a request cancelled before the commit point rolls back: the replacement is retired, the original keeps running', async () => {
      const world = inMain({ replacement: 'never-output' });
      const controller = new AbortController();
      const pending = call(world, 'create', MAIN, { branch: 'feature-x' }, controller.signal);
      await vi.waitFor(() => expect(world.sessions.resumeInCheckout).toHaveBeenCalled());
      controller.abort();
      const result = await pending;

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/cancelled/);
      expect(world.terminals.has('caller')).toBe(true);
      expect(world.terminals.has(world.lastReplacement.id!)).toBe(false);
      expect(world.events.map((event) => event.kind)).not.toContain('terminal-replaced');
      expect(world.git.removeWorktree).not.toHaveBeenCalled();
    });

    it('an already-cancelled request does nothing at all', async () => {
      const world = inMain();
      const controller = new AbortController();
      controller.abort();
      const result = await call(world, 'create', MAIN, { branch: 'feature-x' }, controller.signal);
      expect(result.isError).toBe(true);
      expect(world.git.createCheckoutWorktree).not.toHaveBeenCalled();
      expect(world.terminals.has('caller')).toBe(true);
    });

    it('a cancel that arrives after the worktree exists keeps it and leaves the conversation where it was', async () => {
      const world = inMain();
      const controller = new AbortController();
      world.git.createCheckoutWorktree.mockImplementationOnce(async (_ws: string, branch: string) => {
        controller.abort();
        world.contexts.set(TREE.id, { ...TREE, branch });
        return { success: true, worktree: { path: wtPath, branch, isMain: false, isLocked: false, isPrunable: false }, checkoutContext: { ...TREE, branch } } as never;
      });
      const result = await call(world, 'create', MAIN, { branch: 'feature-x' }, controller.signal);

      expect(result.isError).toBe(true);
      expect(world.terminals.has('caller')).toBe(true);
      expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
      expect(world.events.map((event) => event.kind)).toEqual(expect.arrayContaining(['checkout-attached', 'notice']));
    });
  });
});

describe('complete: isolated worktree -> main checkout, then cleanup', () => {
  it('re-homes into main FIRST, retires the old process SECOND, and only then releases and removes the checkout', async () => {
    const world = inTree();
    const result = await call(world, 'complete', TREE, { deleteBranch: true });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(text(result))).toMatchObject({ status: 'completed', checkout: { kind: 'main' }, cleanup: { checkoutReleased: true, worktreeRemoved: true, branchDeleted: true } });
    const order = [
      index(world.log, 'findSession'), index(world.log, 'checkClean'), index(world.log, 'resume -> main'),
      index(world.log, 'notify terminal-replaced'), index(world.log, 'kill caller'),
      index(world.log, 'release worktree'), index(world.log, 'notify checkout-released'),
      index(world.log, 'inspect'), index(world.log, 'removeWorktree'), index(world.log, 'deleteBranch task'), index(world.log, 'reconcile'),
    ];
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('resolves the main checkout from the registry, never from the request', async () => {
    const world = inTree();
    await call(world, 'complete', TREE, { deleteBranch: false, mainPath: '/elsewhere' } as never);
    expect(world.sessions.resumeInCheckout).toHaveBeenCalledWith('ws', expect.anything(), expect.objectContaining({ targetContext: MAIN }));
    const replaced = world.events.find((event) => event.kind === 'terminal-replaced') as Extract<AgentCheckoutTransitionEvent, { kind: 'terminal-replaced' }>;
    expect(replaced.terminal).toMatchObject({ checkoutContextId: MAIN.id, workingDir: MAIN.path });
  });

  it('completes only the caller\'s own checkout', async () => {
    const world = inTree({ others: [{ id: 'elsewhere', ctx: MAIN.id, cwd: mainPath }] });
    const other: CheckoutContext = { ...TREE, id: 'ws::ckt-other', path: toPosixPath(path.join(root, 'other')), branch: 'other' };
    world.contexts.set(other.id, other);
    await call(world, 'complete', TREE, {});

    expect(world.releaseCheckoutContext).toHaveBeenCalledTimes(1);
    expect(world.releaseCheckoutContext).toHaveBeenCalledWith('ws', TREE.id);
    expect(world.contexts.has(other.id)).toBe(true);
    expect(world.terminals.has('elsewhere')).toBe(true);
  });

  it('deleteBranch: false leaves the branch', async () => {
    const world = inTree();
    const result = await call(world, 'complete', TREE, { deleteBranch: false });
    expect(world.git.deleteBranch).not.toHaveBeenCalled();
    expect(JSON.parse(text(result)).cleanup).toMatchObject({ worktreeRemoved: true, branchDeleted: false });
  });

  it('deleteBranch defaults to false', async () => {
    const world = inTree();
    await call(world, 'complete', TREE, {});
    expect(world.git.deleteBranch).not.toHaveBeenCalled();
  });

  it('deleteBranch: true deletes only the branch this checkout was registered with', async () => {
    const world = inTree();
    await call(world, 'complete', TREE, { deleteBranch: true });
    expect(world.git.deleteBranch).toHaveBeenCalledTimes(1);
    expect(world.git.deleteBranch).toHaveBeenCalledWith('ws', 'task');
  });

  it('an unmerged branch is kept, never force-deleted, and the user is told why', async () => {
    const world = inTree({ deleteBranch: { success: false, error: 'not fully merged', blockedByUnmergedCommits: true } });
    const result = await call(world, 'complete', TREE, { deleteBranch: true });

    expect(JSON.parse(text(result))).toMatchObject({ status: 'completed', cleanup: { worktreeRemoved: true, branchDeleted: false } });
    expect(world.git.deleteBranch).toHaveBeenCalledTimes(1); // the safe delete only; there is no force path
    const notice = world.events.filter((event) => event.kind === 'notice').pop() as { message: string };
    expect(notice.message).toMatch(/kept.*not consider it fully merged/);
  });

  it('a branch Git reports differently from the registered one is not deleted', async () => {
    const world = inTree({ listing: { success: true, worktrees: [
      { path: mainPath, branch: 'main', isMain: true, isLocked: false, isPrunable: false },
      { path: wtPath, branch: 'someone-switched-it', isMain: false, isLocked: false, isPrunable: false },
    ] } });
    const result = await call(world, 'complete', TREE, { deleteBranch: true });
    expect(world.git.deleteBranch).not.toHaveBeenCalled();
    expect(JSON.parse(text(result)).cleanup.branchDeleted).toBe(false);
  });

  it('is idempotent: a conversation already in the main checkout reports it and changes nothing', async () => {
    const world = inMain();
    const result = await call(world, 'complete', MAIN, { deleteBranch: true });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(text(result))).toMatchObject({ status: 'already-complete', checkout: { kind: 'main' } });
    expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
    expect(world.git.removeWorktree).not.toHaveBeenCalled();
    expect(world.terminals.has('caller')).toBe(true);
  });

  describe('nothing is removed unless the conversation really moved', () => {
    it.each(['throws', 'exits-at-once', 'exits-after-output', 'never-output', 'wrong-context', 'unregistered'] as const)(
      'a replacement that %s: the original keeps running and the checkout is untouched', async (replacement) => {
        const world = inTree({ replacement });
        const result = await call(world, 'complete', TREE, { deleteBranch: true });

        expect(result.isError).toBe(true);
        expect(world.terminals.has('caller')).toBe(true);
        expect(world.log).not.toContain('kill caller');
        expect(world.log).not.toContain('dispose caller');
        expect(world.releaseCheckoutContext).not.toHaveBeenCalled();
        expect(world.git.removeWorktree).not.toHaveBeenCalled();
        expect(world.git.forgetMissingWorktree).not.toHaveBeenCalled();
        expect(world.git.deleteBranch).not.toHaveBeenCalled();
        expect(world.contexts.has(TREE.id)).toBe(true);
        expect(world.events.map((event) => event.kind)).not.toContain('terminal-replaced');
        expect(world.events.map((event) => event.kind)).not.toContain('checkout-released');
      });
  });

  describe('refused before any mutation', () => {
    it('a checkout holding uncommitted, untracked or ignored files', async () => {
      const world = inTree({ clean: { success: true, hasChanges: true, worktree: { path: wtPath, branch: 'task' } } });
      const result = await call(world, 'complete', TREE, { deleteBranch: true });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/uncommitted, untracked or ignored files/);
      expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
      expect(world.terminals.has('caller')).toBe(true);
      expect(world.git.removeWorktree).not.toHaveBeenCalled();
    });

    it('another live terminal using the checkout (by launch binding)', async () => {
      const world = inTree({ others: [{ id: 'shell', ctx: TREE.id, cwd: wtPath }] });
      const result = await call(world, 'complete', TREE, {});
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('1 other running terminal is still using this checkout');
      expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
      expect(world.releaseCheckoutContext).not.toHaveBeenCalled();
    });

    it('another live terminal using the checkout (by directory, launched elsewhere)', async () => {
      const world = inTree({ others: [{ id: 'cd-ed', ctx: MAIN.id, cwd: wtPath }] });
      const result = await call(world, 'complete', TREE, {});
      expect(result.isError).toBe(true);
      expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
    });

    it('a locked worktree', async () => {
      const world = inTree({ listing: { success: true, worktrees: [
        { path: mainPath, branch: 'main', isMain: true, isLocked: false, isPrunable: false },
        { path: wtPath, branch: 'task', isMain: false, isLocked: true, isPrunable: false },
      ] } });
      const result = await call(world, 'complete', TREE, {});
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('locked');
      expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
    });

    it('a locked worktree whose directory is also gone (Git will neither forget nor remove it)', async () => {
      fs.rmSync(wtPath, { recursive: true, force: true });
      const world = inTree({ listing: { success: true, worktrees: [
        { path: mainPath, branch: 'main', isMain: true, isLocked: false, isPrunable: false },
        { path: wtPath, branch: 'task', isMain: false, isLocked: true, isPrunable: false },
      ] } });
      const result = await call(world, 'complete', TREE, { deleteBranch: true });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('locked');
      expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
      expect(world.terminals.has('caller')).toBe(true);
    });

    it('a failed Git inspection', async () => {
      const world = inTree({ clean: { success: false, error: 'git exploded' } });
      const result = await call(world, 'complete', TREE, {});
      expect(result.isError).toBe(true);
      expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
    });

    it('a context that is not the registered one of this workspace', async () => {
      const world = inTree();
      // A context that differs in identity values from the registered one (a clone with the same values is equivalent).
      const forged: CheckoutContext = { ...TREE, path: toPosixPath(path.join(root, 'not-the-registered-root')) };
      const result = await world.service.complete(world.callerIn(forged), {}, new AbortController().signal);
      expect(result.isError).toBe(true);
      expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
    });

    it.each(['pi'])('an agent that cannot be resumed elsewhere (%s)', async (harness) => {
      const world = inTree({ harness });
      const result = await call(world, 'complete', TREE, {});
      expect(result.isError).toBe(true);
      expect(world.git.listWorktrees).not.toHaveBeenCalled();
      expect(world.terminals.has('caller')).toBe(true);
    });

    it('an unidentified conversation', async () => {
      const world = inTree({ sessionId: null });
      const result = await call(world, 'complete', TREE, {});
      expect(result.isError).toBe(true);
      expect(world.sessions.resumeInCheckout).not.toHaveBeenCalled();
    });
  });

  describe('a checkout whose directory is already gone (removed out from under the agent)', () => {
    const goneListing = () => ({ success: true, worktrees: [
      { path: mainPath, branch: 'main', isMain: true, isLocked: false, isPrunable: false },
      { path: wtPath, branch: 'task', isMain: false, isLocked: false, isPrunable: true },
    ] });

    it('still re-homes to main, forgets only that Git record, releases the context and can delete the branch', async () => {
      fs.rmSync(wtPath, { recursive: true, force: true });
      const world = inTree({ listing: goneListing() });
      const result = await call(world, 'complete', TREE, { deleteBranch: true });

      expect(result.isError).toBeUndefined();
      expect(world.git.checkWorktreeClean).not.toHaveBeenCalled();
      expect(world.git.removeWorktree).not.toHaveBeenCalled();
      expect(world.git.forgetMissingWorktree).toHaveBeenCalledWith('ws', TREE.path);
      expect(JSON.parse(text(result)).cleanup).toMatchObject({ checkoutReleased: true, worktreeRemoved: true, branchDeleted: true });
      const order = [index(world.log, 'resume -> main'), index(world.log, 'kill caller'), index(world.log, 'release worktree'), index(world.log, 'forgetMissing'), index(world.log, 'deleteBranch task')];
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(order.every((position) => position >= 0)).toBe(true);
    });

    it('a context that reconciliation already dropped counts as released, not as a failed cleanup', async () => {
      fs.rmSync(wtPath, { recursive: true, force: true });
      const world = inTree({ listing: goneListing() });
      // Reconciliation (triggered by the old terminal closing) unregisters the missing checkout's context first.
      const original = world.sessions.resumeInCheckout.getMockImplementation()!;
      world.sessions.resumeInCheckout.mockImplementation(async (...args: Parameters<typeof original>) => {
        const launched = await original(...args);
        world.contexts.delete(TREE.id);
        return launched;
      });
      const result = await call(world, 'complete', TREE, { deleteBranch: true });

      expect(JSON.parse(text(result))).toMatchObject({ status: 'completed', cleanup: { checkoutReleased: true, worktreeRemoved: true, branchDeleted: true } });
      expect(world.releaseCheckoutContext).not.toHaveBeenCalled();
      expect(world.events.map((event) => event.kind)).toContain('checkout-released');
    });

    it('a worktree Git no longer lists at all is simply released', async () => {
      fs.rmSync(wtPath, { recursive: true, force: true });
      const world = inTree({ listing: { success: true, worktrees: [{ path: mainPath, branch: 'main', isMain: true, isLocked: false, isPrunable: false }] } });
      const result = await call(world, 'complete', TREE, {});
      expect(result.isError).toBeUndefined();
      expect(world.releaseCheckoutContext).toHaveBeenCalledWith('ws', TREE.id);
    });

    it('a failed re-home still removes nothing', async () => {
      fs.rmSync(wtPath, { recursive: true, force: true });
      const world = inTree({ listing: goneListing(), replacement: 'exits-at-once' });
      const result = await call(world, 'complete', TREE, { deleteBranch: true });
      expect(result.isError).toBe(true);
      expect(world.git.forgetMissingWorktree).not.toHaveBeenCalled();
      expect(world.releaseCheckoutContext).not.toHaveBeenCalled();
      expect(world.terminals.has('caller')).toBe(true);
    });
  });

  describe('after the commit point the conversation is never stranded', () => {
    it('a release the existing protections refuse keeps the worktree and its context, and reports it', async () => {
      const world = inTree({ release: { success: false, error: '1 running terminal is still using this checkout; close it first' } });
      const result = await call(world, 'complete', TREE, { deleteBranch: true });

      expect(JSON.parse(text(result))).toMatchObject({ status: 'moved-with-cleanup-pending', checkout: { kind: 'main' }, cleanup: { checkoutReleased: false } });
      expect(world.git.removeWorktree).not.toHaveBeenCalled();
      expect(world.git.deleteBranch).not.toHaveBeenCalled();
      expect(world.contexts.has(TREE.id)).toBe(true);
      expect(world.events.map((event) => event.kind)).not.toContain('checkout-released');
      // The conversation itself is in main.
      expect(world.terminals.get(world.lastReplacement.id!)).toMatchObject({ checkoutContextId: MAIN.id });
      expect(world.events.filter((event) => event.kind === 'notice').pop()).toMatchObject({ tone: 'warning' });
    });

    it('a failed removal leaves the checkout on disk, never touches the new main conversation, and skips branch deletion', async () => {
      const world = inTree({ remove: { success: false, error: 'Failed to move item to trash' } });
      const result = await call(world, 'complete', TREE, { deleteBranch: true });

      expect(JSON.parse(text(result))).toMatchObject({ status: 'moved-with-cleanup-pending', cleanup: { worktreeRemoved: false } });
      expect(world.git.deleteBranch).not.toHaveBeenCalled();
      expect(world.terminals.has(world.lastReplacement.id!)).toBe(true);
      expect(world.log).not.toContain(`kill ${world.lastReplacement.id}`);
      expect(fs.existsSync(wtPath)).toBe(true);
      const notice = world.events.filter((event) => event.kind === 'notice').pop() as { message: string; tone: string };
      expect(notice.tone).toBe('warning');
      expect(notice.message).toContain('Failed to move item to trash');
      expect(notice.message).toContain(TREE.path);
    });

    it.each(['inspectWorktree', 'removeWorktree', 'deleteBranch', 'reconcileCheckoutContexts'] as const)(
      'a Git step that THROWS after the commit point (%s) is reported as a partial cleanup, never as "left where it was"', async (step) => {
        const world = inTree();
        (world.git[step] as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { throw new Error('git blew up'); });
        const result = await call(world, 'complete', TREE, { deleteBranch: true });

        // The conversation did move, so this is not a refusal; the user is told what is left.
        expect(world.terminals.get(world.lastReplacement.id!)).toMatchObject({ checkoutContextId: MAIN.id });
        expect(world.terminals.has('caller')).toBe(false);
        const notice = world.events.filter((event) => event.kind === 'notice').pop() as { message: string; tone: string };
        if (step === 'reconcileCheckoutContexts') {
          expect(result.isError).toBeUndefined(); // advisory only
        } else {
          expect(result.isError).toBeUndefined();
          expect(JSON.parse(text(result)).status).toBe('moved-with-cleanup-pending');
          expect(notice.tone).toBe('warning');
          expect(notice.message).toContain('git blew up');
        }
        expect(text(result)).not.toContain('left where it was');
      });

    it('a failure while retiring the old process does not turn a completed move into an error', async () => {
      const world = inTree();
      world.terminals.get('caller')!.releaseResources = vi.fn(async () => { throw new Error('dispose failed'); });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const result = await call(world, 'complete', TREE, { deleteBranch: true });
        expect(JSON.parse(text(result)).status).toBe('completed');
        expect(world.terminals.has('caller')).toBe(false);
      } finally { warn.mockRestore(); }
    });

    it('a checkout that became dirty after the preflight is left on disk', async () => {
      const world = inTree({ inspect: { success: true, hasChanges: true, worktree: { path: wtPath, branch: 'task' } } });
      const result = await call(world, 'complete', TREE, {});
      expect(JSON.parse(text(result))).toMatchObject({ status: 'moved-with-cleanup-pending' });
      expect(world.git.removeWorktree).not.toHaveBeenCalled();
    });

    it('a client that goes away at the handoff does not cut the cleanup short', async () => {
      const world = inTree();
      const controller = new AbortController();
      // Killing the requesting process is what disconnects its client; model that exactly.
      const originalKill = world.terminals.get('caller')!.pty.kill;
      world.terminals.get('caller')!.pty.kill = vi.fn(() => { controller.abort(); (originalKill as () => void)(); });
      const result = await call(world, 'complete', TREE, { deleteBranch: true }, controller.signal);

      expect(controller.signal.aborted).toBe(true);
      expect(JSON.parse(text(result))).toMatchObject({ status: 'completed', cleanup: { worktreeRemoved: true, branchDeleted: true } });
      expect(world.log).toEqual(expect.arrayContaining(['release worktree', 'removeWorktree', 'deleteBranch task', 'reconcile']));
    });

    it('a cancel before the commit point rolls back with nothing removed', async () => {
      const world = inTree({ replacement: 'never-output' });
      const controller = new AbortController();
      const pending = call(world, 'complete', TREE, { deleteBranch: true }, controller.signal);
      await vi.waitFor(() => expect(world.sessions.resumeInCheckout).toHaveBeenCalled());
      controller.abort();
      const result = await pending;

      expect(result.isError).toBe(true);
      expect(world.terminals.has('caller')).toBe(true);
      expect(world.terminals.has(world.lastReplacement.id!)).toBe(false);
      expect(world.releaseCheckoutContext).not.toHaveBeenCalled();
      expect(world.git.removeWorktree).not.toHaveBeenCalled();
    });

    it('shutdown waits for a transaction that is past its commit point', async () => {
      const world = inTree();
      let finishRemoval!: () => void;
      world.git.removeWorktree.mockImplementationOnce(() => new Promise((resolve) => { finishRemoval = () => resolve({ success: true }); }));
      const pending = call(world, 'complete', TREE, {});
      await vi.waitFor(() => expect(world.git.removeWorktree).toHaveBeenCalled());

      let shutDown = false;
      const shutdown = world.service.shutdown().then(() => { shutDown = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(shutDown).toBe(false);
      finishRemoval();
      await pending;
      await shutdown;
      expect(shutDown).toBe(true);
    });
  });

  it('reports the outcome to the user (the agent that asked can no longer be told)', async () => {
    const world = inTree();
    await call(world, 'complete', TREE, { deleteBranch: true });
    const notice = world.events.filter((event) => event.kind === 'notice').pop() as { tone: string; message: string };
    expect(notice.tone).toBe('info');
    expect(notice.message).toContain('Completed isolated checkout "task"');
    expect(notice.message).toContain('Branch "task" was deleted');
  });
});
