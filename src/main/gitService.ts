import { execFile } from 'child_process';
import { promisify } from 'util';
import type { VcsProvider } from '../shared/types/vcs';

export interface GitStatusEntry {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitRemotesResult {
  success: boolean;
  remotes: GitRemote[];
  provider: VcsProvider;
  error?: string;
}

export type GitErrorCode = 'not-a-repo' | 'git-not-found' | 'unknown';

export interface GitStatusResult {
  success: boolean;
  isRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  changes: GitStatusEntry[];
  upstream: string | null;
  ahead: number;
  behind: number;
  errorCode?: GitErrorCode;
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

  private parseBranchHeaders(lines: string[]): {
    currentBranch: string | null;
    isDetached: boolean;
    upstream: string | null;
    ahead: number;
    behind: number;
  } {
    let currentBranch: string | null = null;
    let isDetached = false;
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;

    for (const line of lines) {
      if (line.startsWith('# branch.head ')) {
        const value = line.slice('# branch.head '.length).trim();
        if (value === '(detached)' || value.length === 0) {
          isDetached = true;
          currentBranch = null;
        } else {
          currentBranch = value;
          isDetached = false;
        }
      } else if (line.startsWith('# branch.upstream ')) {
        upstream = line.slice('# branch.upstream '.length).trim() || null;
      } else if (line.startsWith('# branch.ab ')) {
        const value = line.slice('# branch.ab '.length);
        const match = value.match(/^\+(\d+) -(\d+)$/);
        if (match) {
          ahead = parseInt(match[1], 10);
          behind = parseInt(match[2], 10);
        }
      }
    }

    return { currentBranch, isDetached, upstream, ahead, behind };
  }

  private parseStatusEntry(xy: string, path: string): GitStatusEntry {
    const indexStatus = xy[0];
    const worktreeStatus = xy[1];
    // In porcelain=v2, '.' means "not updated" (equivalent to ' ' in v1)
    const staged = indexStatus !== ' ' && indexStatus !== '.' && indexStatus !== '?';

    const statusChar = staged ? indexStatus : worktreeStatus;
    let status: GitStatusEntry['status'] = 'modified';

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
      case 'C':
        status = 'added';
        break;
      default:
        status = 'modified';
    }

    return { path, status, staged };
  }

  private parseGitStatusV2(output: string): GitStatusEntry[] {
    const changes: GitStatusEntry[] = [];
    const lines = output.split('\n').filter(Boolean);

    for (const line of lines) {
      // Skip header lines (start with #)
      if (line.startsWith('# ')) continue;

      if (line.startsWith('1 ')) {
        // Ordinary entry: 1 XY SUB MH MI MW HH HI PATH
        const parts = line.split(' ');
        if (parts.length < 9) continue;
        const xy = parts[1];
        const path = parts.slice(8).join(' ');
        changes.push(this.parseStatusEntry(xy, path));
      } else if (line.startsWith('2 ')) {
        // Rename/copy entry: 2 XY SUB MH MI MW HH HI SCORE PATH<TAB>ORIG
        const parts = line.split(' ');
        if (parts.length < 10) continue;
        const xy = parts[1];
        const pathOrig = parts.slice(9).join(' ');
        const tabIndex = pathOrig.indexOf('\t');
        const path = tabIndex >= 0 ? pathOrig.slice(0, tabIndex) : pathOrig;
        changes.push(this.parseStatusEntry(xy, path));
      } else if (line.startsWith('? ')) {
        // Untracked: ? PATH
        changes.push({ path: line.slice(2), status: 'untracked', staged: false });
      }
      // Ignore '!' (ignored files) and unknown formats
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

  private classifyError(error: unknown): GitErrorCode {
    const message = String(
      (error as { message?: string })?.message ?? ''
    );
    const stderr = String(
      (error as { stderr?: string })?.stderr ?? ''
    );
    const code = (error as { code?: string })?.code;

    if (code === 'ENOENT') {
      return 'git-not-found';
    }

    const combined = `${message} ${stderr}`.toLowerCase();
    if (
      combined.includes('not a git repository') ||
      combined.includes('not a git repo')
    ) {
      return 'not-a-repo';
    }

    return 'unknown';
  }

  async getStatus(workspacePath: string): Promise<GitStatusResult> {
    try {
      await this.execGit(workspacePath, ['rev-parse', '--git-dir']);
      const { stdout } = await this.execGit(workspacePath, ['status', '--porcelain=v2', '--branch']);

      const headerLines = stdout.split('\n').filter((l) => l.startsWith('# '));
      const { currentBranch, isDetached, upstream, ahead, behind } = this.parseBranchHeaders(headerLines);
      const changes = this.parseGitStatusV2(stdout);

      return {
        success: true,
        isRepo: true,
        currentBranch,
        isDetached,
        changes,
        upstream,
        ahead,
        behind,
      };
    } catch (error) {
      const errorCode = this.classifyError(error);
      return {
        success: false,
        isRepo: false,
        currentBranch: null,
        isDetached: false,
        changes: [],
        upstream: null,
        ahead: 0,
        behind: 0,
        errorCode,
        error: this.getGitErrorMessage(error, 'Failed to get git status'),
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

  async unstage(workspacePath: string, files?: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      const args = files && files.length > 0
        ? ['restore', '--staged', '--', ...files]
        : ['restore', '--staged', '.'];
      await this.execGit(workspacePath, args);
      return { success: true };
    } catch {
      // Try fallback with git reset HEAD for older git versions
      try {
        const args = files && files.length > 0
          ? ['reset', 'HEAD', '--', ...files]
          : ['reset', 'HEAD'];
        await this.execGit(workspacePath, args);
        return { success: true };
      } catch (fallbackError) {
        return {
          success: false,
          error: this.getGitErrorMessage(fallbackError, 'Failed to unstage files'),
        };
      }
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

  /**
   * Execute a git command that talks to a remote. Uses a longer timeout (60s)
   * since network operations can take significantly longer than local git ops.
   */
  private async execGitRemote(
    workspacePath: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string }> {
    const execFileAsync = promisify(execFile);
    return execFileAsync('git', args, {
      cwd: workspacePath,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    }) as Promise<{ stdout: string; stderr: string }>;
  }

  async fetch(workspacePath: string, remote?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const args = ['fetch'];
      if (remote) {
        args.push(remote);
      }
      args.push('--prune');
      await this.execGitRemote(workspacePath, args);
      return { success: true };
    } catch (error) {
      return { success: false, error: this.getGitErrorMessage(error, 'Failed to fetch') };
    }
  }

  async pull(
    workspacePath: string,
    rebase?: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const args = ['pull'];
      if (rebase !== undefined) {
        args.push(rebase ? '--rebase' : '--no-rebase');
      }
      await this.execGitRemote(workspacePath, args);
      return { success: true };
    } catch (error) {
      const msg = this.getGitErrorMessage(error, 'Failed to pull');
      // Detect conflict scenarios
      const lower = msg.toLowerCase();
      if (
        lower.includes('merge conflict') ||
        lower.includes('fix conflicts') ||
        lower.includes('not possible to merge')
      ) {
        return { success: false, error: `Pull failed: ${msg}` };
      }
      return { success: false, error: msg };
    }
  }

  async push(
    workspacePath: string,
    remote?: string,
    branch?: string,
    forceWithLease = false
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const args = ['push'];
      if (remote) {
        args.push(remote);
      }
      if (branch) {
        args.push(branch);
      }
      if (forceWithLease) {
        args.push('--force-with-lease');
      }
      await this.execGitRemote(workspacePath, args);
      return { success: true };
    } catch (error) {
      const msg = this.getGitErrorMessage(error, 'Failed to push');
      // Provide actionable hints for common errors
      const lower = msg.toLowerCase();
      if (lower.includes('rejected')) {
        return {
          success: false,
          error: `Push rejected — fetch and merge or rebase first. Run "Fetch & Pull" to update.`,
        };
      }
      if (lower.includes('no upstream configured') || lower.includes('no tracking information')) {
        return {
          success: false,
          error: `No upstream branch. Use "Push with upstream" to set one.`,
        };
      }
      if (lower.includes('permission denied') || lower.includes('authentication failed')) {
        return {
          success: false,
          error: `Authentication failed. Check your git credentials for this remote.`,
        };
      }
      return { success: false, error: msg };
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

  // Exposed for unit testing
  detectProvider(remoteUrl: string): VcsProvider {
    try {
      // Handle SSH URLs: git@github.com:owner/repo.git
      const sshMatch = remoteUrl.match(/^git@([^:]+):/);
      if (sshMatch) {
        const host = sshMatch[1];
        if (host === 'github.com') return 'github';
        if (host === 'bitbucket.org') return 'bitbucket';
        if (host === 'gitlab.com') return 'gitlab';
        return 'unknown';
      }

      // Handle HTTPS/HTTP URLs: https://github.com/owner/repo.git
      const url = new URL(remoteUrl);
      const host = url.hostname;
      if (host === 'github.com') return 'github';
      if (host === 'bitbucket.org') return 'bitbucket';
      if (host === 'gitlab.com') return 'gitlab';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async getRemotes(workspacePath: string): Promise<GitRemotesResult> {
    try {
      const { stdout } = await this.execGit(workspacePath, ['remote', '-v']);
      const lines = stdout.trim().split('\n').filter(Boolean);
      const remoteMap = new Map<string, { fetchUrl: string; pushUrl: string }>();

      for (const line of lines) {
        // Format: <name>\t<url> (<fetch|push>)
        const tabMatch = line.match(/^([^\t]+)\t([^\s]+)\s+\((fetch|push)\)$/);
        if (tabMatch) {
          const [, name, url, type] = tabMatch;
          const entry = remoteMap.get(name) ?? { fetchUrl: '', pushUrl: '' };
          if (type === 'fetch') {
            entry.fetchUrl = url;
          } else {
            entry.pushUrl = url;
          }
          remoteMap.set(name, entry);
        }
      }

      const remotes: GitRemote[] = Array.from(remoteMap.entries()).map(
        ([name, { fetchUrl, pushUrl }]) => ({
          name,
          fetchUrl,
          pushUrl,
        })
      );

      // Provider is determined by the first remote's fetch URL
      let provider: VcsProvider = 'unknown';
      if (remotes.length > 0 && remotes[0].fetchUrl) {
        provider = this.detectProvider(remotes[0].fetchUrl);
      }

      return { success: true, remotes, provider };
    } catch (error) {
      return {
        success: false,
        remotes: [],
        provider: 'unknown',
        error: this.getGitErrorMessage(error, 'Failed to get remotes'),
      };
    }
  }
}
