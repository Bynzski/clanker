import { afterEach, vi } from 'vitest';

// Mock @xterm/addon-clipboard for node (main process) tests
// This prevents ReferenceError: self is not defined when the addon
// is imported during module resolution.
vi.mock('@xterm/addon-clipboard', () => ({
  ClipboardAddon: class MockClipboardAddon {
    dispose = vi.fn();
  },
}));

if (typeof document !== 'undefined') {
  await import('./renderer');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
