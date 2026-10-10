import { findHarnessProvider } from '../harnesses/registry';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  WorkspaceEnvironment,
  EnvironmentCapabilities,
  EnvironmentHarnessOption,
  EnvironmentModelOption,
  TerminalSpawnRequest,
  TerminalSpawnResolved,
} from './workspaceEnvironment';
import { LOCAL_ENVIRONMENT_ID } from '../../shared/types/environments';
import {
  listDirectory,
  readFile,
  writeFile,
  createFile,
  createDirectory,
  deleteEntry,
  renameEntry,
} from '../fileService';
import { resolveExistingDirectory } from '../security';
import { toNativePath } from '../../shared/pathNormalize';
import {
  HARNESS_OPTIONS,
  getAvailableHarnessOptions,
  discoverHarnessModels,
} from '../harnessCatalog';
import { defaultShell, prependUserCliBinsToPath } from '../platformShell';
import { executeLocalHarnessCommand, openLocalHarnessSession } from './localCommandExecutor';
import type { HarnessCommandRequest } from '../harnesses/commandExecution';
import { buildHarnessSpawnArgs, resolveHarnessSpawn } from '../harnessLaunch';

const execFileAsync = promisify(execFile);

export class LocalEnvironment implements WorkspaceEnvironment {
  public readonly id = LOCAL_ENVIRONMENT_ID;
  public readonly kind = 'local' as const;
  public readonly label = 'Local';

  public readonly capabilities: EnvironmentCapabilities = {
    watchFiles: true,
    worktrees: true,
    revealInFileManager: true,
    agentAttention: true,
    sessionDiscovery: true,
    annotationHandoff: true,
  };

  public async validateWorkspacePath(workspacePath: string): Promise<{ valid: boolean; resolvedPath?: string; error?: string }> {
    const native = toNativePath(workspacePath, process.platform);
    const resolved = resolveExistingDirectory(native);
    if (!resolved) {
      return { valid: false, error: 'Directory does not exist or is not accessible' };
    }
    return { valid: true, resolvedPath: resolved };
  }

  public async listDirectory(request: Parameters<WorkspaceEnvironment['listDirectory']>[0]) {
    return listDirectory(request);
  }

  public async readFile(request: Parameters<WorkspaceEnvironment['readFile']>[0]) {
    return readFile(request);
  }

  public async writeFile(request: Parameters<WorkspaceEnvironment['writeFile']>[0]) {
    return writeFile(request);
  }

  public async createFile(request: Parameters<WorkspaceEnvironment['createFile']>[0]) {
    return createFile(request);
  }

  public async createDirectory(request: Parameters<WorkspaceEnvironment['createDirectory']>[0]) {
    return createDirectory(request);
  }

  public async deleteEntry(request: Parameters<WorkspaceEnvironment['deleteEntry']>[0]) {
    return deleteEntry(request);
  }

  public async renameEntry(request: Parameters<WorkspaceEnvironment['renameEntry']>[0]) {
    return renameEntry(request);
  }

  public async execGit(
    workspacePath: string,
    args: string[],
    timeoutMs = 15000,
  ): Promise<{ stdout: string; stderr: string }> {
    const nativePath = toNativePath(workspacePath, process.platform);
    return execFileAsync('git', args, {
      cwd: nativePath,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: prependUserCliBinsToPath(process.env.PATH ?? ''),
        GIT_TERMINAL_PROMPT: '0',
      },
    });
  }

  public executeHarnessCommand(request: HarnessCommandRequest, signal?: AbortSignal) {
    return executeLocalHarnessCommand(request, signal);
  }

  public openHarnessCommandSession(request: HarnessCommandRequest, signal?: AbortSignal) {
    return openLocalHarnessSession(request, signal);
  }

  public async getHarnessOptions(): Promise<Record<string, EnvironmentHarnessOption>> {
    return HARNESS_OPTIONS;
  }

  public async probeAvailableHarnessIds(): Promise<string[]> {
    return Object.keys(getAvailableHarnessOptions());
  }

  public async discoverHarnessModels(harnessId: string): Promise<EnvironmentModelOption[]> {
    return discoverHarnessModels(harnessId);
  }

  public async resolveTerminalSpawn(params: TerminalSpawnRequest): Promise<TerminalSpawnResolved> {
    const userShell = defaultShell();
    const shellArgs = process.platform === 'win32' ? [] : ['-i'];
    const harnessConfig = params.harness ? HARNESS_OPTIONS[params.harness] : undefined;

    let harnessArgs: string[] = [];
    if (harnessConfig) {
      harnessArgs = buildHarnessSpawnArgs(harnessConfig, params.model, undefined, findHarnessProvider(params.harness)?.launch.modelArgs);
    }

    const harnessCmd = harnessConfig
      ? resolveHarnessSpawn(harnessConfig.command, harnessArgs, null)
      : { spawnCmd: userShell, spawnArgs: shellArgs };

    let launchLabel: string | undefined;
    if (harnessConfig && params.harness) {
      launchLabel = `[clanker-grid] ${harnessConfig.command} ${harnessArgs.join(' ')}`;
    } else if (params.initialCommand) {
      launchLabel = `[clanker-grid] ${params.initialCommand.trim().replace(/[\r\n]+/g, ' ')}`;
    }

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      PATH: prependUserCliBinsToPath(process.env.PATH ?? ''),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'clanker-grid',
      FORCE_COLOR: '1',
    };

    return {
      spawnCmd: harnessCmd.spawnCmd,
      spawnArgs: harnessCmd.spawnArgs,
      cwd: toNativePath(params.workingDir, process.platform),
      env,
      launchLabel,
      initialCommand: params.initialCommand,
      harnessId: harnessConfig ? params.harness : undefined,
      attentionEnabled: false, // This environment primitive does not acquire native launch attachments.
    };
  }
}
