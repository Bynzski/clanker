import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { setTimeout as waitForUnmountCallbacks } from 'node:timers/promises';

// Mock ResizeObserver for components that use it (TerminalPane, BrowserPanel)
class ResizeObserverMock {
  private callback: ResizeObserverCallback;
  private element: Element | null = null;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    this.element = element;
  }

  unobserve() {
    this.element = null;
  }

  disconnect() {
    this.element = null;
  }

  // Helper for tests to trigger resize
  triggerResize(entries?: ResizeObserverEntry[]) {
    if (this.element && this.callback) {
      const defaultEntry: ResizeObserverEntry = {
        target: this.element,
        contentRect: new DOMRectReadOnly(0, 0, 800, 600),
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      };
      this.callback(entries ?? [defaultEntry], this);
    }
  }
}

global.ResizeObserver = ResizeObserverMock;

afterEach(async () => {
  cleanup();
  // Radix FocusScope defers unmount focus restoration with setTimeout(0). Finish it
  // in this jsdom realm, before Vitest replaces globals for the next test file.
  // Use a real timer even when the test uses fake timers; do not run its future work.
  await waitForUnmountCallbacks(0);
});

vi.mock('../../src/renderer/assets/harness-logos/codex.svg', () => ({
  default: 'codex-logo.svg',
}));
vi.mock('../../src/renderer/assets/harness-logos/claude.svg', () => ({
  default: 'claude-logo.svg',
}));
vi.mock('../../src/renderer/assets/harness-logos/opencode.svg', () => ({
  default: 'opencode-logo.svg',
}));
vi.mock('../../src/renderer/assets/harness-logos/pi.svg', () => ({
  default: 'pi-logo.svg',
}));
vi.mock('../../src/renderer/assets/harness-logos/omp.svg', () => ({
  default: 'omp-logo.svg',
}));
vi.mock('../../src/renderer/assets/harness-logos/hermes.svg', () => ({
  default: 'hermes-logo.svg',
}));
vi.mock('../../src/renderer/assets/harness-logos/agy.svg', () => ({
  default: 'agy-logo.svg',
}));
