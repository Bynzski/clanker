/**
 * Integration Smoke Test: IPC Registration
 *
 * Verifies that all IPC modules register their expected channels on app startup.
 * If a registration call is missing or a dependency is mis-wired, this test fails
 * at build time rather than at runtime.
 *
 * per S2.7.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testHome } from '../../_helpers/tempPaths';
import { ALL_IPC_CHANNELS } from '../../../src/shared/ipcChannels';

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('IPC registration smoke test', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('registers all IPC channels', async () => {
    // ── Mock Electron modules ───────────────────────────────────────────────
    const handleMock = vi.fn();
    const onMock = vi.fn();

    vi.doMock('electron', () => ({
      app: {
        disableHardwareAcceleration: vi.fn(),
        commandLine: { appendSwitch: vi.fn() },
        whenReady: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        quit: vi.fn(),
        getPath: vi.fn(() => testHome()),
        activate: vi.fn(),
      },
      ipcMain: {
        handle: handleMock,
        on: onMock,
        removeHandler: vi.fn(),
      },
      BrowserWindow: vi.fn(),
      dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) },
      shell: { openExternal: vi.fn() },
    }));

    // electron-store uses both: import Store from 'electron-store' (default) and new Store(...) (named)
    // Mock as a class so that both `new Store()` and `import Store` work
    class MockStore {
      get = vi.fn();
      set = vi.fn();
    }
    vi.doMock('electron-store', () => ({
      __esModule: true,
      default: MockStore,
      Store: MockStore,
    }));

    vi.doMock('node-pty', () => ({
      spawn: vi.fn(() => ({
        pid: 12345,
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
      })),
    }));

    // ── Import modules ──────────────────────────────────────────────────────
    await import('electron');
    const { registerSettingsIpc } = await import('../../../src/main/ipc/settingsIpc');
    const { registerWindowIpc } = await import('../../../src/main/ipc/windowIpc');
    const { registerAiCommitIpc } = await import('../../../src/main/ipc/aiCommitIpc');
    const { registerTerminalIpc } = await import('../../../src/main/ipc/terminalIpc');
    const { registerBrowserIpc } = await import('../../../src/main/ipc/browserIpc');
    const { registerGitIpc } = await import('../../../src/main/ipc/gitIpc');
    const { registerCredentialIpc } = await import('../../../src/main/ipc/credentialIpc');
    const { registerFileIpc } = await import('../../../src/main/ipc/fileIpc');
    const { registerVcsIpc } = await import('../../../src/main/ipc/vcsIpc');
    const { registerAnnotationIpc } = await import('../../../src/main/annotation/annotationIpc');
    const { registerSessionIpc } = await import('../../../src/main/ipc/sessionIpc');

    interface MockStoreSchema {
      lastWorkspace: string;
      showFastfetch: boolean;
      aiCommitEnabled: boolean;
      aiCommitProvider: string;
      aiCommitModel: string;
      harnessDefaults: Record<string, { model: string; favorites: string[]; flags: string }>;
    }

    const mockTerminals = new Map<string, { id: string; pid: number }>();
    let mockActiveBrowserWorkspaceId: string | null = null;

    const mockGitService = {
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      getStatus: vi.fn().mockResolvedValue({
        success: true,
        isRepo: true,
        currentBranch: 'main',
        isDetached: false,
        changes: [],
        upstream: null,
        ahead: 0,
        behind: 0,
      }),
      getBranchState: vi.fn().mockResolvedValue({ success: true, currentBranch: 'main', branches: [] }),
      getRemotes: vi.fn().mockResolvedValue({ success: true, remotes: [] }),
      fetch: vi.fn().mockResolvedValue({ success: true }),
      pull: vi.fn().mockResolvedValue({ success: true }),
      push: vi.fn().mockResolvedValue({ success: true }),
      addRemote: vi.fn().mockResolvedValue({ success: true }),
      removeRemote: vi.fn().mockResolvedValue({ success: true }),
      renameRemote: vi.fn().mockResolvedValue({ success: true }),
      getCommitPromptContext: vi.fn().mockResolvedValue({
        success: true,
        currentBranch: 'main',
        isDetached: false,
        changes: [],
        diffMode: 'unstaged' as const,
        diffSummary: '',
      }),
      getCurrentWorkspace: vi.fn().mockReturnValue(null),
      isRepo: vi.fn().mockResolvedValue(false),
      initRepository: vi.fn().mockResolvedValue({ success: true }),
      stage: vi.fn().mockResolvedValue({ success: true }),
      unstage: vi.fn().mockResolvedValue({ success: true }),
      commit: vi.fn().mockResolvedValue({ success: true }),
      createBranch: vi.fn().mockResolvedValue({ success: true }),
      switchBranch: vi.fn().mockResolvedValue({ success: true }),
      deleteBranch: vi.fn().mockResolvedValue({ success: true }),
      forceDeleteBranch: vi.fn().mockResolvedValue({ success: true }),
      mergeBranch: vi.fn().mockResolvedValue({ success: true }),
      abortCurrentOperation: vi.fn().mockResolvedValue({ success: true }),
      stashChanges: vi.fn().mockResolvedValue({ success: true }),
      applyStash: vi.fn().mockResolvedValue({ success: true }),
      popStash: vi.fn().mockResolvedValue({ success: true }),
      dropStash: vi.fn().mockResolvedValue({ success: true }),
      clearStashes: vi.fn().mockResolvedValue({ success: true }),
      getOperationState: vi.fn().mockResolvedValue({ success: true, inProgress: false, mode: 'none', conflicts: [] }),
      listStashes: vi.fn().mockResolvedValue([]),
      getHistory: vi.fn().mockResolvedValue([]),
      getDiff: vi.fn().mockResolvedValue({ success: true, output: '', title: 'Diff' }),
    };

    const mockStore = {
      get: vi.fn((key: keyof MockStoreSchema) => {
        const defaults: MockStoreSchema = {
          lastWorkspace: testHome(),
          showFastfetch: false,
          aiCommitEnabled: false,
          aiCommitProvider: 'codex',
          aiCommitModel: '',
          harnessDefaults: {},
        };
        return defaults[key];
      }),
      set: vi.fn(),
    };

    const mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
      contentView: { addChildView: vi.fn() },
    } as unknown as { webContents: { send: ReturnType<typeof vi.fn> }; contentView: { addChildView: ReturnType<typeof vi.fn> } };

    const mockFileWatcher = {
      watchFile: vi.fn(),
      unwatchFile: vi.fn(),
      markWritten: vi.fn(),
    };

    const mockExplorerWatcher = {
      watchWorkspace: vi.fn(),
      close: vi.fn(),
    };

    // ── Register all IPC modules ────────────────────────────────────────────
    registerSettingsIpc({
      getStore: () => mockStore as never,
      getMainWindow: () => mockMainWindow as never,
    });

    registerWindowIpc({
      getMainWindow: () => mockMainWindow as never,
    });

    registerAiCommitIpc({
      getStore: () => mockStore as never,
      getGitService: () => mockGitService as never,
    });

    registerTerminalIpc({
      getTerminals: () => mockTerminals as never,
      getMainWindow: () => mockMainWindow as never,
      getStore: () => mockStore as never,
      getSafeWorkspacePath: () => testHome(),
      getHarnessOptions: () => ({}),
    });

    registerBrowserIpc({
      getMainWindow: () => mockMainWindow as never,
      getBrowserViews: () => new Map(),
      getActiveBrowserWorkspaceId: () => mockActiveBrowserWorkspaceId,
      setActiveBrowserWorkspaceId: (id) => { mockActiveBrowserWorkspaceId = id; },
    });

    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    registerCredentialIpc();
    registerFileIpc({ getFileWatcher: () => mockFileWatcher as never, getExplorerWatcher: () => mockExplorerWatcher as never });

    registerVcsIpc({
      getGitService: () => mockGitService as never,
    });

    registerAnnotationIpc({
      getBrowserViews: () => new Map(),
      getActiveBrowserWorkspaceId: () => mockActiveBrowserWorkspaceId,
      getMainWindow: () => mockMainWindow as never,
    });

    registerSessionIpc({
      getTerminals: () => mockTerminals as never,
      getMainWindow: () => mockMainWindow as never,
      getSafeWorkspacePath: () => testHome(),
      getIsShuttingDown: () => false,
      getStore: () => mockStore as never,
      getHarnessOptions: () => ({}),
    });

    // ── Assert ──────────────────────────────────────────────────────────────
    const allRegistered = [
      ...handleMock.mock.calls.map((args: unknown[]) => String(args[0])),
      ...onMock.mock.calls.map((args: unknown[]) => String(args[0])),
    ];

    const canonicalChannels = [...ALL_IPC_CHANNELS];

    const missing = canonicalChannels.filter((ch) => !allRegistered.includes(ch));
    const unexpected = allRegistered.filter((ch) => !canonicalChannels.includes(ch) && !ch.startsWith('__'));

    expect(missing, `Missing channels: ${missing.join(', ')}`).toHaveLength(0);
    expect(unexpected, `Unexpected channels: ${unexpected.join(', ')}`).toHaveLength(0);
  });
});
