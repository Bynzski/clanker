import { afterEach, vi } from 'vitest';

if (typeof document !== 'undefined') {
  await import('./renderer');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
