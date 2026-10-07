import type { FitAddon } from '@xterm/addon-fit';

interface Dimensions { cols: number; rows: number }

interface Options {
  container: HTMLElement;
  fitAddon: Pick<FitAddon, 'fit' | 'proposeDimensions'>;
  resize: (cols: number, rows: number) => Promise<unknown>;
  ready: () => Promise<unknown>;
  onError: (error: unknown) => void;
  isAlive?: () => boolean;
  onDimensions?: (dimensions: Dimensions) => void;
}

/** One sizing path for mount, reattachment, container/window changes and font zoom. */
export function observeTerminalGeometry({ container, fitAddon, resize, ready, onError, isAlive = () => true, onDimensions }: Options) {
  let disposed = false;
  let fitTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let lastSent: Dimensions | undefined;
  let pending: Dimensions | undefined;
  let notifiedReady = false;
  const same = (a: Dimensions | undefined, b: Dimensions) => a?.cols === b.cols && a.rows === b.rows;
  const visible = () => isAlive() && container.isConnected && container.clientWidth > 0 && container.clientHeight > 0;

  const notifyReady = () => {
    if (disposed || notifiedReady || pending || !visible()) return;
    notifiedReady = true;
    void ready().catch((error: unknown) => {
      if (!disposed) { notifiedReady = false; onError(error); }
    });
  };

  const flushResize = () => {
    if (disposed || inFlight || resizeTimer !== undefined || !pending) return;
    if (!visible()) { pending = undefined; return; }
    const dimensions = pending;
    pending = undefined;
    if (same(lastSent, dimensions)) { notifyReady(); return; }
    inFlight = true;
    // Keep a 100ms coalescing window, and never overlap asynchronous IPC calls.
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      flushResize();
    }, 100);
    void resize(dimensions.cols, dimensions.rows).then(() => {
      if (disposed) return;
      lastSent = dimensions;
      // A later fit may have queued exactly the dimensions just confirmed.
      if (pending && same(lastSent, pending)) pending = undefined;
      notifyReady();
    }).catch((error: unknown) => {
      if (!disposed) onError(error);
    }).finally(() => {
      inFlight = false;
      flushResize();
    });
  };

  const fit = () => {
    if (disposed || !visible()) return;
    const dimensions = fitAddon.proposeDimensions();
    if (!dimensions || !Number.isInteger(dimensions.cols) || !Number.isInteger(dimensions.rows)
      || dimensions.cols < 2 || dimensions.rows < 1) return;
    fitAddon.fit();
    onDimensions?.(dimensions);
    pending = dimensions;
    flushResize();
  };

  const scheduleFit = () => {
    if (disposed || fitTimer !== undefined) return;
    // Coalesce without indefinitely postponing fits during a continuous splitter drag.
    fitTimer = setTimeout(() => { fitTimer = undefined; fit(); }, 50);
  };

  const observer = new ResizeObserver(scheduleFit);
  observer.observe(container);
  window.addEventListener('resize', scheduleFit);
  fit();
  // xterm's initial cell measurement may settle after open(). The observer also
  // retries when a hidden pane becomes visible; never send 2x1 geometry while hidden.
  scheduleFit();

  return {
    scheduleFit,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      window.removeEventListener('resize', scheduleFit);
      clearTimeout(fitTimer);
      clearTimeout(resizeTimer);
      pending = undefined;
    },
  };
}
