import { HarnessCapabilityError } from './types';
import type { HarnessLocalAttention, LocalAttentionContext, AttentionLaunchOptions } from './types';

export function hookNodeExecutable(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'node.exe' : 'node';
}

export function localAttention(
  options: (context: LocalAttentionContext) => AttentionLaunchOptions | null,
  acquire?: (context: LocalAttentionContext) => () => void,
): HarnessLocalAttention {
  return {
    options,
    plan(context) {
      const launch = options(context);
      return launch ? { status: 'ready', options: launch }
        : { status: 'blocked', failure: new HarnessCapabilityError('not-configured', 'Attention injection conflicts with user configuration') };
    },
    prepare(context) {
      const launch = options(context);
      if (!launch) return null;
      // Acquire owns rollback on partial failure, before a lease is returned.
      const release = acquire?.(context);
      let disposed = false;
      return { ...launch, dispose() {
        if (disposed) return;
        release?.();
        disposed = true;
      } };
    },
  };
}

/** Cleanup must not mask a failed launch or prevent broker retirement. */
export function disposeAttentionSafely(prepared: { dispose(): void } | null): void {
  try { prepared?.dispose(); } catch (error) {
    console.error('[clanker-grid] attention cleanup failed:', error);
  }
}
