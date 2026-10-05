import type { CheckoutContext, ReleaseCheckoutContextResult } from '../../shared/types/checkoutContext';
import type { AgentCheckoutTransitionEvent } from '../../shared/types/checkoutTransition';
import { LOCAL_ENVIRONMENT_ID } from '../../shared/types/environments';
import type { HarnessSession } from '../../shared/types/session';
import { toNativePath } from '../../shared/pathNormalize';
import type { AgentBridgeCaller, AgentBridgeToolResult } from '../agentBridge/capabilities';
import type { AgentCheckoutLifecyclePort } from '../agentBridge/lifecycleCapabilities';
import { countTerminalsUsingContext, type TerminalUsage } from '../checkoutContextRelease';
import type { GitIpcController } from '../ipc/gitIpc';
import type { ResumedSessionLaunch, SessionIpcController } from '../ipc/sessionIpc';
import { directoryExists } from '../sessionWorktrees';
import type { RetirableTerminal } from '../terminalRetirement';
import { findListedWorktree } from '../worktreeContextAttachment';
import type { WorkspaceRegistry } from '../workspaceRegistry';
import { supportsCheckoutRehoming } from './rehomeSupport';

/**
 * Agent-requested isolated-checkout transactions (issue #102).
 *
 *   create:   main checkout  --(same conversation, resumed)-->  Clanker-owned isolated worktree
 *   complete: isolated worktree --(same conversation, resumed)--> main checkout, then the old one is removed
 *
 * The invariant is **re-home first, delete second**. A running harness cannot be moved by changing a
 * directory from outside, so "moving" it is a real resume of the same native conversation in the target
 * checkout, performed through the same launch every history resume uses (accounts, attention, a fresh
 * bridge credential bound to the new checkout). Only a replacement proven alive and bound to the target
 * ever lets the old process go, and only an old process that is gone ever lets its checkout be released.
 *
 * Phases, in order:
 *   1 preflight  no mutation. Authority, support, identity of the conversation, safety of the checkout.
 *   2 prepare    reversible. Create/attach the worktree (create), start the replacement.
 *   3 proof      the replacement produced output, stayed up through a short observation, is registered in
 *                the terminal table bound to the target, has an attention registration, and the target
 *                context is still the registered one.
 *   --- commit point ---
 *   4 handoff    tell the renderer its pane now belongs to the replacement; retire the requesting process
 *                BEFORE any response is written, so it can never append a tool result to the transcript
 *                the replacement already loaded. The request is then abandoned by its dead client.
 *   5 cleanup    release the context, remove the checkout, optionally delete the branch. Never rolled
 *                back (the conversation already lives in its new home); every outcome is reported to the
 *                user, since the agent that asked can no longer be told.
 *
 * Before the commit point a failure or an abort (client cancel, timeout) rolls back to exactly the
 * starting state: the replacement is retired, the original conversation keeps running untouched. A
 * worktree that `create` already made is kept and shown as an inactive checkout, as for every isolated
 * agent launch; nothing is ever deleted to recover from a failure. After it, aborts are ignored: the
 * transaction runs to completion under this service's ownership.
 */

/** The part of main's terminal table the lifecycle reads and retires. */
export interface LifecycleTerminal extends TerminalUsage, RetirableTerminal {
  workspaceId?: string;
  harnessId?: string;
}

export interface IsolatedCheckoutServiceDeps {
  getRegistry(): WorkspaceRegistry | undefined;
  getTerminals(): Map<string, LifecycleTerminal>;
  attention: {
    snapshot(terminalId: string): { sessionId: string | null } | null;
    release(terminalId: string): void;
  };
  git: Pick<GitIpcController, 'getBranchState' | 'createCheckoutWorktree' | 'listWorktrees' | 'checkWorktreeClean' | 'removeWorktree'
    | 'inspectWorktree' | 'forgetMissingWorktree' | 'deleteBranch' | 'reconcileCheckoutContexts'>;
  getSessions(): Pick<SessionIpcController, 'findSession' | 'resumeInCheckout'> | undefined;
  /** `releaseCheckoutContext` over main's own registry and terminal table. */
  releaseCheckoutContext(workspaceId: string, checkoutContextId: string): ReleaseCheckoutContextResult;
  /** Retires a terminal exactly as an explicit close does; resolves when its cleanup finished. */
  retireTerminal(terminalId: string): Promise<void>;
  notify(event: AgentCheckoutTransitionEvent): void;
  isShuttingDown(): boolean;
  /** Test seam. */
  timing?: Partial<ReplacementTiming>;
}

export interface ReplacementTiming {
  /** The replacement must produce its first output within this. */
  startDeadlineMs: number;
  /** ...and then survive this long without exiting (a resume that cannot find its conversation fails at once). */
  observationMs: number;
}

const DEFAULT_TIMING: ReplacementTiming = { startDeadlineMs: 12_000, observationMs: 1_000 };

/** What the post-commit cleanup achieved; `complete` is false for any partial outcome. */
interface CleanupOutcome { complete: boolean; summary: string; report: Record<string, unknown> }

/** A resumed conversation replays its history before the pane adopts the process; hold much more than the default. */
export const REPLACEMENT_STARTUP_BUFFER = Object.freeze({ bytes: 1024 * 1024, chunks: 8192 });

/** Refused or rolled back; `message` is safe to show the agent and the user. */
class TransitionFailure extends Error {}
/** The caller cancelled or the call timed out before the commit point. */
class TransitionAborted extends Error {}

const ok = (data: unknown): AgentBridgeToolResult => ({ data });
const refuse = (error: string): AgentBridgeToolResult => ({ isError: true, data: { error } });
const messageOf = (cause: unknown, fallback: string): string => (cause instanceof Error && cause.message ? cause.message : fallback);

interface Deferred { promise: Promise<void>; resolve(): void }
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Resolves with whichever of `candidates` settles first; a `null` timeout means no deadline. All timers are cleared. */
async function firstOf<T extends string>(candidates: Record<T, Promise<void>>, timeoutMs: number | null): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const contenders: Array<Promise<T | 'timeout'>> = (Object.entries(candidates) as Array<[T, Promise<void>]>)
    .map(([name, promise]) => promise.then(() => name));
  if (timeoutMs !== null) contenders.push(new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); }));
  try { return await Promise.race(contenders); } finally { if (timer) clearTimeout(timer); }
}

export class IsolatedCheckoutService implements AgentCheckoutLifecyclePort {
  private readonly active = new Map<string, Promise<unknown>>();
  private shutDown = false;
  private readonly timing: ReplacementTiming;

  constructor(private readonly deps: IsolatedCheckoutServiceDeps) {
    this.timing = { ...DEFAULT_TIMING, ...deps.timing };
  }

  /** Waits for every in-flight transaction (post-commit cleanup included) and refuses new ones. */
  async shutdown(): Promise<void> {
    this.shutDown = true;
    await Promise.allSettled([...this.active.values()]);
  }

  create(caller: AgentBridgeCaller, input: { branch: string }, signal: AbortSignal): Promise<AgentBridgeToolResult> {
    return this.exclusive(caller, async () => {
      const prepared = this.preflightCommon(caller);
      const { workspaceId, main } = prepared;

      // Idempotent: the conversation is already in an isolated checkout.
      if (caller.checkoutContext.id !== main.id) {
        return ok({ status: 'already-isolated', checkout: this.describe(caller.checkoutContext) });
      }

      const branch = typeof input.branch === 'string' ? input.branch.trim() : '';
      if (!branch || branch.startsWith('-') || /[\u0000-\u001f\u007f]/.test(branch)) throw new TransitionFailure('Choose a valid branch name');

      const session = await this.conversationOf(caller);
      this.throwIfAborted(signal);
      await this.requireProjectWorkspace(workspaceId, caller.workspace.location.path);

      // Reuse this workspace's own attached checkout for the branch only when nothing runs in it (a retry
      // after a failed move). A checkout another conversation is using is never joined, and any other
      // existing branch is never taken over.
      const registry = this.deps.getRegistry()!;
      let target = registry.getCheckoutContextsForWorkspace(workspaceId)
        .find((context) => context.kind === 'worktree' && context.id !== main.id && context.branch === branch && !context.missing) ?? null;
      if (target && countTerminalsUsingContext(registry, target, this.deps.getTerminals().entries()) > 0) {
        throw new TransitionFailure(`Branch "${branch}" is already in use by another conversation; choose a new branch name`);
      }
      let createdNow = false;
      if (!target) {
        const state = await this.deps.git.getBranchState(workspaceId);
        if (!state.success || !state.isRepo) throw new TransitionFailure(state.error || 'This workspace is not a Git repository');
        if (state.branches.some((entry) => entry.name === branch)) {
          throw new TransitionFailure(`Branch "${branch}" already exists; choose a new branch name`);
        }
        this.throwIfAborted(signal);
        // The base is read from Git now (never from the renderer): the main checkout's branch, or HEAD when detached.
        const base = !state.isDetached && state.currentBranch ? state.currentBranch : 'HEAD';
        const created = await this.deps.git.createCheckoutWorktree(workspaceId, branch, base);
        if (!created.success || !created.checkoutContext) {
          if (created.created) this.notice(workspaceId, 'warning', created.error || `The worktree for "${branch}" was created but could not be attached; it was kept.`);
          throw new TransitionFailure(created.error || 'Could not create the isolated checkout');
        }
        target = created.checkoutContext;
        createdNow = true;
      }
      // Visible and recoverable from here on, whatever happens next.
      this.deps.notify({ kind: 'checkout-attached', workspaceId, checkoutContext: target });

      let launched: ResumedSessionLaunch;
      try {
        this.throwIfAborted(signal);
        launched = await this.startReplacement(caller, session, target, signal);
      } catch (error) {
        const reason = error instanceof TransitionAborted ? 'the request was cancelled' : messageOf(error, 'the conversation could not be resumed there');
        this.notice(workspaceId, 'warning', `Could not move this conversation into "${branch}": ${reason}. The conversation was left where it was; the ${createdNow ? 'new ' : ''}checkout was kept and is listed under the workspace.`);
        throw error instanceof TransitionAborted ? error : new TransitionFailure(`${messageOf(error, 'The conversation could not be resumed in the new checkout')} The isolated checkout for "${branch}" was kept; this conversation is unchanged.`);
      }

      await this.handOff(workspaceId, caller.terminalId, launched);
      this.notice(workspaceId, 'info', `Moved this conversation into isolated checkout "${branch}".`);
      return ok({ status: 'moved', checkout: this.describe(target) });
    });
  }

  complete(caller: AgentBridgeCaller, input: { deleteBranch?: boolean }, signal: AbortSignal): Promise<AgentBridgeToolResult> {
    return this.exclusive(caller, async () => {
      const { workspaceId, main } = this.preflightCommon(caller);
      const old = caller.checkoutContext;
      const registry = this.deps.getRegistry()!;

      // Idempotent: already back in the main checkout.
      if (old.id === main.id) return ok({ status: 'already-complete', checkout: this.describe(main) });
      if (old.kind !== 'worktree' || old.workspaceId !== workspaceId || registry.getCheckoutContext(old.id) !== old) {
        throw new TransitionFailure('This conversation is not running in a Clanker-owned isolated checkout');
      }

      const session = await this.conversationOf(caller);
      this.throwIfAborted(signal);

      // The checkout must be one this transaction can finish: nobody else uses it, Git lists it as an
      // unlocked linked worktree (or no longer has its directory at all), and it holds nothing unsaved.
      const others = countTerminalsUsingContext(registry, old, this.deps.getTerminals().entries(), caller.terminalId);
      if (others > 0) throw new TransitionFailure(`${others} other running terminal${others === 1 ? ' is' : 's are'} still using this checkout; close ${others === 1 ? 'it' : 'them'} first`);
      const checkout = await this.inspectCheckout(workspaceId, old);
      this.throwIfAborted(signal);

      let launched: ResumedSessionLaunch;
      try {
        launched = await this.startReplacement(caller, session, main, signal);
      } catch (error) {
        const reason = error instanceof TransitionAborted ? 'the request was cancelled' : messageOf(error, 'the conversation could not be resumed in the main checkout');
        this.notice(workspaceId, 'warning', `Could not move this conversation back to the main checkout: ${reason}. Nothing was removed; the isolated checkout "${old.branch ?? 'HEAD'}" is untouched.`);
        throw error instanceof TransitionAborted ? error : new TransitionFailure(`${messageOf(error, 'The conversation could not be resumed in the main checkout')} Nothing was removed; this conversation is unchanged.`);
      }

      await this.handOff(workspaceId, caller.terminalId, launched);
      // ---- past the commit point: the conversation lives in the main checkout; finish, never roll back ----
      const cleanup = await this.cleanUp(workspaceId, old, checkout, input.deleteBranch === true);
      this.notice(workspaceId, cleanup.complete ? 'info' : 'warning', cleanup.summary);
      return ok({ status: cleanup.complete ? 'completed' : 'moved-with-cleanup-pending', checkout: this.describe(main), cleanup: cleanup.report });
    });
  }

  // ---------------------------------------------------------------------------------------- phase 1

  /** Authority and support that both transactions share. Throws a refusal; mutates nothing. */
  private preflightCommon(caller: AgentBridgeCaller): { workspaceId: string; main: CheckoutContext } {
    const registry = this.deps.getRegistry();
    const terminal = this.deps.getTerminals().get(caller.terminalId);
    const workspaceId = caller.workspace.workspaceId;
    if (!registry || !terminal || registry.getWorkspace(workspaceId) !== caller.workspace) {
      throw new TransitionFailure('This Clanker session is no longer active');
    }
    if (caller.workspace.location.environmentId !== LOCAL_ENVIRONMENT_ID) {
      throw new TransitionFailure('Isolated checkouts are available for local workspaces only');
    }
    // Defense in depth: the credential is only granted to such launches, but the support rule is the authority.
    if (!supportsCheckoutRehoming(caller.harnessId)) {
      throw new TransitionFailure('This agent cannot be moved between checkouts: its conversation cannot be resumed from another directory');
    }
    const main = registry.resolveCheckoutContext(workspaceId);
    if (!main) throw new TransitionFailure('The workspace has no main checkout');
    return { workspaceId, main };
  }

  /**
   * Main's own record of the calling conversation: its native session id as proven by the harness'
   * lifecycle events (attention), then the conversation as history discovery finds it. Neither comes
   * from the model, and a conversation main cannot find is refused before anything is changed.
   */
  private async conversationOf(caller: AgentBridgeCaller): Promise<HarnessSession> {
    const sessionId = this.deps.attention.snapshot(caller.terminalId)?.sessionId ?? null;
    if (!sessionId) {
      throw new TransitionFailure('Clanker has not identified this conversation yet (agent attention must be enabled and the conversation started); try again after your next turn');
    }
    const sessions = this.deps.getSessions();
    const session = sessions ? await sessions.findSession(caller.workspace.workspaceId, caller.harnessId, sessionId) : null;
    if (!session) throw new TransitionFailure('Clanker could not find this conversation in its history yet, so it cannot be moved safely');
    return session;
  }

  /**
   * Isolated checkouts are created from the project workspace. A workspace that is itself a linked
   * worktree is refused (as the renderer's own flow refuses it), judged from Git's listing here in main
   * rather than from any renderer flag.
   */
  private async requireProjectWorkspace(workspaceId: string, workspacePath: string): Promise<void> {
    const listing = await this.deps.git.listWorktrees(workspaceId);
    if (!listing.success) throw new TransitionFailure(listing.error || 'Git could not list the repository worktrees');
    const own = findListedWorktree(listing, LOCAL_ENVIRONMENT_ID, workspacePath);
    if (own && !own.isMain) {
      throw new TransitionFailure('Isolated checkouts are created from the project workspace, not from a worktree workspace');
    }
  }

  /** What `complete` needs to know about the checkout before it commits to anything. */
  private async inspectCheckout(workspaceId: string, context: CheckoutContext): Promise<{ missing: boolean; branch: string | null }> {
    const listing = await this.deps.git.listWorktrees(workspaceId);
    if (!listing.success) throw new TransitionFailure(listing.error || 'Git could not list the repository worktrees');
    const listed = findListedWorktree(listing, LOCAL_ENVIRONMENT_ID, context.path);
    const onDisk = directoryExists(toNativePath(context.path, process.platform));
    if (!listed || listed.isMain) {
      // Git no longer has it at all: nothing on disk to remove; the context is simply released.
      return { missing: true, branch: context.branch ?? null };
    }
    // A lock is refused up front, even when the directory is gone: Git will not forget or remove it.
    if (listed.isLocked) throw new TransitionFailure('This worktree is locked; unlock it from the Git menu first');
    if (listed.isPrunable || !onDisk) return { missing: true, branch: listed.branch ?? context.branch ?? null };
    const clean = await this.deps.git.checkWorktreeClean(workspaceId, context.path);
    if (!clean.success) throw new TransitionFailure(clean.error || 'Could not inspect the isolated checkout');
    if (clean.hasChanges) {
      throw new TransitionFailure('The isolated checkout has uncommitted, untracked or ignored files. Commit or remove them first; nothing was changed.');
    }
    return { missing: false, branch: listed.branch ?? null };
  }

  // ------------------------------------------------------------------------------------ phases 2-3

  /**
   * Starts the replacement and proves it before returning. Any failure (including an abort) retires the
   * replacement and rethrows, leaving the requesting conversation exactly as it was.
   */
  private async startReplacement(
    caller: AgentBridgeCaller, session: HarnessSession, target: CheckoutContext, signal: AbortSignal,
  ): Promise<ResumedSessionLaunch> {
    const sessions = this.deps.getSessions();
    if (!sessions) throw new TransitionFailure('Conversation resume is unavailable');
    const workspaceId = caller.workspace.workspaceId;
    const output = deferred();
    const exited = deferred();
    const aborted = deferred();
    const onAbort = () => aborted.resolve();
    if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });

    let launched: ResumedSessionLaunch | undefined;
    const discard = async (): Promise<void> => { if (launched) await this.deps.retireTerminal(launched.id).catch(() => undefined); };
    try {
      launched = await sessions.resumeInCheckout(workspaceId, session, {
        targetContext: target,
        onOutput: () => output.resolve(),
        onExit: () => exited.resolve(),
        startupBufferLimit: REPLACEMENT_STARTUP_BUFFER,
      });
      const started = await firstOf({ output: output.promise, exited: exited.promise, aborted: aborted.promise }, this.timing.startDeadlineMs);
      if (started === 'aborted') throw new TransitionAborted();
      if (started !== 'output') throw new TransitionFailure(started === 'exited' ? 'The resumed conversation exited immediately' : 'The resumed conversation did not start in time');
      // A resume that cannot find its conversation prints an error and exits at once, so first output alone proves nothing.
      const observed = await firstOf({ exited: exited.promise, aborted: aborted.promise }, this.timing.observationMs);
      if (observed === 'aborted') throw new TransitionAborted();
      if (observed === 'exited') throw new TransitionFailure('The resumed conversation exited during startup');
      this.proveOwnership(workspaceId, caller, launched, target);
      return launched;
    } catch (error) {
      await discard();
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** The replacement is registered, bound to the target, attended, and the target is still the registered context. */
  private proveOwnership(workspaceId: string, caller: AgentBridgeCaller, launched: ResumedSessionLaunch, target: CheckoutContext): void {
    const registry = this.deps.getRegistry();
    const terminal = this.deps.getTerminals().get(launched.id);
    const current = registry?.getCheckoutContext(target.id);
    if (!terminal || terminal.workspaceId !== workspaceId || terminal.checkoutContextId !== target.id || terminal.harnessId !== caller.harnessId
      || launched.checkoutContextId !== target.id) {
      throw new TransitionFailure('The resumed conversation is not bound to the new checkout');
    }
    if (!current || current.workspaceId !== workspaceId || current.path !== target.path || registry?.getWorkspace(workspaceId) !== caller.workspace) {
      throw new TransitionFailure('The workspace or checkout changed while the conversation was being moved');
    }
    if (!this.deps.attention.snapshot(launched.id)) throw new TransitionFailure('The resumed conversation is not registered for agent attention');
  }

  // --------------------------------------------------------------------------------------- phase 4

  /**
   * The commit point. The renderer is told first so the pane adopts the replacement; then the requesting
   * process is retired (killed, attention released, bridge credential revoked) before any reply exists.
   */
  private async handOff(workspaceId: string, previousTerminalId: string, launched: ResumedSessionLaunch): Promise<void> {
    this.deps.notify({
      kind: 'terminal-replaced', workspaceId, previousTerminalId,
      terminal: {
        id: launched.id, pid: launched.pid, workingDir: launched.workingDir, checkoutContextId: launched.checkoutContextId ?? '',
        environmentId: LOCAL_ENVIRONMENT_ID, harnessId: launched.harnessId, attentionEnabled: launched.attentionEnabled,
      },
    });
    // The conversation already moved; a failure retiring the old process must not turn that into an error.
    await this.deps.retireTerminal(previousTerminalId).catch((error: unknown) => {
      console.warn('[clanker-grid] retiring the replaced terminal failed:', messageOf(error, 'unknown error'));
    });
  }

  // --------------------------------------------------------------------------------------- phase 5

  /**
   * Releases the old context, removes its checkout and optionally deletes its branch, through the
   * existing validated paths. Reports instead of throwing: the conversation has already moved.
   */
  private async cleanUp(
    workspaceId: string, old: CheckoutContext, checkout: { missing: boolean; branch: string | null }, deleteBranch: boolean,
  ): Promise<CleanupOutcome> {
    const report: Record<string, unknown> = {};
    try {
      return await this.runCleanUp(workspaceId, old, checkout, deleteBranch, report);
    } catch (error) {
      // Past the commit point nothing may surface as "the conversation was left where it was": it was
      // not. Whatever threw, the outcome is a partial cleanup, reported to the user.
      report.error = 'cleanup failed';
      return {
        complete: false, report,
        summary: `This conversation is now in the main checkout, but the isolated checkout "${old.branch ?? 'HEAD'}" was not fully cleaned up: ${messageOf(error, 'an unexpected error occurred')}. Check it in the Git menu.`,
      };
    }
  }

  private async runCleanUp(
    workspaceId: string, old: CheckoutContext, checkout: { missing: boolean; branch: string | null }, deleteBranch: boolean,
    report: Record<string, unknown>,
  ): Promise<CleanupOutcome> {
    const label = old.branch ?? 'HEAD';
    const partial = (reason: string): CleanupOutcome => ({
      complete: false, report,
      summary: `This conversation is now in the main checkout, but the isolated checkout "${label}" was not fully cleaned up: ${reason}`,
    });

    // Release only once nothing uses it (the protections are the existing ones, not bypassed for MCP).
    // Reconciliation with Git may already have dropped a missing checkout's context in the meantime; a
    // context that is no longer registered is released, not a failure.
    const alreadyReleased = this.deps.getRegistry()?.getCheckoutContext(old.id) == null;
    const released = alreadyReleased ? { success: true as const } : this.deps.releaseCheckoutContext(workspaceId, old.id);
    if (!released.success) { report.checkoutReleased = false; return partial(`${released.error ?? 'it could not be released'}. Its worktree was kept.`); }
    report.checkoutReleased = true;
    this.deps.notify({ kind: 'checkout-released', workspaceId, checkoutContextId: old.id });

    // The checkout itself.
    if (checkout.missing) {
      const forgotten = await this.deps.git.forgetMissingWorktree(workspaceId, old.path);
      report.worktreeRemoved = forgotten.success;
      if (!forgotten.success) return partial(`its directory was already gone, but Git's record of it remains (${forgotten.error ?? 'unknown error'}).`);
    } else {
      const inspection = await this.deps.git.inspectWorktree(workspaceId, old.path, []);
      if (!inspection.success || !inspection.worktree || typeof inspection.hasChanges !== 'boolean') {
        report.worktreeRemoved = false;
        return partial(`${inspection.error ?? 'it could not be inspected'}. It was left on disk at ${old.path}.`);
      }
      if (inspection.hasChanges) {
        report.worktreeRemoved = false;
        return partial(`it now holds uncommitted, untracked or ignored files. It was left on disk at ${old.path}.`);
      }
      const removal = await this.deps.git.removeWorktree(workspaceId, inspection.worktree.path, inspection.worktree.branch, []);
      report.worktreeRemoved = removal.success;
      if (!removal.success) return partial(`${removal.error ?? 'removal failed'}. It was left on disk at ${old.path}.`);
    }

    // The branch: only on request, only the branch this checkout was registered with, never forced.
    let branchNote = '';
    if (deleteBranch) {
      const branch = old.branch ?? null;
      if (!branch || (checkout.branch !== null && checkout.branch !== branch)) {
        report.branchDeleted = false;
        branchNote = ' The branch was kept (it could not be matched to this checkout).';
      } else {
        const deletion = await this.deps.git.deleteBranch(workspaceId, branch);
        report.branchDeleted = deletion.success;
        branchNote = deletion.success ? ` Branch "${branch}" was deleted.`
          : deletion.blockedByUnmergedCommits ? ` Branch "${branch}" was kept: Git does not consider it fully merged into the current branch.`
          : ` Branch "${branch}" was kept: ${deletion.error ?? 'it could not be deleted'}.`;
      }
    } else {
      report.branchDeleted = false;
    }

    // Bring every context in line with Git (and let the renderer refresh its listing); advisory only.
    await this.deps.git.reconcileCheckoutContexts(workspaceId).catch(() => undefined);
    return { complete: true, report, summary: `Completed isolated checkout "${label}": this conversation is back in the main checkout and the worktree was removed.${branchNote}` };
  }

  // ------------------------------------------------------------------------------------- plumbing

  private describe(context: CheckoutContext): { kind: CheckoutContext['kind']; isolated: boolean; branch: string | null } {
    return { kind: context.kind, isolated: context.kind === 'worktree', branch: context.branch ?? null };
  }

  private notice(workspaceId: string, tone: 'info' | 'warning', message: string): void {
    this.deps.notify({ kind: 'notice', workspaceId, tone, message });
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new TransitionAborted();
  }

  /**
   * One transition per conversation at a time, tracked so shutdown can wait for it. The promise is the
   * transaction itself: if the bridge abandons the call (timeout, client gone) it still runs to its own
   * end here, and is never an orphan.
   */
  private async exclusive(caller: AgentBridgeCaller, body: () => Promise<AgentBridgeToolResult>): Promise<AgentBridgeToolResult> {
    if (this.shutDown || this.deps.isShuttingDown()) return refuse('Clanker is shutting down');
    if (this.active.has(caller.terminalId)) return refuse('A checkout transition is already in progress for this conversation');
    const transaction = (async (): Promise<AgentBridgeToolResult> => {
      try {
        return await body();
      } catch (error) {
        if (error instanceof TransitionFailure) return refuse(error.message);
        if (error instanceof TransitionAborted) return refuse('The request was cancelled before the conversation was moved; nothing changed');
        // Unknown failures keep their detail in main; the agent gets a bounded generic error.
        console.warn('[clanker-grid] isolated checkout transition failed:', messageOf(error, 'unknown error'));
        return refuse('The checkout transition failed; the conversation was left where it was');
      }
    })();
    this.active.set(caller.terminalId, transaction);
    try { return await transaction; } finally { this.active.delete(caller.terminalId); }
  }
}
