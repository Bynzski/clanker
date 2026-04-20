import { vi } from 'vitest';

// Mock @xterm/addon-clipboard for main process tests
// This prevents ReferenceError: self is not defined when the addon
// is imported during module resolution (e.g., via workspaceLifecycle -> TerminalPane)
vi.mock('@xterm/addon-clipboard', () => ({
  ClipboardAddon: class MockClipboardAddon {
    dispose = vi.fn();
  },
}));