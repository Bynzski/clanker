/**
 * Browser IPC Handlers
 *
 * Registers all browser-related IPC handlers and manages tab-scoped
 * WebContentsView instances owned by the Electron main process.
 */

import { ipcMain, BrowserWindow, Menu, WebContentsView, shell, type Rectangle } from 'electron';
import {
  normalizeAppBrowserUrl,
  normalizeExternalUrl,
  normalizeTrustedAppBrowserUrl,
} from '../security';
import {
  BROWSER_SET_BOUNDS,
  BROWSER_HIDE,
  BROWSER_NAVIGATE,
  RECIPE_PREVIEW_PROBE,
  BROWSER_BACK,
  BROWSER_FORWARD,
  BROWSER_REFRESH,
  BROWSER_STOP,
  BROWSER_DISPOSE_WORKSPACE,
  OPEN_EXTERNAL,
  CAN_GO_BACK,
  CAN_GO_FORWARD,
  BROWSER_URL_UPDATED,
  BROWSER_GET_URL,
  BROWSER_SAVE_URL,
  BROWSER_CREATE_TAB,
  BROWSER_CLOSE_TAB,
  BROWSER_SWITCH_TAB,
  BROWSER_ACTIVATE,
  BROWSER_MOVE_TAB,
  BROWSER_GET_TABS,
  BROWSER_TAB_NAVIGATE,
  BROWSER_HISTORY_ADD,
  BROWSER_HISTORY_GET,
  BROWSER_HISTORY_CLEAR,
  FIT_ALL_PANES,
  BROWSER_KEYBINDING_COMMAND,
} from '../../shared/ipcChannels';
import {
  isWorkspacePageCommand,
  keystrokeFromElectronInput,
  platformFromString,
  resolveCommand,
  type KeybindingCommandId,
  type KeybindingOverrides,
} from '../../shared/keybindings';
import { BrowserSessionScopes } from '../browserSessionScope';
import { getBrowserHistoryService } from '../browserHistory';
import { WORKSPACE_RECIPES_ENABLED, RECIPES_DISABLED_MESSAGE } from '../../shared/recipeAvailability';
import { probeRecipePreview } from '../recipePreview';

export interface BrowserViewEntry {
  view: WebContentsView;
  url: string;
  title: string;
}

export type BrowserWorkspaceViews = Map<string, BrowserViewEntry>;
export type BrowserViewsByWorkspace = Map<string, BrowserWorkspaceViews>;

const browserSessionScopes = new BrowserSessionScopes();
const tabOrderByWorkspace = new Map<string, string[]>();
const activeTabIdsByWorkspace = new Map<string, string>();
const lastBrowserBoundsByWorkspace = new Map<string, Rectangle>();

interface RegisterBrowserIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  onBrowserNavigation?: (workspaceId: string, url: string, errorCode?: number) => void;
  getWorkspaceEnvironmentKind?: (workspaceId: string) => 'local' | 'ssh' | null;
  getBrowserViews: () => BrowserViewsByWorkspace;
  getActiveBrowserWorkspaceId: () => string | null;
  setActiveBrowserWorkspaceId: (id: string | null) => void;
  onActiveBrowserTabChanged?: (workspaceId: string, tabId: string | null) => void;
  /** Validated effective-override source shared with the settings IPC; read per keystroke from cache. */
  getKeybindingOverrides?: () => KeybindingOverrides;
}

export interface BrowserIpcController {
  disposeWorkspace(workspaceId: string): void;
  /** Close every native browser view and clear process-lifetime tab bookkeeping. */
  disposeAll(): void;
}

const DEFAULT_BROWSER_URL = 'https://github.com';
const RECIPE_NAVIGATION_TIMEOUT_MS = 10000;

/**
 * Fallback tab ID used by workspace-scoped browser APIs (e.g. BROWSER_NAVIGATE
 * without a tabId) when no active tab is known for the workspace. This is a
 * supported backward-compatible API surface — the renderer may call
 * browserNavigate/builderSetBounds without a tabId when the tab state is
 * not yet initialized.
 */
const FALLBACK_TAB_ID = '__fallback_tab__';

function getWorkspaceTabViews(workspaceId: string, deps: RegisterBrowserIpcDeps): BrowserWorkspaceViews {
  let workspaceViews = deps.getBrowserViews().get(workspaceId);
  if (!workspaceViews) {
    workspaceViews = new Map();
    deps.getBrowserViews().set(workspaceId, workspaceViews);
  }
  return workspaceViews;
}

function getExistingWorkspaceTabViews(workspaceId: string, deps: RegisterBrowserIpcDeps): BrowserWorkspaceViews | undefined {
  return deps.getBrowserViews().get(workspaceId);
}

function getTabOrder(workspaceId: string): string[] {
  let order = tabOrderByWorkspace.get(workspaceId);
  if (!order) {
    order = [];
    tabOrderByWorkspace.set(workspaceId, order);
  }
  return order;
}

function rememberTabId(workspaceId: string, tabId: string): void {
  const order = getTabOrder(workspaceId);
  if (!order.includes(tabId)) {
    order.push(tabId);
  }
}

function forgetTabId(workspaceId: string, tabId: string): void {
  const order = tabOrderByWorkspace.get(workspaceId);
  if (!order) return;
  const index = order.indexOf(tabId);
  if (index !== -1) {
    order.splice(index, 1);
  }
  if (order.length === 0) {
    tabOrderByWorkspace.delete(workspaceId);
  }
}

function getActiveTabId(workspaceId: string): string | null {
  return activeTabIdsByWorkspace.get(workspaceId) ?? null;
}

function setActiveTabId(workspaceId: string, tabId: string | null, deps?: RegisterBrowserIpcDeps): void {
  const previousTabId = activeTabIdsByWorkspace.get(workspaceId) ?? null;
  if (tabId) {
    activeTabIdsByWorkspace.set(workspaceId, tabId);
    rememberTabId(workspaceId, tabId);
  } else {
    activeTabIdsByWorkspace.delete(workspaceId);
  }
  if (previousTabId !== tabId) {
    deps?.onActiveBrowserTabChanged?.(workspaceId, tabId);
  }
}



function getActiveViewEntry(workspaceId: string, deps: RegisterBrowserIpcDeps): BrowserViewEntry | null {
  const activeTabId = getActiveTabId(workspaceId);
  if (!activeTabId) return null;
  return getExistingWorkspaceTabViews(workspaceId, deps)?.get(activeTabId) ?? null;
}

type BrowserZoomShortcutAction = 'in' | 'out' | 'reset';

function clampBrowserZoomLevel(level: number): number {
  return Math.max(-5, Math.min(5, level));
}

function isBrowserDevToolsShortcut(input: {
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key?: string;
}): boolean {
  if (input.alt) return false;
  const key = input.key?.toLowerCase() ?? '';
  return key === 'f12' || ((input.control || input.meta) && input.shift && key === 'i');
}

function applyBrowserViewZoomAction(view: WebContentsView, action: BrowserZoomShortcutAction): void {
  if (action === 'reset') {
    view.webContents.setZoomLevel(0);
    return;
  }

  const delta = action === 'in' ? 0.5 : -0.5;
  const currentLevel = view.webContents.getZoomLevel();
  view.webContents.setZoomLevel(clampBrowserZoomLevel(currentLevel + delta));
}

const KEYBINDING_PLATFORM = platformFromString(process.platform);

interface BrowserShortcutTarget {
  workspaceId: string;
  tabId: string;
  deps: RegisterBrowserIpcDeps;
}

const BROWSER_ZOOM_COMMANDS = {
  'zoom.in': 'in',
  'zoom.out': 'out',
  'zoom.reset': 'reset',
} as const satisfies Partial<Record<KeybindingCommandId, BrowserZoomShortcutAction>>;

/**
 * Run one resolved browser-context command. Zoom, refresh and Fit All act on
 * state main owns. Tab and address-bar commands change renderer-owned state, so
 * they are forwarded as one typed signal and run by the renderer's existing
 * browser actions; the address bar additionally needs window focus handed back.
 */
function runBrowserKeybinding(
  commandId: KeybindingCommandId,
  view: WebContentsView,
  { workspaceId, tabId, deps }: BrowserShortcutTarget,
): void {
  const zoomAction = BROWSER_ZOOM_COMMANDS[commandId as keyof typeof BROWSER_ZOOM_COMMANDS];
  if (zoomAction) {
    applyBrowserViewZoomAction(view, zoomAction);
    return;
  }

  const win = deps.getMainWindow();
  if (isWorkspacePageCommand(commandId)) {
    win?.webContents.send(BROWSER_KEYBINDING_COMMAND, { workspaceId, tabId, command: commandId });
    return;
  }
  switch (commandId) {
    case 'browser.refresh':
      view.webContents.reload();
      return;
    case 'layout.fitAll':
      win?.webContents.send(FIT_ALL_PANES);
      return;
    case 'browser.focusAddress':
    case 'browser.newTab':
    case 'browser.closeTab':
    case 'browser.nextTab':
    case 'browser.previousTab':
      if (!win) return;
      if (commandId === 'browser.focusAddress') win.webContents.focus();
      win.webContents.send(BROWSER_KEYBINDING_COMMAND, { workspaceId, tabId, command: commandId });
      return;
    default:
      return;
  }
}

function attachBrowserShortcutHandlers(view: WebContentsView, target: BrowserShortcutTarget) {
  // Ctrl+wheel over the page arrives as `zoom-changed`, not as a keyboard input event.
  view.webContents.on('zoom-changed', (_event, direction) => {
    if (direction === 'in' || direction === 'out') {
      applyBrowserViewZoomAction(view, direction);
    }
  });

  view.webContents.on('before-input-event', (event, input) => {
    if (isBrowserDevToolsShortcut(input)) {
      event.preventDefault();
      if (view.webContents.isDevToolsOpened()) {
        view.webContents.closeDevTools();
      } else {
        view.webContents.openDevTools({ mode: 'detach' });
      }
      return;
    }

    const keystroke = keystrokeFromElectronInput(input, KEYBINDING_PLATFORM);
    if (!keystroke) return;
    // Same effective bindings as every other surface; browser focus owns only browser-context commands.
    const overrides = target.deps.getKeybindingOverrides?.() ?? {};
    const commandId = resolveCommand(keystroke, 'browser', overrides, KEYBINDING_PLATFORM);
    if (!commandId) return;

    event.preventDefault();
    if (input.type === 'keyUp') return;
    runBrowserKeybinding(commandId, view, target);
  });
}

function attachBrowserContextMenuHandlers(view: WebContentsView, mainWindow: BrowserWindow) {
  view.webContents.on('context-menu', (_event, params) => {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open DevTools',
        click: () => view.webContents.openDevTools({ mode: 'detach' }),
      },
      {
        label: 'Inspect Element',
        click: () => {
          view.webContents.inspectElement(params.x, params.y);
          view.webContents.openDevTools({ mode: 'detach' });
        },
      },
    ]);

    menu.popup({ window: mainWindow });
  });
}

function attachBrowserSecurityHandlers(view: WebContentsView) {
  view.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = normalizeExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }
    return { action: 'deny' };
  });

  view.webContents.on('will-navigate', (event, url) => {
    if (!normalizeAppBrowserUrl(url)) {
      event.preventDefault();
    }
  });
}

function createBrowserViewForTab(
  workspaceId: string,
  tabId: string,
  deps: RegisterBrowserIpcDeps,
): BrowserViewEntry | null {
  const mainWindow = deps.getMainWindow();
  if (!mainWindow || !tabId) return null;

  const kind = deps.getWorkspaceEnvironmentKind ? deps.getWorkspaceEnvironmentKind(workspaceId) : 'local';
  if (!kind) return null; // Never let an unregistered SSH workspace fall into the global session.
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      partition: browserSessionScopes.partition(workspaceId, kind),
    },
  });

  if (kind === 'ssh') browserSessionScopes.attach(workspaceId, view.webContents.session);
  if (process.env.NODE_ENV === 'development') {
    view.webContents.on('render-process-gone', (_event, details) => {
      console.error(
        `[diag] browser view gone workspace=${workspaceId} tab=${tabId} webContents=${view.webContents.id} reason=${details?.reason} exitCode=${details?.exitCode}`,
      );
    });
  }
  attachBrowserSecurityHandlers(view);
  attachBrowserShortcutHandlers(view, { workspaceId, tabId, deps });
  attachBrowserContextMenuHandlers(view, mainWindow);
  view.setVisible(false);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  mainWindow.contentView.addChildView(view);

  const entry: BrowserViewEntry = { view, url: DEFAULT_BROWSER_URL, title: '' };

  const reportUrlChange = (navigatedUrl: string) => {
    const safeUrl = normalizeAppBrowserUrl(navigatedUrl);
    if (!safeUrl) return;

    deps.onBrowserNavigation?.(workspaceId, safeUrl);
    entry.url = safeUrl;
    const title = view.webContents.getTitle();
    if (typeof title === 'string') {
      entry.title = title;
    }

    deps.getMainWindow()?.webContents.send(BROWSER_URL_UPDATED, {
      workspaceId,
      tabId,
      url: safeUrl,
      title,
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    });
    getBrowserHistoryService().add(safeUrl, title);
  };

  view.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && normalizeAppBrowserUrl(url)) deps.onBrowserNavigation?.(workspaceId, url, code);
  });
  view.webContents.on('did-navigate', (_event, url) => reportUrlChange(url));
  view.webContents.on('did-navigate-in-page', (_event, url) => reportUrlChange(url));

  void view.webContents.loadURL(DEFAULT_BROWSER_URL);
  return entry;
}

function ensureTabViewEntry(
  workspaceId: string,
  tabId: string,
  deps: RegisterBrowserIpcDeps,
): BrowserViewEntry | null {
  if (!workspaceId || !tabId) return null;

  const workspaceViews = getWorkspaceTabViews(workspaceId, deps);
  const existing = workspaceViews.get(tabId);
  if (existing) {
    rememberTabId(workspaceId, tabId);
    return existing;
  }

  const entry = createBrowserViewForTab(workspaceId, tabId, deps);
  if (!entry) return null;

  workspaceViews.set(tabId, entry);
  rememberTabId(workspaceId, tabId);
  return entry;
}

function hideWorkspaceTabViews(workspaceId: string, deps: RegisterBrowserIpcDeps): void {
  const workspaceViews = getExistingWorkspaceTabViews(workspaceId, deps);
  if (!workspaceViews) return;
  for (const { view } of workspaceViews.values()) {
    view.setVisible(false);
  }
}

function hideAllOtherWorkspaceTabViews(workspaceId: string, deps: RegisterBrowserIpcDeps): void {
  for (const [candidateWorkspaceId] of deps.getBrowserViews()) {
    if (candidateWorkspaceId !== workspaceId) {
      hideWorkspaceTabViews(candidateWorkspaceId, deps);
    }
  }
}

function showTabView(workspaceId: string, tabId: string, deps: RegisterBrowserIpcDeps): boolean {
  // Remembered geometry is not permission to take over the visible browser.
  if (deps.getActiveBrowserWorkspaceId() !== workspaceId) return false;
  const entry = getExistingWorkspaceTabViews(workspaceId, deps)?.get(tabId);
  const bounds = lastBrowserBoundsByWorkspace.get(workspaceId);
  if (!entry || !bounds) return false;

  hideAllOtherWorkspaceTabViews(workspaceId, deps);
  hideWorkspaceTabViews(workspaceId, deps);
  if (bounds.width > 0 && bounds.height > 0) {
    entry.view.setBounds(bounds);
  }
  entry.view.setVisible(true);
  deps.setActiveBrowserWorkspaceId(workspaceId);
  return true;
}

function destroyTabView(workspaceId: string, tabId: string, deps: RegisterBrowserIpcDeps): boolean {
  const workspaceViews = getExistingWorkspaceTabViews(workspaceId, deps);
  const entry = workspaceViews?.get(tabId);
  if (!workspaceViews || !entry) return false;

  closeBrowserView(entry.view);
  workspaceViews.delete(tabId);
  forgetTabId(workspaceId, tabId);

  if (workspaceViews.size === 0) {
    deps.getBrowserViews().delete(workspaceId);
  }
  return true;
}

function closeBrowserView(view: WebContentsView): void {
  try {
    view.setVisible(false);
  } catch {
    // The owning BrowserWindow may already be tearing down.
  }
  try {
    if (!view.webContents.isDestroyed?.()) {
      view.webContents.close();
    }
  } catch {
    // Closing an already-destroyed WebContentsView is harmless during teardown.
  }
}

function destroyWorkspaceBrowserViews(workspaceId: string, deps: RegisterBrowserIpcDeps): void {
  const workspaceViews = getExistingWorkspaceTabViews(workspaceId, deps);
  if (workspaceViews) {
    for (const { view } of workspaceViews.values()) {
      closeBrowserView(view);
    }
    workspaceViews.clear();
  }

  deps.getBrowserViews().delete(workspaceId);
  browserSessionScopes.dispose(workspaceId);
  tabOrderByWorkspace.delete(workspaceId);
  activeTabIdsByWorkspace.delete(workspaceId);
  lastBrowserBoundsByWorkspace.delete(workspaceId);

  if (deps.getActiveBrowserWorkspaceId() === workspaceId) {
    deps.setActiveBrowserWorkspaceId(null);
  }
  deps.onActiveBrowserTabChanged?.(workspaceId, null);
}

function resolveTabIdForWorkspace(workspaceId: string, requestedTabId: string | undefined): string | null {
  if (requestedTabId) return requestedTabId;
  const activeTabId = getActiveTabId(workspaceId);
  if (activeTabId) return activeTabId;
  return tabOrderByWorkspace.get(workspaceId)?.[0] ?? FALLBACK_TAB_ID;
}

function selectFallbackTab(workspaceId: string, removedTabId: string): string | null {
  const order = tabOrderByWorkspace.get(workspaceId) ?? [];
  const removedIndex = order.indexOf(removedTabId);
  const remaining = order.filter((id) => id !== removedTabId);
  if (remaining.length === 0) return null;
  if (removedIndex === -1) return remaining[0] ?? null;
  return remaining[Math.min(removedIndex, remaining.length - 1)] ?? remaining[0] ?? null;
}

function getActiveBrowserEntryForOperation(workspaceId: string, deps: RegisterBrowserIpcDeps): BrowserViewEntry | null {
  return getActiveViewEntry(workspaceId, deps);
}

export function registerBrowserIpc(deps: RegisterBrowserIpcDeps): BrowserIpcController {
  const { getMainWindow } = deps;

  ipcMain.handle(BROWSER_ACTIVATE, (_, workspaceId: string, tabId?: string) => {
    if (!workspaceId) return false;
    const targetTabId = resolveTabIdForWorkspace(workspaceId, tabId);
    if (!targetTabId || !ensureTabViewEntry(workspaceId, targetTabId, deps)) return false;
    hideAllOtherWorkspaceTabViews(workspaceId, deps);
    hideWorkspaceTabViews(workspaceId, deps);
    deps.setActiveBrowserWorkspaceId(workspaceId);
    setActiveTabId(workspaceId, targetTabId, deps);
    showTabView(workspaceId, targetTabId, deps);
    return true;
  });

  ipcMain.handle(BROWSER_SET_BOUNDS, (
    _,
    workspaceId: string,
    viewportBounds: Rectangle,
    tabId?: string,
  ) => {
    if (!workspaceId) return;

    const bounds = {
      x: viewportBounds.x,
      y: viewportBounds.y,
      width: viewportBounds.width,
      height: viewportBounds.height,
    };
    lastBrowserBoundsByWorkspace.set(workspaceId, bounds);

    // Bounds updates can arrive after a newer tab switch. Once a tab is
    // selected, only explicit switch/create actions should change it.
    const selectedTabId = getActiveTabId(workspaceId);
    const targetTabId = selectedTabId ?? resolveTabIdForWorkspace(workspaceId, tabId);
    if (!targetTabId) {
      return;
    }

    const entry = ensureTabViewEntry(workspaceId, targetTabId, deps);
    if (!entry) return;

    if (!selectedTabId) {
      setActiveTabId(workspaceId, targetTabId, deps);
    }
    showTabView(workspaceId, targetTabId, deps);
  });

  ipcMain.handle(BROWSER_HIDE, (_, workspaceId: string) => {
    if (!workspaceId) return;
    hideWorkspaceTabViews(workspaceId, deps);
    if (deps.getActiveBrowserWorkspaceId() === workspaceId) {
      deps.setActiveBrowserWorkspaceId(null);
    }
  });

  ipcMain.handle(RECIPE_PREVIEW_PROBE, (_, url: string, waitForReady: boolean) => {
    if (!WORKSPACE_RECIPES_ENABLED) throw new Error(RECIPES_DISABLED_MESSAGE);
    return probeRecipePreview(url, waitForReady === true);
  });

  ipcMain.handle(BROWSER_NAVIGATE, (_, workspaceId: string, url: string, tabId?: string, awaitLoad?: boolean) => {
    if (!workspaceId) return false;
    const safeUrl = normalizeTrustedAppBrowserUrl(url);
    if (!safeUrl) return false;

    const targetTabId = resolveTabIdForWorkspace(workspaceId, tabId);
    if (!targetTabId) return false;

    const entry = ensureTabViewEntry(workspaceId, targetTabId, deps);
    if (!entry) return false;

    entry.url = safeUrl;
    setActiveTabId(workspaceId, targetTabId, deps);
    getMainWindow()?.webContents.send(BROWSER_URL_UPDATED, { workspaceId, tabId: targetTabId, url: safeUrl });
    const loading = entry.view.webContents.loadURL(safeUrl);
    if (awaitLoad === true) {
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          try { entry.view.webContents.stop(); } catch { /* View may have closed. */ }
          resolve(false);
        }, RECIPE_NAVIGATION_TIMEOUT_MS);
        void Promise.resolve(loading).then(() => {
          clearTimeout(timer);
          resolve(true);
        }).catch(() => {
          clearTimeout(timer);
          resolve(false);
        });
      });
    }
    void Promise.resolve(loading).catch(() => {});
    return true;
  });

  ipcMain.handle(BROWSER_BACK, (_, workspaceId: string) => {
    if (!workspaceId) return;
    const entry = getActiveBrowserEntryForOperation(workspaceId, deps);
    if (entry?.view.webContents.navigationHistory.canGoBack()) {
      entry.view.webContents.navigationHistory.goBack();
    }
  });

  ipcMain.handle(BROWSER_FORWARD, (_, workspaceId: string) => {
    if (!workspaceId) return;
    const entry = getActiveBrowserEntryForOperation(workspaceId, deps);
    if (entry?.view.webContents.navigationHistory.canGoForward()) {
      entry.view.webContents.navigationHistory.goForward();
    }
  });

  ipcMain.handle(BROWSER_REFRESH, (_, workspaceId: string) => {
    if (!workspaceId) return;
    getActiveBrowserEntryForOperation(workspaceId, deps)?.view.webContents.reload();
  });

  ipcMain.handle(BROWSER_STOP, (_, workspaceId: string) => {
    if (!workspaceId) return;
    getActiveBrowserEntryForOperation(workspaceId, deps)?.view.webContents.stop();
  });

  ipcMain.handle(BROWSER_DISPOSE_WORKSPACE, (_, workspaceId: string) => {
    if (!workspaceId) return;
    destroyWorkspaceBrowserViews(workspaceId, deps);
  });

  ipcMain.handle(OPEN_EXTERNAL, (_, url: string) => {
    const safeUrl = normalizeExternalUrl(url);
    if (!safeUrl) return false;
    void shell.openExternal(safeUrl);
    return true;
  });

  ipcMain.handle(CAN_GO_BACK, (_, workspaceId: string) => {
    if (!workspaceId) return false;
    return getActiveBrowserEntryForOperation(workspaceId, deps)?.view.webContents.navigationHistory.canGoBack() ?? false;
  });

  ipcMain.handle(CAN_GO_FORWARD, (_, workspaceId: string) => {
    if (!workspaceId) return false;
    return getActiveBrowserEntryForOperation(workspaceId, deps)?.view.webContents.navigationHistory.canGoForward() ?? false;
  });

  ipcMain.handle(BROWSER_GET_URL, (_, workspaceId: string) => {
    return getActiveBrowserEntryForOperation(workspaceId, deps)?.url ?? null;
  });

  ipcMain.handle(BROWSER_SAVE_URL, (_, workspaceId: string, url: string) => {
    const safeUrl = normalizeTrustedAppBrowserUrl(url);
    if (!safeUrl) return false;
    const entry = getActiveBrowserEntryForOperation(workspaceId, deps);
    if (!entry) return false;
    entry.url = safeUrl;
    return true;
  });

  ipcMain.handle(BROWSER_CREATE_TAB, (_, workspaceId: string, tabId: string) => {
    if (!workspaceId || !tabId) return { url: '', title: '' };
    const entry = ensureTabViewEntry(workspaceId, tabId, deps);
    if (!entry) return { url: '', title: '' };

    if (!getActiveTabId(workspaceId)) {
      setActiveTabId(workspaceId, tabId, deps);
    }
    return { url: entry.url, title: entry.title };
  });

  ipcMain.handle(BROWSER_CLOSE_TAB, (_, workspaceId: string, tabId: string) => {
    if (!workspaceId || !tabId) return false;

    const workspaceViews = getExistingWorkspaceTabViews(workspaceId, deps);
    if (!workspaceViews?.has(tabId)) return false;

    if (workspaceViews.size <= 1) {
      return false;
    }

    const closingActive = getActiveTabId(workspaceId) === tabId;
    const fallbackTabId = closingActive ? selectFallbackTab(workspaceId, tabId) : getActiveTabId(workspaceId);

    destroyTabView(workspaceId, tabId, deps);

    if (closingActive) {
      setActiveTabId(workspaceId, fallbackTabId, deps);
      if (fallbackTabId && deps.getActiveBrowserWorkspaceId() === workspaceId) {
        showTabView(workspaceId, fallbackTabId, deps);
      }
    }

    return true;
  });

  ipcMain.handle(BROWSER_SWITCH_TAB, (_, workspaceId: string, tabId: string) => {
    if (!workspaceId || !tabId) return null;

    const entry = getExistingWorkspaceTabViews(workspaceId, deps)?.get(tabId);
    if (!entry) return null;

    setActiveTabId(workspaceId, tabId, deps);
    showTabView(workspaceId, tabId, deps);
    return { url: entry.url, title: entry.title };
  });

  ipcMain.handle(BROWSER_MOVE_TAB, (
    _, workspaceId: string, tabId: string, targetTabId: string, activeTabId: string,
  ) => {
    const views = getExistingWorkspaceTabViews(workspaceId, deps);
    const order = tabOrderByWorkspace.get(workspaceId);
    if (!views || !order || !views.has(activeTabId)) return false;
    const fromIndex = order.indexOf(tabId);
    const targetIndex = order.indexOf(targetTabId);
    if (fromIndex < 0 || targetIndex < 0) return false;
    if (fromIndex !== targetIndex) {
      order.splice(fromIndex, 1);
      order.splice(targetIndex, 0, tabId);
    }
    setActiveTabId(workspaceId, activeTabId, deps);
    showTabView(workspaceId, activeTabId, deps);
    return true;
  });

  ipcMain.handle(BROWSER_GET_TABS, (_, workspaceId: string) => {
    if (!workspaceId) return [];
    const workspaceViews = getExistingWorkspaceTabViews(workspaceId, deps);
    const order = tabOrderByWorkspace.get(workspaceId) ?? [];
    if (!workspaceViews) return [];

    return order
      .map((id) => {
        const entry = workspaceViews.get(id);
        return entry ? { tabId: id, url: entry.url, title: entry.title } : null;
      })
      .filter((entry): entry is { tabId: string; url: string; title: string } => entry != null);
  });

  ipcMain.handle(BROWSER_HISTORY_ADD, (_, url: string, title?: string) => {
    return getBrowserHistoryService().add(url, title);
  });

  ipcMain.handle(BROWSER_HISTORY_GET, (_, prefix?: string) => {
    return getBrowserHistoryService().query(prefix);
  });

  ipcMain.handle(BROWSER_HISTORY_CLEAR, () => {
    return getBrowserHistoryService().clear();
  });

  ipcMain.handle(BROWSER_TAB_NAVIGATE, (_, workspaceId: string, tabId: string, url: string) => {
    if (!workspaceId || !tabId) return false;
    const safeUrl = normalizeTrustedAppBrowserUrl(url);
    if (!safeUrl) return false;

    const entry = ensureTabViewEntry(workspaceId, tabId, deps);
    if (!entry) return false;

    entry.url = safeUrl;
    getMainWindow()?.webContents.send(BROWSER_URL_UPDATED, { workspaceId, tabId, url: safeUrl });
    // Load the target view even when it becomes inactive between tab creation,
    // activation, and navigation. Each tab then remains internally consistent
    // under concurrent link activations and is ready when switched back to.
    void Promise.resolve(entry.view.webContents.loadURL(safeUrl)).catch(() => {});
    return true;
  });

  ipcMain.on(BROWSER_URL_UPDATED, () => { });
  ipcMain.on(FIT_ALL_PANES, () => { });
  ipcMain.on(BROWSER_KEYBINDING_COMMAND, () => { });

  return {
    disposeWorkspace: (workspaceId) => destroyWorkspaceBrowserViews(workspaceId, deps),
    disposeAll(): void {
      const workspaceIds = new Set([
        ...deps.getBrowserViews().keys(),
        ...tabOrderByWorkspace.keys(),
        ...activeTabIdsByWorkspace.keys(),
        ...lastBrowserBoundsByWorkspace.keys(),
      ]);
      for (const workspaceId of workspaceIds) {
        destroyWorkspaceBrowserViews(workspaceId, deps);
      }
      deps.getBrowserViews().clear();
      browserSessionScopes.disposeAll();
  tabOrderByWorkspace.clear();
      activeTabIdsByWorkspace.clear();
      lastBrowserBoundsByWorkspace.clear();
      deps.setActiveBrowserWorkspaceId(null);
    },
  };
}

/** Test-only: clear all in-memory tab tracking state. */
export function __resetBrowserTabState(): void {
  browserSessionScopes.disposeAll();
  tabOrderByWorkspace.clear();
  activeTabIdsByWorkspace.clear();
  lastBrowserBoundsByWorkspace.clear();
}

/** Test-only/introspection helpers. */
export {
  DEFAULT_BROWSER_URL,
  getWorkspaceTabViews,
  getActiveTabId,
  setActiveTabId,
  ensureTabViewEntry,
  hideWorkspaceTabViews,
  showTabView,
  destroyTabView,
  destroyWorkspaceBrowserViews,
  createBrowserViewForTab,
  clampBrowserZoomLevel,
  applyBrowserViewZoomAction,
};
