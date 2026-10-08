/** Local, workspace-owned background services. Never persisted as live processes. */
export interface DevServiceTarget { workspaceId: string; terminalId: string }
export interface DevServiceCommand {
  workspaceId: string;
  checkoutContextId: string;
  /** Registered root spelling, retained for descriptive context identity. */
  checkoutRoot: string;
  /** Canonical launch working directory (POSIX), including symlink resolution. */
  cwd: string;
  command: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  /** Advisory only; detection never installs dependencies or prevents a custom dev script. */
  preparationHint?: string;
  /** Main-owned configuration fingerprint; confirmed again before spawning. */
  settingsRevision?: string;
  /** Names only for launch presentation; values never enter runtime snapshots or diagnostics. */
  environmentKeys?: string[];
}
export interface DevServiceStartRequest extends DevServiceTarget {
  /** Confirm the command and checkout the user saw; main rediscovers both. */
  checkoutContextId: string;
  cwd: string;
  command: string;
  settingsRevision?: string;
}
export interface DevServiceSettingsRequest extends DevServiceStartRequest {
  /** Explicit non-secret project configuration, validated in main. */
  environment: Record<string, string>;
}
export interface WorkspaceService extends DevServiceCommand {
  id: string;
  sourceTerminalId: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  pid?: number;
  previewUrl?: string;
  exitCode?: number;
  /** Signal that ended the process, when it was killed rather than exiting (e.g. `SIGKILL`). */
  exitSignal?: string;
  /** Output matched a busy-port message and the service never became ready. Another process may own the port. */
  portConflict?: { port?: number };
  /**
   * Some processes started by this service could not be confirmed terminated. The service is still owned
   * (it blocks launches and checkout removal) and is reported as `failed`; Stop retries the cleanup.
   */
  cleanupIncomplete?: boolean;
  /** Failure output (bounded, control-stripped) preceded by Clanker's own diagnosis; also stop/cleanup errors. */
  error?: string;
}
/** Live = owns, or may still own, processes: starting/running/stopping, or a failure whose cleanup is unverified. */
export function isLiveWorkspaceService(service: WorkspaceService | undefined): boolean {
  return Boolean(service && (['starting', 'running', 'stopping'].includes(service.status) || service.cleanupIncomplete));
}
export interface WorkspaceServicesUpdate { revision: number; services: WorkspaceService[] }
export interface DevServiceDiscoveryResult { success: boolean; command?: DevServiceCommand; environment?: Record<string, string>; error?: string }
export interface WorkspaceServiceResult { success: boolean; service?: WorkspaceService; error?: string }
