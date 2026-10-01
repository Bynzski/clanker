export interface RemotePreviewRequest {
  workspaceId: string;
  remotePort: number;
  localPort: number;
}
export interface RemotePreviewState extends RemotePreviewRequest {
  status: 'starting' | 'active' | 'stopping' | 'error';
  url: string;
  error?: string;
}
export interface RemotePreviewResult {
  success: boolean;
  forward: RemotePreviewState | null;
  error?: string;
}
export interface RemotePreviewUpdate {
  workspaceId: string;
  forward: RemotePreviewState | null;
}
export function isPreviewPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535;
}

/** Discovered service identity is independent of any desktop forward. */
export interface RemoteWebService {
  remoteHost: '127.0.0.1' | '::1';
  remotePort: number;
  protocol: 'http' | 'https';
  pid?: number;
  processName?: string;
  cwd?: string;
  source: 'listener' | 'fallback' | 'terminal-output';
  confidence?: 'workspace' | 'unscoped';
}
