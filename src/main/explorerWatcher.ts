/**
 * Explorer Watcher Service
 *
 * Watches the active workspace tree using chokidar for filesystem changes.
 * Separate from FileWatcherService which watches individual open editor documents.
 *
 * On `add` / `addDir` / `unlink` / `unlinkDir` events inside the watched workspace:
 * - Batches EXPLORER_TREE_CHANGED notifications by parent directory before refreshing
 * - Schedules a debounced git status refresh via the existing GIT_STATUS_UPDATE pipeline
 *
 * Lifecycle: owned in main process, started/stopped on workspace open/close/switch.
 * Only the active workspace is watched at any given time.
 */

import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';
import type { BrowserWindow } from 'electron';
import { EXPLORER_TREE_CHANGED, GIT_STATUS_UPDATE } from '../shared/ipcChannels';
import { toPosixPath } from '../shared/pathNormalize';
import { isUncPath } from '../shared/pathClassify';
import type { GitService } from './gitService';

interface ExplorerWatcherDeps {
  /** Returns the current main window, or null if destroyed. */
  getMainWindow: () => BrowserWindow | null;
  /** Returns the currently active workspace path, or null if no workspace is open. */
  getCurrentWorkspace: () => string | null;
}

/**
 * Debounce delay before refreshing git status after filesystem changes.
 * Matches the existing FileWatcherService GIT_STATUS_DEBOUNCE_MS.
 */
const GIT_STATUS_DEBOUNCE_MS = 500;

/**
 * Debounce delay for explorer tree refresh batches.
 * Coalesces bursty filesystem events into a single renderer update pass.
 */
const EXPLORER_TREE_DEBOUNCE_MS = 100;
const UNLINK_ADD_COLLAPSE_MS = 300;

export function shouldUsePollingForWorkspace(
  workspacePath: string,
  platform: NodeJS.Platform = process.platform,
  forcePolling: boolean = process.env.CLANKER_GRID_WATCHER_POLLING === '1'
): boolean {
  return platform === 'win32' && (forcePolling || isUncPath(toPosixPath(workspacePath)));
}

/** Default patterns to ignore — these directories generate noise without useful events. */
const DEFAULT_IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.cache/**',
  '**/.turbo/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '.DS_Store',
];

/**
 * Default glob patterns for dotfiles that should be ignored.
 * Matches chokidar dot option: hidden files in root are ignored, but sub-dotdirs
 * like `.git/` are covered by explicit patterns above.
 */
const DOTFILE_GLOB = /(^|[/\\])\../;

/**
 * Map a filesystem path (often a "real" resolved path) back into the workspace's
 * presentation path (the path the user opened, which may be a symlink).
 *
 * This keeps renderer cache keys stable because the File Explorer keys entries
 * by the "workspace path" it was opened with, while chokidar may emit resolved
 * realpaths depending on platform/event source.
 */
export function mapToWorkspacePresentationPath(args: {
  workspacePath: string;
  workspaceRealPath: string;
  candidatePath: string;
}): string | null {
  const workspacePath = path.resolve(args.workspacePath);
  const workspaceRealPath = path.resolve(args.workspaceRealPath);
  const candidateResolved = path.resolve(args.candidatePath);

  // Best-effort: if the candidate exists, prefer realpath to normalize.
  let candidateReal = candidateResolved;
  try {
    candidateReal = fs.realpathSync(candidateResolved);
  } catch {
    // Ignore: candidate may have been deleted between event and mapping.
  }

  const rel = path.relative(workspaceRealPath, candidateReal);
  if (rel === '') {
    return workspacePath;
  }

  // Reject anything outside the workspace root.
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }

  return path.join(workspacePath, rel);
}

export class ExplorerWatcherService {
  private watcher: chokidar.FSWatcher | null = null;
  private workspacePath: string | null = null;
  private workspaceRealPath: string | null = null;
  private pendingExplorerDirectories = new Set<string>();
  private explorerTreeTimer: NodeJS.Timeout | null = null;
  private gitStatusTimer: NodeJS.Timeout | null = null;
  private pendingUnlinkPaths = new Map<string, NodeJS.Timeout>();
  private getMainWindow: () => BrowserWindow | null;
  private getCurrentWorkspace: () => string | null;
  private gitService: GitService | null = null;

  constructor(deps: ExplorerWatcherDeps) {
    this.getMainWindow = deps.getMainWindow;
    this.getCurrentWorkspace = deps.getCurrentWorkspace;
  }

  /**
   * Inject the GitService for status refresh. Called once at startup alongside
   * FileWatcherService.setGitService().
   */
  setGitService(gitService: GitService): void {
    this.gitService = gitService;
  }

  /**
   * Start watching a workspace directory tree.
   * Idempotent: calling while already watching the same path is a no-op.
   * Calling with a different path first calls close() on the existing watcher.
   *
   * @param workspacePath Absolute path to the workspace root
   */
  watchWorkspace(workspacePath: string): void {
    if (this.workspacePath === workspacePath && this.watcher !== null) {
      // Already watching this exact path — no-op
      return;
    }

    // Different workspace or no active watcher — close the old one first
    this.closeInternal();

    this.workspacePath = workspacePath;
    try {
      this.workspaceRealPath = fs.realpathSync(path.resolve(workspacePath));
    } catch {
      this.workspaceRealPath = path.resolve(workspacePath);
    }

    this.watcher = chokidar.watch(workspacePath, {
      ignored: [...DEFAULT_IGNORED, DOTFILE_GLOB],
      ignoreInitial: true,
      persistent: true,
      usePolling: shouldUsePollingForWorkspace(workspacePath),
      // Depth: undefined = unlimited (ignored paths prevent noisy dirs)
      depth: undefined,
      // Suppress unlink events for directories whose children are ignored
      // This prevents stale unlinkDir events when node_modules is deleted
      awaitWriteFinish: {
        stabilityThreshold: process.platform === 'win32' ? 200 : 100,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', (filePath) => this.handleEvent('add', filePath));
    this.watcher.on('addDir', (dirPath) => this.handleEvent('addDir', dirPath));
    this.watcher.on('unlink', (filePath) => this.handleEvent('unlink', filePath));
    this.watcher.on('unlinkDir', (dirPath) => this.handleEvent('unlinkDir', dirPath));

    this.watcher.on('error', (err) => {
      console.error('[ExplorerWatcher] watcher error:', err);
      // Non-fatal: the watcher may recover or the workspace may be closed.
      // Keep it alive unless the workspace is no longer current.
      if (this.workspacePath !== this.getCurrentWorkspace()) {
        this.closeInternal();
      }
    });
  }

  /**
   * Stop watching and release all resources.
   * Safe to call when not watching — subsequent calls are no-ops.
   */
  close(): void {
    this.closeInternal();
  }

  /** Internal close without resetting workspacePath (used by watchWorkspace for re-watch). */
  private closeInternal(): void {
    if (this.explorerTreeTimer !== null) {
      clearTimeout(this.explorerTreeTimer);
      this.explorerTreeTimer = null;
    }
    this.pendingExplorerDirectories.clear();

    if (this.gitStatusTimer !== null) {
      clearTimeout(this.gitStatusTimer);
      this.gitStatusTimer = null;
    }

    for (const timer of this.pendingUnlinkPaths.values()) {
      clearTimeout(timer);
    }
    this.pendingUnlinkPaths.clear();

    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }

    this.workspacePath = null;
    this.workspaceRealPath = null;
  }

  /**
   * Handle a filesystem event by determining the parent directory and emitting
   * the EXPLORER_TREE_CHANGED event to the renderer.
   */
  private handleEvent(
    eventType: 'add' | 'addDir' | 'unlink' | 'unlinkDir',
    targetPath: string
  ): void {
    if (eventType === 'unlink') {
      const existing = this.pendingUnlinkPaths.get(targetPath);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(() => {
        this.pendingUnlinkPaths.delete(targetPath);
        this.queuePathChange(targetPath);
      }, UNLINK_ADD_COLLAPSE_MS);

      this.pendingUnlinkPaths.set(targetPath, timer);
      return;
    }

    if (eventType === 'add') {
      const pendingUnlink = this.pendingUnlinkPaths.get(targetPath);
      if (pendingUnlink) {
        clearTimeout(pendingUnlink);
        this.pendingUnlinkPaths.delete(targetPath);
      }
    }

    this.queuePathChange(targetPath);
  }

  private queuePathChange(targetPath: string): void {
    const rawParentDir = path.dirname(targetPath);
    const workspacePath = this.workspacePath;
    const workspaceRealPath = this.workspaceRealPath;
    const parentDir = workspacePath && workspaceRealPath
      ? mapToWorkspacePresentationPath({
          workspacePath,
          workspaceRealPath,
          candidatePath: rawParentDir,
        }) ?? rawParentDir
      : rawParentDir;
    const posixParentDir = toPosixPath(parentDir);

    const mainWindow = this.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      this.pendingExplorerDirectories.add(posixParentDir);
      this.scheduleExplorerTreeRefresh();
    }

    this.scheduleGitStatusRefresh();
  }

  /**
   * Schedule a debounced batch of explorer refresh events.
   * Multiple filesystem events can target the same directory, so we coalesce
   * them before notifying the renderer.
   */
  private scheduleExplorerTreeRefresh(): void {
    if (this.explorerTreeTimer !== null) {
      clearTimeout(this.explorerTreeTimer);
    }

    this.explorerTreeTimer = setTimeout(() => {
      this.explorerTreeTimer = null;

      const mainWindow = this.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        this.pendingExplorerDirectories.clear();
        return;
      }

      const directories = Array.from(this.pendingExplorerDirectories);
      this.pendingExplorerDirectories.clear();
      for (const directoryPath of directories) {
        mainWindow.webContents.send(EXPLORER_TREE_CHANGED, { directoryPath });
      }
    }, EXPLORER_TREE_DEBOUNCE_MS);
  }

  /**
   * Schedule a debounced git status refresh.
   * Multiple rapid filesystem events coalesce into a single git status call.
   */
  private scheduleGitStatusRefresh(): void {
    if (this.gitStatusTimer !== null) {
      clearTimeout(this.gitStatusTimer);
    }

    this.gitStatusTimer = setTimeout(() => {
      this.gitStatusTimer = null;
      this.triggerGitStatusRefresh();
    }, GIT_STATUS_DEBOUNCE_MS);
  }

  /**
   * Trigger a git status refresh and emit the result via GIT_STATUS_UPDATE.
   * Non-fatal: failures are logged and do not affect file watching.
   */
  private async triggerGitStatusRefresh(): Promise<void> {
    const workspacePath = this.gitService?.getCurrentWorkspace();
    if (!this.gitService || !workspacePath) {
      return;
    }

    // Only refresh if this workspace is still the active one
    if (workspacePath !== this.workspacePath) {
      return;
    }

    try {
      const status = await this.gitService.getStatus(workspacePath);
      const mainWindow = this.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(GIT_STATUS_UPDATE, status);
      }
    } catch (err) {
      // Non-fatal: git status failure must not break file watching
      console.error('[ExplorerWatcher] git status refresh failed:', err);
    }
  }
}
