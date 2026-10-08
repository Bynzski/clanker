import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { WorkspaceRegistry, RegisteredWorkspace } from '../workspaceRegistry';
import type { CheckoutContext } from '../../shared/types/checkoutContext';
import type { AgentLocation } from '../../shared/types/agentAttention';
import type { TerminalUsage } from '../checkoutContextRelease';
import type { DevServiceTarget, DevServiceStartRequest, DevServiceSettingsRequest, DevServiceSettingsSnapshot, DevServiceDiscoveryResult, WorkspaceService, WorkspaceServicesUpdate, WorkspaceServiceResult } from '../../shared/types/workspaceServices';
import { discoverDevCommand } from './devCommandDiscovery';
import { applyDevServiceEnvironment, DevServiceSettings } from './devServiceSettings';
import { resolveHarnessPtySpawn } from '../harnessLaunch';
import { prependUserCliBinsToPath } from '../platformShell';
import { normalizeWorkspacePath } from '../../shared/workspaceIdentity';
import { toNativePath } from '../../shared/pathNormalize';
import { withoutAttentionEnvironment } from '../environment/attentionEnvironment';
import { withoutAgentBridgeEnvironment } from '../agentBridge/service';
import { createTerminalOutputRows } from '../terminalOutputRows';
import { findTerminalUrls } from '../../shared/terminalUrls';
import { probeRecipePreview } from '../recipePreview';
import { DiagnosticTail, classifyPortConflict, describePortConflict, type PortConflict } from './devServiceDiagnostics';

interface ServiceTerminal { workspaceId?: string; checkoutContextId?: string }
interface Target { workspace: RegisteredWorkspace; context: CheckoutContext; terminal: ServiceTerminal; canonicalRoot: string }
/**
 * Ownership of one managed service. The PTY child is the leader of its own session and process group
 * (node-pty forks with setsid), so on POSIX `pgid === child.pid` names every process the service started
 * that has not left the group. Leader exit therefore never means "service finished": only a group that
 * the kernel reports empty does.
 */
interface Runtime {
  service: WorkspaceService;
  process?: IPty;
  /** POSIX process group created for this service; only signaled while it is still believed to be ours. */
  pgid?: number;
  /** An explicit stop (or workspace close/shutdown) was requested. Never set by an unexpected exit. */
  cancelled: boolean;
  /** All managed processes are verified gone (or none was ever spawned). Only then is the checkout released. */
  exited: boolean;
  /** Termination was attempted and could not be confirmed. Keeps blocking launches and checkout removal. */
  cleanupFailed: boolean;
  /** The group was observed empty. After this it is never signaled again, so a recycled PID cannot be hit. */
  groupGone: boolean;
  ptyExited?: boolean;
  probeTimer?: ReturnType<typeof setTimeout>;
  /** Explicit stop in flight. */
  stop?: Promise<void>;
  /** Termination (explicit or after an unexpected exit) in flight; single-flight. */
  cleanup?: Promise<boolean>;
  probing: boolean;
  candidates: Set<string>;
  tail: DiagnosticTail;
  portConflict?: PortConflict;
  /** The process ended without an explicit stop being requested first; its diagnosis survives any later takeover. */
  unexpected?: boolean;
  /** Diagnosis of an unexpected exit, kept so a later Stop of an unresolved cleanup does not erase why it failed. */
  failure?: string;
  /** A signal was refused with EPERM (a member runs as another user): reported, since it cannot be fixed by retrying. */
  permissionDenied?: boolean;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Dev server operation failed';
const SIGNAL_NAMES = new Map(Object.entries(os.constants.signals).map(([name, value]) => [value, name]));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Process-group existence probe: signal 0 delivers nothing. Only ESRCH proves the group is gone; EPERM (it exists,
 * owned by someone else) and any unexpected error fail closed as "still alive".
 */
const defaultGroupAlive = (pgid: number): boolean => {
  try { process.kill(-pgid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
};

/** Headless PTYs: no TerminalPane, TERMINAL_READY, pane state, or attention/bridge credentials. */
export class WorkspaceServiceManager {
  private readonly runtimes = new Map<string, Runtime>();
  private revision = 0;
  private closed = false;
  private readonly settings: DevServiceSettings;
  private settingsSnapshot?: DevServiceSettingsSnapshot;
  constructor(private readonly deps: {
    registry: WorkspaceRegistry;
    settings?: DevServiceSettings;
    getTerminal: (id: string) => ServiceTerminal | undefined;
    getLocation: (id: string) => AgentLocation | null;
    isShuttingDown: () => boolean;
    changed: (update: WorkspaceServicesUpdate) => void;
    spawn?: typeof pty.spawn;
    probe?: typeof probeRecipePreview;
    signalGroup?: (pid: number, signal: NodeJS.Signals) => void;
    /** Test seam; production probes the real process group. */
    isGroupAlive?: (pgid: number) => boolean;
    /** Graceful window, post-SIGKILL verification window, and poll interval, all bounded per operation. */
    timing?: { graceMs?: number; killMs?: number; pollMs?: number };
    /** Test seam for synthetic registry roots; production always resolves the physical root. */
    canonicalRoot?: (registeredPath: string) => string;
  }) { this.settings = deps.settings ?? new DevServiceSettings(); }

  snapshot(): WorkspaceServicesUpdate {
    // Completed diagnostics need not outlive their checkout or originating conversation.
    // Live services are deliberately retained even when the conversation has gone.
    let removed = false;
    for (const [id, runtime] of this.runtimes) {
      if (runtime.exited && (!this.deps.registry.resolveCheckoutContext(runtime.service.workspaceId, runtime.service.checkoutContextId)
        || !this.deps.getTerminal(runtime.service.sourceTerminalId))) {
        this.runtimes.delete(id); removed = true;
      }
    }
    if (removed) this.revision++;
    return { revision: this.revision, services: [...this.runtimes.values()].map(({ service }) => ({ ...service })),
      ...(this.settingsSnapshot ? { settings: { ...this.settingsSnapshot, checkouts: this.settingsSnapshot.checkouts.map((entry) => ({ ...entry })) } } : {}) };
  }
  private publish() { this.revision++; this.deps.changed(this.snapshot()); }
  /** Include both pending launches and live services in checkout release/removal checks. */
  usages(): TerminalUsage[] {
    return [...this.runtimes.values()].filter((runtime) => !runtime.exited).map(({ service }) => ({
      resourceKind: 'service', checkoutContextId: service.checkoutContextId, environmentId: 'local', cwd: toNativePath(service.cwd, process.platform),
    }));
  }
  private resolve(request: DevServiceTarget): Target {
    if (this.closed || this.deps.isShuttingDown()) throw new Error('Application is shutting down');
    const workspace = this.deps.registry.getWorkspace(request.workspaceId);
    const terminal = this.deps.getTerminal(request.terminalId);
    if (!workspace || !terminal || terminal.workspaceId !== workspace.workspaceId) throw new Error('Terminal is not registered for this workspace');
    if (workspace.environment.kind !== 'local') throw new Error('Dev servers are currently supported only in local workspaces');
    const location = this.deps.getLocation(request.terminalId);
    // A native location report is presentation evidence, not authority: only a registered root may be used.
    const contextId = location ? location.checkoutContextId : terminal.checkoutContextId;
    if (location && !contextId) throw new Error('Agent is outside a registered checkout');
    const context = this.deps.registry.resolveCheckoutContext(workspace.workspaceId, contextId ?? undefined);
    if (!context || context.missing) throw new Error('Checkout is missing or no longer registered');
    const canonicalRoot = this.deps.canonicalRoot?.(context.path)
      ?? normalizeWorkspacePath(fs.realpathSync.native(toNativePath(context.path, process.platform)));
    return { workspace, terminal, context, canonicalRoot };
  }
  private recheck(request: DevServiceTarget, target: Target) {
    const current = this.resolve(request);
    if (current.workspace !== target.workspace || current.terminal !== target.terminal || current.context !== target.context || current.canonicalRoot !== target.canonicalRoot) {
      throw new Error('Terminal checkout changed; discover the dev command again');
    }
  }
  async discover(request: DevServiceTarget): Promise<DevServiceDiscoveryResult> {
    try {
      const target = this.resolve(request);
      const command = await discoverDevCommand(target.workspace.environment, target.context);
      this.recheck(request, target);
      const settings = this.settings.get(target.canonicalRoot);
      return { success: true, command: command ? { ...command, cwd: target.canonicalRoot, settingsRevision: settings.settingsRevision, environmentKeys: Object.keys(settings.environment) } : undefined, environment: settings.environment };
    } catch (error) { return { success: false, error: message(error) }; }
  }

  async saveSettings(request: DevServiceSettingsRequest): Promise<DevServiceDiscoveryResult> {
    try {
      const target = this.resolve(request);
      this.confirmSettingsTarget(request, target);
      const command = await discoverDevCommand(target.workspace.environment, target.context);
      this.recheck(request, target);
      if (!command || command.command !== request.command) throw new Error('Dev command changed; discover it again');
      this.confirmSettingsTarget(request, target);
      if ([...this.runtimes.values()].some((entry) => !entry.exited && entry.service.cwd === target.canonicalRoot)) {
        throw new Error('Stop the checkout dev server before changing settings');
      }
      // No await between live-service check, compare-and-set and persistence.
      this.settings.set(target.canonicalRoot, request.settingsRevision, request.environment);
      const settings = this.settings.get(target.canonicalRoot);
      // Full, bounded metadata survives missed/reordered pushes and clearing a root; values stay in main.
      this.settingsSnapshot = this.settings.revisions();
      this.publish();
      return { success: true, command: { ...command, cwd: target.canonicalRoot, settingsRevision: settings.settingsRevision, environmentKeys: Object.keys(settings.environment) }, environment: settings.environment };
    } catch (error) { return { success: false, error: message(error) }; }
  }
  private confirmSettingsTarget(request: DevServiceStartRequest, target: Target): void {
    if (request.checkoutContextId !== target.context.id || request.cwd !== target.canonicalRoot) throw new Error('Terminal checkout changed; discover the dev command again');
    if (!this.settings.matches(target.canonicalRoot, request.settingsRevision)) throw new Error('Dev server settings changed; discover the dev command again');
  }

  async start(request: DevServiceStartRequest): Promise<WorkspaceServiceResult> {
    let runtime: Runtime | undefined;
    try {
      this.snapshot(); // Retire completed orphan records before applying the global bound.
      const target = this.resolve(request);
      this.confirmSettingsTarget(request, target);
      for (;;) { // Everything up to the reservation below is synchronous, so concurrent Starts cannot both pass it.
        const existing = [...this.runtimes.values()].find((entry) => entry.service.workspaceId === request.workspaceId && entry.service.checkoutContextId === target.context.id);
        if (!existing) break;
        if (existing.exited) { this.runtimes.delete(existing.service.id); break; } // Stopped/failed with cleanup verified: replace it.
        if (existing.stop || existing.cleanup) throw new Error('The dev server is still stopping; start it again once it has stopped');
        if (existing.cleanupFailed) { await this.stopRuntime(existing); continue; } // Retry cleanup; relaunch only once ownership is relinquished.
        if (existing.service.command !== request.command || existing.service.cwd !== target.canonicalRoot) throw new Error('A different dev command is already running in this checkout');
        return { success: true, service: { ...existing.service } };
      }
      if (this.runtimes.size >= 64) throw new Error('Dev service limit reached');
      const id = randomUUID();
      runtime = {
        service: { id, workspaceId: request.workspaceId, checkoutContextId: target.context.id, checkoutRoot: target.context.path, cwd: target.canonicalRoot,
          command: request.command, packageManager: 'npm', sourceTerminalId: request.terminalId, status: 'starting' },
        cancelled: false, exited: false, cleanupFailed: false, groupGone: false, probing: false, candidates: new Set(), tail: new DiagnosticTail(),
      };
      this.runtimes.set(id, runtime);
      // Reserve before asynchronous inspection: release/removal and duplicate launches cannot race the spawn.
      this.publish();
      const command = await discoverDevCommand(target.workspace.environment, target.context);
      if (!command || command.command !== request.command) throw new Error('Dev command changed; discover it again before running');
      this.recheck(request, target);
      const validation = await target.workspace.environment.validateWorkspacePath(target.context.path);
      this.recheck(request, target);
      if (!validation.valid || !validation.resolvedPath) throw new Error('Checkout is no longer accessible');
      // Physical-root identity is also checked by recheck: symlink retargeting cannot redirect a launch.
      if (normalizeWorkspacePath(validation.resolvedPath) !== target.context.path) throw new Error('Checkout root changed');
      if (runtime.cancelled || this.closed || this.runtimes.get(id) !== runtime) throw new Error('Dev server start was cancelled');
      this.confirmSettingsTarget(request, target);
      const settings = this.settings.get(target.canonicalRoot);
      runtime.service = { ...runtime.service, ...command, cwd: target.canonicalRoot, settingsRevision: settings.settingsRevision, environmentKeys: Object.keys(settings.environment) };
      const env = withoutAgentBridgeEnvironment(withoutAttentionEnvironment({
        ...applyDevServiceEnvironment(process.env, settings.environment), PATH: prependUserCliBinsToPath(process.env.PATH ?? ''),
        TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'clanker-grid', FORCE_COLOR: '1',
      }));
      const args = command.packageManager === 'yarn' ? ['dev'] : ['run', 'dev'];
      const plan = resolveHarnessPtySpawn(command.packageManager, args, null, { env });
      this.recheck(request, target);
      // No await between the checks above and the spawn: a shutdown or close cannot slip in between.
      const child = (this.deps.spawn ?? pty.spawn)(plan.spawnCmd, plan.spawnArgs, {
        name: 'xterm-256color', cols: 120, rows: 30, cwd: toNativePath(target.canonicalRoot, process.platform), env, handleFlowControl: false,
      });
      runtime.process = child;
      runtime.pgid = child.pid;
      runtime.service.pid = child.pid;
      const live = runtime;
      // Two bounded observers: URLs must be whole rows (an over-long row is dropped), diagnostics keep a truncated one.
      const observeUrls = createTerminalOutputRows((row) => this.observeUrl(live, row));
      const observeDiagnostics = createTerminalOutputRows((row) => this.observeDiagnostics(live, row), { truncate: true });
      child.onData((data) => { observeUrls(data); observeDiagnostics(data); });
      child.onExit(({ exitCode, signal }) => this.onPtyExit(live, exitCode, signal));
      // The process exists and has not terminated. Readiness is separate: `previewUrl` appears only after a probe succeeds.
      live.service.status = 'running';
      this.publish();
      return { success: true, service: { ...live.service } };
    } catch (error) {
      if (runtime?.process && !runtime.exited) {
        // Something failed after the process exists (not before): it must not be orphaned by a bookkeeping error.
        void this.stopRuntime(runtime).catch(() => undefined);
      } else if (runtime) {
        runtime.exited = true;
        runtime.service.status = runtime.cancelled ? 'stopped' : 'failed';
        runtime.service.error = message(error);
        if (this.runtimes.get(runtime.service.id) === runtime) this.publish();
      }
      return { success: false, error: message(error) };
    }
  }

  private observeDiagnostics(runtime: Runtime, row: string) {
    runtime.tail.push(row);
    const conflict = classifyPortConflict(row);
    // A row naming the port wins over a later portless one (Node prints both an error line and `code: 'EADDRINUSE'`).
    if (conflict && !runtime.service.previewUrl && (conflict.port !== undefined || !runtime.portConflict)) runtime.portConflict = conflict;
  }
  private observeUrl(runtime: Runtime, row: string) {
    if (runtime.cancelled || runtime.exited || runtime.service.previewUrl) return;
    for (const match of findTerminalUrls(row)) {
      const url = new URL(match.target);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      if (!['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '[::]'].includes(url.hostname)) continue;
      if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
      if (url.hostname === '[::]') url.hostname = '[::1]';
      if (runtime.candidates.has(url.href) || runtime.candidates.size >= 8) continue;
      runtime.candidates.add(url.href);
    }
    this.probeCandidates(runtime);
  }
  private probeCandidates(runtime: Runtime) {
    if (runtime.probing || runtime.probeTimer || runtime.cancelled || runtime.exited || runtime.service.previewUrl || !runtime.candidates.size) return;
    runtime.probing = true;
    void (async () => {
      for (const url of runtime.candidates) {
        if (runtime.cancelled || runtime.exited) return;
        const result = await (this.deps.probe ?? probeRecipePreview)(url, true);
        if (result.status === 'ready' && !runtime.cancelled && !runtime.exited && this.runtimes.get(runtime.service.id) === runtime) {
          runtime.service.previewUrl = url;
          runtime.portConflict = undefined; // It is serving: any earlier busy-port line was a recovered warning.
          this.publish();
          return;
        }
      }
    })().catch(() => undefined).finally(() => {
      runtime.probing = false;
      if (!runtime.cancelled && !runtime.exited && !runtime.service.previewUrl) {
        runtime.probeTimer = setTimeout(() => { runtime.probeTimer = undefined; this.probeCandidates(runtime); }, 5000);
      }
    });
  }

  // ---- Process ownership and termination -------------------------------------------------------

  /**
   * True once no process of this service remains. POSIX: the group the PTY leader created is empty (a leader that
   * exited while descendants live does NOT count). Windows has no process groups here, so the PTY exiting is the
   * strongest signal available (best effort). Once observed gone the answer is latched so the pgid is never reused.
   */
  private isGone(runtime: Runtime): boolean {
    if (runtime.groupGone) return true;
    if (!runtime.process || runtime.pgid === undefined) return (runtime.groupGone = true);
    const gone = process.platform === 'win32' ? runtime.ptyExited === true : !(this.deps.isGroupAlive ?? defaultGroupAlive)(runtime.pgid);
    if (gone) runtime.groupGone = true;
    return gone;
  }
  private signal(runtime: Runtime, signal: NodeJS.Signals) {
    if (runtime.groupGone) return; // Ownership relinquished: the number may now belong to an unrelated process.
    if (process.platform !== 'win32' && runtime.pgid !== undefined) {
      try { (this.deps.signalGroup ?? ((pid, sig) => process.kill(-pid, sig)))(runtime.pgid, signal); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ESRCH') runtime.groupGone = true; // Nothing left in the group.
        else if (code === 'EPERM') runtime.permissionDenied = true; // Fail closed: it is not gone, and we say why.
      }
    }
    if (runtime.process && !runtime.ptyExited) { try { runtime.process.kill(signal); } catch { /* onExit decides liveness */ } }
  }
  private async waitUntilGone(runtime: Runtime, ms: number): Promise<boolean> {
    const pollMs = this.deps.timing?.pollMs ?? 25;
    const deadline = Date.now() + ms;
    while (!this.isGone(runtime)) {
      if (Date.now() >= deadline) return false;
      await sleep(pollMs);
    }
    return true;
  }
  /** SIGTERM the group, wait, escalate to SIGKILL, wait, and report whether the group is verifiably empty. */
  private async reap(runtime: Runtime): Promise<boolean> {
    if (this.isGone(runtime)) return true;
    this.signal(runtime, 'SIGTERM');
    if (await this.waitUntilGone(runtime, this.deps.timing?.graceMs ?? 2000)) return true;
    this.signal(runtime, 'SIGKILL');
    return this.waitUntilGone(runtime, this.deps.timing?.killMs ?? 2000);
  }
  private runCleanup(runtime: Runtime): Promise<boolean> {
    return runtime.cleanup ??= this.reap(runtime).finally(() => { runtime.cleanup = undefined; });
  }

  private onPtyExit(live: Runtime, exitCode: number, signal?: number) {
    live.ptyExited = true;
    clearTimeout(live.probeTimer);
    live.service.exitCode = exitCode;
    live.service.exitSignal = signal ? SIGNAL_NAMES.get(signal) ?? String(signal) : undefined;
    live.service.previewUrl = undefined;
    // An explicit stop is polling the group already; it owns the final state.
    if (live.cancelled || live.exited) { if (this.runtimes.get(live.service.id) === live) this.publish(); return; }
    // Unexpected exit. The leader going away says nothing about its descendants (npm commonly exits first).
    live.unexpected = true;
    if (this.isGone(live)) { this.finishUnexpected(live, true); return; }
    live.service.status = 'stopping';
    if (this.runtimes.get(live.service.id) === live) this.publish();
    void this.runCleanup(live).then((ok) => this.finishUnexpected(live, ok), () => this.finishUnexpected(live, false));
  }
  private incompleteNote(runtime: Runtime): string {
    return runtime.permissionDenied
      ? 'Some processes started by this dev server could not be signalled (permission denied) and are still running. Stop them outside Clanker, then Stop again.'
      : 'Some processes started by this dev server could not be confirmed terminated. Stop it again before restarting.';
  }
  /** Builds the failure record from the exit and the output captured so far (descendants may still be writing). */
  private diagnose(live: Runtime) {
    const { exitCode, exitSignal } = live.service;
    const how = exitSignal ? `terminated by ${exitSignal}` : `exited with code ${exitCode}`;
    live.service.portConflict = live.portConflict;
    live.failure = [
      live.portConflict && describePortConflict(live.portConflict),
      live.service.preparationHint,
      live.tail.text() || `Command ${how}`,
      exitCode === 0 && !exitSignal ? 'The dev server exited on its own (code 0); it was not stopped from Clanker.' : undefined,
    ].filter(Boolean).join('\n');
  }
  private finishUnexpected(live: Runtime, cleaned: boolean) {
    if (live.cancelled) return; // An explicit stop took over; stopRuntime() reports the same diagnosis.
    this.diagnose(live);
    live.exited = cleaned;
    live.cleanupFailed = !cleaned;
    live.service.cleanupIncomplete = cleaned ? undefined : true;
    live.service.status = 'failed';
    live.service.error = [live.failure, cleaned ? undefined : this.incompleteNote(live)].filter(Boolean).join('\n');
    if (this.runtimes.get(live.service.id) === live) this.publish();
  }

  async stop(workspaceId: string, serviceId: string): Promise<WorkspaceServiceResult> {
    const runtime = this.runtimes.get(serviceId);
    if (!runtime || runtime.service.workspaceId !== workspaceId) return { success: false, error: 'Service is not owned by this workspace' };
    try {
      await this.stopRuntime(runtime);
      return { success: true, service: { ...runtime.service } };
    } catch (error) { return { success: false, error: message(error) }; }
  }
  /** Idempotent and single-flight. Resolves only once ownership is verifiably relinquished; rejects otherwise. */
  private stopRuntime(runtime: Runtime): Promise<void> {
    if (runtime.stop) return runtime.stop;
    if (runtime.exited) return Promise.resolve();
    runtime.cancelled = true;
    clearTimeout(runtime.probeTimer);
    runtime.service.previewUrl = undefined;
    if (!runtime.process) {
      runtime.exited = true; runtime.service.status = 'stopped'; this.publish();
      return Promise.resolve();
    }
    runtime.service.status = 'stopping'; runtime.service.error = undefined; runtime.service.cleanupIncomplete = undefined;
    this.publish();
    const stopping = this.runCleanup(runtime).then((cleaned) => {
      runtime.stop = undefined;
      // An explicit stop that took over after an unexpected exit must not erase why the service died.
      if (runtime.unexpected) this.diagnose(runtime);
      runtime.exited = cleaned;
      runtime.cleanupFailed = !cleaned;
      // A service that had already failed on its own stays failed (with its diagnosis) once its leftovers are gone.
      if (cleaned) {
        runtime.service.status = runtime.failure === undefined ? 'stopped' : 'failed';
        runtime.service.error = runtime.failure; runtime.service.cleanupIncomplete = undefined;
        this.publish();
        return;
      }
      runtime.service.status = 'failed'; runtime.service.cleanupIncomplete = true;
      const reason = runtime.permissionDenied ? this.incompleteNote(runtime) : 'Dev server did not exit; try Stop again';
      runtime.service.error = [runtime.failure, reason].filter(Boolean).join('\n');
      this.publish();
      throw new Error(reason);
    });
    runtime.stop = stopping;
    return stopping;
  }
  /** Stops every owned service. Records whose cleanup could not be verified are kept (not forgotten) and reported. */
  async closeWorkspace(workspaceId: string): Promise<void> {
    const owned = [...this.runtimes.values()].filter(({ service }) => service.workspaceId === workspaceId);
    const results = await Promise.allSettled(owned.map((runtime) => this.stopRuntime(runtime)));
    const unresolved: Runtime[] = [];
    for (const [index, runtime] of owned.entries()) {
      if (results[index].status === 'fulfilled' && runtime.exited) this.runtimes.delete(runtime.service.id); else unresolved.push(runtime);
    }
    this.publish();
    if (!unresolved.length) return;
    for (const runtime of unresolved) this.retryAfterClose(runtime);
    throw new Error(`${unresolved.length} dev server(s) could not be confirmed stopped: ${unresolved.map(({ service }) => `pid ${service.pid ?? '?'} in ${service.cwd}`).join('; ')}`);
  }
  /**
   * A closed workspace's leftovers have no UI to retry from, so the failed cleanup is retried a few times with
   * growing delays (3 attempts, never a standing poll). Shutdown makes its own final attempt and ends these.
   */
  private retryAfterClose(runtime: Runtime, attempt = 1) {
    if (attempt > 3) return;
    const timer = setTimeout(() => {
      if (this.closed || this.runtimes.get(runtime.service.id) !== runtime) return;
      void this.stopRuntime(runtime).then(() => {
        if (this.runtimes.get(runtime.service.id) === runtime) { this.runtimes.delete(runtime.service.id); this.publish(); }
      }, () => this.retryAfterClose(runtime, attempt + 1));
    }, 10_000 * attempt);
    timer.unref?.();
  }
  async reset(): Promise<void> {
    const results = await Promise.allSettled([...new Set([...this.runtimes.values()].map(({ service }) => service.workspaceId))].map((id) => this.closeWorkspace(id)));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  /** Refuses new launches first, then waits (bounded per service) for every service to be verified gone. */
  async shutdown(): Promise<void> { this.closed = true; await this.reset(); }
}
