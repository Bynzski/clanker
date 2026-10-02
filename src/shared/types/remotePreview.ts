export interface RemotePreviewRequest {
  workspaceId: string;
  remotePort: number;
  /** Legacy input is ignored; desktop allocation is always main-owned. */
  localPort?: number;
  remoteHost?: '127.0.0.1' | '::1';
  protocol?: 'http' | 'https';
}
export interface RemotePreviewState extends RemotePreviewRequest {
  localPort: number;
  serviceId?: string;
  status: 'starting' | 'waiting' | 'active' | 'stopping' | 'error';
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
  forwards?: RemotePreviewState[];
  services?: RemoteWebService[];
  error?: string;
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
