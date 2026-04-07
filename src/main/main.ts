import { app, BrowserWindow, Menu, WebContentsView, ipcMain, dialog, shell } from 'electron';

// Disable GPU acceleration for compatibility in some environments
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('disable-setuid-sandbox');

import * as path from 'path';
import * as fs from 'fs';
import * as pty from 'node-pty';
import Store from 'electron-store';

interface Terminal {
  id: string;
  pid: number;
  pty: pty.IPty;
  buffer: string;
}

interface StoreSchema {
  lastWorkspace: string;
  showFastfetch: boolean;
}

interface HarnessConfig {
  command: string;
  args: string[];
  name: string;
  icon: string;
  env?: Record<string, string>;
}

export const HARNESS_OPTIONS: Record<string, HarnessConfig> = {
  'codex': {
    name: 'Codex',
    command: 'codex',
    args: ['--yolo'],
    icon: '🧠',
  },
  'opencode': {
    name: 'OpenCode',
    command: 'opencode',
    args: ['--pure'],
    icon: '⚡',
    env: {
      OPENCODE_PERMISSION: JSON.stringify({
        bash: { '*': 'allow' },
        edit: 'allow',
      }),
    },
  },
  'pi': {
    name: 'Pi',
    command: 'pi',
    args: [],
    icon: 'π',
  },
  'claude': {
    name: 'Claude',
    command: 'claude',
    args: [],
    icon: '✨',
  },
};

function isCommandAvailable(command: string): boolean {
  const searchPaths = new Set<string>([
    process.cwd(),
    path.join(process.cwd(), 'node_modules', '.bin'),
    app.getAppPath(),
    path.join(app.getAppPath(), 'node_modules', '.bin'),
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
  ]);

  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT?.split(';').filter(Boolean) ?? ['.EXE', '.CMD', '.BAT', '.COM'])
    : [''];
  const candidates = path.extname(command) ? [command] : [command, ...extensions.map((ext) => `${command}${ext}`)];

  for (const searchPath of searchPaths) {
    for (const candidate of candidates) {
      const fullPath = path.isAbsolute(candidate) ? candidate : path.join(searchPath, candidate);
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
        return true;
      } catch {
        // continue searching
      }
    }
  }

  return false;
}

function getAvailableHarnessOptions() {
  return Object.fromEntries(
    Object.entries(HARNESS_OPTIONS).filter(([, config]) => isCommandAvailable(config.command))
  );
}

const store = new Store<StoreSchema>({
  defaults: {
    lastWorkspace: app.getPath('home'),
    showFastfetch: false,
  },
});

const terminals: Map<string, Terminal> = new Map();
let mainWindow: BrowserWindow | null = null;
let browserView: WebContentsView | null = null;
let currentBrowserUrl = 'https://github.com';

// ============================================================================
// Git Service - Handles all git operations in the main process
// This service manages polling and can be extended for GitHub API integration
// ============================================================================

interface GitStatusEntry {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

interface GitStatusResult {
  success: boolean;
  isRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  changes: GitStatusEntry[];
  error?: string;
}

interface GitBranchEntry {
  name: string;
  isCurrent: boolean;
}

interface GitBranchStateResult {
  success: boolean;
  isRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  branches: GitBranchEntry[];
  error?: string;
}

interface GitOperationStateResult {
  success: boolean;
  isRepo: boolean;
  inProgress: boolean;
  mode: 'none' | 'merge' | 'rebase';
  conflicts: string[];
  message: string;
  error?: string;
}

interface GitStashEntry {
  ref: string;
  hash: string;
  message: string;
}

interface GitCommitEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

interface GitDiffResult {
  success: boolean;
  output: string;
  title: string;
  error?: string;
}

class GitService {
  private pollingInterval: NodeJS.Timeout | null = null;
  private currentWorkspacePath: string | null = null;
  private pollIntervalMs = 30000; // 30 seconds

  private async execGit(
    workspacePath: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string }> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    return execFileAsync('git', args, {
      cwd: workspacePath,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    }) as Promise<{ stdout: string; stderr: string }>;
  }

  private normalizeBranchName(name: string): string {
    return name.trim();
  }

  private isMissingSwitchCommand(error: any): boolean {
    const stderr = String(error?.stderr ?? error?.message ?? '');
    return stderr.includes('not a git command') || stderr.includes('unknown subcommand');
  }

  private getGitErrorMessage(error: any, fallback: string): string {
    const stderr = String(error?.stderr ?? '').trim();
    const message = String(error?.message ?? '').trim();
    return stderr || message || fallback;
  }

  private parseBranchList(branchOutput: string, currentBranch: string | null): GitBranchEntry[] {
    const lines = branchOutput.trim().split('\n').filter(Boolean);

    return lines.map((line) => {
      const [name, headMarker = ' '] = line.split('\t');
      return {
        name,
        isCurrent: Boolean(currentBranch && name === currentBranch) || headMarker === '*',
      };
    });
  }

  private parseDelimitedRows<T>(
    output: string,
    mapper: (columns: string[]) => T
  ): T[] {
    const lines = output.trim().split('\n').filter(Boolean);
    return lines.map((line) => mapper(line.split('\x1f')));
  }

  async getCurrentBranch(workspacePath: string): Promise<string | null> {
    const { stdout } = await this.execGit(workspacePath, ['branch', '--show-current']);
    const branchName = stdout.trim();
    return branchName.length > 0 ? branchName : null;
  }

  async getBranches(workspacePath: string): Promise<GitBranchEntry[]> {
    const currentBranch = await this.getCurrentBranch(workspacePath);
    const { stdout } = await this.execGit(workspacePath, [
      'branch',
      '--format=%(refname:short)\t%(HEAD)',
    ]);

    return this.parseBranchList(stdout, currentBranch);
  }

  async getOperationState(workspacePath: string): Promise<GitOperationStateResult> {
    try {
      const isRepo = await this.isRepo(workspacePath);
      if (!isRepo) {
        return {
          success: false,
          isRepo: false,
          inProgress: false,
          mode: 'none',
          conflicts: [],
          message: 'Not a git repository',
        };
      }

      let mode: GitOperationStateResult['mode'] = 'none';
      let message = 'No merge in progress';
      let inProgress = false;

      try {
        await this.execGit(workspacePath, ['rev-parse', '--verify', 'MERGE_HEAD']);
        mode = 'merge';
        inProgress = true;
        message = 'Merge in progress';
      } catch {
        try {
          await this.execGit(workspacePath, ['rev-parse', '--verify', 'REBASE_HEAD']);
          mode = 'rebase';
          inProgress = true;
          message = 'Rebase in progress';
        } catch {
          mode = 'none';
          inProgress = false;
          message = 'No merge in progress';
        }
      }

      const conflicts = inProgress ? await this.getConflictingFiles(workspacePath) : [];
      if (conflicts.length > 0) {
        message = `${mode === 'rebase' ? 'Rebase' : 'Merge'} has ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}`;
      }

      return {
        success: true,
        isRepo: true,
        inProgress,
        mode,
        conflicts,
        message,
      };
    } catch (error: any) {
      return {
        success: false,
        isRepo: false,
        inProgress: false,
        mode: 'none',
        conflicts: [],
        message: 'Failed to load merge state',
        error: this.getGitErrorMessage(error, 'Failed to load merge state'),
      };
    }
  }

  async getConflictingFiles(workspacePath: string): Promise<string[]> {
    const { stdout } = await this.execGit(workspacePath, [
      'diff',
      '--name-only',
      '--diff-filter=U',
    ]);
    return stdout.trim().split('\n').filter(Boolean);
  }

  async mergeBranch(
    workspacePath: string,
    branchName: string
  ): Promise<{ success: boolean; error?: string }> {
    const targetBranch = this.normalizeBranchName(branchName);
    if (!targetBranch) {
      return { success: false, error: 'Branch name cannot be empty' };
    }

    try {
      await this.execGit(workspacePath, ['merge', targetBranch]);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to merge branch'),
      };
    }
  }

  async abortCurrentOperation(
    workspacePath: string
  ): Promise<{ success: boolean; error?: string }> {
    const state = await this.getOperationState(workspacePath);
    if (!state.inProgress) {
      return { success: false, error: 'No merge or rebase in progress' };
    }

    try {
      if (state.mode === 'rebase') {
        await this.execGit(workspacePath, ['rebase', '--abort']);
      } else {
        await this.execGit(workspacePath, ['merge', '--abort']);
      }
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to abort operation'),
      };
    }
  }

  async stashChanges(
    workspacePath: string,
    message?: string,
    includeUntracked?: boolean
  ): Promise<{ success: boolean; error?: string }> {
    const stashMessage = message?.trim() || '';

    try {
      const args = ['stash', 'push'];
      if (includeUntracked) {
        args.push('-u');
      }
      if (stashMessage.length > 0) {
        args.push('-m', stashMessage);
      }
      await this.execGit(workspacePath, args);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to stash changes'),
      };
    }
  }

  async listStashes(workspacePath: string): Promise<GitStashEntry[]> {
    const { stdout } = await this.execGit(workspacePath, [
      'stash',
      'list',
      '--format=%H%x1f%gd%x1f%gs',
    ]);

    return this.parseDelimitedRows(stdout, ([hash = '', ref = '', message = '']) => ({
      hash,
      ref,
      message,
    }));
  }

  async applyStash(
    workspacePath: string,
    stashRef: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execGit(workspacePath, ['stash', 'apply', stashRef]);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to apply stash'),
      };
    }
  }

  async popStash(
    workspacePath: string,
    stashRef: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execGit(workspacePath, ['stash', 'pop', stashRef]);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to pop stash'),
      };
    }
  }

  async dropStash(
    workspacePath: string,
    stashRef: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execGit(workspacePath, ['stash', 'drop', stashRef]);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to drop stash'),
      };
    }
  }

  async clearStashes(
    workspacePath: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execGit(workspacePath, ['stash', 'clear']);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to clear stashes'),
      };
    }
  }

  async getHistory(workspacePath: string, limit = 8): Promise<GitCommitEntry[]> {
    try {
      const { stdout } = await this.execGit(workspacePath, [
        'log',
        `-n${Math.max(1, Math.min(50, limit))}`,
        '--date=short',
        '--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s',
      ]);

      return this.parseDelimitedRows(stdout, ([hash = '', shortHash = '', author = '', date = '', subject = '']) => ({
        hash,
        shortHash,
        author,
        date,
        subject,
      }));
    } catch (error: any) {
      const errorText = String(error?.stderr ?? error?.message ?? '');
      if (errorText.includes('does not have any commits yet') || errorText.includes('unknown revision')) {
        return [];
      }
      throw error;
    }
  }

  async getDiff(
    workspacePath: string,
    mode: 'working' | 'staged' | 'commit',
    ref?: string
  ): Promise<GitDiffResult> {
    try {
      let output = '';
      let title = 'Diff';

      if (mode === 'working') {
        title = 'Working Tree Diff';
        const { stdout } = await this.execGit(workspacePath, [
          'diff',
          '--stat',
          '--summary',
          '--no-color',
          '--no-ext-diff',
        ]);
        output = stdout.trim();
      } else if (mode === 'staged') {
        title = 'Staged Diff';
        const { stdout } = await this.execGit(workspacePath, [
          'diff',
          '--cached',
          '--stat',
          '--summary',
          '--no-color',
          '--no-ext-diff',
        ]);
        output = stdout.trim();
      } else {
        const commitRef = (ref ?? '').trim();
        if (!commitRef) {
          return {
            success: false,
            output: '',
            title: 'Commit Diff',
            error: 'Commit reference is required',
          };
        }

        title = `Commit ${commitRef.slice(0, 12)} Diff`;
        const { stdout } = await this.execGit(workspacePath, [
          'show',
          '--stat',
          '--summary',
          '--format=medium',
          '--no-color',
          '--no-ext-diff',
          commitRef,
        ]);
        output = stdout.trim();
      }

      return {
        success: true,
        output,
        title,
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        title: 'Diff',
        error: this.getGitErrorMessage(error, 'Failed to load diff'),
      };
    }
  }

  async getBranchState(workspacePath: string): Promise<GitBranchStateResult> {
    try {
      const isRepo = await this.isRepo(workspacePath);
      if (!isRepo) {
        return {
          success: false,
          isRepo: false,
          currentBranch: null,
          isDetached: false,
          branches: [],
          error: 'Not a git repository',
        };
      }

      const currentBranch = await this.getCurrentBranch(workspacePath);
      const branches = await this.getBranches(workspacePath);

      return {
        success: true,
        isRepo: true,
        currentBranch,
        isDetached: currentBranch == null,
        branches,
      };
    } catch (error: any) {
      return {
        success: false,
        isRepo: false,
        currentBranch: null,
        isDetached: false,
        branches: [],
        error: this.getGitErrorMessage(error, 'Failed to load branch state'),
      };
    }
  }

  async createBranch(
    workspacePath: string,
    name: string,
    baseBranch?: string
  ): Promise<{ success: boolean; error?: string }> {
    const branchName = this.normalizeBranchName(name);
    const base = baseBranch?.trim() || null;

    if (!branchName) {
      return { success: false, error: 'Branch name cannot be empty' };
    }

    try {
      await this.execGit(workspacePath, ['check-ref-format', '--branch', branchName]);
    } catch (error: any) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Invalid branch name'),
      };
    }

    try {
      const args = ['switch', '-c', branchName];
      if (base) {
        args.push(base);
      }

      await this.execGit(workspacePath, args);
      return { success: true };
    } catch (error: any) {
      if (this.isMissingSwitchCommand(error)) {
        try {
          const args = ['checkout', '-b', branchName];
          if (base) {
            args.push(base);
          }
          await this.execGit(workspacePath, args);
          return { success: true };
        } catch (fallbackError: any) {
          return {
            success: false,
            error: this.getGitErrorMessage(fallbackError, 'Failed to create branch'),
          };
        }
      }

      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to create branch'),
      };
    }
  }

  async switchBranch(
    workspacePath: string,
    name: string
  ): Promise<{ success: boolean; error?: string }> {
    const branchName = this.normalizeBranchName(name);

    if (!branchName) {
      return { success: false, error: 'Branch name cannot be empty' };
    }

    try {
      await this.execGit(workspacePath, ['switch', branchName]);
      return { success: true };
    } catch (error: any) {
      if (this.isMissingSwitchCommand(error)) {
        try {
          await this.execGit(workspacePath, ['checkout', branchName]);
          return { success: true };
        } catch (fallbackError: any) {
          return {
            success: false,
            error: this.getGitErrorMessage(fallbackError, 'Failed to switch branch'),
          };
        }
      }

      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to switch branch'),
      };
    }
  }

  async deleteBranch(
    workspacePath: string,
    name: string
  ): Promise<{ success: boolean; error?: string }> {
    const branchName = this.normalizeBranchName(name);

    if (!branchName) {
      return { success: false, error: 'Branch name cannot be empty' };
    }

    const currentBranch = await this.getCurrentBranch(workspacePath);
    if (currentBranch && currentBranch === branchName) {
      return { success: false, error: 'Cannot delete the current branch' };
    }

    try {
      await this.execGit(workspacePath, ['branch', '-d', branchName]);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to delete branch'),
      };
    }
  }

  /**
   * Parse git status --porcelain output into structured data
   */
  private parseGitStatus(statusOutput: string): GitStatusEntry[] {
    const changes: GitStatusEntry[] = [];
    const lines = statusOutput.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filePath = line.slice(3).trim();

      // Determine if staged (has changes in index)
      const staged = indexStatus !== ' ' && indexStatus !== '?';

      // Determine status type
      let status: GitStatusEntry['status'] = 'modified';
      const statusChar = staged ? indexStatus : workTreeStatus;

      switch (statusChar) {
        case 'M':
          status = 'modified';
          break;
        case 'A':
          status = 'added';
          break;
        case 'D':
          status = 'deleted';
          break;
        case 'R':
          status = 'renamed';
          break;
        case '?':
          status = 'untracked';
          break;
        default:
          status = 'modified';
      }

      changes.push({ path: filePath, status, staged });
    }

    return changes;
  }

  /**
   * Get git status for a workspace
   */
  async getStatus(workspacePath: string): Promise<GitStatusResult> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      // Check if it's a git repository
      await execAsync('git rev-parse --git-dir', { cwd: workspacePath });

      // Get porcelain status
      const { stdout } = await execAsync('git status --porcelain', { cwd: workspacePath });
      const changes = this.parseGitStatus(stdout);
      const currentBranch = await this.getCurrentBranch(workspacePath);

      return {
        success: true,
        isRepo: true,
        currentBranch,
        isDetached: currentBranch == null,
        changes,
      };
    } catch {
      // Not a git repository or git not available
      return {
        success: false,
        isRepo: false,
        currentBranch: null,
        isDetached: false,
        changes: [],
      };
    }
  }

  /**
   * Stage files in the workspace
   */
  async stage(workspacePath: string, files?: string[]): Promise<{ success: boolean; error?: string }> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      if (files && files.length > 0) {
        await execAsync(`git add ${files.map(f => `"${f}"`).join(' ')}`, { cwd: workspacePath });
      } else {
        await execAsync('git add -A', { cwd: workspacePath });
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to stage files' };
    }
  }

  /**
   * Create a commit in the workspace
   */
  async commit(workspacePath: string, message: string): Promise<{ success: boolean; error?: string }> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    if (!message || message.trim().length === 0) {
      return { success: false, error: "Commit message cannot be empty" };
    }

    // Sanitize message to prevent injection
    const sanitizedMessage = message.trim().replace(/"/g, '\\"');

    try {
      await execAsync(`git commit -m "${sanitizedMessage}"`, { cwd: workspacePath });
      return { success: true };
    } catch (error: any) {
      const errorMsg = error.stderr || error.message || '';
      if (errorMsg.includes('nothing to commit')) {
        return { success: false, error: 'Nothing to commit' };
      }
      return { success: false, error: errorMsg || 'Failed to create commit' };
    }
  }

  /**
   * Check if workspace is a git repository
   */
  async isRepo(workspacePath: string): Promise<boolean> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      await execAsync('git rev-parse --git-dir', { cwd: workspacePath });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start polling git status for a workspace
   * Emits 'git-status-update' events to the renderer
   */
  startPolling(workspacePath: string): void {
    // Stop any existing polling
    this.stopPolling();

    this.currentWorkspacePath = workspacePath;

    // Emit initial status immediately
    this.emitStatusUpdate(workspacePath);

    // Then poll at interval
    this.pollingInterval = setInterval(async () => {
      if (this.currentWorkspacePath) {
        await this.emitStatusUpdate(this.currentWorkspacePath);
      }
    }, this.pollIntervalMs);
  }

  /**
   * Stop polling git status
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.currentWorkspacePath = null;
  }

  /**
   * Force an immediate status refresh
   */
  async refresh(): Promise<GitStatusResult | null> {
    if (!this.currentWorkspacePath) {
      return null;
    }
    return this.getStatus(this.currentWorkspacePath);
  }

  /**
   * Get current workspace path
   */
  getCurrentWorkspace(): string | null {
    return this.currentWorkspacePath;
  }

  /**
   * Emit status update to renderer
   */
  private async emitStatusUpdate(workspacePath: string): Promise<void> {
    if (!mainWindow) return;

    const result = await this.getStatus(workspacePath);
    mainWindow.webContents.send('git-status-update', result);
  }
}

// Singleton instance
const gitService = new GitService();

async function refreshGitStatus(workspacePath: string) {
  const status = await gitService.getStatus(workspacePath);
  if (mainWindow) {
    mainWindow.webContents.send('git-status-update', status);
  }
  return status;
}

function emitFitAllPanesShortcut() {
  mainWindow?.webContents.send('fit-all-panes');
}

function attachBrowserShortcutHandlers(view: WebContentsView) {
  view.webContents.on('before-input-event', (_event, input) => {
    if (
      (input.control || input.meta) &&
      input.shift &&
      input.key.toLowerCase() === 'f'
    ) {
      emitFitAllPanesShortcut();
    }
  });
}

function getRendererUrl(query: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value.length > 0) {
      searchParams.set(key, value);
    }
  }
  const queryString = searchParams.toString();

  if (process.env.NODE_ENV === 'development') {
    return `http://localhost:1420${queryString ? `/?${queryString}` : '/'}`;
  }

  const fileUrl = path.join(__dirname, '../renderer/index.html');
  return queryString ? `${fileUrl}?${queryString}` : fileUrl;
}

function getIconPath() {
  if (process.env.NODE_ENV === 'development') {
    return path.join(__dirname, '../../build/icon.png');
  }
  return path.join(process.resourcesPath, 'icon.png');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Clanker Grid',
    backgroundColor: '#0d1117',
    icon: getIconPath(),
    show: true,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);
  Menu.setApplicationMenu(null);

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(getRendererUrl({}));
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    browserView?.webContents.close();
    browserView = null;
    mainWindow = null;
    terminals.forEach((term) => term.pty.kill());
    terminals.clear();
    gitService.stopPolling();
  });
}

// Initialize browser view (hidden by default)
function initBrowserView() {
  if (browserView || !mainWindow) return;

  browserView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      partition: 'persist:browser',
    },
  });

  browserView.webContents.loadURL(currentBrowserUrl);
  mainWindow.contentView.addChildView(browserView);
  attachBrowserShortcutHandlers(browserView);
  
  // Initially hide it
  browserView.setVisible(false);
  browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
}

// Show/hide and position browser view
function updateBrowserView(x: number, y: number, width: number, height: number, visible: boolean) {
  if (!mainWindow) return;

  if (!browserView) {
    initBrowserView();
  }

  if (browserView) {
    browserView.setVisible(visible);
    if (visible && width > 0 && height > 0) {
      browserView.setBounds({ x, y, width, height });
    }
  }
}

// IPC Handlers
ipcMain.handle('get-last-workspace', () => {
  return store.get('lastWorkspace');
});

ipcMain.handle('set-last-workspace', (_, workspacePath: string) => {
  store.set('lastWorkspace', workspacePath);
});

ipcMain.handle('get-show-fastfetch', () => {
  return store.get('showFastfetch');
});

ipcMain.handle('set-show-fastfetch', (_, showFastfetch: boolean) => {
  store.set('showFastfetch', showFastfetch);
});

ipcMain.handle('open-directory-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Workspace Directory',
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    store.set('lastWorkspace', selectedPath);
    return selectedPath;
  }
  return null;
});

ipcMain.handle('read-directory', async (_, dirPath: string) => {
  const fs = await import('fs');
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
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

ipcMain.handle('spawn-terminal', (_, workingDir: string, harness?: string) => {
  const id = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Use user's default shell, fallback to bash
  const userShell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
  
  // Spawn with interactive flags for better shell experience
  // -i: interactive mode (enables completion, aliases, etc.)
  // --login: load profile files (~/.bash_profile, ~/.zprofile)
  const shellArgs = ['-i'];
  
  const harnessEnv = harness && HARNESS_OPTIONS[harness]?.env ? HARNESS_OPTIONS[harness].env : {};

  const ptyProcess = pty.spawn(userShell, shellArgs, {
    name: 'xterm-256color',
    cwd: workingDir || store.get('lastWorkspace'),
    env: {
      ...process.env as { [key: string]: string },
      ...harnessEnv,
      // Ensure proper terminal settings
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // Helpful for shells that detect terminal
      TERM_PROGRAM: 'clanker-grid',
      // Enable true color
      FORCE_COLOR: '1',
      // Disable fastfetch in app terminals (if setting is off)
      ...(store.get('showFastfetch') ? {} : { CLANKER_GRID: '1' }),
    },
  });

  const terminal: Terminal = { id, pid: ptyProcess.pid, pty: ptyProcess, buffer: '' };
  terminals.set(id, terminal);

  // If a harness is specified, write the command after a short delay
  if (harness && HARNESS_OPTIONS[harness]) {
    const config = HARNESS_OPTIONS[harness];
    setTimeout(() => {
      const cmd = `${config.command} ${config.args.join(' ')}\r\n`;
      ptyProcess.write(cmd);
    }, 500);
  }

  ptyProcess.onData((data) => {
    terminal.buffer += data;
    if (mainWindow) {
      mainWindow.webContents.send('terminal-data', { id, data });
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    terminals.delete(id);
    if (mainWindow) {
      mainWindow.webContents.send('terminal-exit', { id, exitCode });
    }
  });

  return { id, pid: ptyProcess.pid };
});

ipcMain.handle('get-terminal-buffer', (_, id: string) => {
  return terminals.get(id)?.buffer ?? '';
});

ipcMain.handle('write-terminal', (_, { id, data }: { id: string; data: string }) => {
  const terminal = terminals.get(id);
  if (terminal) {
    terminal.pty.write(data);
  }
});

ipcMain.handle('resize-terminal', (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
  const terminal = terminals.get(id);
  if (terminal) {
    terminal.pty.resize(cols, rows);
  }
});

ipcMain.handle('kill-terminal', (_, id: string) => {
  const terminal = terminals.get(id);
  if (terminal) {
    terminal.pty.kill();
    terminals.delete(id);
  }
});

// Browser IPC Handlers
ipcMain.handle('browser-show', (_, x: number, y: number, width: number, height: number) => {
  updateBrowserView(x, y, width, height, true);
});

// Browser view with viewport coordinates
ipcMain.handle('browser-set-bounds', (_, viewportBounds: { x: number; y: number; width: number; height: number }) => {
  // viewportBounds are already relative to window content area (from getBoundingClientRect)
  // WebContentsView.setBounds uses content coordinates, so these should work directly
  updateBrowserView(
    viewportBounds.x,
    viewportBounds.y,
    viewportBounds.width,
    viewportBounds.height,
    true
  );
});

ipcMain.handle('browser-hide', () => {
  updateBrowserView(0, 0, 0, 0, false);
});

ipcMain.handle('browser-navigate', (_, url: string) => {
  currentBrowserUrl = url;
  if (browserView) {
    browserView.webContents.loadURL(url);
  }
});

ipcMain.handle('browser-back', () => {
  if (browserView && browserView.webContents.navigationHistory.canGoBack()) {
    browserView.webContents.navigationHistory.goBack();
  }
});

ipcMain.handle('browser-forward', () => {
  if (browserView && browserView.webContents.navigationHistory.canGoForward()) {
    browserView.webContents.navigationHistory.goForward();
  }
});

ipcMain.handle('browser-refresh', () => {
  if (browserView) {
    browserView.webContents.reload();
  }
});

ipcMain.handle('browser-stop', () => {
  if (browserView) {
    browserView.webContents.stop();
  }
});

ipcMain.handle('open-external', (_, url: string) => {
  shell.openExternal(url);
});

ipcMain.handle('minimize-window', () => {
  mainWindow?.minimize();
});

ipcMain.handle('toggle-maximize-window', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle('close-window', () => {
  mainWindow?.close();
});

ipcMain.handle('is-maximized-window', () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle('get-harness-options', () => {
  return getAvailableHarnessOptions();
});

ipcMain.handle('get-browser-url', () => {
  return currentBrowserUrl;
});

ipcMain.handle('can-go-back', () => {
  return browserView?.webContents.navigationHistory.canGoBack() ?? false;
});

ipcMain.handle('can-go-forward', () => {
  return browserView?.webContents.navigationHistory.canGoForward() ?? false;
});

// ============================================================================
// Git IPC Handlers - Delegated to GitService
// ============================================================================

ipcMain.handle('git-start-polling', (_, workspacePath: string) => {
  gitService.startPolling(workspacePath);
});

ipcMain.handle('git-stop-polling', () => {
  gitService.stopPolling();
});

ipcMain.handle('git-get-status', async (_, workspacePath: string) => {
  return gitService.getStatus(workspacePath);
});

ipcMain.handle('git-get-branch-state', async (_, workspacePath: string) => {
  return gitService.getBranchState(workspacePath);
});

ipcMain.handle('git-get-operation-state', async (_, workspacePath: string) => {
  return gitService.getOperationState(workspacePath);
});

ipcMain.handle('git-get-stashes', async (_, workspacePath: string) => {
  return gitService.listStashes(workspacePath);
});

ipcMain.handle('git-get-history', async (_, workspacePath: string, limit?: number) => {
  return gitService.getHistory(workspacePath, limit);
});

ipcMain.handle('git-get-diff', async (
  _,
  workspacePath: string,
  mode: 'working' | 'staged' | 'commit',
  ref?: string
) => {
  return gitService.getDiff(workspacePath, mode, ref);
});

ipcMain.handle('git-stage', async (_, workspacePath: string, files?: string[]) => {
  const result = await gitService.stage(workspacePath, files);
  // Refresh status after staging
  await refreshGitStatus(workspacePath);
  return result;
});

ipcMain.handle('git-commit', async (_, workspacePath: string, message: string) => {
  const result = await gitService.commit(workspacePath, message);
  // Refresh status after commit
  await refreshGitStatus(workspacePath);
  return result;
});

ipcMain.handle('git-create-branch', async (_, workspacePath: string, name: string, baseBranch?: string) => {
  const result = await gitService.createBranch(workspacePath, name, baseBranch);
  if (result.success) {
    await refreshGitStatus(workspacePath);
  }
  return result;
});

ipcMain.handle('git-switch-branch', async (_, workspacePath: string, name: string) => {
  const result = await gitService.switchBranch(workspacePath, name);
  if (result.success) {
    await refreshGitStatus(workspacePath);
  }
  return result;
});

ipcMain.handle('git-delete-branch', async (_, workspacePath: string, name: string) => {
  const result = await gitService.deleteBranch(workspacePath, name);
  if (result.success) {
    await refreshGitStatus(workspacePath);
  }
  return result;
});

ipcMain.handle('git-merge-branch', async (_, workspacePath: string, branchName: string) => {
  const result = await gitService.mergeBranch(workspacePath, branchName);
  if (result.success) {
    await refreshGitStatus(workspacePath);
  }
  return result;
});

ipcMain.handle('git-abort-operation', async (_, workspacePath: string) => {
  const result = await gitService.abortCurrentOperation(workspacePath);
  if (result.success) {
    await refreshGitStatus(workspacePath);
  }
  return result;
});

ipcMain.handle('git-stash', async (_, workspacePath: string, message?: string, includeUntracked?: boolean) => {
  const result = await gitService.stashChanges(workspacePath, message, includeUntracked);
  if (result.success) {
    await refreshGitStatus(workspacePath);
  }
  return result;
});

ipcMain.handle('git-apply-stash', async (_, workspacePath: string, stashRef: string) => {
  const result = await gitService.applyStash(workspacePath, stashRef);
  if (result.success) {
    await refreshGitStatus(workspacePath);
  }
  return result;
});

ipcMain.handle('git-pop-stash', async (_, workspacePath: string, stashRef: string) => {
  const result = await gitService.popStash(workspacePath, stashRef);
  if (result.success) {
    await refreshGitStatus(workspacePath);
  }
  return result;
});

ipcMain.handle('git-drop-stash', async (_, workspacePath: string, stashRef: string) => {
  const result = await gitService.dropStash(workspacePath, stashRef);
  if (result.success) {
    await refreshGitStatus(workspacePath);
  }
  return result;
});

ipcMain.handle('git-clear-stashes', async (_, workspacePath: string) => {
  const result = await gitService.clearStashes(workspacePath);
  if (result.success) {
    await refreshGitStatus(workspacePath);
  }
  return result;
});

ipcMain.handle('git-is-repo', async (_, workspacePath: string) => {
  return gitService.isRepo(workspacePath);
});

ipcMain.handle('git-refresh', async () => {
  return gitService.refresh();
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
