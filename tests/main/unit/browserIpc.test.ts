/**
 * Browser IPC Registration Tests
 *
 * Tests for the browser IPC module, verifying channel registration.
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';
import { testHome } from '../../_helpers/tempPaths';

let attachedBeforeInputEventHandler: ((event: { preventDefault: () => void }, input: { control?: boolean; meta?: boolean; alt?: boolean; shift?: boolean; key?: string; code?: string; type?: string }) => void) | null = null;
let attachedContextMenuHandler: ((event: unknown, params: { x: number; y: number }) => void) | null = null;
let attachedZoomChangedHandler: ((event: unknown, direction: string) => void) | null = null;
let attachedDidFailLoadHandler: ((event: unknown, code: number, description: string, url: string, isMainFrame: boolean) => void) | null = null;
let attachedDidNavigateHandler: ((event: unknown, url: string) => void) | null = null;

// Mock electron module
vi.mock('electron', () => ({
  app: {
    disableHardwareAcceleration: vi.fn(),
    getPath: vi.fn((name: string) => {
      if (name === 'home') return testHome();
      return `/mock/${name}`;
    }),
    commandLine: {
      appendSwitch: vi.fn(),
    },
    whenReady: vi.fn(() => {
      return new Promise<never>(() => {
        // Prevent app initialization during tests
      });
    }),
    on: vi.fn(),
    quit: vi.fn(),
  },
  BrowserWindow: vi.fn(() => ({
    setMenuBarVisibility: vi.fn(),
    setAutoHideMenuBar: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    minimize: vi.fn(),
    unmaximize: vi.fn(),
    maximize: vi.fn(),
    isMaximized: vi.fn(() => false),
    close: vi.fn(),
    webContents: {
      send: vi.fn(),
      getZoomLevel: vi.fn(() => 0),
    },
    contentView: {
      addChildView: vi.fn(),
    },
  })),
  Menu: Object.assign(vi.fn(), {
    buildFromTemplate: vi.fn((template: unknown[]) => ({
      popup: vi.fn(),
      template,
    })),
    setApplicationMenu: vi.fn(),
  }),
  WebContentsView: class MockWebContentsView {
    constructor(public options: { webPreferences: { partition: string } }) {}
    setVisible = vi.fn();
    setBounds = vi.fn();
    webContents = {
      loadURL: vi.fn(),
      close: vi.fn(),
      reload: vi.fn(),
      stop: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((eventName: string, handler: typeof attachedBeforeInputEventHandler) => {
        if (eventName === 'before-input-event') {
          attachedBeforeInputEventHandler = handler;
        }
        if (eventName === 'zoom-changed') {
          attachedZoomChangedHandler = handler as unknown as typeof attachedZoomChangedHandler;
        }
        if (eventName === 'context-menu') {
          attachedContextMenuHandler = handler as typeof attachedContextMenuHandler;
        }
        if (eventName === 'did-fail-load') attachedDidFailLoadHandler = handler as unknown as typeof attachedDidFailLoadHandler;
        if (eventName === 'did-navigate') {
          attachedDidNavigateHandler = handler as unknown as typeof attachedDidNavigateHandler;
        }
      }),
      getTitle: vi.fn(() => 'Navigated title'),
      getZoomLevel: vi.fn(() => 0),
      setZoomLevel: vi.fn(),
      openDevTools: vi.fn(),
      closeDevTools: vi.fn(),
      isDevToolsOpened: vi.fn(() => false),
      inspectElement: vi.fn(),
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        goBack: vi.fn(),
        goForward: vi.fn(),
      },
    };
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

// Import after mocking
import { ipcMain, Menu } from 'electron';
import {
  registerBrowserIpc,
  createBrowserViewForTab,
  applyBrowserViewZoomAction,
  clampBrowserZoomLevel,
} from '../../../src/main/ipc/browserIpc';
import { KeybindingOverridesService } from '../../../src/main/keybindingOverrides';
import { BrowserHistoryService, __resetBrowserHistoryServiceForTests } from '../../../src/main/browserHistory';
import { assistantBrowserOwners, resolveBrowserOwnerKind } from '../../../src/main/browserOwner';
import { assistantBrowserOwnerId } from '../../../src/shared/browserOwner';
import type { BrowserHistoryEntry } from '../../../src/shared/types/browserHistory';

class MemoryHistoryStore {
  entries: BrowserHistoryEntry[] = [];

  get(key: 'entries') {
    return this[key];
  }

  set(key: 'entries', value: BrowserHistoryEntry[]) {
    this[key] = value;
  }
}

describe('registerBrowserIpc', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockDeps = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockBrowserViews = new Map<string, any>();
    let mockActiveWorkspaceId: string | null = null;

    const mockMainWindow = {
      webContents: {
        send: vi.fn(),
        getZoomLevel: vi.fn(() => 0),
      },
      contentView: {
        addChildView: vi.fn(),
      },
    };

    return {
      deps: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getMainWindow: () => mockMainWindow as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getBrowserViews: () => mockBrowserViews as any,
        getActiveBrowserWorkspaceId: () => mockActiveWorkspaceId,
        setActiveBrowserWorkspaceId: (id: string | null) => { mockActiveWorkspaceId = id; },
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    attachedBeforeInputEventHandler = null;
    attachedZoomChangedHandler = null;
    attachedContextMenuHandler = null;
    attachedDidNavigateHandler = null;
    __resetBrowserHistoryServiceForTests(new BrowserHistoryService(new MemoryHistoryStore()));
  });

  test('reports main-frame navigation failures without bypassing certificate security or exposing diagnostics', () => {
    const { deps } = createMockDeps(); const onBrowserNavigation = vi.fn();
    createBrowserViewForTab('tls', 'one', { ...deps, onBrowserNavigation });
    attachedDidFailLoadHandler?.({}, -202, 'raw TLS diagnostic', 'https://127.0.0.1:4000/', true);
    expect(onBrowserNavigation).toHaveBeenCalledExactlyOnceWith('tls', 'https://127.0.0.1:4000/', -202);
    attachedDidFailLoadHandler?.({}, -3, 'aborted', 'https://127.0.0.1:4000/', true);
    attachedDidFailLoadHandler?.({}, -202, 'iframe', 'https://127.0.0.1:4000/', false);
    expect(onBrowserNavigation).toHaveBeenCalledTimes(1);
  });

  test('routes actual SSH tab creation into private scopes and fails closed for unregistered workspaces', () => {
    const { deps } = createMockDeps();
    const scoped = { ...deps, getWorkspaceEnvironmentKind: (id: string) => id === 'missing' ? null : id === 'local' ? 'local' as const : 'ssh' as const };
    const partition = (id: string, tab: string) => (createBrowserViewForTab(id, tab, scoped)?.view as unknown as { options: { webPreferences: { partition: string } } }).options.webPreferences.partition;
    expect(partition('a', 'one')).toBe(partition('a', 'two'));
    expect(partition('a', 'one')).not.toBe(partition('b', 'one'));
    expect(partition('local', 'one')).toBe('persist:browser-global');
    expect(createBrowserViewForTab('missing', 'one', scoped)).toBeNull();
  });

  test('an Assistant Browser owner is local and persistent only while main resolves it; fabricated ids and SSH workspaces keep their scopes', () => {
    const { deps } = createMockDeps();
    const known = new Set(['hermes:fred']);
    const scoped = {
      ...deps,
      getWorkspaceEnvironmentKind: (id: string) => resolveBrowserOwnerKind(id, {
        hasAssistant: (assistantId) => known.has(assistantId),
        getWorkspaceKind: (workspaceId) => workspaceId === 'ssh-ws' ? 'ssh' : workspaceId === 'local-ws' ? 'local' : null,
      }),
    };
    const partition = (id: string, tab: string) => (createBrowserViewForTab(id, tab, scoped)?.view as unknown as { options: { webPreferences: { partition: string } } }).options.webPreferences.partition;
    expect(partition(assistantBrowserOwnerId('hermes:fred'), 'one')).toBe('persist:browser-global');
    expect(partition('local-ws', 'one')).toBe('persist:browser-global');
    expect(createBrowserViewForTab(assistantBrowserOwnerId('hermes:fabricated'), 'one', scoped)).toBeNull();
    expect(createBrowserViewForTab('assistant-browser:', 'one', scoped)).toBeNull();
    // A workspace id that merely looks like an Assistant id never reaches the workspace registry path.
    expect(partition('ssh-ws', 'one')).toMatch(/^browser-ssh-/);
    expect(partition('ssh-ws', 'one')).not.toBe(partition(assistantBrowserOwnerId('hermes:fred'), 'one'));
  });

  test('disabling Assistants selects only Assistant-owned Browser owners for disposal, never workspaces', () => {
    const owners = ['ws-a', assistantBrowserOwnerId('hermes:fred'), 'ssh-ws', assistantBrowserOwnerId('hermes:ops')];
    expect(assistantBrowserOwners(owners)).toEqual([assistantBrowserOwnerId('hermes:fred'), assistantBrowserOwnerId('hermes:ops')]);
    expect(assistantBrowserOwners(['ws-a', 'assistant-x'])).toEqual([]);
  });

  test('registers browser context-menu and keyboard shortcut handlers', () => {
    const { deps } = createMockDeps();

    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    handler(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 });

    expect(attachedBeforeInputEventHandler).not.toBeNull();
    expect(attachedContextMenuHandler).not.toBeNull();
  });

  test('disposeAll closes every native view and clears workspace ownership', () => {
    const { deps } = createMockDeps();
    const controller = registerBrowserIpc(deps);
    const setBoundsHandler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    setBoundsHandler(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 });
    setBoundsHandler(null, 'ws-2', { x: 0, y: 0, width: 640, height: 480 });
    const views = [...deps.getBrowserViews().values()].flatMap((workspaceViews) => (
      [...workspaceViews.values()]
    ));

    controller.disposeAll();

    expect(views).toHaveLength(2);
    for (const entry of views) {
      expect(entry.view.webContents.close).toHaveBeenCalledOnce();
    }
    expect(deps.getBrowserViews().size).toBe(0);
    expect(deps.getActiveBrowserWorkspaceId()).toBeNull();
  });

  test('registers all expected browser IPC channels', () => {
    const { deps } = createMockDeps();

    registerBrowserIpc(deps);

    // Verify all expected channels are registered
    const expectedChannels = [
      'browser-activate',
      'browser-set-bounds',
      'browser-hide',
      'browser-navigate',
      'browser-back',
      'browser-forward',
      'browser-refresh',
      'browser-stop',
      'browser-dispose-workspace',
      'open-external',
      'can-go-back',
      'can-go-forward',
      'browser-create-tab',
      'browser-close-tab',
      'browser-switch-tab',
      'browser-move-tab',
      'browser-get-tabs',
      'browser-tab-navigate',
      'browser-history-add',
      'browser-history-get',
      'browser-history-clear',
    ];

    expectedChannels.forEach(channel => {
      expect(mockIpcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    });
  });

  test('registers exactly 24 browser IPC handlers', () => {
    const { deps } = createMockDeps();

    registerBrowserIpc(deps);

    // Count how many times handle was called
    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(24);
  });

  test('can be called multiple times (registering handlers again)', () => {
    const { deps } = createMockDeps();

    // Register twice
    registerBrowserIpc(deps);
    registerBrowserIpc(deps);

    // Handlers should be registered again
    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(48);
  });

  test('browser context menu can open devtools and inspect the clicked element', () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    handler(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 });

    expect(attachedContextMenuHandler).not.toBeNull();
    const mockMenuInstance = { popup: vi.fn() };
    const buildFromTemplate = vi.mocked(Menu.buildFromTemplate);
    buildFromTemplate.mockReturnValueOnce(mockMenuInstance as never);

    const inspectElement = vi.fn();
    const openDevTools = vi.fn();
    // Access the view through the nested tab map
    const workspaceViews = deps.getBrowserViews().get('ws-1') as Map<string, { view: { webContents: { inspectElement: typeof inspectElement; openDevTools: typeof openDevTools } } }>;
    const view = workspaceViews.values().next().value!.view;
    view.webContents.inspectElement = inspectElement;
    view.webContents.openDevTools = openDevTools;

    attachedContextMenuHandler?.({}, { x: 12, y: 34 });
    expect(buildFromTemplate).toHaveBeenCalled();
    expect(mockMenuInstance.popup).toHaveBeenCalled();

    const template = buildFromTemplate.mock.calls[buildFromTemplate.mock.calls.length - 1]?.[0] as Array<{ label?: string; click?: () => void }>;
    expect(template.map(item => item.label)).toEqual(['Open DevTools', 'Inspect Element']);

    template[0]?.click?.();
    expect(openDevTools).toHaveBeenCalledWith({ mode: 'detach' });

    template[1]?.click?.();
    expect(inspectElement).toHaveBeenCalledWith(12, 34);
    expect(openDevTools).toHaveBeenCalledTimes(2);
  });

  test('browser channels do not overlap with terminal channels', () => {
    const { deps } = createMockDeps();

    registerBrowserIpc(deps);

    const browserChannels = [
      'browser-set-bounds',
      'browser-hide',
      'browser-navigate',
      'browser-back',
      'browser-forward',
      'browser-refresh',
      'browser-stop',
      'browser-dispose-workspace',
      'open-external',
      'can-go-back',
      'can-go-forward',
    ];

    const terminalChannels = [
      'spawn-terminal',
      'get-terminal-buffer',
      'write-terminal',
      'resize-terminal',
      'kill-terminal',
      'terminal:cleanup-workspace',
    ];

    // Verify no overlap
    const overlap = browserChannels.filter(ch => terminalChannels.includes(ch));
    expect(overlap.length).toBe(0);
  });
});

/**
 * Browser IPC — Error-Path Tests
 *
 * Verifies every browser handler returns a defined value (never undefined or
 * thrown) for null/invalid workspace IDs, missing browser views, null main
 * window, and unsafe URL attempts.
 */

describe('browserIpc — error-path: null/invalid workspaceId returns valid results', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockDeps = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockBrowserViews = new Map<string, any>();
    let mockActiveWorkspaceId: string | null = null;
    const mockMainWindow = {
      webContents: {
        send: vi.fn(),
        getZoomLevel: vi.fn(() => 0),
      },
      contentView: { addChildView: vi.fn() },
    };

    return {
      deps: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getMainWindow: () => mockMainWindow as any,
        getBrowserViews: () => mockBrowserViews,
        getActiveBrowserWorkspaceId: () => mockActiveWorkspaceId,
        setActiveBrowserWorkspaceId: (id: string | null) => { mockActiveWorkspaceId = id; },
      },
      mockMainWindow,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('BROWSER_SET_BOUNDS returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    // @ts-expect-error — intentionally passing null to test invalid input
    const result = await handler(null, null, { x: 0, y: 0, width: 800, height: 600 });
    expect(result).toBeUndefined();
  });

  test('browser keyboard zoom shortcuts zoom the focused browser tab without affecting app zoom', () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    handler(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 });

    expect(attachedBeforeInputEventHandler).not.toBeNull();

    const workspaceViews = deps.getBrowserViews().get('ws-1') as Map<string, {
      view: { webContents: { getZoomLevel: ReturnType<typeof vi.fn>; setZoomLevel: ReturnType<typeof vi.fn> } };
    }>;
    const firstTabEntry = workspaceViews.values().next().value;
    const view = firstTabEntry!.view;
    view.webContents.getZoomLevel = vi.fn(() => 0);
    view.webContents.setZoomLevel = vi.fn();

    const preventDefault = vi.fn();
    attachedBeforeInputEventHandler?.(
      { preventDefault },
      { control: true, meta: false, alt: false, key: '=', code: 'Equal', type: 'keyDown' }
    );
    expect(preventDefault).toHaveBeenCalled();
    expect(view.webContents.setZoomLevel).toHaveBeenCalledWith(0.5);
    expect(deps.getMainWindow().webContents.getZoomLevel).not.toHaveBeenCalled();

    preventDefault.mockClear();
    view.webContents.setZoomLevel.mockClear();
    attachedBeforeInputEventHandler?.(
      { preventDefault },
      { control: true, meta: false, alt: false, type: 'mouseWheel' }
    );
    expect(preventDefault).not.toHaveBeenCalled();
    expect(view.webContents.setZoomLevel).not.toHaveBeenCalled();
  });

  test('browser Ctrl+wheel zoom-changed zooms only the browser tab in 0.5 steps and clamps', () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;
    handler(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 });

    expect(attachedZoomChangedHandler).not.toBeNull();
    const workspaceViews = deps.getBrowserViews().get('ws-1') as Map<string, {
      view: { webContents: { getZoomLevel: ReturnType<typeof vi.fn>; setZoomLevel: ReturnType<typeof vi.fn> } };
    }>;
    const view = workspaceViews.values().next().value!.view;
    view.webContents.getZoomLevel = vi.fn(() => 1);
    view.webContents.setZoomLevel = vi.fn();

    attachedZoomChangedHandler?.({}, 'in');
    expect(view.webContents.setZoomLevel).toHaveBeenLastCalledWith(1.5);
    attachedZoomChangedHandler?.({}, 'out');
    expect(view.webContents.setZoomLevel).toHaveBeenLastCalledWith(0.5);

    view.webContents.getZoomLevel = vi.fn(() => 5);
    attachedZoomChangedHandler?.({}, 'in');
    expect(view.webContents.setZoomLevel).toHaveBeenLastCalledWith(5);

    expect(deps.getMainWindow().webContents.getZoomLevel).not.toHaveBeenCalled();
  });

  describe('browser keybindings via before-input-event', () => {
    type Input = { control?: boolean; meta?: boolean; alt?: boolean; shift?: boolean; code?: string; key?: string; type?: string };
    const ctrl = (code: string, extra: Partial<Input> = {}): Input => ({
      control: true, meta: false, alt: false, shift: false, code, type: 'keyDown', ...extra,
    });
    const custom = (code: string, mods: Partial<{ primary: boolean; shift: boolean; alt: boolean }> = {}) => ({
      code, primary: true, ctrl: false, shift: false, alt: false, ...mods,
    });

    function setup(overrides: Record<string, unknown> = {}) {
      const { deps } = createMockDeps();
      const send = vi.fn();
      const focus = vi.fn();
      const win = { webContents: { send, focus, getZoomLevel: vi.fn(() => 0) }, contentView: { addChildView: vi.fn() } };
      let current = overrides;
      const fullDeps = {
        ...deps,
        getMainWindow: () => win as never,
        getKeybindingOverrides: () => current as never,
      };
      const entry = createBrowserViewForTab('ws-k', 'tab-k', fullDeps as never)!;
      entry.view.webContents.setZoomLevel = vi.fn();
      entry.view.webContents.getZoomLevel = vi.fn(() => 0);
      const press = (input: Input) => {
        const preventDefault = vi.fn();
        attachedBeforeInputEventHandler?.({ preventDefault }, input);
        return preventDefault;
      };
      return { entry, send, focus, press, setOverrides: (next: Record<string, unknown>) => { current = next; }, win };
    }

    test('zoom keys zoom only the browser view', () => {
      const { entry, press, send } = setup();
      expect(press(ctrl('Equal'))).toHaveBeenCalled();
      expect(entry.view.webContents.setZoomLevel).toHaveBeenLastCalledWith(0.5);
      press(ctrl('Minus'));
      expect(entry.view.webContents.setZoomLevel).toHaveBeenLastCalledWith(-0.5);
      press(ctrl('Digit0'));
      expect(entry.view.webContents.setZoomLevel).toHaveBeenLastCalledWith(0);
      press(ctrl('Equal', { shift: true }));
      expect(entry.view.webContents.setZoomLevel).toHaveBeenLastCalledWith(0.5);
      expect(send).not.toHaveBeenCalled();
    });

    test('key-up of a handled shortcut is consumed without running it twice', () => {
      const { entry, press } = setup();
      const prevented = press(ctrl('Equal', { type: 'keyUp' }));
      expect(prevented).toHaveBeenCalled();
      expect(entry.view.webContents.setZoomLevel).not.toHaveBeenCalled();
    });

    test('refresh reloads the focused view without touching the renderer', () => {
      const { entry, press, send } = setup();
      expect(press(ctrl('KeyR'))).toHaveBeenCalled();
      expect(entry.view.webContents.reload).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
    });

    test('focus address hands window focus to the renderer with a typed, scoped signal', () => {
      const { press, send, focus } = setup();
      expect(press(ctrl('KeyL'))).toHaveBeenCalled();
      expect(focus).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith('browser-keybinding-command', {
        workspaceId: 'ws-k', tabId: 'tab-k', command: 'browser.focusAddress',
      });
    });

    test.each([
      ['KeyT', {}, 'browser.newTab'],
      ['KeyW', {}, 'browser.closeTab'],
      ['Tab', {}, 'browser.nextTab'],
      ['Tab', { shift: true }, 'browser.previousTab'],
    ] as const)('%s %j signals %s without taking window focus', (code, extra, command) => {
      const { press, send, focus } = setup();
      expect(press(ctrl(code, extra))).toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith('browser-keybinding-command', { workspaceId: 'ws-k', tabId: 'tab-k', command });
      expect(focus).not.toHaveBeenCalled();
    });

    test('Fit All uses its new default and the old Ctrl+Shift+F is no longer active', () => {
      const { press, send } = setup();
      expect(press(ctrl('KeyF', { alt: true }))).toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith('fit-all-panes');
      send.mockClear();
      expect(press(ctrl('KeyF', { shift: true, key: 'F' }))).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    test('DevTools shortcuts are preserved', () => {
      const { entry, press } = setup();
      press(ctrl('KeyI', { shift: true, key: 'I' }));
      expect(entry.view.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' });
      press({ code: 'F12', key: 'F12', control: false, meta: false, alt: false, shift: false, type: 'keyDown' });
      expect(entry.view.webContents.openDevTools).toHaveBeenCalledTimes(2);
    });

    test('does not steal application-only commands or unbound keys from the page', () => {
      const { press, send } = setup();
      for (const code of ['KeyS', 'KeyB', 'Comma', 'KeyA', 'KeyC']) {
        expect(press(ctrl(code))).not.toHaveBeenCalled();
      }
      expect(press({ ...ctrl('KeyT'), control: false })).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    test('ignores modifier-only and code-less input', () => {
      const { press } = setup();
      expect(press(ctrl('ControlLeft'))).not.toHaveBeenCalled();
      expect(press({ control: true, type: 'mouseWheel' })).not.toHaveBeenCalled();
    });

    test('overridden bindings take effect and the default no longer fires', () => {
      const { press, send } = setup({ 'browser.newTab': custom('KeyJ') });
      expect(press(ctrl('KeyJ'))).toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith('browser-keybinding-command', expect.objectContaining({ command: 'browser.newTab' }));
      send.mockClear();
      expect(press(ctrl('KeyT'))).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    test('overridden zoom binding applies in the browser; default zoom key is released to the page', () => {
      const { entry, press } = setup({ 'zoom.in': custom('KeyJ') });
      press(ctrl('KeyJ'));
      expect(entry.view.webContents.setZoomLevel).toHaveBeenLastCalledWith(0.5);
      vi.mocked(entry.view.webContents.setZoomLevel).mockClear();
      expect(press(ctrl('Equal'))).not.toHaveBeenCalled();
      expect(entry.view.webContents.setZoomLevel).not.toHaveBeenCalled();
    });

    test('unbound commands do nothing and reset-to-default restores behavior live', () => {
      const { entry, press, setOverrides } = setup({ 'browser.refresh': null });
      expect(press(ctrl('KeyR'))).not.toHaveBeenCalled();
      expect(entry.view.webContents.reload).not.toHaveBeenCalled();
      setOverrides({});
      expect(press(ctrl('KeyR'))).toHaveBeenCalled();
      expect(entry.view.webContents.reload).toHaveBeenCalledTimes(1);
    });

    test.each([
      ['NumpadAdd', 0.5], ['NumpadSubtract', -0.5], ['Numpad0', 0],
    ] as const)('primary+%s zooms the browser view via the zoom aliases', (code, level) => {
      const { entry, press } = setup();
      expect(press(ctrl(code))).toHaveBeenCalled();
      expect(entry.view.webContents.setZoomLevel).toHaveBeenLastCalledWith(level);
    });

    test('numpad aliases stop applying after an explicit zoom rebind', () => {
      const { entry, press } = setup({ 'zoom.in': custom('KeyJ') });
      expect(press(ctrl('NumpadAdd'))).not.toHaveBeenCalled();
      expect(entry.view.webContents.setZoomLevel).not.toHaveBeenCalled();
      press(ctrl('NumpadSubtract'));
      expect(entry.view.webContents.setZoomLevel).toHaveBeenLastCalledWith(-0.5);
    });

    test('a conflicting persisted map never reaches browser resolution', () => {
      const store = {
        // browser.newTab and browser.refresh both on Ctrl+R: well-formed, overlapping contexts
        get: vi.fn(() => ({ 'browser.newTab': custom('KeyR') })),
        set: vi.fn(),
        delete: vi.fn(),
      };
      const service = new KeybindingOverridesService(() => store as never, 'other');
      const { deps } = createMockDeps();
      const send = vi.fn();
      const win = { webContents: { send, focus: vi.fn(), getZoomLevel: vi.fn(() => 0) }, contentView: { addChildView: vi.fn() } };
      const entry = createBrowserViewForTab('ws-c', 'tab-c', {
        ...deps, getMainWindow: () => win as never, getKeybindingOverrides: () => service.get(),
      } as never)!;
      const preventDefault = vi.fn();
      attachedBeforeInputEventHandler?.({ preventDefault }, ctrl('KeyR'));
      expect(entry.view.webContents.reload).toHaveBeenCalledTimes(1); // default Refresh, no first-match winner
      expect(send).not.toHaveBeenCalled();
      expect(store.delete).toHaveBeenCalledWith('keybindingOverrides');
    });

    test('works without any override provider (defaults)', () => {
      const { deps } = createMockDeps();
      const entry = createBrowserViewForTab('ws-d', 'tab-d', deps as never)!;
      const preventDefault = vi.fn();
      attachedBeforeInputEventHandler?.({ preventDefault }, ctrl('KeyR'));
      expect(preventDefault).toHaveBeenCalled();
      expect(entry.view.webContents.reload).toHaveBeenCalled();
    });
  });

  test('new browser tabs do not inherit application zoom', () => {
    const { deps } = createMockDeps();
    deps.getMainWindow().webContents.getZoomLevel = vi.fn(() => 2);
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    handler(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 });

    const workspaceViews = deps.getBrowserViews().get('ws-1') as Map<string, {
      view: { webContents: { setZoomLevel: ReturnType<typeof vi.fn> } };
    }>;
    const firstTabEntry = workspaceViews.values().next().value;

    expect(firstTabEntry?.view.webContents.setZoomLevel).not.toHaveBeenCalled();
  });

  test('browser zoom helper actions are clamped correctly', () => {
    expect(clampBrowserZoomLevel(-10)).toBe(-5);
    expect(clampBrowserZoomLevel(10)).toBe(5);

    const view = {
      webContents: {
        getZoomLevel: vi.fn(() => 5),
        setZoomLevel: vi.fn(),
      },
    };

    applyBrowserViewZoomAction(view as never, 'in');
    expect(view.webContents.setZoomLevel).toHaveBeenCalledWith(5);

    view.webContents.getZoomLevel = vi.fn(() => -5);
    view.webContents.setZoomLevel.mockClear();
    applyBrowserViewZoomAction(view as never, 'out');
    expect(view.webContents.setZoomLevel).toHaveBeenCalledWith(-5);

    view.webContents.setZoomLevel.mockClear();
    applyBrowserViewZoomAction(view as never, 'reset');
    expect(view.webContents.setZoomLevel).toHaveBeenCalledWith(0);
  });

  test('browser devtools shortcuts toggle the browser DevTools window', () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    handler(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 });

    // Access the view through the nested tab map
    const workspaceViews = deps.getBrowserViews().get('ws-1') as Map<string, { view: { webContents: { openDevTools: ReturnType<typeof vi.fn>; closeDevTools: ReturnType<typeof vi.fn>; isDevToolsOpened: ReturnType<typeof vi.fn> } } }>;
    const firstTabEntry = workspaceViews?.values().next().value;
    const view = firstTabEntry!.view;
    view.webContents.openDevTools = vi.fn();
    view.webContents.closeDevTools = vi.fn();
    view.webContents.isDevToolsOpened = vi.fn(() => false);

    const preventDefault = vi.fn();
    attachedBeforeInputEventHandler?.(
      { preventDefault },
      { control: true, meta: false, alt: false, shift: true, key: 'i', type: 'keyDown' }
    );

    expect(preventDefault).toHaveBeenCalled();
    expect(view.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' });
    expect(view.webContents.closeDevTools).not.toHaveBeenCalled();

    view.webContents.isDevToolsOpened = vi.fn(() => true);
    attachedBeforeInputEventHandler?.(
      { preventDefault },
      { control: false, meta: false, alt: false, shift: false, key: 'F12', type: 'keyDown' }
    );

    expect(view.webContents.closeDevTools).toHaveBeenCalled();
  });

  test('BROWSER_SET_BOUNDS returns undefined for empty string workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    const result = await handler(null, '', { x: 0, y: 0, width: 800, height: 600 });
    expect(result).toBeUndefined();
  });

  test('BROWSER_HIDE returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-hide'
    )?.[1] as (_: unknown, workspaceId: string) => void;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBeUndefined();
  });

  test('BROWSER_NAVIGATE returns false for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-navigate'
    )?.[1] as (_: unknown, workspaceId: string, url: string) => boolean;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null, 'https://github.com');
    expect(result).toBe(false);
  });

  test('BROWSER_NAVIGATE returns false for invalid URL schemes', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-navigate'
    )?.[1] as (_: unknown, workspaceId: string, url: string) => boolean;

    const result = await handler(null, 'ws-1', 'javascript:alert(1)');
    expect(result).toBe(false);
  });

  test('BROWSER_NAVIGATE allows trusted app-initiated file URLs', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-navigate'
    )?.[1] as (_: unknown, workspaceId: string, url: string) => boolean;

    const result = await handler(null, 'ws-1', 'file:///tmp/report.html');
    expect(result).toBe(true);

    const entry = deps.getBrowserViews().get('ws-1')?.get('__fallback_tab__');
    expect(entry?.url).toBe('file:///tmp/report.html');
    expect(entry?.view.webContents.loadURL).toHaveBeenLastCalledWith('file:///tmp/report.html');
  });

  test('BROWSER_BACK returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-back'
    )?.[1] as (_: unknown, workspaceId: string) => void;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBeUndefined();
  });

  test('BROWSER_FORWARD returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-forward'
    )?.[1] as (_: unknown, workspaceId: string) => void;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBeUndefined();
  });

  test('BROWSER_REFRESH returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-refresh'
    )?.[1] as (_: unknown, workspaceId: string) => void;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBeUndefined();
  });

  test('BROWSER_STOP returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-stop'
    )?.[1] as (_: unknown, workspaceId: string) => void;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBeUndefined();
  });

  test('BROWSER_DISPOSE_WORKSPACE returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-dispose-workspace'
    )?.[1] as (_: unknown, workspaceId: string) => void;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBeUndefined();
  });

  test('CAN_GO_BACK returns false for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'can-go-back'
    )?.[1] as (_: unknown, workspaceId: string) => boolean;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBe(false);
  });

  test('CAN_GO_FORWARD returns false for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'can-go-forward'
    )?.[1] as (_: unknown, workspaceId: string) => boolean;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBe(false);
  });
});

describe('browserIpc — error-path: OPEN_EXTERNAL security', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('OPEN_EXTERNAL returns false for file:// URL (blocked by normalizeExternalUrl)', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'open-external'
    )?.[1] as (_: unknown, url: string) => boolean;

    const result = await handler(null, 'file:///etc/passwd');
    expect(result).toBe(false);
  });

  test('OPEN_EXTERNAL returns false for javascript: URL (blocked by normalizeExternalUrl)', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'open-external'
    )?.[1] as (_: unknown, url: string) => boolean;

    const result = await handler(null, 'javascript:alert(1)');
    expect(result).toBe(false);
  });

  test('OPEN_EXTERNAL returns false for empty string', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'open-external'
    )?.[1] as (_: unknown, url: string) => boolean;

    const result = await handler(null, '');
    expect(result).toBe(false);
  });

  test('OPEN_EXTERNAL returns false for null url', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'open-external'
    )?.[1] as (_: unknown, url: string) => boolean;

    // @ts-expect-error — intentionally passing null
    const result = await handler(null, null);
    expect(result).toBe(false);
  });

  const { createMockDeps } = (() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockBrowserViews = new Map<string, any>();
    let mockActiveWorkspaceId: string | null = null;
    const mockMainWindow = {
      webContents: { send: vi.fn() },
      contentView: { addChildView: vi.fn() },
    };
    return {
      createMockDeps: () => ({
        deps: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getMainWindow: () => mockMainWindow as any,
          getBrowserViews: () => mockBrowserViews,
          getActiveBrowserWorkspaceId: () => mockActiveWorkspaceId,
          setActiveBrowserWorkspaceId: (id: string | null) => { mockActiveWorkspaceId = id; },
        },
      }),
    };
  })();
});

describe('browserIpc — error-path: null main window does not crash', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('BROWSER_SET_BOUNDS does not throw when main window is null', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockBrowserViews = new Map<string, any>();
    let mockActiveWorkspaceId: string | null = null;

    const deps = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getMainWindow: () => null as any,
      getBrowserViews: () => mockBrowserViews,
      getActiveBrowserWorkspaceId: () => mockActiveWorkspaceId,
      setActiveBrowserWorkspaceId: (id: string | null) => { mockActiveWorkspaceId = id; },
    };
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    // Should not throw when main window is null (createBrowserViewForWorkspace returns null)
    const result = await handler(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 });
    expect(result).toBeUndefined();
  });
});

describe('browser IPC channel constants', () => {
  test('browser channel names are consistent', () => {
    const expectedChannels = [
      'browser-set-bounds',
      'browser-hide',
      'browser-navigate',
      'browser-back',
      'browser-forward',
      'browser-refresh',
      'browser-stop',
      'browser-dispose-workspace',
      'open-external',
      'can-go-back',
      'can-go-forward',
      'browser-create-tab',
      'browser-close-tab',
      'browser-switch-tab',
      'browser-move-tab',
      'browser-get-tabs',
      'browser-tab-navigate',
      'browser-history-add',
      'browser-history-get',
      'browser-history-clear',
    ];

    // Verify all channels are non-empty strings
    expectedChannels.forEach(channel => {
      expect(typeof channel).toBe('string');
      expect(channel.length).toBeGreaterThan(0);
    });

    // Verify no duplicates
    const uniqueChannels = new Set(expectedChannels);
    expect(uniqueChannels.size).toBe(expectedChannels.length);
  });

  test('all browser channels start with expected prefixes', () => {
    const browserChannels = [
      'browser-set-bounds',
      'browser-hide',
      'browser-navigate',
      'browser-back',
      'browser-forward',
      'browser-refresh',
      'browser-stop',
      'browser-dispose-workspace',
      'open-external',
      'can-go-back',
      'can-go-forward',
    ];

    // These channels should all be browser-related or window-related
    const browserPrefixes = ['browser-', 'open-', 'can-go-'];
    browserChannels.forEach(channel => {
      const hasExpectedPrefix = browserPrefixes.some(prefix => channel.startsWith(prefix));
      expect(hasExpectedPrefix).toBe(true);
    });
  });
});

// ===========================================================================
// Phase 1 — Tab IPC handlers
// ===========================================================================
describe('registerBrowserIpc — tab handlers (Phase 1)', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyHandler = (..._args: any[]) => any;

  function createMockDeps() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockBrowserViews = new Map<string, any>();
    let mockActiveWorkspaceId: string | null = null;
    const mockMainWindow = {
      webContents: {
        send: vi.fn(),
        getZoomLevel: vi.fn(() => 0),
      },
      contentView: { addChildView: vi.fn() },
    };
    return {
      mockMainWindow,
      mockBrowserViews,
      deps: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getMainWindow: () => mockMainWindow as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getBrowserViews: () => mockBrowserViews as any,
        getActiveBrowserWorkspaceId: () => mockActiveWorkspaceId,
        setActiveBrowserWorkspaceId: (id: string | null) => { mockActiveWorkspaceId = id; },
      },
    };
  }

  function findHandler(name: string): AnyHandler {
    const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === name)?.[1] as AnyHandler | undefined;
    if (!handler) {
      throw new Error(`handler ${name} not registered`);
    }
    return handler;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../../src/main/ipc/browserIpc');
    mod.__resetBrowserTabState();
    __resetBrowserHistoryServiceForTests(new BrowserHistoryService(new MemoryHistoryStore()));
  });

  test('presentation leases fence stale cross-pane operations, navigation and closed-tab recreation', async () => {
    const { deps, mockBrowserViews } = createMockDeps();
    const controller = registerBrowserIpc(deps);
    const create = findHandler('browser-create-tab');
    const activate = findHandler('browser-activate');
    const bounds = findHandler('browser-set-bounds');
    const hide = findHandler('browser-hide');
    const switchTab = findHandler('browser-switch-tab');
    const navigate = findHandler('browser-tab-navigate');
    const aLease = { paneId: 'pane-a', epoch: 1 };
    const bLease = { paneId: 'pane-b', epoch: 2 };
    await create(null, 'ws-1', 'tab-a', 'pane-a');
    await create(null, 'ws-1', 'tab-b', 'pane-b');
    const a = mockBrowserViews.get('ws-1').get('tab-a');
    const b = mockBrowserViews.get('ws-1').get('tab-b');
    const rect = { x: 20, y: 30, width: 400, height: 300 };
    expect(await activate(null, 'ws-1', 'tab-a', aLease)).toBe(true);
    await bounds(null, 'ws-1', rect, 'tab-a', aLease);
    expect(await activate(null, 'ws-1', 'tab-b', bLease)).toBe(true);
    expect(b.view.setVisible).toHaveBeenLastCalledWith(false);
    await bounds(null, 'ws-1', rect, 'tab-b', bLease);
    const calls = b.view.setBounds.mock.calls.length;
    expect(await activate(null, 'ws-1', 'tab-a', aLease)).toBe(false);
    await bounds(null, 'ws-1', { ...rect, x: 999 }, 'tab-a', aLease);
    await bounds(null, 'ws-1', rect, 'tab-a', bLease);
    await bounds(null, 'ws-1', { ...rect, width: NaN }, 'tab-b', bLease);
    await hide(null, 'ws-1', aLease);
    await hide(null, 'ws-1');
    expect(await switchTab(null, 'ws-1', 'tab-a', aLease)).toBeNull();
    expect(await switchTab(null, 'ws-1', 'tab-a')).toBeNull();
    await findHandler('browser-refresh')(null, 'ws-1', aLease);
    expect(b.view.webContents.reload).not.toHaveBeenCalled();
    expect(b.view.setBounds.mock.calls).toHaveLength(calls);
    expect(b.view.setVisible).toHaveBeenLastCalledWith(true);
    expect(await navigate(null, 'ws-1', 'tab-a', 'https://example.com')).toBe(true);
    expect(a.view.webContents.loadURL).toHaveBeenLastCalledWith('https://example.com/');
    expect(b.view.setVisible).toHaveBeenLastCalledWith(true);
    expect(await activate(null, 'ws-1', 'tab-a', { paneId: 'pane-b', epoch: 3 })).toBe(false);
    expect(await findHandler('browser-close-tab')(null, 'ws-1', 'tab-a')).toBe(false);
    expect(await findHandler('browser-close-tab')(null, 'ws-1', 'tab-b')).toBe(false);
    expect(await findHandler('browser-get-tabs')(null, 'ws-1', 'pane-b')).toEqual([{ tabId: 'tab-b', url: 'https://github.com', title: '' }]);
    expect(await findHandler('browser-get-tabs')(null, 'ws-1')).toEqual([]);
    expect(await navigate(null, 'ws-1', 'unknown', 'https://example.com')).toBe(false);
    expect(mockBrowserViews.get('ws-1').has('unknown')).toBe(false);
    await create(null, 'ws-1', 'tab-a2', 'pane-a');
    expect(await findHandler('browser-close-tab')(null, 'ws-1', 'tab-a')).toBe(true);
    expect(await navigate(null, 'ws-1', 'tab-a', 'https://example.com')).toBe(false);
    expect(await activate(null, 'ws-1', 'tab-a', { paneId: 'pane-a', epoch: 4 })).toBe(false);
    expect(mockBrowserViews.get('ws-1').has('tab-a')).toBe(false);
    await hide(null, 'ws-1', bLease);
    expect(b.view.setVisible).toHaveBeenLastCalledWith(false);
    expect(await activate(null, 'ws-1', 'tab-b', bLease)).toBe(false);
    expect(await activate(null, 'ws-1', 'tab-b', { ...bLease, epoch: 5 })).toBe(true);
    controller.disposeAll();
  });

  test('unknown explicit navigation never creates resources, while legacy implicit navigation remains supported', async () => {
    const { deps } = createMockDeps();
    const controller = registerBrowserIpc(deps);
    const navigate = findHandler('browser-tab-navigate');
    expect(await navigate(null, 'ws-1', 'unknown', 'https://example.com')).toBe(false);
    expect(deps.getBrowserViews().size).toBe(0);
    expect(await findHandler('browser-navigate')(null, 'ws-1', 'https://example.com', 'unknown')).toBe(false);
    expect(await findHandler('browser-navigate')(null, 'ws-1', 'https://example.com')).toBe(true);
    controller.disposeWorkspace('ws-1');
    expect(await navigate(null, 'ws-1', '__fallback_tab__', 'https://example.com')).toBe(false);
    expect(deps.getBrowserViews().size).toBe(0);
  });

  test('BROWSER_CREATE_TAB records the renderer-provided id and returns default url', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const getTabs = findHandler('browser-get-tabs');

    const result = await create(null, 'ws-1', 'tab-a');
    expect(result).toEqual({ url: 'https://github.com', title: '' });

    const tabs = await getTabs(null, 'ws-1');
    expect(tabs).toEqual([{ tabId: 'tab-a', url: 'https://github.com', title: '' }]);
  });

  test('BROWSER_CREATE_TAB is idempotent for the same id', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const getTabs = findHandler('browser-get-tabs');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-a');

    const tabs = await getTabs(null, 'ws-1');
    expect(tabs).toHaveLength(1);
  });

  test('BROWSER_SWITCH_TAB returns null for unknown tab and does not change state', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const switchTab = findHandler('browser-switch-tab');

    await create(null, 'ws-1', 'tab-a');
    const result = await switchTab(null, 'ws-1', 'tab-missing');
    expect(result).toBeNull();
  });

  test('BROWSER_SWITCH_TAB returns the tab record for a known tab', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const switchTab = findHandler('browser-switch-tab');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');
    const result = await switchTab(null, 'ws-1', 'tab-b');
    expect(result).toEqual({ url: 'https://github.com', title: '' });
  });

  test('BROWSER_MOVE_TAB keeps native order and the selected page together', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);
    const create = findHandler('browser-create-tab');
    const move = findHandler('browser-move-tab');
    const getTabs = findHandler('browser-get-tabs');
    const setBounds = findHandler('browser-set-bounds');
    const navigate = findHandler('browser-tab-navigate');
    const getUrl = findHandler('browser-get-url');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');
    await create(null, 'ws-1', 'tab-c');
    await navigate(null, 'ws-1', 'tab-b', 'https://example.com/');
    await findHandler('browser-activate')(null, 'ws-1', 'tab-c');
    await setBounds(null, 'ws-1', { x: 0, y: 0, width: 500, height: 300 }, 'tab-c');

    expect(await move(null, 'ws-1', 'tab-a', 'tab-c', 'tab-b')).toBe(true);
    expect((await getTabs(null, 'ws-1')).map((tab: { tabId: string }) => tab.tabId)).toEqual(['tab-b', 'tab-c', 'tab-a']);
    expect(await getUrl(null, 'ws-1')).toBe('https://example.com/');
    expect(deps.getBrowserViews().get('ws-1')?.get('tab-b')?.view.setVisible).toHaveBeenLastCalledWith(true);
    expect(deps.getBrowserViews().get('ws-1')?.get('tab-c')?.view.setVisible).toHaveBeenLastCalledWith(false);
    expect(await move(null, 'ws-1', 'missing', 'tab-c', 'tab-b')).toBe(false);
  });

  test('a stale bounds update cannot replace a newly selected tab', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);
    const create = findHandler('browser-create-tab');
    const setBounds = findHandler('browser-set-bounds');
    const switchTab = findHandler('browser-switch-tab');
    const navigate = findHandler('browser-tab-navigate');
    const getUrl = findHandler('browser-get-url');

    await create(null, 'ws-1', 'tab-old');
    await create(null, 'ws-1', 'tab-new');
    await navigate(null, 'ws-1', 'tab-old', 'https://redsox.com/');
    await findHandler('browser-activate')(null, 'ws-1', 'tab-old');
    await setBounds(null, 'ws-1', { x: 0, y: 0, width: 500, height: 300 }, 'tab-old');
    await switchTab(null, 'ws-1', 'tab-new');
    await setBounds(null, 'ws-1', { x: 0, y: 0, width: 500, height: 300 }, 'tab-old');

    expect(await getUrl(null, 'ws-1')).toBe('https://github.com');
    expect(deps.getBrowserViews().get('ws-1')?.get('tab-new')?.view.setVisible).toHaveBeenLastCalledWith(true);
    expect(deps.getBrowserViews().get('ws-1')?.get('tab-old')?.view.setVisible).toHaveBeenLastCalledWith(false);
  });

  test('BROWSER_CLOSE_TAB refuses to close the last tab and returns false', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const close = findHandler('browser-close-tab');
    const getTabs = findHandler('browser-get-tabs');

    await create(null, 'ws-1', 'tab-a');
    const result = await close(null, 'ws-1', 'tab-a');
    expect(result).toBe(false);

    const tabs = await getTabs(null, 'ws-1');
    expect(tabs).toHaveLength(1);
  });

  test('BROWSER_CLOSE_TAB returns false for unknown tab id', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const close = findHandler('browser-close-tab');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');
    const result = await close(null, 'ws-1', 'tab-unknown');
    expect(result).toBe(false);
  });

  test('BROWSER_CLOSE_TAB removes the tab and updates active when closing the active tab', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const switchTab = findHandler('browser-switch-tab');
    const close = findHandler('browser-close-tab');
    const getTabs = findHandler('browser-get-tabs');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');
    await create(null, 'ws-1', 'tab-c');
    await switchTab(null, 'ws-1', 'tab-b');

    const result = await close(null, 'ws-1', 'tab-b');
    expect(result).toBe(true);

    const tabs = await getTabs(null, 'ws-1');
    expect(tabs.map((t: { tabId: string }) => t.tabId)).toEqual(['tab-a', 'tab-c']);
  });

  test('BROWSER_TAB_NAVIGATE rejects invalid URL schemes', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const tabNavigate = findHandler('browser-tab-navigate');

    await create(null, 'ws-1', 'tab-a');
    const result = await tabNavigate(null, 'ws-1', 'tab-a', 'javascript:alert(1)');
    expect(result).toBe(false);
  });

  test('BROWSER_TAB_NAVIGATE allows trusted app-initiated file URLs', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const tabNavigate = findHandler('browser-tab-navigate');
    const switchTab = findHandler('browser-switch-tab');

    await create(null, 'ws-1', 'tab-a');
    await switchTab(null, 'ws-1', 'tab-a');
    const result = await tabNavigate(null, 'ws-1', 'tab-a', 'file:///tmp/report.html');
    expect(result).toBe(true);

    const entry = deps.getBrowserViews().get('ws-1')?.get('tab-a');
    expect(entry?.url).toBe('file:///tmp/report.html');
    expect(entry?.view.webContents.loadURL).toHaveBeenLastCalledWith('file:///tmp/report.html');
  });

  test('BROWSER_TAB_NAVIGATE loads inactive tab views so concurrent activations stay consistent', async () => {
    const { deps, mockMainWindow } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const switchTab = findHandler('browser-switch-tab');
    const tabNavigate = findHandler('browser-tab-navigate');
    const getTabs = findHandler('browser-get-tabs');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');
    await switchTab(null, 'ws-1', 'tab-a');

    const inactiveEntry = deps.getBrowserViews().get('ws-1')?.get('tab-b');
    inactiveEntry?.view.webContents.loadURL.mockClear();

    mockMainWindow.webContents.send.mockClear();
    const result = await tabNavigate(null, 'ws-1', 'tab-b', 'https://other.example/');
    expect(result).toBe(true);

    const tabs = await getTabs(null, 'ws-1');
    const recordB = tabs.find((t: { tabId: string }) => t.tabId === 'tab-b');
    expect(recordB?.url).toBe('https://other.example/');

    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
      'browser-url-updated',
      expect.objectContaining({ workspaceId: 'ws-1', tabId: 'tab-b', url: 'https://other.example/' }),
    );
    expect(inactiveEntry?.view.webContents.loadURL).toHaveBeenCalledWith('https://other.example/');
  });

  test('BROWSER_GET_TABS returns empty array for unknown workspace', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const getTabs = findHandler('browser-get-tabs');
    const tabs = await getTabs(null, 'ws-unknown');
    expect(tabs).toEqual([]);
  });

  test('BROWSER_NAVIGATE keeps working without a tabId (compatibility)', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const navigate = findHandler('browser-navigate');
    const result = await navigate(null, 'ws-1', 'https://github.com/');
    expect(result).toBe(true);
  });

  test('recipe navigation observes loadURL failure while normal navigation remains immediate', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);
    const navigate = findHandler('browser-navigate');
    expect(await navigate(null, 'ws-1', 'https://example.com/')).toBe(true);
    const entry = deps.getBrowserViews().get('ws-1')?.get('__fallback_tab__');
    expect(entry).toBeDefined();
    vi.mocked(entry!.view.webContents.loadURL).mockRejectedValueOnce(new Error('Navigation failed'));
    expect(await navigate(null, 'ws-1', 'https://example.com/', undefined, true)).toBe(false);
  });

  test('BROWSER_SET_BOUNDS accepts optional tabId for tab-aware callers', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const setBounds = findHandler('browser-set-bounds');

    await create(null, 'ws-1', 'tab-a');
    const result = await setBounds(null, 'ws-1', { x: 0, y: 0, width: 100, height: 100 }, 'tab-a');
    expect(result).toBeUndefined();
  });

  test('creates distinct WebContentsView entries for two tabs in one workspace', async () => {
    const { deps, mockBrowserViews } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');

    const workspaceViews = mockBrowserViews.get('ws-1') as Map<string, { view: unknown }>;
    expect(workspaceViews.get('tab-a')?.view).toBeDefined();
    expect(workspaceViews.get('tab-b')?.view).toBeDefined();
    expect(workspaceViews.get('tab-a')?.view).not.toBe(workspaceViews.get('tab-b')?.view);
  });

  test('bounds show the selected tab and hide sibling views', async () => {
    const { deps, mockBrowserViews } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const setBounds = findHandler('browser-set-bounds');
    const switchTab = findHandler('browser-switch-tab');
    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');

    await switchTab(null, 'ws-1', 'tab-b');
    await setBounds(null, 'ws-1', { x: 1, y: 2, width: 300, height: 200 }, 'tab-a');
    await findHandler('browser-activate')(null, 'ws-1', 'tab-b');

    const workspaceViews = mockBrowserViews.get('ws-1') as Map<string, { view: { setVisible: ReturnType<typeof vi.fn>; setBounds: ReturnType<typeof vi.fn> } }>;
    expect(workspaceViews.get('tab-a')?.view.setVisible).toHaveBeenLastCalledWith(false);
    expect(workspaceViews.get('tab-b')?.view.setBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 300, height: 200 });
    expect(workspaceViews.get('tab-b')?.view.setVisible).toHaveBeenLastCalledWith(true);
  });

  test('hiding and disposing a workspace affects all tab views', async () => {
    const { deps, mockBrowserViews } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const hide = findHandler('browser-hide');
    const dispose = findHandler('browser-dispose-workspace');
    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');

    const workspaceViews = mockBrowserViews.get('ws-1') as Map<string, { view: { setVisible: ReturnType<typeof vi.fn>; webContents: { close: ReturnType<typeof vi.fn> } } }>;
    const tabA = workspaceViews.get('tab-a');
    const tabB = workspaceViews.get('tab-b');
    await hide(null, 'ws-1');
    expect(tabA?.view.setVisible).toHaveBeenLastCalledWith(false);
    expect(tabB?.view.setVisible).toHaveBeenLastCalledWith(false);

    await dispose(null, 'ws-1');
    expect(tabA?.view.webContents.close).toHaveBeenCalled();
    expect(tabB?.view.webContents.close).toHaveBeenCalled();
    expect(mockBrowserViews.has('ws-1')).toBe(false);
  });
});

describe('registerBrowserIpc — browser history handlers (Phase 4)', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & { handle: ReturnType<typeof vi.fn> };
  type AnyHandler = (..._args: unknown[]) => unknown;

  function createMockDeps() {
    const mockBrowserViews = new Map<string, never>();
    let mockActiveWorkspaceId: string | null = null;
    const mockMainWindow = {
      webContents: { send: vi.fn(), getZoomLevel: vi.fn(() => 0) },
      contentView: { addChildView: vi.fn() },
    };
    return {
      mockBrowserViews,
      deps: {
        getMainWindow: () => mockMainWindow as never,
        getBrowserViews: () => mockBrowserViews as never,
        getActiveBrowserWorkspaceId: () => mockActiveWorkspaceId,
        setActiveBrowserWorkspaceId: (id: string | null) => { mockActiveWorkspaceId = id; },
      },
    };
  }

  function findHandler(name: string): AnyHandler {
    const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === name)?.[1] as AnyHandler | undefined;
    if (!handler) throw new Error(`handler ${name} not registered`);
    return handler;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    attachedDidNavigateHandler = null;
    const mod = await import('../../../src/main/ipc/browserIpc');
    mod.__resetBrowserTabState();
    __resetBrowserHistoryServiceForTests(new BrowserHistoryService(new MemoryHistoryStore()));
  });

  test('history IPC add/get/clear handlers are registered and enforce HTTP(S)', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const add = findHandler('browser-history-add');
    const get = findHandler('browser-history-get');
    const clear = findHandler('browser-history-clear');

    expect(await add(null, 'about:blank', 'Blank')).toBe(false);
    expect(await add(null, 'https://github.com/clanker-grid', 'Grid')).toBe(true);
    expect(await get(null, 'git')).toEqual([
      expect.objectContaining({ url: 'https://github.com/clanker-grid', title: 'Grid' }),
    ]);
    expect(await clear(null)).toBe(true);
    expect(await get(null, 'git')).toEqual([]);
  });

  test('committed navigation events record HTTP(S) URLs in history', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const get = findHandler('browser-history-get');
    await create(null, 'ws-1', 'tab-a');

    expect(attachedDidNavigateHandler).not.toBeNull();
    attachedDidNavigateHandler?.(null, 'https://github.com/clanker-grid');
    attachedDidNavigateHandler?.(null, 'about:blank');

    expect(await get(null, 'github.com')).toEqual([
      expect.objectContaining({ url: 'https://github.com/clanker-grid', title: 'Navigated title' }),
    ]);
  });
});

// ===========================================================================
// Phase 6 — Integration hardening tests
// ===========================================================================
describe('registerBrowserIpc — integration hardening (Phase 6)', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & { handle: ReturnType<typeof vi.fn> };
  type AnyHandler = (..._args: unknown[]) => unknown;

  function createMockDeps() {
    const mockBrowserViews = new Map<string, Map<string, { view: { setVisible: ReturnType<typeof vi.fn>; setBounds: ReturnType<typeof vi.fn>; webContents: { close: ReturnType<typeof vi.fn>; loadURL: ReturnType<typeof vi.fn>; getZoomLevel: ReturnType<typeof vi.fn>; setZoomLevel: ReturnType<typeof vi.fn>; getTitle: ReturnType<typeof vi.fn>; navigationHistory: { canGoBack: ReturnType<typeof vi.fn>; canGoForward: ReturnType<typeof vi.fn>; goBack: ReturnType<typeof vi.fn>; goForward: ReturnType<typeof vi.fn> }; reload: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; setWindowOpenHandler: ReturnType<typeof vi.fn>; openDevTools: ReturnType<typeof vi.fn>; closeDevTools: ReturnType<typeof vi.fn>; isDevToolsOpened: ReturnType<typeof vi.fn>; inspectElement: ReturnType<typeof vi.fn> } } }>>();
    let mockActiveWorkspaceId: string | null = null;
    const mockMainWindow = {
      webContents: { send: vi.fn(), getZoomLevel: vi.fn(() => 0) },
      contentView: { addChildView: vi.fn() },
    };
    return {
      mockMainWindow,
      mockBrowserViews,
      deps: {
        getMainWindow: () => mockMainWindow as never,
        getBrowserViews: () => mockBrowserViews as never,
        getActiveBrowserWorkspaceId: () => mockActiveWorkspaceId,
        setActiveBrowserWorkspaceId: (id: string | null) => { mockActiveWorkspaceId = id; },
      },
    };
  }

  function findHandler(name: string): AnyHandler {
    const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === name)?.[1] as AnyHandler | undefined;
    if (!handler) throw new Error(`handler ${name} not registered`);
    return handler;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    attachedDidNavigateHandler = null;
    const mod = await import('../../../src/main/ipc/browserIpc');
    mod.__resetBrowserTabState();
    __resetBrowserHistoryServiceForTests(new BrowserHistoryService(new MemoryHistoryStore()));
  });

  test('late background tab operations and bounds cannot take over the foreground workspace', async () => {
    const { deps, mockBrowserViews } = createMockDeps();
    registerBrowserIpc(deps);
    const create = findHandler('browser-create-tab');
    const activate = findHandler('browser-activate');
    const bounds = findHandler('browser-set-bounds');
    const switchTab = findHandler('browser-switch-tab');
    const navigate = findHandler('browser-tab-navigate');
    const viewport = { x: 0, y: 0, width: 800, height: 600 };
    for (const [workspaceId, tabs] of [['ws-a', ['a1', 'a2']], ['ws-b', ['b1', 'b2']]] as const) {
      for (const tabId of tabs) await create(null, workspaceId, tabId);
    }
    await activate(null, 'ws-a', 'a2');
    await bounds(null, 'ws-a', viewport, 'a2');

    let finish!: () => void;
    const delayedCreation = new Promise<void>((resolve) => { finish = resolve; }).then(async () => {
      await create(null, 'ws-a', 'a3');
      await navigate(null, 'ws-a', 'a3', 'https://a3.example/');
      await switchTab(null, 'ws-a', 'a3');
      await bounds(null, 'ws-a', viewport, 'a2');
      await findHandler('browser-move-tab')(null, 'ws-a', 'a1', 'a2', 'a3');
    });
    await activate(null, 'ws-b', 'b2');
    await bounds(null, 'ws-b', viewport, 'b2');
    finish();
    await delayedCreation;

    expect(deps.getActiveBrowserWorkspaceId()).toBe('ws-b');
    const assertVisible = (workspaceId: string, tabId: string) => {
      for (const [id, views] of mockBrowserViews) {
        for (const [tab, { view }] of views) {
          expect(view.setVisible).toHaveBeenLastCalledWith(id === workspaceId && tab === tabId);
        }
      }
    };
    assertVisible('ws-b', 'b2');

    // Reconcile a renderer selection that differs from the background main state.
    await activate(null, 'ws-a', 'a1');
    assertVisible('ws-a', 'a1');
    await switchTab(null, 'ws-a', 'a2');
    await bounds(null, 'ws-a', viewport, 'a1');
    assertVisible('ws-a', 'a2');
    await activate(null, 'ws-b', 'b1');
    await bounds(null, 'ws-a', viewport, 'a3');
    assertVisible('ws-b', 'b1');
    await activate(null, 'ws-a', 'a3');
    expect(await findHandler('browser-get-url')(null, 'ws-a')).toBe('https://a3.example/');
    assertVisible('ws-a', 'a3');

    await findHandler('browser-hide')(null, 'ws-a');
    await bounds(null, 'ws-a', viewport, 'a3');
    await switchTab(null, 'ws-a', 'a2');
    expect(deps.getActiveBrowserWorkspaceId()).toBeNull();
    for (const views of mockBrowserViews.values()) {
      for (const { view } of views.values()) expect(view.setVisible).toHaveBeenLastCalledWith(false);
    }
  });

  test('no stale views remain visible after tab switch', async () => {
    const { deps, mockBrowserViews } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const setBounds = findHandler('browser-set-bounds');
    const switchTab = findHandler('browser-switch-tab');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');
    await create(null, 'ws-1', 'tab-c');

    // Show tab-a
    await findHandler('browser-activate')(null, 'ws-1', 'tab-a');
    await setBounds(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 }, 'tab-a');
    // Switch to tab-c
    await switchTab(null, 'ws-1', 'tab-c');
    await setBounds(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 }, 'tab-a');

    const workspaceViews = mockBrowserViews.get('ws-1')!;
    // Only tab-c should be visible
    let visibleCount = 0;
    for (const entry of workspaceViews.values()) {
      const calls = entry.view.setVisible.mock.calls;
      const lastVisibleCall = calls[calls.length - 1];
      if (lastVisibleCall?.[0] === true) visibleCount++;
    }
    expect(visibleCount).toBe(1);

    const tabC = workspaceViews.get('tab-c')!;
    expect(tabC.view.setVisible).toHaveBeenLastCalledWith(true);
    const tabA = workspaceViews.get('tab-a')!;
    expect(tabA.view.setVisible).toHaveBeenLastCalledWith(false);
  });

  test('no stale views remain visible after browser hide', async () => {
    const { deps, mockBrowserViews } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const setBounds = findHandler('browser-set-bounds');
    const hide = findHandler('browser-hide');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');
    await setBounds(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 }, 'tab-a');
    await hide(null, 'ws-1');

    const workspaceViews = mockBrowserViews.get('ws-1')!;
    for (const entry of workspaceViews.values()) {
      expect(entry.view.setVisible).toHaveBeenLastCalledWith(false);
    }
  });

  test('workspace dispose closes all tab views and clears state', async () => {
    const { deps, mockBrowserViews } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const dispose = findHandler('browser-dispose-workspace');
    const getTabs = findHandler('browser-get-tabs');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');
    await dispose(null, 'ws-1');

    expect(mockBrowserViews.has('ws-1')).toBe(false);
    const tabs = await getTabs(null, 'ws-1');
    expect(tabs).toEqual([]);
  });

  test('closing active tab selects adjacent and shows fallback', async () => {
    const { deps, mockBrowserViews } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const setBounds = findHandler('browser-set-bounds');
    const close = findHandler('browser-close-tab');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');
    await setBounds(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 }, 'tab-b');

    await findHandler('browser-activate')(null, 'ws-1', 'tab-b');

    // Close active tab-b — should fall back to tab-a
    await close(null, 'ws-1', 'tab-b');

    const workspaceViews = mockBrowserViews.get('ws-1')!;
    expect(workspaceViews.has('tab-b')).toBe(false);

    // tab-a should now be visible (it becomes the fallback)
    const tabA = workspaceViews.get('tab-a')!;
    expect(tabA.view.setVisible).toHaveBeenLastCalledWith(true);
  });

  test('BROWSER_NAVIGATE without tabId uses active tab (backward compat)', async () => {
    const { deps, mockMainWindow } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const setBounds = findHandler('browser-set-bounds');
    const navigate = findHandler('browser-navigate');
    const getTabs = findHandler('browser-get-tabs');

    await create(null, 'ws-1', 'tab-a');
    await setBounds(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 }, 'tab-a');

    // Navigate without tabId — should target the active tab
    const result = await navigate(null, 'ws-1', 'https://example.com/');
    expect(result).toBe(true);

    const tabs = await getTabs(null, 'ws-1');
    expect(tabs).toEqual([
      expect.objectContaining({ tabId: 'tab-a', url: 'https://example.com/' }),
    ]);

    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
      'browser-url-updated',
      expect.objectContaining({ workspaceId: 'ws-1', url: 'https://example.com/' }),
    );
  });

  test('history persists across clear and re-query', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const add = findHandler('browser-history-add');
    const get = findHandler('browser-history-get');
    const clear = findHandler('browser-history-clear');

    await add(null, 'https://example.com/page1', 'Page 1');
    await add(null, 'https://example.com/page2', 'Page 2');
    expect(await get(null, 'example')).toHaveLength(2);

    await clear(null);
    expect(await get(null, 'example')).toHaveLength(0);

    // Re-add after clear
    await add(null, 'https://example.com/page3', 'Page 3');
    expect(await get(null, 'example')).toHaveLength(1);
  });

  test('BROWSER_GET_URL returns the active tab URL', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const setBounds = findHandler('browser-set-bounds');
    const tabNavigate = findHandler('browser-tab-navigate');
    const getUrl = findHandler('browser-get-url');

    await create(null, 'ws-1', 'tab-a');
    await setBounds(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 }, 'tab-a');
    await tabNavigate(null, 'ws-1', 'tab-a', 'https://example.com/');

    const url = await getUrl(null, 'ws-1');
    expect(url).toBe('https://example.com/');
  });
});
