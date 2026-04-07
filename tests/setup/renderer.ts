import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

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
