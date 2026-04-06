import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Workspace
  getLastWorkspace: () => ipcRenderer.invoke('get-last-workspace'),
  setLastWorkspace: (path: string) => ipcRenderer.invoke('set-last-workspace', path),
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  readDirectory: (path: string) => ipcRenderer.invoke('read-directory', path),

  // Terminal
  spawnTerminal: (workingDir: string, harness?: string) => ipcRenderer.invoke('spawn-terminal', workingDir, harness),
  getTerminalBuffer: (id: string) => ipcRenderer.invoke('get-terminal-buffer', id),
  writeTerminal: (id: string, data: string) => ipcRenderer.invoke('write-terminal', { id, data }),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke('resize-terminal', { id, cols, rows }),
  killTerminal: (id: string) => ipcRenderer.invoke('kill-terminal', id),
  onTerminalData: (callback: (data: { id: string; data: string }) => void) => {
    const handler = (_: any, data: { id: string; data: string }) => callback(data);
    ipcRenderer.on('terminal-data', handler);
    return () => ipcRenderer.removeListener('terminal-data', handler);
  },
  onTerminalExit: (callback: (data: { id: string; exitCode: number }) => void) => {
    const handler = (_: any, data: { id: string; exitCode: number }) => callback(data);
    ipcRenderer.on('terminal-exit', handler);
    return () => ipcRenderer.removeListener('terminal-exit', handler);
  },

  // Browser (using WebContentsView)
  browserShow: (x: number, y: number, width: number, height: number) => 
    ipcRenderer.invoke('browser-show', x, y, width, height),
  browserHide: () => ipcRenderer.invoke('browser-hide'),
  browserSetBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('browser-set-bounds', bounds),
  browserNavigate: (url: string) => ipcRenderer.invoke('browser-navigate', url),
  browserBack: () => ipcRenderer.invoke('browser-back'),
  browserForward: () => ipcRenderer.invoke('browser-forward'),
  browserRefresh: () => ipcRenderer.invoke('browser-refresh'),
  browserStop: () => ipcRenderer.invoke('browser-stop'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  getBrowserUrl: () => ipcRenderer.invoke('get-browser-url'),
  canGoBack: () => ipcRenderer.invoke('can-go-back'),
  canGoForward: () => ipcRenderer.invoke('can-go-forward'),
  onFitAllPanes: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('fit-all-panes', handler);
    return () => ipcRenderer.removeListener('fit-all-panes', handler);
  },

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('toggle-maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  isMaximizedWindow: () => ipcRenderer.invoke('is-maximized-window'),

  // Harness
  getHarnessOptions: () => ipcRenderer.invoke('get-harness-options'),
});
