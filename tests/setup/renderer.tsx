import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

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

afterEach(() => {
  cleanup();
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
