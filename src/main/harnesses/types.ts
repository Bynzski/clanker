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
