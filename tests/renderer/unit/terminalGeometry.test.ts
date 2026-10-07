// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeTerminalGeometry } from '../../../src/renderer/lib/terminalGeometry';

let callback: ResizeObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();

function fixture(width = 800, height = 600) {
  const container = document.createElement('div');
  document.body.append(container);
  Object.defineProperties(container, {
    clientWidth: { configurable: true, get: () => width },
    clientHeight: { configurable: true, get: () => height },
  });
  const fitAddon = { fit: vi.fn(), proposeDimensions: vi.fn().mockReturnValue({ cols: 90, rows: 30 }) };
  const resize = vi.fn().mockResolvedValue(undefined);
  const ready = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  const isAlive = vi.fn().mockReturnValue(true);
  const geometry = observeTerminalGeometry({ container, fitAddon, resize, ready, onError, isAlive });
  return {
    container, fitAddon, resize, ready, onError, geometry, isAlive,
    changeSize(w: number, h: number, cols = 90, rows = 30) {
      width = w; height = h;
      fitAddon.proposeDimensions.mockReturnValue({ cols, rows });
      callback([], {} as ResizeObserver);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: ResizeObserverCallback) { callback = cb; }
    observe = observe;
    disconnect = disconnect;
  });
});
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('terminal geometry lifecycle', () => {
  it('observes the outer container and resizes before releasing startup output', async () => {
    const f = fixture();
    expect(observe).toHaveBeenCalledWith(f.container);
    expect(f.resize).toHaveBeenCalledExactlyOnceWith(90, 30);
    expect(f.ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(f.ready).toHaveBeenCalledOnce();
    expect(f.resize).toHaveBeenCalledOnce();
    f.geometry.dispose();
  });

  it('refits a container-only resize and coalesces a continuous splitter drag to the latest size', async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(200);
    f.resize.mockClear();
    f.changeSize(600, 400, 70, 20);
    await vi.advanceTimersByTimeAsync(20);
    f.changeSize(500, 400, 60, 20);
    await vi.advanceTimersByTimeAsync(30);
    expect(f.resize).toHaveBeenCalledExactlyOnceWith(60, 20);
    f.changeSize(450, 400, 50, 20);
    await vi.advanceTimersByTimeAsync(50);
    f.changeSize(400, 400, 40, 20);
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.resize.mock.calls).toEqual([[60, 20], [50, 20], [40, 20]]);
    f.geometry.dispose();
  });

  it('does not overlap slow resize IPC or release output before the latest queued geometry', async () => {
    const f = fixture(0, 0);
    let finish!: () => void;
    f.resize.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    f.changeSize(600, 400, 70, 20);
    await vi.advanceTimersByTimeAsync(50);
    f.changeSize(400, 400, 40, 20);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.resize).toHaveBeenCalledOnce();
    expect(f.ready).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.resize.mock.calls).toEqual([[70, 20], [40, 20]]);
    expect(f.ready).toHaveBeenCalledOnce();
    f.geometry.dispose();
  });

  it('does not resize hidden panes, and retries when they become visible', async () => {
    const f = fixture(0, 0);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.fitAddon.fit).not.toHaveBeenCalled();
    expect(f.resize).not.toHaveBeenCalled();
    expect(f.ready).not.toHaveBeenCalled();
    f.changeSize(500, 400, 60, 20);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.resize).toHaveBeenCalledExactlyOnceWith(60, 20);
    expect(f.ready).toHaveBeenCalledOnce();
    f.changeSize(0, 0, 2, 1);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.resize).toHaveBeenCalledOnce();
    f.geometry.dispose();
  });

  it.each([{ cols: NaN, rows: 24 }, { cols: 80, rows: Infinity }, { cols: 0, rows: 0 }, { cols: 80.5, rows: 24 }, undefined])('rejects unmeasured/invalid dimensions %j', async (dimensions) => {
    const f = fixture(0, 0);
    f.changeSize(500, 400);
    f.fitAddon.proposeDimensions.mockReturnValue(dimensions);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.fitAddon.fit).not.toHaveBeenCalled();
    expect(f.resize).not.toHaveBeenCalled();
    expect(f.ready).not.toHaveBeenCalled();
    f.geometry.dispose();
  });

  it('uses the same sizing path for window changes and font zoom without duplicate IPC', async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(200);
    f.resize.mockClear();
    window.dispatchEvent(new Event('resize'));
    f.geometry.scheduleFit();
    await vi.advanceTimersByTimeAsync(200);
    expect(f.resize).not.toHaveBeenCalled();
    f.fitAddon.proposeDimensions.mockReturnValue({ cols: 70, rows: 25 });
    f.geometry.scheduleFit();
    await vi.advanceTimersByTimeAsync(200);
    expect(f.resize).toHaveBeenCalledExactlyOnceWith(70, 25);
    f.geometry.dispose();
  });

  it('cancels observers, pending fits/resizes and late readiness on teardown', async () => {
    const f = fixture(0, 0);
    let finish!: () => void;
    f.resize.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    f.changeSize(600, 400, 70, 20);
    await vi.advanceTimersByTimeAsync(50);
    f.changeSize(400, 400, 40, 20);
    f.geometry.dispose();
    finish();
    callback([], {} as ResizeObserver);
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(500);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(f.resize).toHaveBeenCalledOnce();
    expect(f.ready).not.toHaveBeenCalled();
  });

  it('does not refit a terminal explicitly disposed before its pane unmounts', async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(200);
    f.fitAddon.fit.mockClear(); f.resize.mockClear();
    f.isAlive.mockReturnValue(false);
    f.changeSize(400, 400, 40, 20);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.fitAddon.fit).not.toHaveBeenCalled();
    expect(f.resize).not.toHaveBeenCalled();
    f.geometry.dispose();
  });

  it('retries sizing after IPC failure without announcing readiness prematurely', async () => {
    const f = fixture(0, 0);
    f.resize.mockRejectedValueOnce(new Error('IPC failed'));
    f.changeSize(500, 400, 60, 20);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.onError).toHaveBeenCalledOnce();
    expect(f.ready).not.toHaveBeenCalled();
    f.geometry.scheduleFit();
    await vi.advanceTimersByTimeAsync(200);
    expect(f.resize).toHaveBeenCalledTimes(2);
    expect(f.ready).toHaveBeenCalledOnce();
    f.geometry.dispose();
  });
});
