// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowserBoundsLifecycle } from '../../../src/renderer/components/useBrowserBoundsLifecycle';

/**
 * Sidebar navigation only changes DOM geometry. The browser keeps one bounds
 * path: measure the content element, send exactly that rect. No sidebar offset.
 */
const rendererRoot = resolve(__dirname, '../../../src/renderer');

class CapturingResizeObserver {
  static callbacks: Array<() => void> = [];
  constructor(cb: ResizeObserverCallback) { CapturingResizeObserver.callbacks.push(() => cb([], this as unknown as ResizeObserver)); }
  observe() {}
  unobserve() {}
  disconnect() {}
}

let rect = { left: 400, top: 120, width: 300, height: 500 };

function Harness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useBrowserBoundsLifecycle({
    workspaceId: 'ws', activeTabId: 'tab', browserVisible: true, browserOverlayCount: 0,
    isActiveWorkspace: true, layoutVersion: 0, containerRef, contentRef,
  });
  return (
    <div ref={containerRef}>
      <div ref={(el) => { (contentRef as { current: HTMLDivElement | null }).current = el; if (el) el.getBoundingClientRect = () => rect as DOMRect; }} />
    </div>
  );
}

describe('browser bounds vs sidebar layout', () => {
  const originalRO = global.ResizeObserver;
  const originalRaf = window.requestAnimationFrame;
  let setBounds: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rect = { left: 400, top: 120, width: 300, height: 500 };
    CapturingResizeObserver.callbacks = [];
    global.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 1; }) as typeof window.requestAnimationFrame;
    setBounds = vi.fn();
    window.electronAPI = {
      browserSetBounds: setBounds,
      browserActivate: vi.fn().mockResolvedValue(undefined),
      browserHide: vi.fn(),
      getWindowZoomFactor: () => 1,
    } as unknown as typeof window.electronAPI;
  });
  afterEach(() => { cleanup(); global.ResizeObserver = originalRO; window.requestAnimationFrame = originalRaf; });

  it('sends exactly the measured content rect and re-sends through ResizeObserver when layout shifts', () => {
    render(<Harness />);
    expect(setBounds).toHaveBeenLastCalledWith('ws', { x: 400, y: 120, width: 300, height: 500 }, 'tab');

    // A wider sidebar shifts/shrinks the content element; only the DOM rect changes.
    rect = { left: 480, top: 120, width: 220, height: 500 };
    act(() => { CapturingResizeObserver.callbacks.forEach((fire) => fire()); });
    expect(setBounds).toHaveBeenLastCalledWith('ws', { x: 480, y: 120, width: 220, height: 500 }, 'tab');
  });

  it('navigation modules contain no browser-bounds or geometry logic of their own', () => {
    for (const file of ['components/WorkspaceSidebar.tsx', 'components/WorkspaceNavigatorSection.tsx', 'components/WorkspaceHost.tsx', 'store/workspaceNavigationStore.ts']) {
      const source = readFileSync(resolve(rendererRoot, file), 'utf8');
      expect(source, file).not.toMatch(/browserSetBounds|getBoundingClientRect|ResizeObserver|browserBoundsFromDomRect/);
    }
  });
});
