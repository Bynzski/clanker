import { useThemeStore } from '../theme/themeStore';
import { registerThemedTerminal, unregisterThemedTerminal } from '../theme/terminalTheme';

type XTerm = import('@xterm/xterm').Terminal;
type Fit = import('@xterm/addon-fit').FitAddon;
interface CachedTerminal { xterm: XTerm; fitAddon: Fit; input?: { dispose(): void } }

/** Workspace/page presentation never owns these terminal runtimes. Exit retains scrollback. */
const cache = new Map<string, CachedTerminal>();
const disposedIds = new Set<string>();
const readyIds = new Set<string>();
const readinessListeners = new Set<() => void>();
let readinessRevision = 0;
function notifyReadiness(): void {
  readinessRevision++;
  for (const listener of readinessListeners) listener();
}
export function subscribeTerminalReadiness(listener: () => void): () => void {
  readinessListeners.add(listener);
  return () => { readinessListeners.delete(listener); };
}
export function getTerminalReadinessRevision(): number { return readinessRevision; }

export function getCachedTerminal(terminalId: string): CachedTerminal | undefined { return cache.get(terminalId); }
export function isTerminalDisposed(terminalId: string): boolean { return disposedIds.has(terminalId); }
export function terminalNeedsBootstrap(terminalId: string): boolean { return !readyIds.has(terminalId) && !disposedIds.has(terminalId); }
export function markTerminalRuntimeReady(terminalId: string): void {
  if (disposedIds.has(terminalId) || readyIds.has(terminalId)) return;
  readyIds.add(terminalId);
  notifyReadiness();
}

export function cacheTerminalInstance(terminalId: string, xterm: XTerm, fitAddon: Fit): void {
  if (disposedIds.has(terminalId)) { unregisterThemedTerminal(xterm); xterm.dispose(); return; }
  const previous = cache.get(terminalId);
  if (previous && previous.xterm !== xterm) evict(terminalId);
  registerThemedTerminal(xterm, useThemeStore.getState().theme);
  let input = previous?.xterm === xterm ? previous.input : undefined;
  if (previous?.xterm !== xterm) {
    // Default-deny user events until an interactive pane attaches its registry handlers.
    xterm.attachCustomKeyEventHandler?.(() => false);
    xterm.attachCustomWheelEventHandler?.(() => false);
    // Native terminal-query replies must survive page/workspace unmounts, just like output.
    input = xterm.onData?.((data) => {
      if (cache.get(terminalId)?.xterm !== xterm || disposedIds.has(terminalId)) return;
      if (data === '\x03' && xterm.hasSelection()) {
        void window.electronAPI.writeClipboard(xterm.getSelection()).catch(console.error);
        xterm.clearSelection();
      } else void window.electronAPI.writeTerminal(terminalId, data).catch(console.error);
    });
  }
  cache.set(terminalId, { xterm, fitAddon, input });
}
export function writeCachedTerminalData(terminalId: string, data: string): boolean {
  const entry = cache.get(terminalId);
  if (!entry) return false;
  entry.xterm.write(data);
  return true;
}
export function writeCachedTerminalExit(terminalId: string, exitCode: number): boolean {
  const entry = cache.get(terminalId);
  if (!entry) return false;
  entry.xterm.write(`\r\n\x1b[33mProcess exited with code ${exitCode}\x1b[0m\r\n`);
  return true;
}
function evict(terminalId: string): void {
  const entry = cache.get(terminalId);
  if (!entry) return;
  entry.input?.dispose();
  unregisterThemedTerminal(entry.xterm);
  entry.xterm.dispose();
  cache.delete(terminalId);
}
export function markTerminalDisposed(terminalId: string): void {
  disposedIds.add(terminalId);
  readyIds.delete(terminalId);
  evict(terminalId);
  notifyReadiness();
}
/** Retain the tombstone until a mounted pane's async import/teardown has declined to cache it. */
export function finishTerminalDisposal(terminalId: string): void { disposedIds.delete(terminalId); }
export function clearTerminalCache(): void {
  for (const id of cache.keys()) evict(id);
  disposedIds.clear(); readyIds.clear();
  notifyReadiness();
}
