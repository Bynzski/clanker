import { HarnessCapabilityError, classifyHarnessFailure } from '../harnesses/types';
import { findHarnessProvider } from '../harnesses/registry';
/**
 * AI Commit IPC Handlers
 *
 * Registers IPC handlers for AI-powered commit message generation.
 * Separated from settingsIpc.ts per concern separation.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import Store from 'electron-store';
import { type StoreSchema } from '../../shared/types/store';
import {
  resolveExistingDirectory,
} from '../security';
import { toNativePath } from '../../shared/pathNormalize';
import type { WorkspaceRegistry } from '../workspaceRegistry';
import { resolveHarnessSpawn } from '../harnessLaunch';
import { prependUserCliBinsToPath } from '../platformShell';
import {
  buildCommitPrompt,
  normalizeCommitMessageOutput,
  type AiCommitProvider,
} from '../aiCommit';
import type { GitService, GitStatusEntry } from '../gitService';
import {
  GENERATE_COMMIT_MESSAGE,
} from '../../shared/ipcChannels';

interface RegisterAiCommitIpcDeps {
  getStore: () => Store<StoreSchema>;
  getGitService: () => GitService;
  getWorkspaceRegistry?: () => WorkspaceRegistry;
}

function runCommandWithInput(
  command: string,
  args: string[],
  input: string | undefined,
  timeoutMs = 30000,
  extraEnv?: Record<string, string>,
  cwd?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { spawnCmd, spawnArgs } = resolveHarnessSpawn(command, args, null);
    const child = spawn(spawnCmd, spawnArgs, {
      cwd,
      env: {
        ...process.env,
        PATH: prependUserCliBinsToPath(process.env.PATH ?? ''),
        ...extraEnv,
      } as { [key: string]: string },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new HarnessCapabilityError('timeout', `Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += String(data);
    });

    child.stderr.on('data', (data) => {
      stderr += String(data);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(Object.assign(classifyHarnessFailure(error), { stdout, stderr }));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const error = new HarnessCapabilityError('command-failed', `Command failed with exit code ${code ?? 'unknown'}`);
        reject(Object.assign(error, { stdout, stderr, code }));
        return;
      }

      resolve(stdout || stderr);
    });

    child.stdin.end(input === undefined ? undefined : input.endsWith('\n') ? input : `${input}\n`);
  });
}

function formatCommitChangeSummary(changes: GitStatusEntry[]): string[] {
  return changes.map((change) => `${change.staged ? 'staged' : 'unstaged'} ${change.status}: ${change.path}`);
}

function getValidatedWorkspacePath(workspacePath: string | null | undefined): string | null {
  if (typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
    return null;
  }

  return resolveExistingDirectory(toNativePath(workspacePath, process.platform));
}

function getInvalidWorkspaceResult() {
  return { success: false, error: 'Workspace path is invalid or not a directory' };
}

async function resolveAiCommitModel(provider: AiCommitProvider, configuredModel: string): Promise<string | null> {
  const { discoverHarnessModels } = await import('../harnessCatalog');
  const models = await discoverHarnessModels(provider);
  if (configuredModel && models.some((model) => model.id === configuredModel)) {
    return configuredModel;
  }

  return models[0]?.id ?? null;
}

async function generateAiCommitMessage(
  workspacePath: string,
  store: Store<StoreSchema>,
  gitService: GitService
): Promise<{ success: boolean; message?: string; error?: string }> {
  const enabled = store.get('aiCommitEnabled');
  if (!enabled) {
    return { success: false, error: 'AI commit message generation is disabled' };
  }

  const provider = store.get('aiCommitProvider');
  const providerConfig = findHarnessProvider(provider)?.aiCommit;
  if (!providerConfig) {
    return { success: false, error: 'Unsupported AI commit provider' };
  }

  const context = await gitService.getCommitPromptContext(workspacePath);
  if (!context.success) {
    return { success: false, error: context.error || 'Unable to build commit context' };
  }

  const model = await resolveAiCommitModel(provider, store.get('aiCommitModel'));
  if (!model) {
    return { success: false, error: `No models available for ${provider}` };
  }

  const prompt = buildCommitPrompt({
    workspacePath,
    branchName: context.currentBranch,
    isDetached: context.isDetached,
    changeSummary: formatCommitChangeSummary(context.changes),
    diffMode: context.diffMode,
    diffSummary: context.diffSummary,
  });

  const invocation = providerConfig.buildInvocation({ model, prompt });
  const output = await runCommandWithInput(
    invocation.command, invocation.args, invocation.stdin, invocation.timeoutMs,
    invocation.env, workspacePath,
  );
  const message = normalizeCommitMessageOutput(output);

  if (!message) {
    return { success: false, error: 'AI model returned an empty commit message' };
  }

  return { success: true, message };
}

export function registerAiCommitIpc(deps: RegisterAiCommitIpcDeps): void {
  const { getStore, getGitService } = deps;

  ipcMain.handle(GENERATE_COMMIT_MESSAGE, async (_, workspacePath: string, workspaceId?: string) => {
    const registry = deps.getWorkspaceRegistry?.();
    const ws = workspaceId ? registry?.getWorkspace(workspaceId) : null;
    if (workspaceId && registry && !ws) {
      return { success: false, error: 'Workspace is not registered' };
    }
    if (ws?.location.environmentId !== undefined && ws.location.environmentId !== 'local') {
      return { success: false, error: 'AI commit message generation is not supported for remote workspaces in this version' };
    }
    if (!workspaceId && registry?.getAllWorkspaces().some(
      (entry) => entry.location.environmentId !== 'local' && entry.location.path === workspacePath
    )) {
      return { success: false, error: 'Select a registered local workspace to generate an AI commit message' };
    }

    const safeWorkspacePath = getValidatedWorkspacePath(ws?.location.path ?? workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    return generateAiCommitMessage(safeWorkspacePath, getStore(), getGitService());
  });
}

async function refreshGitStatus(
  workspacePath: string,
  getMainWindow: () => BrowserWindow | null,
  gitService: GitService
) {
  const status = await gitService.getStatus(workspacePath);
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send('git-status-update', status);
  }
  return status;
}

export {
  runCommandWithInput,
  formatCommitChangeSummary,
  getValidatedWorkspacePath,
  getInvalidWorkspaceResult,
  resolveAiCommitModel,
  generateAiCommitMessage,
  refreshGitStatus,
};
