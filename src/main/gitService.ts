import { execFile } from 'child_process';
import { promisify } from 'util';

export interface GitStatusEntry {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

export interface GitStatusResult {
  success: boolean;
  isRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  changes: GitStatusEntry[];
  error?: string;
}

export interface GitBranchEntry {
  name: string;
  isCurrent: boolean;
}

export interface GitBranchStateResult {
  success: boolean;
  isRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  branches: GitBranchEntry[];
  error?: string;
}

export interface GitOperationStateResult {
  success: boolean;
  isRepo: boolean;
  inProgress: boolean;
  mode: 'none' | 'merge' | 'rebase';
  conflicts: string[];
  message: string;
  error?: string;
}

export interface GitStashEntry {
  ref: string;
  hash: string;
  message: string;
}

export interface GitCommitEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitDiffResult {
  success: boolean;
  output: string;
  title: string;
  error?: string;
}

export class GitService {
  private pollingInterval: NodeJS.Timeout | null = null;
  private currentWorkspacePath: string | null = null;
  private pollIntervalMs = 30000;

  constructor(private readonly emitStatus: (status: GitStatusResult) => void) {}

  private async execGit(
    workspacePath: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string }> {
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

  private isMissingSwitchCommand(error: unknown): boolean {
    const stderr = String((error as { stderr?: string; message?: string })?.stderr ?? (error as { message?: string })?.message ?? '');
    return stderr.includes('not a git command') || stderr.includes('unknown subcommand');
  }

  private getGitErrorMessage(error: unknown, fallback: string): string {
    const errorRecord = error as { stderr?: string; message?: string };
    const stderr = String(errorRecord?.stderr ?? '').trim();
    const message = String(errorRecord?.message ?? '').trim();
    return stderr || message || fallback;
  }

  private parseBranchList(branchOutput: string): GitBranchEntry[] {
    const lines = branchOutput.trim().split('\n').filter(Boolean);

    return lines.map((line) => {
      const [name, headMarker = ' '] = line.split('\t');
      return {
        name,
        isCurrent: headMarker === '*',
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

  private parseGitStatus(statusOutput: string): GitStatusEntry[] {
    const changes: GitStatusEntry[] = [];
    const lines = statusOutput.split('\n').filter(Boolean);

    // git status --porcelain format: XY<space>PATH
    // X = index status, Y = worktree status, position 3+ = file path
    const INDEX_STATUS = 0;
    const WORKTREE_STATUS = 1;
    const PATH_START = 3;

    for (const line of lines) {
      const indexStatus = line[INDEX_STATUS];
      const workTreeStatus = line[WORKTREE_STATUS];
      const filePath = line.slice(PATH_START).trim();
      const staged = indexStatus !== ' ' && indexStatus !== '?';

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

  async getCurrentBranch(workspacePath: string): Promise<string | null> {
    const { stdout } = await this.execGit(workspacePath, ['branch', '--show-current']);
    const branchName = stdout.trim();
    return branchName.length > 0 ? branchName : null;
  }

  async getBranches(workspacePath: string): Promise<GitBranchEntry[]> {
    const { stdout } = await this.execGit(workspacePath, [
      'branch',
      '--format=%(refname:short)\t%(HEAD)',
    ]);

    return this.parseBranchList(stdout);
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
          try {
            await this.execGit(workspacePath, ['rev-parse', '--verify', 'CHERRY_PICK_HEAD']);
            mode = 'merge';
            inProgress = true;
            message = 'Cherry-pick in progress';
          } catch {
            mode = 'none';
            inProgress = false;
            message = 'No merge in progress';
          }
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
    } catch (error) {
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
    try {
      const { stdout } = await this.execGit(workspacePath, [
        'diff',
        '--name-only',
        '--diff-filter=U',
      ]);
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  async mergeBranch(workspacePath: string, branchName: string): Promise<{ success: boolean; error?: string }> {
    const targetBranch = this.normalizeBranchName(branchName);
    if (!targetBranch) {
      return { success: false, error: 'Branch name cannot be empty' };
    }

    try {
      await this.execGit(workspacePath, ['merge', targetBranch]);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to merge branch'),
      };
    }
  }

  async abortCurrentOperation(workspacePath: string): Promise<{ success: boolean; error?: string }> {
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
    } catch (error) {
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
    } catch (error) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to stash changes'),
      };
    }
  }

  async listStashes(workspacePath: string): Promise<GitStashEntry[]> {
    try {
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
    } catch {
      return [];
    }
  }

  async applyStash(workspacePath: string, stashRef: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execGit(workspacePath, ['stash', 'apply', stashRef]);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to apply stash'),
      };
    }
  }

  async popStash(workspacePath: string, stashRef: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execGit(workspacePath, ['stash', 'pop', stashRef]);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to pop stash'),
      };
    }
  }

  async dropStash(workspacePath: string, stashRef: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execGit(workspacePath, ['stash', 'drop', stashRef]);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to drop stash'),
      };
    }
  }

  async clearStashes(workspacePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execGit(workspacePath, ['stash', 'clear']);
      return { success: true };
    } catch (error) {
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
    } catch (error) {
      const errorText = String((error as { stderr?: string; message?: string })?.stderr ?? (error as { message?: string })?.message ?? '');
      if (errorText.includes('does not have any commits yet') || errorText.includes('unknown revision')) {
        return [];
      }
      return [];
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
    } catch (error) {
      return {
        success: false,
        output: '',
        title: 'Diff',
        error: this.getGitErrorMessage(error, 'Failed to load diff'),
      };
    }
  }

  async getCommitPromptContext(workspacePath: string): Promise<{
    success: boolean;
    currentBranch: string | null;
    isDetached: boolean;
    changes: GitStatusEntry[];
    diffMode: 'staged' | 'working';
    diffSummary: string;
    error?: string;
  }> {
    const status = await this.getStatus(workspacePath);
    if (!status.success || !status.isRepo) {
      return {
        success: false,
        currentBranch: null,
        isDetached: false,
        changes: [],
        diffMode: 'working',
        diffSummary: '',
        error: status.error || 'Not a git repository',
      };
    }

    if (status.changes.length === 0) {
      return {
        success: false,
        currentBranch: status.currentBranch,
        isDetached: status.isDetached,
        changes: [],
        diffMode: 'working',
        diffSummary: '',
        error: 'No changes to summarize',
      };
    }

    const stagedChanges = status.changes.filter((change) => change.staged);
    const workingChanges = status.changes.filter((change) => !change.staged);
    const diffMode: 'staged' | 'working' = stagedChanges.length > 0 ? 'staged' : 'working';
    const diff = await this.getDiff(workspacePath, diffMode);
    const scopedChanges = diffMode === 'staged' ? stagedChanges : workingChanges;

    if (!diff.success) {
      return {
        success: false,
        currentBranch: status.currentBranch,
        isDetached: status.isDetached,
        changes: scopedChanges,
        diffMode,
        diffSummary: '',
        error: diff.error || 'Failed to load commit context',
      };
    }

    return {
      success: true,
      currentBranch: status.currentBranch,
      isDetached: status.isDetached,
      changes: scopedChanges,
      diffMode,
      diffSummary: diff.output.trim(),
    };
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
    } catch (error) {
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

  async createBranch(workspacePath: string, name: string, baseBranch?: string): Promise<{ success: boolean; error?: string }> {
    const branchName = this.normalizeBranchName(name);
    const base = baseBranch?.trim() || null;

    if (!branchName) {
      return { success: false, error: 'Branch name cannot be empty' };
    }

    try {
      await this.execGit(workspacePath, ['check-ref-format', '--branch', branchName]);
    } catch (error) {
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
    } catch (error) {
      if (this.isMissingSwitchCommand(error)) {
        try {
          const args = ['checkout', '-b', branchName];
          if (base) {
            args.push(base);
          }
          await this.execGit(workspacePath, args);
          return { success: true };
        } catch (fallbackError) {
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

  async switchBranch(workspacePath: string, name: string): Promise<{ success: boolean; error?: string }> {
    const branchName = this.normalizeBranchName(name);

    if (!branchName) {
      return { success: false, error: 'Branch name cannot be empty' };
    }

    try {
      await this.execGit(workspacePath, ['switch', branchName]);
      return { success: true };
    } catch (error) {
      if (this.isMissingSwitchCommand(error)) {
        try {
          await this.execGit(workspacePath, ['checkout', branchName]);
          return { success: true };
        } catch (fallbackError) {
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

  async deleteBranch(workspacePath: string, name: string): Promise<{ success: boolean; error?: string }> {
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
    } catch (error) {
      return {
        success: false,
        error: this.getGitErrorMessage(error, 'Failed to delete branch'),
      };
    }
  }

  async getStatus(workspacePath: string): Promise<GitStatusResult> {
    try {
      await this.execGit(workspacePath, ['rev-parse', '--git-dir']);
      const { stdout } = await this.execGit(workspacePath, ['status', '--porcelain']);
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
      return {
        success: false,
        isRepo: false,
        currentBranch: null,
        isDetached: false,
        changes: [],
      };
    }
  }

  async stage(workspacePath: string, files?: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      if (Array.isArray(files) && files.length === 0) {
        return { success: true };
      }
      const args = files && files.length > 0 ? ['add', '--', ...files] : ['add', '-A'];
      await this.execGit(workspacePath, args);
      return { success: true };
    } catch (error) {
      return { success: false, error: this.getGitErrorMessage(error, 'Failed to stage files') };
    }
  }

  async commit(workspacePath: string, message: string): Promise<{ success: boolean; error?: string }> {
    if (!message || message.trim().length === 0) {
      return { success: false, error: 'Commit message cannot be empty' };
    }

    try {
      await this.execGit(workspacePath, ['commit', '-m', message.trim()]);
      return { success: true };
    } catch (error) {
      const errorMsg = this.getGitErrorMessage(error, 'Failed to create commit');
      if (errorMsg.includes('nothing to commit')) {
        return { success: false, error: 'Nothing to commit' };
      }
      return { success: false, error: errorMsg };
    }
  }

  async isRepo(workspacePath: string): Promise<boolean> {
    try {
      await this.execGit(workspacePath, ['rev-parse', '--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  startPolling(workspacePath: string): void {
    this.stopPolling();
    this.currentWorkspacePath = workspacePath;
    void this.emitStatusUpdate(workspacePath);
    this.pollingInterval = setInterval(async () => {
      if (this.currentWorkspacePath) {
        await this.emitStatusUpdate(this.currentWorkspacePath);
      }
    }, this.pollIntervalMs);
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.currentWorkspacePath = null;
  }

  async refresh(): Promise<GitStatusResult | null> {
    if (!this.currentWorkspacePath) {
      return null;
    }
    return this.getStatus(this.currentWorkspacePath);
  }

  getCurrentWorkspace(): string | null {
    return this.currentWorkspacePath;
  }

  private async emitStatusUpdate(workspacePath: string): Promise<void> {
    this.emitStatus(await this.getStatus(workspacePath));
  }
}
