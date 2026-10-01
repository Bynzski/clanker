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
