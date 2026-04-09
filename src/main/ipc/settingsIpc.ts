/**
 * Settings IPC Handlers
 *
 * Registers all settings-related IPC handlers (store, AI commit, harness, window controls).
 * Extracted from main.ts per S2.3.
 */

import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import * as fs from 'fs';
import { spawn } from 'child_process';
import Store from 'electron-store';
import {
  discoverHarnessModels,
  getAvailableHarnessOptions,
} from '../harnessCatalog';
import {
  resolveExistingDirectory,
} from '../security';
import { GitService } from '../gitService';
import {
  AI_COMMIT_COMMANDS,
  buildAiCommitArgs,
  buildCommitPrompt,
  getAiCommitTimeoutMs,
  normalizeCommitMessageOutput,
  type AiCommitProvider,
} from '../aiCommit';
import type { GitStatusEntry } from '../gitService';

interface StoreSchema {
  lastWorkspace: string;
  showFastfetch: boolean;
  aiCommitEnabled: boolean;
  aiCommitProvider: AiCommitProvider;
  aiCommitModel: string;
}

interface RegisterSettingsIpcDeps {
  getStore: () => Store<StoreSchema>;
  getMainWindow: () => BrowserWindow | null;
  getGitService: () => GitService;
}

function runCommandWithInput(
  command: string,
  args: string[],
  input: string,
  timeoutMs = 30000,
  extraEnv?: Record<string, string>,
  cwd?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...extraEnv,
      } as { [key: string]: string },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += String(data);
    });

    child.stderr.on('data', (data) => {
      stderr += String(data);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(Object.assign(error, { stdout, stderr }));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error(`Command failed with exit code ${code ?? 'unknown'}`);
        reject(Object.assign(error, { stdout, stderr, code }));
        return;
      }

      resolve(stdout || stderr);
    });

    child.stdin.end(input.endsWith('\n') ? input : `${input}\n`);
  });
}

function formatCommitChangeSummary(changes: GitStatusEntry[]): string[] {
  return changes.map((change) => `${change.staged ? 'staged' : 'unstaged'} ${change.status}: ${change.path}`);
}

function getValidatedWorkspacePath(workspacePath: string): string | null {
  return resolveExistingDirectory(workspacePath);
}

function getSafeWorkspacePath(workingDir: string, store: Store<StoreSchema>): string {
  return (
    resolveExistingDirectory(workingDir, store.get('lastWorkspace'))
    ?? app.getPath('home')
  );
}

function getInvalidWorkspaceResult() {
  return { success: false, error: 'Workspace path is invalid or not a directory' };
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

async function resolveAiCommitModel(provider: AiCommitProvider, configuredModel: string): Promise<string | null> {
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
  const providerConfig = AI_COMMIT_COMMANDS[provider];
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

  const args = buildAiCommitArgs(provider, model);
  const output = await runCommandWithInput(
    providerConfig.command,
    args,
    prompt,
    getAiCommitTimeoutMs(provider),
    undefined,
    workspacePath
  );
  const message = normalizeCommitMessageOutput(output);

  if (!message) {
    return { success: false, error: 'AI model returned an empty commit message' };
  }

  return { success: true, message };
}

export function registerSettingsIpc(deps: RegisterSettingsIpcDeps): void {
  const { getStore, getMainWindow, getGitService } = deps;

  // Store handlers
  ipcMain.handle('get-last-workspace', () => {
    return getStore().get('lastWorkspace');
  });

  ipcMain.handle('get-show-fastfetch', () => {
    return getStore().get('showFastfetch');
  });

  ipcMain.handle('set-show-fastfetch', (_, showFastfetch: boolean) => {
    getStore().set('showFastfetch', showFastfetch);
  });

  ipcMain.handle('get-ai-commit-settings', () => {
    return {
      enabled: getStore().get('aiCommitEnabled'),
      provider: getStore().get('aiCommitProvider'),
      model: getStore().get('aiCommitModel'),
    };
  });

  ipcMain.handle('set-ai-commit-enabled', (_, enabled: boolean) => {
    getStore().set('aiCommitEnabled', enabled);
  });

  ipcMain.handle('set-ai-commit-provider', (_, provider: AiCommitProvider) => {
    getStore().set('aiCommitProvider', provider);
  });

  ipcMain.handle('set-ai-commit-model', (_, model: string) => {
    getStore().set('aiCommitModel', model);
  });

  ipcMain.handle('generate-commit-message', async (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }

    return generateAiCommitMessage(safeWorkspacePath, getStore(), getGitService());
  });

  ipcMain.handle('open-directory-dialog', async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Workspace Directory',
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0];
      getStore().set('lastWorkspace', selectedPath);
      return selectedPath;
    }
    return null;
  });

  ipcMain.handle('read-directory', async (_, dirPath: string) => {
    const safeDirectoryPath = resolveExistingDirectory(dirPath);
    if (!safeDirectoryPath) {
      return [];
    }

    try {
      const entries = fs.readdirSync(safeDirectoryPath, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
        }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('get-harness-models', async (_, harness: string) => {
    return discoverHarnessModels(harness);
  });

  ipcMain.handle('get-harness-options', () => {
    return getAvailableHarnessOptions();
  });

  // Window control handlers
  ipcMain.handle('minimize-window', () => {
    getMainWindow()?.minimize();
  });

  ipcMain.handle('toggle-maximize-window', () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle('close-window', () => {
    getMainWindow()?.close();
  });

  ipcMain.handle('is-maximized-window', () => {
    return getMainWindow()?.isMaximized() ?? false;
  });
}

// Export helpers for testing and reuse by other IPC modules
export {
  runCommandWithInput,
  formatCommitChangeSummary,
  getValidatedWorkspacePath,
  getSafeWorkspacePath,
  getInvalidWorkspaceResult,
  refreshGitStatus,
  resolveAiCommitModel,
  generateAiCommitMessage,
};
