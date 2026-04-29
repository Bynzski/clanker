import { watch, type FSWatcher } from 'fs';
import { access } from 'fs/promises';
import type { BrowserWindow } from 'electron';
import { FILE_CHANGED, GIT_STATUS_UPDATE } from '../shared/ipcChannels';
import { toPosixPath } from '../shared/pathNormalize';
import { pathKey } from '../shared/pathKey';
import type { GitService } from './gitService';

interface FileWatcherDeps {
  getMainWindow: () => BrowserWindow | null;
}

const FILE_CHANGE_DEBOUNCE_MS = 200;
const GIT_STATUS_DEBOUNCE_MS = 500;
const SELF_WRITE_SUPPRESSION_MS = 500;
const REWATCH_BASE_DELAY_MS = 50;
const REWATCH_MAX_DELAY_MS = 5000;
const REWATCH_MAX_ATTEMPTS = 12;

export class FileWatcherService {
  private watchers = new Map<string, FSWatcher>();
  private recentlyWritten = new Map<string, number>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private rewatchTimers = new Map<string, NodeJS.Timeout>();
  private rewatchAttempts = new Map<string, number>();
  private gitStatusTimer: NodeJS.Timeout | null = null;
  private getMainWindow: () => BrowserWindow | null;
  private gitService: GitService | null = null;

  constructor(deps: FileWatcherDeps) {
    this.getMainWindow = deps.getMainWindow;
  }

  /** Inject the GitService for status refresh. Called once at startup. */
  setGitService(gitService: GitService): void {
    this.gitService = gitService;
  }

  /** Start watching a file path. No-op if already watching. */
  watchFile(filePath: string): void {
    const key = pathKey(filePath);
    if (this.watchers.has(key)) return;
    this.clearRewatch(filePath);

    try {
      const watcher = this.createWatcher(filePath);
      this.watchers.set(key, watcher);
    } catch {
      // File may not exist or be accessible; ignore
    }
  }

  /** Stop watching a specific file path. */
  unwatchFile(filePath: string): void {
    const key = pathKey(filePath);
    this.clearRewatch(filePath);

    const watcher = this.watchers.get(key);
    if (watcher) {
      watcher.close();
      this.watchers.delete(key);
    }

    const timer = this.debounceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(key);
    }
  }

  /**
   * Temporarily release an active watch handle for a file before a mutation.
   * Returns a re-acquire callback if a watcher existed.
   */
  releaseHandle(filePath: string): (() => void) | null {
    const watcher = this.watchers.get(pathKey(filePath));
    if (!watcher) {
      return null;
    }

    this.unwatchFile(filePath);
    return () => {
      this.watchFile(filePath);
    };
  }

  /** Stop all watchers. Called on window close / workspace switch. */
  unwatchAll(): void {
    for (const timer of this.rewatchTimers.values()) {
      clearTimeout(timer);
    }
    this.rewatchTimers.clear();
    this.rewatchAttempts.clear();

    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.gitStatusTimer) {
      clearTimeout(this.gitStatusTimer);
      this.gitStatusTimer = null;
    }
  }

  /** Mark a file as "we just wrote this" to suppress the resulting change event. */
  markWritten(filePath: string): void {
    this.recentlyWritten.set(pathKey(filePath), Date.now());
  }

  private clearRewatch(filePath: string): void {
    const key = pathKey(filePath);
    const timer = this.rewatchTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.rewatchTimers.delete(key);
    }
    this.rewatchAttempts.delete(key);
  }

  private createWatcher(filePath: string): FSWatcher {
    const key = pathKey(filePath);
    const watcher = watch(filePath, (eventType) => {
      if (eventType === 'change') {
        this.handleChange(filePath);
        return;
      }

      if (eventType === 'rename') {
        // Many editors (and our own write path) do atomic-save via rename.
        // On Linux/macOS, file watches can stick to the old inode, so resubscribe.
        this.handleRename(filePath);
      }
    });

    watcher.on('error', () => {
      // Errors can occur during atomic saves; keep trying to re-establish the watch
      // unless the renderer explicitly unwatched this path.
      if (this.watchers.get(key) === watcher) {
        this.watchers.delete(key);
        this.scheduleRewatch(filePath);
      }
    });

    watcher.on('close', () => {
      if (this.watchers.get(key) === watcher) {
        this.watchers.delete(key);
      }
    });

    return watcher;
  }

  private handleRename(filePath: string): void {
    this.handleChange(filePath);
    this.scheduleRewatch(filePath);
  }

  private scheduleRewatch(filePath: string): void {
    const key = pathKey(filePath);
    if (this.rewatchTimers.has(key)) return;

    // Ensure we're not stuck following a stale inode.
    const existing = this.watchers.get(key);
    if (existing) {
      try {
        existing.close();
      } catch {
        // ignore
      }
      this.watchers.delete(key);
    }

    const attempt = (this.rewatchAttempts.get(key) ?? 0) + 1;
    this.rewatchAttempts.set(key, attempt);

    if (attempt > REWATCH_MAX_ATTEMPTS) {
      this.rewatchAttempts.delete(key);
      return;
    }

    const delay = Math.min(REWATCH_BASE_DELAY_MS * (2 ** (attempt - 1)), REWATCH_MAX_DELAY_MS);
    const timer = setTimeout(() => {
      this.rewatchTimers.delete(key);

      // Renderer may have re-registered (or unregistered) in the meantime.
      if (this.watchers.has(key)) {
        this.clearRewatch(filePath);
        return;
      }

      try {
        const watcher = this.createWatcher(filePath);
        this.watchers.set(key, watcher);
        this.clearRewatch(filePath);
      } catch {
        this.scheduleRewatch(filePath);
      }
    }, delay);

    this.rewatchTimers.set(key, timer);
  }

  /** Internal: handle a raw change event from fs.watch. */
  private handleChange(filePath: string): void {
    // Capture time once so the suppression check and any later time comparisons
    // (e.g., via fake timers in tests) are consistent.
    const now = Date.now();
    const key = pathKey(filePath);
    const writtenTimestamp = this.recentlyWritten.get(key);
    if (writtenTimestamp !== undefined) {
      this.recentlyWritten.delete(key);
      if (now - writtenTimestamp < SELF_WRITE_SUPPRESSION_MS) {
        return;
      }
    }

    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.emitChange(filePath);
    }, FILE_CHANGE_DEBOUNCE_MS);

    this.debounceTimers.set(key, timer);
    this.scheduleGitStatusRefresh();
  }

  /** Internal: emit the FILE_CHANGED event to the renderer. */
  private async emitChange(filePath: string): Promise<void> {
    let deleted = false;

    try {
      await access(filePath);
    } catch {
      deleted = true;
    }

    const payload = { filePath: toPosixPath(filePath), deleted };
    const mainWindow = this.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(FILE_CHANGED, payload);
    }
  }

  /** Internal: schedule a debounced git status refresh. */
  private scheduleGitStatusRefresh(): void {
    if (this.gitStatusTimer) clearTimeout(this.gitStatusTimer);
    this.gitStatusTimer = setTimeout(() => {
      this.gitStatusTimer = null;
      void this.triggerGitStatusRefresh();
    }, GIT_STATUS_DEBOUNCE_MS);
  }

  /** Internal: run git status and emit the result. */
  private async triggerGitStatusRefresh(): Promise<void> {
    const workspacePath = this.gitService?.getCurrentWorkspace();
    if (!this.gitService || !workspacePath) return;
    try {
      const status = await this.gitService.getStatus(workspacePath);
      const mainWindow = this.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(GIT_STATUS_UPDATE, status);
      }
    } catch {
      // Non-fatal: git status failure must not break file watching
    }
  }
}
