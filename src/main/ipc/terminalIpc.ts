import type { NativeAttentionCapability } from '../../shared/types/attentionSignal';
import { remoteAttentionCapability } from '../attentionCapability';
import { prepareLaunchAttachments, type LaunchAttachmentStep, type PreparedLaunchAttachments } from '../launchAttachments';
import { attentionLaunchStep, localAttentionCapability, NATIVE_ATTENTION_ATTACHED } from '../attentionLaunchStep';
import { retireTerminal } from '../terminalRetirement';
import { grantsCheckoutRehoming } from '../isolatedCheckout/rehomeSupport';
import { agentBridgeLaunchStep, withoutAgentBridgeEnvironment, type AgentBridgeService } from '../agentBridge/service';
import { findHarnessProvider } from '../harnesses/registry';
import { prepareHarnessAccountContext, type HarnessAccountService } from '../accounts/harnessAccountService';
/**
 * Terminal IPC Handlers
 *
 * Registers all terminal-related IPC handlers. Extracted from main.ts per S2.1.
 */

import { ipcMain, BrowserWindow, clipboard } from 'electron';
import type * as pty from 'node-pty';
import Store from 'electron-store';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type StoreSchema } from '../../shared/types/store';
import { buildHarnessSpawnArgs, ensureHarnessWrapperScript, resolveHarnessPtySpawn, type HarnessPtySpawnOptions } from '../harnessLaunch';
import { defaultShell, prependUserCliBinsToPath } from '../platformShell';
import type { WorkspaceRegistry } from '../workspaceRegistry';
import {
  SPAWN_TERMINAL,
  GET_TERMINAL_BUFFER,
  WRITE_TERMINAL,
  GET_AGENT_HANDOFF_STATUSES,
  GET_AGENT_ATTENTION_SNAPSHOTS,
  GET_AGENT_ATTENTION_DIAGNOSTICS,
  SEND_ANNOTATION_TO_AGENT,
  RESIZE_TERMINAL,
  KILL_TERMINAL,
  TERMINAL_CLEANUP_WORKSPACE,
  TERMINAL_DATA,
  TERMINAL_EXIT,
  TERMINAL_RESIZED,
  TERMINAL_READY,
  RECIPE_COMMAND_WAIT,
  WRITE_CLIPBOARD,
  RELEASE_CHECKOUT_CONTEXT,
} from '../../shared/ipcChannels';
import { spawnPtyProcess } from './ptySpawn';
import { resolveTerminalLaunchTarget } from './terminalLaunchTarget';
import { WORKSPACE_RECIPES_ENABLED, RECIPES_DISABLED_MESSAGE } from '../../shared/recipeAvailability';
import { RecipeCommandStartup } from '../recipeCommandStartup';
import { toNativePath } from '../../shared/pathNormalize';
import { isInsideRoot } from '../localPathContainment';
import { releaseCheckoutContext, type TerminalUsage } from '../checkoutContextRelease';
import { isPathContained } from '../remote/sshEnvironment';
import { createRemoteAttentionFilter } from '../remote/remoteAttentionTransport';
import type { AgentAttentionBroker } from '../agentAttentionBroker';
import { attentionSourceOptions } from '../agentAttentionAdapters';
import { withoutAttentionEnvironment } from '../environment/attentionEnvironment';

interface Terminal {
  id: string;
  pid: number;
  pty: pty.IPty;
  cwd?: string;
  remoteWorkingDir?: string;
  workspaceId?: string;
  /** Execution root this terminal was launched against (see WorkspaceRegistry checkout contexts). */
  checkoutContextId?: string;
  environmentId?: string;
  harnessId?: string;
  attention?: NativeAttentionCapability;
  releaseResources?: () => Promise<void>;
  /** Settles when the PTY process has REALLY exited (node-pty `onExit`); never because the record was removed. */
  exited?: Promise<void>;
  /**
   * between PTY spawn and renderer confirming xterm is ready.
   * Cleared after flush on TERMINAL_READY.
   * Max 16 KB to prevent unbounded growth if renderer never signals ready.
   */
  startupBuffer: string[];
  startupBufferReady: boolean;
  /** Socket reads paused at the startup bound, never XON/XOFF flow control. */
  startupPaused?: boolean;
  initialCommand?: string;
  recipeCommandStartup?: RecipeCommandStartup;
}

export type { Terminal };

interface RegisterTerminalIpcDeps {
  getTerminals: () => Map<string, Terminal>;
  getAdditionalCheckoutUsages?: () => TerminalUsage[];
  getMainWindow: () => BrowserWindow | null;
  getStore: () => Store<StoreSchema>;
  getSafeWorkspacePath: (workingDir: string) => string;
  getOpenWorkspacePath?: (workspaceId: string) => string | null;
  getWorkspaceRegistry?: () => WorkspaceRegistry;
  getHarnessOptions: () => Record<string, { name: string; command: string; args: string[]; icon: string; env?: Record<string, string> }>;
  ensureHarnessWrapperScript?: () => string | null;
  getAppShuttingDown?: () => boolean;
  agentAttentionBroker?: AgentAttentionBroker;
  /** Optional: without it no launch attaches the Clanker MCP bridge. */
  agentBridge?: AgentBridgeService;
  createRemoteOutputObserver?: (workspaceId: string) => (data: string) => void;
  /** Optional: without it (or without managed accounts) every launch uses the native account. */
  getHarnessAccountService?: () => HarnessAccountService | undefined;
  /** Test seam (mirrors LocalLaunchOverrides): plan harness spawns for another platform/host. */
  harnessSpawnOverrides?: Partial<HarnessPtySpawnOptions>;
}

let appShuttingDown = false;

export function setAppShuttingDown(shuttingDown: boolean): void {
  appShuttingDown = shuttingDown;
}

export function getAppShuttingDown(): boolean {
  return appShuttingDown;
}

export function registerTerminalIpc(deps: RegisterTerminalIpcDeps): void {
  const {
    getTerminals,
    getMainWindow,
    getStore,
    getSafeWorkspacePath,
    getHarnessOptions,
    ensureHarnessWrapperScript: ensureHarnessWrapperScriptPath = ensureHarnessWrapperScript,
    agentAttentionBroker,
  } = deps;

  const ok = () => ({ success: true as const });
  const fail = (error: string) => ({ success: false as const, error });

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;
  const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;
  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

  const spawnTerminal = async (
    workingDir: string,
    harness?: string,
    model?: string,
    initialCommand?: string,
    recipeCommand?: boolean,
    workspaceId?: string,
    environmentId?: string,
    checkoutContextId?: string
  ) => {
    if (recipeCommand === true && !WORKSPACE_RECIPES_ENABLED) throw new Error(RECIPES_DISABLED_MESSAGE);
    const terminals = getTerminals();
    const mainWindow = getMainWindow();
    const store = getStore();
    const registry = deps.getWorkspaceRegistry?.();

    const { resolvedWorkspace, checkoutContext, isResolvedTargetCurrent } = resolveTerminalLaunchTarget(
      registry, workingDir, workspaceId, environmentId, checkoutContextId,
    );
    const effectiveEnvironmentId = resolvedWorkspace?.location.environmentId || environmentId || 'local';
    const isRemote = effectiveEnvironmentId !== 'local';
    const id = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (isRemote) {
      if (!resolvedWorkspace || !checkoutContext || resolvedWorkspace.location.environmentId === 'local') {
        throw new Error('Remote workspace is not registered or not accessible');
      }

      // Containment is against this context's own root, so a worktree context neither inherits
      // nor extends the workspace root's reach.
      const root = checkoutContext.path;
      if (typeof workingDir !== 'string' || !isPathContained(root, workingDir)) {
        throw new Error('Terminal directory is outside the registered workspace');
      }
      let remoteWorkingDir = root;
      if (workingDir !== root) {
        const validation = await resolvedWorkspace.environment.validateWorkspacePath(workingDir);
        if (!validation.valid || !validation.resolvedPath ||
            !isPathContained(root, validation.resolvedPath)) {
          throw new Error('Terminal directory is outside the registered workspace');
        }
        remoteWorkingDir = validation.resolvedPath;
      }

      const attentionRequested = Boolean(harness && store.get('harnessDefaults')[harness]?.attentionEnabled);
      const attentionAvailable = Boolean(resolvedWorkspace.environment.capabilities?.agentAttention && agentAttentionBroker);
      const registrationToken = harness && agentAttentionBroker ? agentAttentionBroker.registerRemote(id, harness, {
        ...attentionSourceOptions(harness), capability: remoteAttentionCapability(harness, attentionRequested, attentionAvailable),
      }) : undefined;
      const attentionToken = attentionRequested && attentionAvailable ? registrationToken : undefined;
      let releaseAttention: (() => Promise<void>) | undefined;
      try {
        const resolved = await resolvedWorkspace.environment.resolveTerminalSpawn({
          id,
          workingDir: remoteWorkingDir,
          harness,
          model,
          flags: harness ? store.get('harnessDefaults')[harness]?.flags : undefined,
          initialCommand,
          recipeCommand,
          attentionToken,
        });
        releaseAttention = resolved.releaseAttention;
        const attention = remoteAttentionCapability(harness ?? '', attentionRequested, attentionAvailable, resolved);
        agentAttentionBroker?.setCapability?.(id, attention);

        if (appShuttingDown || deps.getAppShuttingDown?.() || !isResolvedTargetCurrent() ||
            registry?.isRemotePathReserved?.(effectiveEnvironmentId, remoteWorkingDir)) {
          throw new Error('Remote workspace was closed or is being removed');
        }

        const result = spawnPtyProcess({
          id,
          spawnCmd: resolved.spawnCmd,
          spawnArgs: resolved.spawnArgs,
          cwd: process.cwd(),
          env: resolved.env,
          terminals,
          mainWindow,
          getIsShuttingDown: () => appShuttingDown,
          launchLabel: resolved.launchLabel,
          harnessId: resolved.harnessId,
          attention,
          initialCommand: effectiveEnvironmentId === 'local' ? resolved.initialCommand : undefined,
          workspaceId: resolvedWorkspace.workspaceId,
          checkoutContextId: checkoutContext.id,
          environmentId: effectiveEnvironmentId,
          remoteWorkingDir,
          onOutput: deps.createRemoteOutputObserver?.(resolvedWorkspace.workspaceId),
          filterData: resolved.attentionEnabled && agentAttentionBroker
            ? createRemoteAttentionFilter((raw) => agentAttentionBroker.receiveRemote(id, raw)) : undefined,
          onExit: async () => {
            agentAttentionBroker?.release(id);
            await releaseAttention?.();
          },
        });

        return {
          id: result.id,
          pid: result.pid,
          attention,
          attentionEnabled: attention.attachment === 'prepared',
          harnessId: resolved.harnessId ?? harness ?? null,
          checkoutContextId: checkoutContext.id,
        };
      } catch (error) {
        agentAttentionBroker?.release(id);
        await releaseAttention?.().catch(() => undefined);
        console.error('[clanker-grid] failed to spawn remote terminal via SSH:', error);
        throw error;
      }
    }

    const cwd = getSafeWorkspacePath(toNativePath(workingDir, process.platform));
    // A resolved context, requested or implicitly the workspace's main one, is the execution
    // boundary. getSafeWorkspacePath falls back to a default directory for unusable input, so
    // check the directory actually used. Only a launch that resolves no context stays unbound.
    if (checkoutContext && !isInsideRoot(toNativePath(checkoutContext.path, process.platform), cwd)) {
      throw new Error('Terminal directory is outside the registered workspace');
    }
    // Use user's default shell, fallback to bash
    const userShell = defaultShell();

    // Spawn with interactive flags for better shell experience.
    // PowerShell is interactive by default (no flag needed); bash needs -i.
    const shellArgs = process.platform === 'win32' ? [] : ['-i'];

    const harnessConfig = harness ? getHarnessOptions()[harness] : undefined;
    // The one account seam: the manually selected account contributes its provider-owned variables
    // (nothing at all for the default account). Resolved before any resource is registered so a
    // disconnected account fails the launch cleanly instead of falling back to another account.
    const accountBinding = harness && harnessConfig
      ? prepareHarnessAccountContext(deps.getHarnessAccountService?.(), { environmentId: effectiveEnvironmentId, harness })
      : undefined;
    const baseHarnessEnv = (harness && getHarnessOptions()[harness]?.env) || {};
    const harnessEnv = accountBinding ? accountBinding.mergeEnvironment(baseHarnessEnv) : baseHarnessEnv;
    const harnessDefaults = store.get('harnessDefaults');
    const attentionEnabled = Boolean(harness && harnessDefaults[harness]?.attentionEnabled);
    const userFlags = harness ? harnessDefaults[harness]?.flags : undefined;
    const effectiveModel = model || (harness ? harnessDefaults[harness]?.model || undefined : undefined);
    let harnessArgs = harnessConfig
      ? buildHarnessSpawnArgs(harnessConfig, effectiveModel, userFlags, findHarnessProvider(harness)?.launch.modelArgs)
      : [];
    // Everything a launch acquires (attention, the agent bridge) goes through one coordinator: it
    // composes argv/env deterministically and gives every resource back on a failed launch or exit.
    const steps: LaunchAttachmentStep[] = [];
    if (harnessConfig && harness && agentAttentionBroker) {
      steps.push(attentionLaunchStep({ broker: agentAttentionBroker, harness, terminalId: id, enabled: attentionEnabled }));
    }
    // Local, registered launches only: the credential is bound to main's own record of this launch.
    if (harnessConfig && harness && deps.agentBridge && harnessDefaults[harness]?.agentBridgeEnabled === true
      && resolvedWorkspace && checkoutContext && !isRemote) {
      steps.push(agentBridgeLaunchStep({
        service: deps.agentBridge, harness,
        grants: ({ state, bridgeAvailable }) => ({ checkoutRehoming: grantsCheckoutRehoming(harness, { nativeAttentionAttached: state.provided.has(NATIVE_ATTENTION_ATTACHED), bridgeAvailable }) }),
        identity: {
          terminalId: id, workspaceId: resolvedWorkspace.workspaceId, environmentId: effectiveEnvironmentId,
          checkoutContextId: checkoutContext.id, harnessId: harness,
        },
      }));
    }
    const attachments: PreparedLaunchAttachments = await prepareLaunchAttachments(
      { args: harnessArgs, env: { ...process.env, ...harnessEnv } }, steps);
    harnessArgs = attachments.args;
    // The terminal's cleanup keeps only the disposer: `attachments.env` holds the launch credentials and
    // must not outlive spawning.
    const disposeAttachments = attachments.dispose;
    try {
      const wrapperPath = harnessConfig ? ensureHarnessWrapperScriptPath() : null;
      // PATH is case-insensitive on Windows: keep one spelling so the resolved executable is the one
      // the child will see.
      const inheritedEnv = withoutAgentBridgeEnvironment(withoutAttentionEnvironment(process.env));
      if (process.platform === 'win32') {
        for (const key of Object.keys(inheritedEnv)) if (key.toLowerCase() === 'path') delete inheritedEnv[key];
      }
      const env: { [key: string]: string } = {
        ...inheritedEnv,
        PATH: prependUserCliBinsToPath(process.env.PATH ?? ''),
        ...withoutAgentBridgeEnvironment(withoutAttentionEnvironment(harnessEnv)),
        ...attachments.env,
        // Hermes' TUI starts a backend child process; bridge its documented
        // process-level bypass explicitly instead of relying on CLI propagation.
        ...(findHarnessProvider(harness)?.launch.localEnvironment?.(userFlags) ?? {}),
        ...(harnessConfig ? { CLANKER_GRID_FALLBACK_SHELL: userShell } : {}),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: 'clanker-grid',
        FORCE_COLOR: '1',
      };
      // Resolved from the final child environment so Windows PATH/PATHEXT resolution and shim
      // escaping (or fail-closed rejection) apply to exactly what will be spawned.
      const harnessCmd = harnessConfig
        ? resolveHarnessPtySpawn(harnessConfig.command, harnessArgs, wrapperPath, { env, ...deps.harnessSpawnOverrides })
        : { spawnCmd: userShell, spawnArgs: shellArgs };

      let launchLabel: string | undefined;
      const cleanInitialCommand = (!harness && typeof initialCommand === 'string' && initialCommand.trim())
        ? initialCommand.trim().replace(/[\r\n]+/g, ' ')
        : undefined;
      const recipeCommandStartup = cleanInitialCommand && recipeCommand === true
        ? new RecipeCommandStartup() : undefined;
      if (harness && getHarnessOptions()[harness]) {
        const config = getHarnessOptions()[harness];
        launchLabel = `[clanker-grid] ${config.command} ${harnessArgs.join(' ')}`;
      } else if (cleanInitialCommand) {
        launchLabel = `[clanker-grid] ${cleanInitialCommand}`;
      }

      // The attention registration above awaited: the workspace or context may have been
      // closed meanwhile. Fail closed before any process exists; the catch below releases
      // the attention resources.
      if (!isResolvedTargetCurrent()) {
        throw new Error('Workspace was closed or is being removed');
      }

      const result = spawnPtyProcess({
      id,
      spawnCmd: harnessCmd.spawnCmd,
      spawnArgs: harnessCmd.spawnArgs,
      cwd,
      env,
      terminals,
      mainWindow,
      getIsShuttingDown: () => appShuttingDown,
      launchLabel,
      harnessId: harnessConfig ? harness : undefined,
      attention: localAttentionCapability(harness ?? '', attentionEnabled, attachments),
      initialCommand: recipeCommandStartup && cleanInitialCommand
        ? recipeCommandStartup.wrap(cleanInitialCommand, process.platform, userShell) : cleanInitialCommand,
      recipeCommandStartup,
      // Recorded like the SSH path does: the resolved workspace is what an agent's reported
      // location is resolved against (see agentLocation.ts).
      workspaceId: resolvedWorkspace?.workspaceId,
      checkoutContextId: checkoutContext?.id,
      onExit: disposeAttachments,
      });
      return {
        ...result,
        harnessId: harnessConfig ? harness : undefined,
        attention: localAttentionCapability(harness ?? '', attentionEnabled, attachments),
        attentionEnabled: attachments.provided.has(NATIVE_ATTENTION_ATTACHED),
        checkoutContextId: checkoutContext?.id,
      };
    } catch (error) {
      await attachments.dispose();
      throw error;
    }
  };
  // Explicit positional bridge: extra renderer arguments cannot become a trusted descriptor.
  ipcMain.handle(SPAWN_TERMINAL, (_event, workingDir: string, harness?: string, model?: string, initialCommand?: string, recipeCommand?: boolean, workspaceId?: string, environmentId?: string, checkoutContextId?: string) =>
    spawnTerminal(workingDir, harness, model, initialCommand, recipeCommand, workspaceId, environmentId, checkoutContextId));

  /**
   * @deprecated GET_TERMINAL_BUFFER is retained as a no-op returning ''.
   * Session continuity is now handled by xterm instance caching in the renderer.
   * The app-level buffer has been removed (Phase 1 terminal redesign).
   */
  ipcMain.handle(GET_TERMINAL_BUFFER, () => {
    return '';
  });

  /**
   * TERMINAL_READY — Renderer confirms xterm is ready to receive data.
   * Flushes the bounded startup buffer in order, then marks the terminal as ready.
   * This ensures early PTY output (including DA1 query responses) is not lost.
   */
  ipcMain.handle(TERMINAL_READY, (_, id: string) => {
    const terminals = getTerminals();
    const terminal = terminals.get(id);
    if (!terminal || terminal.startupBufferReady) {
      return ok();
    }

    const mainWindow = getMainWindow();
    if (mainWindow && terminal.startupBuffer.length > 0) {
      // Flush buffered data in order — this includes any DA1 response from xterm
      for (const chunk of terminal.startupBuffer) {
        mainWindow.webContents.send(TERMINAL_DATA, { id, data: chunk });
      }
    }

    // Clear buffer and mark as ready
    terminal.startupBuffer = [];
    terminal.startupBufferReady = true;
    if (terminal.startupPaused) {
      terminal.startupPaused = false;
      terminal.pty.resume();
    }

    if (terminal.initialCommand) {
      terminal.pty.write(`${terminal.initialCommand}\r`);
      terminal.initialCommand = undefined;
      terminal.recipeCommandStartup?.onReady();
    }
    return ok();
  });

  ipcMain.handle(RECIPE_COMMAND_WAIT, async (_, id: string) => {
    if (!WORKSPACE_RECIPES_ENABLED) throw new Error(RECIPES_DISABLED_MESSAGE);
    const terminal = getTerminals().get(id);
    if (!terminal?.recipeCommandStartup) {
      return { status: 'failed', error: 'Recipe command terminal is no longer available' };
    }
    return terminal.recipeCommandStartup.wait();
  });

  ipcMain.handle(WRITE_TERMINAL, (_, payload: unknown) => {
    if (!isRecord(payload) || !isNonEmptyString(payload.id) || typeof payload.data !== 'string') {
      return fail('Invalid payload');
    }
    const { id, data } = payload;
    const terminals = getTerminals();
    const terminal = terminals.get(id);
    if (terminal) {
      terminal.pty.write(data);
      return ok();
    }
    return ok(); // no-op for missing terminal
  });

  ipcMain.handle(GET_AGENT_HANDOFF_STATUSES, () => Object.fromEntries(
    [...getTerminals()].filter(([, terminal]) => terminal.harnessId).map(([id]) => [
      id, agentAttentionBroker?.handoffState(id) ?? 'unavailable',
    ]),
  ));

  // Hydration for a renderer that subscribed late or was recreated. Retired agents are absent.
  ipcMain.handle(GET_AGENT_ATTENTION_DIAGNOSTICS, (_event, terminalId: unknown) => {
    const enabled = process.env.CLANKER_DEBUG_ATTENTION === '1';
    if (terminalId === null) return enabled;
    if (!enabled || typeof terminalId !== 'string' || terminalId.length > 128) return null;
    const terminal = getTerminals().get(terminalId);
    return { main: agentAttentionBroker?.signalDiagnostics(terminalId) ?? null,
      terminal: terminal ? { harness: terminal.harnessId ?? null, workspaceId: terminal.workspaceId ?? null,
        environmentId: terminal.environmentId ?? 'local', attention: terminal.attention ?? null } : null };
  });

  ipcMain.handle(GET_AGENT_ATTENTION_SNAPSHOTS, () => agentAttentionBroker?.snapshots() ?? []);

  ipcMain.handle(SEND_ANNOTATION_TO_AGENT, (_, payload: unknown) => {
    if (!isRecord(payload)
      || !isNonEmptyString(payload.workspaceId)
      || !isNonEmptyString(payload.terminalId)
      || !isNonEmptyString(payload.message)
      || Buffer.byteLength(payload.message, 'utf8') > 32 * 1024) {
      return fail('Invalid annotation handoff');
    }
    const terminal = getTerminals().get(payload.terminalId);
    const registeredWs = deps.getWorkspaceRegistry?.()?.getWorkspace(payload.workspaceId);
    const closed = 'The destination workspace or terminal is closed. Copy the message instead.';
    if (!terminal) return fail(closed);
    if (terminal.workspaceId !== undefined && terminal.workspaceId !== payload.workspaceId) {
      return fail('The selected terminal belongs to a different workspace. Copy the message instead.');
    }

    if (registeredWs && registeredWs.location.environmentId !== 'local') {
      // The registered workspace is the authority. The PTY is the existing local ssh process, so
      // terminal.cwd (a desktop directory) is meaningless here; the remote directory recorded at
      // spawn is checked against the canonical remote root. No SSH round trip is made.
      const root = registeredWs.location.path;
      if (terminal.workspaceId !== registeredWs.workspaceId
        || !terminal.environmentId || terminal.environmentId !== registeredWs.location.environmentId
        || !terminal.remoteWorkingDir || !isPathContained(root, terminal.remoteWorkingDir)) {
        return fail('The selected terminal is not in that remote workspace. Copy the message instead.');
      }
    } else {
      const workspacePath = deps.getOpenWorkspacePath?.(payload.workspaceId);
      if (!workspacePath || !terminal.cwd) return fail(closed);
      if (terminal.environmentId && terminal.environmentId !== 'local') {
        return fail('The selected terminal is not in that workspace. Copy the message instead.');
      }
      let relative: string;
      try {
        relative = path.relative(fs.realpathSync(workspacePath), fs.realpathSync(terminal.cwd));
      } catch {
        return fail('The destination directory is unavailable. Copy the message instead.');
      }
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return fail('The selected terminal is outside that workspace. Copy the message instead.');
      }
    }
    if (!terminal.harnessId || !agentAttentionBroker?.canHandoff(payload.terminalId)) {
      return fail('The agent is no longer available for handoff. Copy the message instead.');
    }
    const message = payload.message.replace(/\r\n?/g, '\n');
    if (/[\x00-\x08\x0b-\x1f\x7f]/.test(message)) {
      return fail('The message contains terminal control characters. Edit or copy it instead.');
    }
    try {
      terminal.pty.write(`\x1b[200~${message}\x1b[201~\r`);
      agentAttentionBroker.markSubmitted(payload.terminalId);
      return ok();
    } catch {
      return fail('The terminal could not receive the message. Copy it instead.');
    }
  });

  ipcMain.handle(RESIZE_TERMINAL, (_, payload: unknown) => {
    if (
      !isRecord(payload)
      || !isNonEmptyString(payload.id)
      || !isFiniteNumber(payload.cols)
      || !isFiniteNumber(payload.rows)
    ) {
      return fail('Invalid payload');
    }
    const { id, cols, rows } = payload;
    const terminals = getTerminals();
    const terminal = terminals.get(id);
    if (terminal) {
      const safeCols = Math.max(1, Math.floor(cols));
      const safeRows = Math.max(1, Math.floor(rows));
      terminal.pty.resize(safeCols, safeRows);

      // Phase 1: resize confirmation — notify renderer of confirmed geometry.
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(TERMINAL_RESIZED, { id, cols: safeCols, rows: safeRows });
      }

      // Safety net: if handleFlowControl paused the PTY (e.g., via XOFF
      // interception from user pressing Ctrl+S), resume it on resize so the
      // terminal doesn't get stuck paused.
      try {
        if (!terminal.startupPaused) terminal.pty.resume();
      } catch {
        // PTY may have exited; ignore.
      }

      return ok();
    }
    return ok(); // no-op for missing terminal
  });

  ipcMain.handle(KILL_TERMINAL, (_, id: string) => {
    const terminals = getTerminals();
    if (!isNonEmptyString(id)) {
      return fail('Invalid terminal id');
    }
    // A missing terminal is a no-op.
    void retireTerminal({ terminals, releaseAttention: (terminalId) => agentAttentionBroker?.release(terminalId) }, id);
    return ok();
  });

  ipcMain.handle(TERMINAL_CLEANUP_WORKSPACE, (_, ids: string[]) => {
    const terminals = getTerminals();
    let killed = 0;
    for (const id of ids) {
      if (terminals.has(id)) {
        void retireTerminal({ terminals, releaseAttention: (terminalId) => agentAttentionBroker?.release(terminalId) }, id);
        killed++;
      }
    }
    return killed;
  });

  /**
   * Releases a worktree checkout context once no Clanker terminal uses it. Only ids cross IPC;
   * everything else is judged from main's registry and terminal table.
   */
  ipcMain.handle(RELEASE_CHECKOUT_CONTEXT, (_, workspaceId: unknown, checkoutContextId: unknown) => {
    const registry = deps.getWorkspaceRegistry?.();
    if (!registry) return fail('Workspace registry is unavailable');
    return releaseCheckoutContext({ registry, terminals: [...getTerminals().values(), ...(deps.getAdditionalCheckoutUsages?.() ?? [])], workspaceId, checkoutContextId });
  });

  ipcMain.handle(WRITE_CLIPBOARD, (_, text: unknown) => {
    if (typeof text !== 'string') {
      return fail('Invalid text');
    }
    clipboard.writeText(text);
    return ok();
  });

  // Event channels — registered so the integration test can verify completeness.
  // These are one-way: main sends events to renderer (no handler needed).
  ipcMain.on(TERMINAL_DATA, () => { });
  ipcMain.on(TERMINAL_EXIT, () => { });
  ipcMain.on(TERMINAL_RESIZED, () => { });

  // TERMINAL_READY is a handler (ipcMain.handle), not an event channel.
}
