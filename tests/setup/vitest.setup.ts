import { afterEach, vi } from 'vitest';
import { dropInheritedLaunchCredentials } from '../../src/main/environment/attentionEnvironment';

// An agent running this suite inside Clanker passes its live launch credentials down. Tests spawn
// wrappers, hooks and harness stubs; none of them may report to (or retire) that real agent.
dropInheritedLaunchCredentials(process.env);

// Mock @xterm/addon-clipboard for node (main process) tests
// This prevents ReferenceError: self is not defined when the addon
// is imported during module resolution.
vi.mock('@xterm/addon-clipboard', () => ({
  ClipboardAddon: class MockClipboardAddon {
    dispose = vi.fn();
  },
}));

if (typeof document !== 'undefined') {
  await import('./renderer.tsx');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
