import { disposeAttentionSafely } from '../harnesses/localAttention';
import type { HarnessProfilesCapability, PreparedLocalAttention } from '../harnesses/types';
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
import { RecipeCommandStartup } from '../recipeCommandStartup';
import { toNativePath } from '../../shared/pathNormalize';
import { pathKey } from '../../shared/pathKey';
import { isInsideRoot } from '../localPathContainment';
import { releaseCheckoutContext } from '../checkoutContextRelease';
import { isPathContained } from '../remote/sshEnvironment';
import { createRemoteAttentionFilter } from '../remote/remoteAttentionTransport';
import type { AgentAttentionBroker } from '../agentAttentionBroker';
import {
  ensureAttentionAdapterFiles,
  prepareLocalAttention,
  withoutAttentionEnvironment,
} from '../agentAttentionAdapters';

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
  releaseResources?: () => Promise<void>;
  /**
   * between PTY spawn and renderer confirming xterm is ready.
   * Cleared after flush on TERMINAL_READY.
   * Max 16 KB to prevent unbounded growth if renderer never signals ready.
   */
  startupBuffer: string[];
  startupBufferReady: boolean;
  initialCommand?: string;
  recipeCommandStartup?: RecipeCommandStartup;
}

export type { Terminal };

interface RegisterTerminalIpcDeps {
  getTerminals: () => Map<string, Terminal>;
  getMainWindow: () => BrowserWindow | null;
  getStore: () => Store<StoreSchema>;
  getSafeWorkspacePath: (workingDir: string) => string;
  getOpenWorkspacePath?: (workspaceId: string) => string | null;
  getWorkspaceRegistry?: () => WorkspaceRegistry;
  getHarnessOptions: () => Record<string, { name: string; command: string; args: string[]; icon: string; env?: Record<string, string> }>;
  ensureHarnessWrapperScript?: () => string | null;
  getAppShuttingDown?: () => boolean;
  agentAttentionBroker?: AgentAttentionBroker;
  createRemoteOutputObserver?: (workspaceId: string) => (data: string) => void;
  /** Optional: without it (or without managed accounts) every launch uses the native account. */
  getHarnessAccountService?: () => HarnessAccountService | undefined;
  onTerminalReleased?: (id: string) => void;
  /** Test seam (mirrors LocalLaunchOverrides): plan harness spawns for another platform/host. */
  harnessSpawnOverrides?: Partial<HarnessPtySpawnOptions>;
}

type TrustedProfileLaunch = ReturnType<HarnessProfilesCapability['buildLaunch']>;
export interface TerminalIpcController {
  /** Main-only: renderer IPC cannot supply commands, environment or profile paths. */
  spawnAssistant(workspaceId: string, harnessId: string, launch: TrustedProfileLaunch): Promise<{ id: string; pid: number; harnessId?: string | null; attentionEnabled: boolean; checkoutContextId?: string }>;
  killTerminal(id: string): { success: true } | { success: false; error: string };
}

let appShuttingDown = false;

export function setAppShuttingDown(shuttingDown: boolean): void {
  appShuttingDown = shuttingDown;
}

export function getAppShuttingDown(): boolean {
  return appShuttingDown;
}

export function registerTerminalIpc(deps: RegisterTerminalIpcDeps): TerminalIpcController {
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
    checkoutContextId?: string,
    profileLaunch?: TrustedProfileLaunch
  ) => {
    const terminals = getTerminals();
    const mainWindow = getMainWindow();
    const store = getStore();
    const registry = deps.getWorkspaceRegistry?.();

    let resolvedWorkspace = workspaceId ? registry?.getWorkspace(workspaceId) : null;
    if (workspaceId && registry && !resolvedWorkspace) {
      throw new Error('Workspace is not registered or not accessible');
    }
    if (!resolvedWorkspace && workingDir && !environmentId) {
      resolvedWorkspace = registry?.getWorkspaceByLocation('local', workingDir) ?? null;
    }
    if (environmentId && resolvedWorkspace && environmentId !== resolvedWorkspace.location.environmentId) {
      throw new Error('Workspace environment does not match registered workspace');
    }
    if (checkoutContextId !== undefined && !isNonEmptyString(checkoutContextId)) {
      throw new Error('Invalid checkout context');
    }
    // The terminal root is the checkout context's validated root, not the workspace path:
    // no requested id means the workspace's main checkout, and a context registered under another
    // workspace never resolves. Launches outside any registered workspace stay unbound (legacy).
    const checkoutContext = resolvedWorkspace && registry
      ? registry.resolveCheckoutContext(resolvedWorkspace.workspaceId, checkoutContextId)
      : null;
    if ((resolvedWorkspace || checkoutContextId) && !checkoutContext) {
      throw new Error('Checkout context is not registered for this workspace');
    }
    // Launch resolution can await (SSH resolution, attention registration). Whatever was resolved
    // must still be the exact registered workspace and context when the process is about to exist;
    // a launch that resolved neither (legacy unbound, path only) has nothing to revalidate.
    const isResolvedTargetCurrent = (): boolean => {
      if (!resolvedWorkspace) return true;
      if (registry?.getWorkspace(resolvedWorkspace.workspaceId) !== resolvedWorkspace) return false;
      return !checkoutContext || registry.getCheckoutContext(checkoutContext.id) === checkoutContext;
    };
    const effectiveEnvironmentId = resolvedWorkspace?.location.environmentId || environmentId || 'local';
    const isRemote = effectiveEnvironmentId !== 'local';
    if (profileLaunch && (isRemote || !resolvedWorkspace || !findHarnessProvider(harness)?.profiles)) throw new Error('Profile launch requires a registered local workspace and provider capability');
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

      const attentionRequested = Boolean(harness && store.get('harnessDefaults')[harness]?.attentionEnabled
        && resolvedWorkspace.environment.capabilities.agentAttention && agentAttentionBroker);
      const attentionToken = attentionRequested && harness ? agentAttentionBroker!.registerRemote(id, harness) : undefined;
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
          attentionEnabled: resolved.attentionEnabled === true,
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

    // Assistants are main-checkout launches: the profile launch never targets a non-main context,
    // whatever the renderer has selected. The authoritative path is that main context's path.
    if (profileLaunch && (checkoutContextId !== undefined || !checkoutContext || checkoutContext.kind !== 'main')) {
      throw new Error('Assistant launch requires the workspace main checkout context');
    }
    const profileRegisteredPath = profileLaunch ? toNativePath(checkoutContext!.path, process.platform) : undefined;
    // Profile launches fail closed instead of silently falling back to home/last workspace.
    const cwd = profileLaunch
      ? fs.realpathSync(profileRegisteredPath!)
      : getSafeWorkspacePath(toNativePath(workingDir, process.platform));
    // The registered path may legitimately reach the directory through symlinks/junctions, so it need not
    // be textually canonical; `cwd` is its canonical target and its dev/ino identity is pinned here.
    const profileCwdIdentity = profileLaunch ? fs.statSync(cwd, { bigint: true }) : undefined;
    if (profileLaunch && !profileCwdIdentity!.isDirectory()) throw new Error('Registered assistant directory changed');
    // A resolved context, requested or implicitly the workspace's main one, is the execution
    // boundary. getSafeWorkspacePath falls back to a default directory for unusable input, so
    // check the directory actually used. Only a launch that resolves no context stays unbound.
    if (!profileLaunch && checkoutContext && !isInsideRoot(toNativePath(checkoutContext.path, process.platform), cwd)) {
      throw new Error('Terminal directory is outside the registered workspace');
    }
    // Final check, run synchronously before PTY creation (after every await): the registered path must
    // still canonicalize to the same target and name the directory that was validated above.
    const assertProfileDirectoryUnchanged = () => {
      if (!profileLaunch) return;
      let current: string;
      let identity: fs.BigIntStats;
      try {
        current = fs.realpathSync(profileRegisteredPath!);
        identity = fs.statSync(current, { bigint: true });
      } catch { throw new Error('Registered assistant directory changed'); }
      if (pathKey(current, process.platform === 'win32') !== pathKey(cwd, process.platform === 'win32')
        || !identity.isDirectory() || identity.dev !== profileCwdIdentity!.dev || identity.ino !== profileCwdIdentity!.ino) {
        throw new Error('Registered assistant directory changed');
      }
    };
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
    const baseHarnessEnv = profileLaunch?.env ?? ((harness && getHarnessOptions()[harness]?.env) || {});
    const harnessEnv = accountBinding ? accountBinding.mergeEnvironment(baseHarnessEnv) : baseHarnessEnv;
    const harnessDefaults = store.get('harnessDefaults');
    const attentionEnabled = Boolean(harnessConfig && harness && findHarnessProvider(harness)?.attention?.local && harnessDefaults[harness]?.attentionEnabled);
    // Native profiles own model/provider/approval settings, not harness-global defaults.
    const userFlags = profileLaunch ? undefined : harness ? harnessDefaults[harness]?.flags : undefined;
    const effectiveModel = profileLaunch ? undefined : model || (harness ? harnessDefaults[harness]?.model || undefined : undefined);
    let harnessArgs = profileLaunch ? [...profileLaunch.args] : harnessConfig
      ? buildHarnessSpawnArgs(harnessConfig, effectiveModel, userFlags, findHarnessProvider(harness)?.launch.modelArgs)
      : [];
    let attentionEnv: Record<string, string> = {};
    let attentionCommand: string | undefined;
    let preparedAttention: PreparedLocalAttention | null = null;
    if (harnessConfig && harness && agentAttentionBroker) {
      try {
        const files = ensureAttentionAdapterFiles();
        if (attentionEnabled) {
          preparedAttention = prepareLocalAttention(harness, {
            terminalId: id, args: harnessArgs, env: { ...process.env, ...harnessEnv }, files,
            platform: process.platform,
          }) ?? null;
        }
        attentionEnv = await agentAttentionBroker.register(id, harness);
        attentionCommand = files.command;
        if (preparedAttention) {
          attentionEnv = { ...attentionEnv, ...preparedAttention.env };
          harnessArgs = preparedAttention.args;
        }
      } catch {
        disposeAttentionSafely(preparedAttention);
        agentAttentionBroker.release(id);
      }
    }
    try {
      const wrapperPath = harnessConfig ? ensureHarnessWrapperScriptPath() : null;
      if (appShuttingDown || deps.getAppShuttingDown?.() || (profileLaunch && registry?.getWorkspace(resolvedWorkspace!.workspaceId) !== resolvedWorkspace)) throw new Error('Assistant workspace was closed or application is shutting down');
      // PATH is case-insensitive on Windows: keep one spelling so the resolved executable is the one
      // the child will see.
      const inheritedEnv = withoutAttentionEnvironment(process.env);
      if (process.platform === 'win32') {
        for (const key of Object.keys(inheritedEnv)) if (key.toLowerCase() === 'path') delete inheritedEnv[key];
      }
      const env: { [key: string]: string } = {
        ...inheritedEnv,
        PATH: prependUserCliBinsToPath(process.env.PATH ?? ''),
        ...withoutAttentionEnvironment(harnessEnv),
        ...attentionEnv,
        // Hermes' TUI starts a backend child process; bridge its documented
        // process-level bypass explicitly instead of relying on CLI propagation.
        ...(findHarnessProvider(harness)?.launch.localEnvironment?.(userFlags) ?? {}),
        ...(attentionCommand ? { CLANKER_ATTENTION_COMMAND: attentionCommand } : {}),
        ...(harnessConfig ? { CLANKER_GRID_FALLBACK_SHELL: userShell } : {}),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: 'clanker-grid',
        FORCE_COLOR: '1',
      };
      if (profileLaunch) {
        for (const key of profileLaunch.unsetEnvironmentKeys) {
          for (const inherited of Object.keys(env)) {
            if (process.platform === 'win32' ? inherited.toLowerCase() === key.toLowerCase() : inherited === key) delete env[inherited];
          }
        }
        Object.assign(env, profileLaunch.env);
      }

      // Resolved from the final child environment so Windows PATH/PATHEXT resolution and shim
      // escaping (or fail-closed rejection) apply to exactly what will be spawned.
      const harnessCmd = harnessConfig
        ? resolveHarnessPtySpawn(profileLaunch?.command ?? harnessConfig.command, harnessArgs, wrapperPath, { env, ...deps.harnessSpawnOverrides })
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
      // the attention resources. Both object-identity and filesystem-identity checks are
      // synchronous and immediately precede PTY creation.
      if (!isResolvedTargetCurrent()) {
        throw new Error('Workspace was closed or is being removed');
      }
      assertProfileDirectoryUnchanged();

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
      workspaceId: resolvedWorkspace?.workspaceId,
      environmentId: effectiveEnvironmentId,
      initialCommand: recipeCommandStartup && cleanInitialCommand
        ? recipeCommandStartup.wrap(cleanInitialCommand, process.platform, userShell) : cleanInitialCommand,
      recipeCommandStartup,
      checkoutContextId: checkoutContext?.id,
      onExit: () => {
        deps.onTerminalReleased?.(id);
        disposeAttentionSafely(preparedAttention);
        agentAttentionBroker?.release(id);
      },
      });
      return {
        ...result,
        harnessId: harnessConfig ? harness : undefined,
        attentionEnabled,
        checkoutContextId: checkoutContext?.id,
      };
    } catch (error) {
      disposeAttentionSafely(preparedAttention);
      agentAttentionBroker?.release(id);
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

    if (terminal.initialCommand) {
      terminal.pty.write(`${terminal.initialCommand}\r`);
      terminal.initialCommand = undefined;
      terminal.recipeCommandStartup?.onReady();
    }
    return ok();
  });

  ipcMain.handle(RECIPE_COMMAND_WAIT, async (_, id: string) => {
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
        terminal.pty.resume();
      } catch {
        // PTY may have exited; ignore.
      }

      return ok();
    }
    return ok(); // no-op for missing terminal
  });

  const killTerminal = (id: string) => {
    const terminals = getTerminals();
    if (!isNonEmptyString(id)) {
      return fail('Invalid terminal id');
    }
    const terminal = terminals.get(id);
    if (terminal) {
      deps.onTerminalReleased?.(id);
      agentAttentionBroker?.release(id);
      void terminal.releaseResources?.();
      try {
        terminal.pty.kill();
      } catch {
        // On Windows, node-pty may warn about SIGTERM before falling back
        // to TerminateProcess. Suppress the noise — the process is gone.
      }
      terminals.delete(id);
      return ok();
    }
    return ok(); // no-op for missing terminal
  };
  ipcMain.handle(KILL_TERMINAL, (_, id: string) => killTerminal(id));

  ipcMain.handle(TERMINAL_CLEANUP_WORKSPACE, (_, ids: string[]) => {
    const terminals = getTerminals();
    let killed = 0;
    for (const id of ids) {
      const terminal = terminals.get(id);
      if (terminal) {
        deps.onTerminalReleased?.(id);
        agentAttentionBroker?.release(id);
        void terminal.releaseResources?.();
        try {
          terminal.pty.kill();
        } catch {
          // On Windows, node-pty may warn about SIGTERM — suppress.
        }
        terminals.delete(id);
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
    return releaseCheckoutContext({ registry, terminals: getTerminals().values(), workspaceId, checkoutContextId });
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
  return {
    spawnAssistant: (workspaceId, harnessId, launch) => {
      const workspace = deps.getWorkspaceRegistry?.().getWorkspace(workspaceId);
      if (!workspace || workspace.location.environmentId !== 'local') return Promise.reject(new Error('Assistant workspace is not registered locally'));
      return spawnTerminal(workspace.location.path, harnessId, undefined, undefined, undefined, workspaceId, workspace.location.environmentId, undefined, launch);
    },
    killTerminal,
  };
}
