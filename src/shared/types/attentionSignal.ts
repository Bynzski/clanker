import type { AttentionVerdict } from '../attentionProtocol';
import type { AgentRuntimeStatus } from './agentAttention';

/** Acquisition facts, not lifecycle authority. Prepared never means verified upstream execution. */
export interface NativeAttentionCapability {
  requested: boolean;
  attachment: 'disabled' | 'unavailable' | 'prepared';
  reason?: 'unsupported' | 'configuration-conflict' | 'preparation-failed' | 'transport-unavailable';
}
export interface AttentionSignal extends Omit<NativeAttentionCapability, 'reason'> {
  health: 'unverified' | 'observed' | 'degraded' | 'lost';
  /** Fixed vocabulary only; no upstream error text. */
  reason?: NativeAttentionCapability['reason'] | HookDiagnostic | 'identity-rejected' | 'directory-removed' | 'envelope-invalid';
}
export const HOOK_DIAGNOSTICS = [
  'input-oversized', 'input-malformed', 'input-timeout', 'interpreter-unavailable', 'interpreter-failed',
  'settlement-unverified', 'no-event', 'resolution-suppressed', 'state-unreadable', 'state-unwritable', 'lock-unavailable',
] as const;
export type HookDiagnostic = typeof HOOK_DIAGNOSTICS[number];

/** Developer-only safe projection of broker.explain(); no session IDs, cwd, tokens or payloads. */
export interface AttentionSignalDiagnostics {
  terminalId: string;
  harness: string;
  transport: 'local' | 'remote';
  signal: AttentionSignal | null;
  revision: number;
  status: AgentRuntimeStatus;
  received: number;
  verdicts: Partial<Record<AttentionVerdict, number>>;
  hooks: Partial<Record<HookDiagnostic, number>>;
  lastVerdict?: AttentionVerdict;
  lastNativeEvent?: string;
}

/** Hook JSON only; canonical lifecycle envelopes remain bounded to 2 KiB. */
export const MAX_NATIVE_HOOK_BYTES = 8 * 1024 * 1024;
