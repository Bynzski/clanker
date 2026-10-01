import type { HarnessSession } from '../../shared/types/session';
import type { HarnessId } from '../../shared/harnessIds';

/** Serializable identity. React icons remain in the renderer catalog. */
export interface HarnessDescriptor {
  readonly id: HarnessId;
  readonly name: string;
  readonly iconKey: HarnessId;
  readonly legacyIcon: string;
}

/** CLI identity only; PTYs, wrappers, shells and transports remain shared. */
export interface HarnessLaunchCapability {
  readonly command: string;
  readonly args: string[];
  readonly modelArg: string;
  readonly env?: Record<string, string>;
  readonly modelArgs?: (model: string) => string[] | undefined;
  readonly localEnvironment?: (flags?: string) => Record<string, string>;
}

export interface HarnessProvider {
  readonly descriptor: HarnessDescriptor;
  readonly launch: HarnessLaunchCapability;
  readonly models?: HarnessModelsCapability;
  readonly sessions?: HarnessSessionsCapability;
}

export type CapabilitySupport = 'native' | 'emulated';
export type HarnessFailureKind = 'unsupported' | 'binary-unavailable' | 'not-configured'
  | 'command-failed' | 'timeout' | 'parse-failure' | 'storage-changed' | 'transport-failure';

/** Compatibility surfaces may hide failures; providers retain the cause. */
export class HarnessCapabilityError extends Error {
  constructor(readonly kind: HarnessFailureKind, message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'HarnessCapabilityError';
  }
}

export interface ModelOption { id: string; label: string }
export interface HarnessModelsCapability {
  discover(refresh?: boolean): Promise<ModelOption[]>;
  readonly fallback?: ModelOption[];
  readonly explicitRefresh?: boolean;
}

export function classifyHarnessFailure(error: unknown): HarnessCapabilityError {
  if (error instanceof HarnessCapabilityError) return error;
  const details = error as { code?: string; killed?: boolean } | null;
  const kind = details?.code === 'ENOENT' ? 'binary-unavailable'
    : details?.killed || (error instanceof Error && /timed out|timeout/i.test(error.message)) ? 'timeout'
    : 'command-failed';
  return new HarnessCapabilityError(kind, error instanceof Error ? error.message : String(error), error);
}

export interface HarnessSessionsCapability {
  discover(workspacePath: string): Promise<HarnessSession[]>;
  readonly resume?: HarnessSessionOperation;
  readonly fork?: HarnessSessionOperation;
  readonly remote?: HarnessRemoteSessions;
  readonly selectionFlags?: readonly string[];

}

export interface HarnessSessionOperation {
  readonly support: CapabilitySupport;
  /** Omission means both transports. Agy's emulated fork is local only. */
  readonly transports?: readonly ('local' | 'ssh')[];
  build(session: HarnessSession, userFlags?: string): { command: string; args: string[] };
}

export interface HarnessRemoteSessions {
  /** Body of scan(harness), using the transport's bounded read/emit helpers. */
  readonly scan: string;
  readonly command?: { command: string; args: string[] };
  readonly fileStore?: string;
}
