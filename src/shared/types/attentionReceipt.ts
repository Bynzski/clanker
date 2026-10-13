/** Renderer diagnostics only. Never lifecycle authority or user acknowledgement. */
export interface AttentionReceipt {
  terminalId: string;
  receivedRevision: number;
  storedRevision: number | null;
  snapshotPresent: boolean;
  foreground: boolean;
  indicator: 'running' | 'needs_input' | 'turn_complete' | 'signal_unavailable' | 'signal_degraded' | 'failed' | 'none';
  merge: 'applied' | 'older' | 'equal' | 'tombstone';
}

/** IPC intake is a strict allowlist; no paths, arbitrary messages or credentials. */
export function parseAttentionReceipt(value: unknown): AttentionReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const keys = ['terminalId', 'receivedRevision', 'storedRevision', 'snapshotPresent', 'foreground', 'indicator', 'merge'];
  if (Object.keys(r).length !== keys.length || Object.keys(r).some(key => !keys.includes(key))
    || typeof r.terminalId !== 'string' || !/^[\w-]{1,128}$/.test(r.terminalId)
    || !Number.isSafeInteger(r.receivedRevision) || (r.receivedRevision as number) < 0
    || (r.storedRevision !== null && (!Number.isSafeInteger(r.storedRevision) || (r.storedRevision as number) < 0))
    || typeof r.snapshotPresent !== 'boolean' || typeof r.foreground !== 'boolean'
    || !['running', 'needs_input', 'turn_complete', 'signal_unavailable', 'signal_degraded', 'failed', 'none'].includes(r.indicator as string)
    || !['applied', 'older', 'equal', 'tombstone'].includes(r.merge as string)) return null;
  return r as unknown as AttentionReceipt;
}
