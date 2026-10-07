import { isTerminalGeometry, type TerminalGeometry } from '../../shared/terminalGeometry';

interface Waiter { finish: (geometry?: TerminalGeometry, error?: Error) => void }
interface Entry {
  dimensions?: TerminalGeometry;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  waiters: Set<Waiter>;
}
const panes = new Map<string, Entry>();
const entryFor = (paneId: string) => {
  let entry = panes.get(paneId);
  if (!entry) { entry = { settled: false, waiters: new Set() }; panes.set(paneId, entry); }
  return entry;
};

/** Only the mounted, visible xterm fit can publish dimensions. No viewport guesses or fake PTY. */
export function publishTerminalPaneGeometry(paneId: string, dimensions: TerminalGeometry): void {
  if (!isTerminalGeometry(dimensions)) return;
  const entry = entryFor(paneId);
  if (entry.dimensions?.cols === dimensions.cols && entry.dimensions.rows === dimensions.rows) return;
  entry.dimensions = { ...dimensions };
  entry.settled = false;
  clearTimeout(entry.timer);
  // Allow the inserted split and xterm's initial cell measurement to settle before starting a TUI.
  entry.timer = setTimeout(() => {
    if (panes.get(paneId) !== entry) return;
    entry.settled = true;
    for (const waiter of [...entry.waiters]) waiter.finish(entry.dimensions);
  }, 100);
}

export function clearTerminalPaneGeometry(paneId: string): void {
  const entry = panes.get(paneId);
  if (!entry) return;
  clearTimeout(entry.timer);
  panes.delete(paneId);
  for (const waiter of [...entry.waiters]) waiter.finish(undefined, new Error('The resume pane was closed or hidden'));
}

/** Bounded, cancellable preparation; an invisible/unmounted pane never starts a process. */
export function waitForTerminalPaneGeometry(paneId: string, signal?: AbortSignal, timeoutMs = 5000): Promise<TerminalGeometry> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Resume was cancelled')); return; }
    const entry = entryFor(paneId);
    if (entry.settled && entry.dimensions) { resolve({ ...entry.dimensions }); return; }
    let finished = false;
    const abort = () => waiter.finish(undefined, new Error('Resume was cancelled'));
    const timer = setTimeout(() => waiter.finish(undefined, new Error('Could not measure a visible resume pane. Try again with the workspace visible.')), timeoutMs);
    const waiter: Waiter = { finish: (geometry, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      entry.waiters.delete(waiter);
      if (!entry.dimensions && !entry.waiters.size && panes.get(paneId) === entry) panes.delete(paneId);
      if (geometry) resolve({ ...geometry }); else reject(error);
    } };
    entry.waiters.add(waiter);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
