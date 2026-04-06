interface ElectronAPI {
  // Workspace
  getLastWorkspace: () => Promise<string>;
  setLastWorkspace: (path: string) => Promise<void>;
  openDirectoryDialog: () => Promise<string | null>;
  readDirectory: (path: string) => Promise<{ name: string; isDirectory: boolean }[]>;

  // Terminal
  spawnTerminal: (workingDir: string, harness?: string) => Promise<{ id: string; pid: number }>;
  getTerminalBuffer: (id: string) => Promise<string>;
  writeTerminal: (id: string, data: string) => Promise<void>;
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>;
  killTerminal: (id: string) => Promise<void>;
  onTerminalData: (callback: (data: { id: string; data: string }) => void) => () => void;
  onTerminalExit: (callback: (data: { id: string; exitCode: number }) => void) => () => void;

  // Browser (WebContentsView)
  browserShow: (x: number, y: number, width: number, height: number) => Promise<void>;
  browserHide: () => Promise<void>;
  browserSetBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
  browserNavigate: (url: string) => Promise<void>;
  browserBack: () => Promise<void>;
  browserForward: () => Promise<void>;
  browserRefresh: () => Promise<void>;
  browserStop: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  getBrowserUrl: () => Promise<string>;
  canGoBack: () => Promise<boolean>;
  canGoForward: () => Promise<boolean>;
  onFitAllPanes: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
