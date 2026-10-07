import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { WorkspaceRegistry, RegisteredWorkspace } from '../workspaceRegistry';
import type { CheckoutContext } from '../../shared/types/checkoutContext';
import type { AgentLocation } from '../../shared/types/agentAttention';
import type { TerminalUsage } from '../checkoutContextRelease';
import type { DevServiceTarget, DevServiceStartRequest, DevServiceDiscoveryResult, WorkspaceService, WorkspaceServicesUpdate, WorkspaceServiceResult } from '../../shared/types/workspaceServices';
import { discoverDevCommand } from './devCommandDiscovery';
import { resolveHarnessPtySpawn } from '../harnessLaunch';
import { prependUserCliBinsToPath } from '../platformShell';
import { normalizeWorkspacePath } from '../../shared/workspaceIdentity';
import { toNativePath } from '../../shared/pathNormalize';
import { withoutAttentionEnvironment } from '../agentAttentionAdapters';
import { withoutAgentBridgeEnvironment } from '../agentBridge/service';
import { createTerminalOutputRows } from '../terminalOutputRows';
import { findTerminalUrls } from '../../shared/terminalUrls';
import { probeRecipePreview } from '../recipePreview';

interface ServiceTerminal { workspaceId?: string; checkoutContextId?: string }
interface Target { workspace: RegisteredWorkspace; context: CheckoutContext; terminal: ServiceTerminal; canonicalRoot: string }
interface Runtime {
  service: WorkspaceService;
  process?: IPty;
  cancelled: boolean;
  exited: boolean;
  ptyExited?: boolean;
  probeTimer?: ReturnType<typeof setTimeout>;
  stop?: Promise<void>;
  startupTimer?: ReturnType<typeof setTimeout>;
  probing: boolean;
  candidates: Set<string>;
  outputTail: string;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Dev server operation failed';

/** Headless PTYs: no TerminalPane, TERMINAL_READY, pane state, or attention/bridge credentials. */
export class WorkspaceServiceManager {
  private readonly runtimes = new Map<string, Runtime>();
  private revision = 0;
  private closed = false;
  constructor(private readonly deps: {
    registry: WorkspaceRegistry;
    getTerminal: (id: string) => ServiceTerminal | undefined;
    getLocation: (id: string) => AgentLocation | null;
    isShuttingDown: () => boolean;
    changed: (update: WorkspaceServicesUpdate) => void;
    spawn?: typeof pty.spawn;
    probe?: typeof probeRecipePreview;
    signalGroup?: (pid: number, signal: NodeJS.Signals) => void;
    /** Test seam for synthetic registry roots; production always resolves the physical root. */
    canonicalRoot?: (registeredPath: string) => string;
  }) {}

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
    return { revision: this.revision, services: [...this.runtimes.values()].map(({ service }) => ({ ...service })) };
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
      return { success: true, command: command ? { ...command, cwd: target.canonicalRoot } : undefined };
    } catch (error) { return { success: false, error: message(error) }; }
  }

  async start(request: DevServiceStartRequest): Promise<WorkspaceServiceResult> {
    let runtime: Runtime | undefined;
    try {
      this.snapshot(); // Retire completed orphan records before applying the global bound.
      const target = this.resolve(request);
      if (request.checkoutContextId !== target.context.id || request.cwd !== target.canonicalRoot) throw new Error('Terminal checkout changed; discover the dev command again');
      const existing = [...this.runtimes.values()].find((entry) => entry.service.workspaceId === request.workspaceId && entry.service.checkoutContextId === target.context.id);
      if (existing && !existing.exited) {
        if (existing.service.command !== request.command || existing.service.cwd !== target.canonicalRoot) throw new Error('A different dev command is already running in this checkout');
        return { success: true, service: { ...existing.service } };
      }
      if (existing) this.runtimes.delete(existing.service.id);
      if (this.runtimes.size >= 64) throw new Error('Dev service limit reached');
      const id = randomUUID();
      runtime = {
        service: { id, workspaceId: request.workspaceId, checkoutContextId: target.context.id, checkoutRoot: target.context.path, cwd: target.canonicalRoot,
          command: request.command, packageManager: 'npm', sourceTerminalId: request.terminalId, status: 'starting' },
        cancelled: false, exited: false, probing: false, candidates: new Set(), outputTail: '',
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
      if (runtime.cancelled || this.runtimes.get(id) !== runtime) throw new Error('Dev server start was cancelled');
      runtime.service = { ...runtime.service, ...command, cwd: target.canonicalRoot };
      const env = withoutAgentBridgeEnvironment(withoutAttentionEnvironment({
        ...process.env as Record<string, string>, PATH: prependUserCliBinsToPath(process.env.PATH ?? ''),
        TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'clanker-grid', FORCE_COLOR: '1',
      }));
      const args = command.packageManager === 'yarn' ? ['dev'] : ['run', 'dev'];
      const plan = resolveHarnessPtySpawn(command.packageManager, args, null, { env });
      this.recheck(request, target);
      const child = (this.deps.spawn ?? pty.spawn)(plan.spawnCmd, plan.spawnArgs, {
        name: 'xterm-256color', cols: 120, rows: 30, cwd: toNativePath(target.canonicalRoot, process.platform), env, handleFlowControl: false,
      });
      runtime.process = child;
      runtime.service.pid = child.pid;
      const live = runtime;
      const observe = createTerminalOutputRows((row) => {
        if (row.trim()) live.outputTail = `${live.outputTail}${row}\n`.slice(-2048);
        this.observeUrl(live, row);
      });
      child.onData(observe); // Only a bounded 2 KiB failure tail, never an unbounded output buffer.
      child.onExit(({ exitCode }) => {
        live.ptyExited = true;
        clearTimeout(live.startupTimer);
        clearTimeout(live.probeTimer);
        live.service.exitCode = exitCode;
        live.service.previewUrl = undefined;
        if (!live.cancelled) {
          // npm's parent may exit before descendants. They must not outlive the service.
          this.signalGroup(live, 'SIGKILL');
          live.exited = true;
          live.service.status = exitCode === 0 ? 'stopped' : 'failed';
          if (exitCode !== 0) live.service.error = [live.service.preparationHint, live.outputTail.trim() || `Command exited with code ${exitCode}`].filter(Boolean).join('\n');
        }
        if (this.runtimes.get(id) === live) this.publish();
      });
      live.startupTimer = setTimeout(() => {
        if (!live.exited && !live.cancelled) { live.service.status = 'running'; this.publish(); }
      }, 750);
      this.publish();
      return { success: true, service: { ...live.service } };
    } catch (error) {
      if (runtime) {
        runtime.exited = true;
        runtime.service.status = runtime.cancelled ? 'stopped' : 'failed';
        runtime.service.error = message(error);
        if (this.runtimes.get(runtime.service.id) === runtime) this.publish();
      }
      return { success: false, error: message(error) };
    }
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
  private signalGroup(runtime: Runtime, signal: NodeJS.Signals) {
    if (process.platform !== 'win32' && runtime.process) {
      try { (this.deps.signalGroup ?? ((pid, sig) => process.kill(-pid, sig)))(runtime.process.pid, signal); } catch { /* Already exited. */ }
    }
  }

  async stop(workspaceId: string, serviceId: string): Promise<WorkspaceServiceResult> {
    const runtime = this.runtimes.get(serviceId);
    if (!runtime || runtime.service.workspaceId !== workspaceId) return { success: false, error: 'Service is not owned by this workspace' };
    try {
      await this.stopRuntime(runtime);
      return { success: true, service: { ...runtime.service } };
    } catch (error) { return { success: false, error: message(error) }; }
  }
  private stopRuntime(runtime: Runtime): Promise<void> {
    if (runtime.stop) return runtime.stop;
    if (runtime.exited) return Promise.resolve();
    runtime.cancelled = true;
    clearTimeout(runtime.startupTimer);
    clearTimeout(runtime.probeTimer);
    runtime.service.previewUrl = undefined;
    if (!runtime.process) {
      runtime.exited = true; runtime.service.status = 'stopped'; this.publish();
      return Promise.resolve();
    }
    const child = runtime.process;
    runtime.service.status = 'stopping'; runtime.service.error = undefined; this.publish();
    const signal = (value: NodeJS.Signals) => {
      this.signalGroup(runtime, value);
      if (!runtime.ptyExited) { try { child.kill(value); } catch { /* onExit decides liveness */ } }
    };
    signal('SIGTERM');
    runtime.stop = new Promise<void>((resolve, reject) => {
      // Kill the original POSIX process group even if the PTY parent exited first: npm can leave descendants.
      setTimeout(() => {
        signal('SIGKILL');
        setTimeout(() => {
          if (runtime.ptyExited) {
            runtime.exited = true; runtime.service.status = 'stopped'; this.publish(); resolve();
          }
          else { runtime.service.error = 'Dev server did not exit; try Stop again'; runtime.stop = undefined; this.publish(); reject(new Error(runtime.service.error)); }
        }, 250);
      }, 750);
    });
    return runtime.stop;
  }
  async closeWorkspace(workspaceId: string): Promise<void> {
    const owned = [...this.runtimes.values()].filter(({ service }) => service.workspaceId === workspaceId);
    await Promise.all(owned.map((runtime) => this.stopRuntime(runtime)));
    for (const runtime of owned) this.runtimes.delete(runtime.service.id);
    this.publish();
  }
  async reset(): Promise<void> {
    await Promise.all([...new Set([...this.runtimes.values()].map(({ service }) => service.workspaceId))].map((id) => this.closeWorkspace(id)));
  }
  async shutdown(): Promise<void> { this.closed = true; await this.reset(); }
}
