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
}
export interface DevServiceStartRequest extends DevServiceTarget {
  /** Confirm the command and checkout the user saw; main rediscovers both. */
  checkoutContextId: string;
  cwd: string;
  command: string;
}
export interface WorkspaceService extends DevServiceCommand {
  id: string;
  sourceTerminalId: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  pid?: number;
  previewUrl?: string;
  exitCode?: number;
  error?: string;
}
export function isLiveWorkspaceService(service: WorkspaceService | undefined): boolean {
  return Boolean(service && ['starting', 'running', 'stopping'].includes(service.status));
}
export interface WorkspaceServicesUpdate { revision: number; services: WorkspaceService[] }
export interface DevServiceDiscoveryResult { success: boolean; command?: DevServiceCommand; error?: string }
export interface WorkspaceServiceResult { success: boolean; service?: WorkspaceService; error?: string }
