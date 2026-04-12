import { writeCachedTerminalData, writeCachedTerminalExit } from '../components/TerminalPane';

/**
 * Keep terminal output flowing even when the owning workspace is unmounted.
 *
 * TerminalPane keeps the xterm instance cached across workspace switches, but
 * the IPC listeners that receive PTY output need to live at the app level so
 * hidden workspaces still receive data and exit notifications.
 */
export function startTerminalSessionBridge(): () => void {
  const disposers: Array<() => void> = [];

  if (typeof window.electronAPI?.onTerminalData === 'function') {
    disposers.push(window.electronAPI.onTerminalData(({ id, data }) => {
      writeCachedTerminalData(id, data);
    }));
  }

  if (typeof window.electronAPI?.onTerminalExit === 'function') {
    disposers.push(window.electronAPI.onTerminalExit(({ id, exitCode }) => {
      writeCachedTerminalExit(id, exitCode);
    }));
  }

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
