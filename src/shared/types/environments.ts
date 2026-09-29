/**
 * Workspace Environment Types
 *
 * Defines the first-class environment boundary for local and remote (SSH) workspaces.
 */

export type WorkspaceEnvironmentId = string;

export const LOCAL_ENVIRONMENT_ID: WorkspaceEnvironmentId = 'local';

export interface WorkspaceLocation {
  environmentId: WorkspaceEnvironmentId;
  path: string;
}

export interface SshEnvironmentConfig {
  id: string;
  kind: 'ssh';
  label: string;
  target: string;
}

export interface SshEnvironmentTestResult {
  success: boolean;
  error?: string;
}
