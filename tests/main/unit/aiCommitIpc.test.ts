import type { HarnessAiCommitCapability } from '../../../src/main/harnesses/types';
import { executeLocalHarnessCommand } from '../../../src/main/environment/localCommandExecutor';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';
/**
 * AI Commit IPC Registration Tests
 *
 * Tests for the AI commit IPC module, verifying channel registration and error handling.
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';
import { testHome } from '../../_helpers/tempPaths';

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
    close: vi.fn(),
    isMaximized: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
    },
    contentView: {
      addChildView: vi.fn(),
    },
  })),
  Menu: Object.assign(vi.fn(), {
    setApplicationMenu: vi.fn(),
  }),
  WebContentsView: vi.fn(() => ({
    setVisible: vi.fn(),
    setBounds: vi.fn(),
    webContents: {
      loadURL: vi.fn(),
      close: vi.fn(),
      reload: vi.fn(),
      stop: vi.fn(),
      on: vi.fn(),
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        goBack: vi.fn(),
        goForward: vi.fn(),
      },
    },
  })),
  ipcMain: {
    handle: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('../../../src/main/environment/localCommandExecutor', () => ({ executeLocalHarnessCommand: vi.fn() }));

const { mockGitServiceGetStatus, mockGitServiceGetCommitPromptContext } = vi.hoisted(() => ({
  mockGitServiceGetStatus: vi.fn(),
  mockGitServiceGetCommitPromptContext: vi.fn(),
}));

const { mockResolveExistingDirectory } = vi.hoisted(() => ({
  mockResolveExistingDirectory: vi.fn().mockReturnValue(null),
}));

const { mockDiscoverHarnessModels } = vi.hoisted(() => ({
  mockDiscoverHarnessModels: vi.fn(),
}));

vi.mock('../../../src/main/harnessCatalog', () => ({
  discoverHarnessModels: mockDiscoverHarnessModels,
  getAvailableHarnessOptions: vi.fn(),
}));

vi.mock('../../../src/main/gitService', () => ({
  GitService: vi.fn().mockImplementation(() => ({
    getStatus: mockGitServiceGetStatus,
    getCommitPromptContext: mockGitServiceGetCommitPromptContext,
  })),
}));

vi.mock('../../../src/main/security', () => ({
  resolveExistingDirectory: mockResolveExistingDirectory,
}));

import { ipcMain } from 'electron';
import { registerAiCommitIpc } from '../../../src/main/ipc/aiCommitIpc';

describe('registerAiCommitIpc', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockDeps = () => {
    const mockStore = {
      get: vi.fn((key: string) => {
        const defaults: Record<string, unknown> = {
          lastWorkspace: testHome(),
          aiCommitEnabled: false,
          aiCommitProvider: 'codex',
          aiCommitModel: '',
        };
        return defaults[key];
      }),
      set: vi.fn(),
    };

    const mockGitService = {
      getStatus: vi.fn().mockResolvedValue({ success: true, changes: [] }),
      getCommitPromptContext: vi.fn().mockResolvedValue({
        success: true,
        currentBranch: 'main',
        isDetached: false,
        changes: [],
        diffMode: 'working' as const,
        diffSummary: '',
      }),
    };

    return {
      deps: {
        getStore: () => mockStore as never,
        getGitService: () => mockGitService as never,
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('registers GENERATE_COMMIT_MESSAGE channel', () => {
    const { deps } = createMockDeps();

    registerAiCommitIpc(deps);

    expect(mockIpcMain.handle).toHaveBeenCalledWith('generate-commit-message', expect.any(Function));
  });

  test('registers exactly 1 AI commit IPC channel', () => {
    const { deps } = createMockDeps();

    registerAiCommitIpc(deps);

    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(1);
  });
});

describe('registerAiCommitIpc — error-path: workspace validation and commit generation', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockDeps = () => {
    const mockStore = {
      get: vi.fn((key: string) => {
        const defaults: Record<string, unknown> = {
          lastWorkspace: testHome(),
          aiCommitEnabled: false,
          aiCommitProvider: 'codex',
          aiCommitModel: '',
        };
        return defaults[key];
      }),
      set: vi.fn(),
    };
    const mockGitService = {
      getStatus: mockGitServiceGetStatus,
      getCommitPromptContext: mockGitServiceGetCommitPromptContext,
    };
    return {
      deps: {
        getStore: () => mockStore as never,
        getGitService: () => mockGitService as never,
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverHarnessModels.mockReset();
    mockGitServiceGetStatus.mockReset();
    mockGitServiceGetCommitPromptContext.mockReset();
  });

  test('GENERATE_COMMIT_MESSAGE returns error for invalid workspace path', async () => {
    const { deps } = createMockDeps();
    registerAiCommitIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'generate-commit-message'
    )?.[1] as (_: unknown, workspacePath: string) => Promise<{ success: boolean; error?: string }>;

    const result = await handler(null, '/invalid/nonexistent/path');
    expect(result).toEqual({ success: false, error: 'Workspace path is invalid or not a directory' });
  });

  test('GENERATE_COMMIT_MESSAGE returns error when AI commit is disabled', async () => {
    const mockStore = {
      get: vi.fn((key: string) => {
        if (key === 'aiCommitEnabled') return false;
        if (key === 'aiCommitProvider') return 'codex';
        if (key === 'aiCommitModel') return '';
        return undefined;
      }),
      set: vi.fn(),
    };
    const deps = {
      getStore: () => mockStore as never,
      getGitService: () => ({ getStatus: mockGitServiceGetStatus, getCommitPromptContext: mockGitServiceGetCommitPromptContext } as never),
    };
    mockResolveExistingDirectory.mockResolvedValueOnce(process.cwd());
    registerAiCommitIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'generate-commit-message'
    )?.[1] as (_: unknown, workspacePath: string) => Promise<{ success: boolean; error?: string }>;

    const result = await handler(null, '/some/path');
    expect(result).toEqual({ success: false, error: 'AI commit message generation is disabled' });
  });

  test('GENERATE_COMMIT_MESSAGE returns error when commit prompt context fails', async () => {
    const mockStore = {
      get: vi.fn((key: string) => {
        if (key === 'aiCommitEnabled') return true;
        if (key === 'aiCommitProvider') return 'codex';
        if (key === 'aiCommitModel') return '';
        return undefined;
      }),
      set: vi.fn(),
    };
    const deps = {
      getStore: () => mockStore as never,
      getGitService: () => ({ getStatus: mockGitServiceGetStatus, getCommitPromptContext: mockGitServiceGetCommitPromptContext } as never),
    };
    mockResolveExistingDirectory.mockResolvedValueOnce(process.cwd());
    mockGitServiceGetCommitPromptContext.mockResolvedValue({ success: false, error: 'No changes' });
    registerAiCommitIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'generate-commit-message'
    )?.[1] as (_: unknown, workspacePath: string) => Promise<{ success: boolean; error?: string }>;

    const result = await handler(null, '/some/path');
    expect(result).toEqual({ success: false, error: 'No changes' });
  });
});

test('IPC executes the provider invocation without assuming stdin prompt transport', async () => {
  const capability: HarnessAiCommitCapability = getHarnessProvider('codex').aiCommit;
  const invocation = vi.spyOn(capability, 'buildInvocation').mockReturnValue({
    command: 'different-cli', args: ['--prompt', 'provider prompt'], env: { PROVIDER_SETTING: 'set' }, timeoutMs: 12345,
  });
  vi.mocked(executeLocalHarnessCommand).mockResolvedValueOnce({ stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"fix: provider invocation"}}\n{"type":"turn.completed"}', stderr: 'thinking trace', exitCode: 0 });
  mockResolveExistingDirectory.mockReturnValue(testHome());
  mockDiscoverHarnessModels.mockResolvedValue([{ id: 'selected-model', label: 'Selected' }]);
  const store = { get: (key: string) => ({ aiCommitEnabled: true, aiCommitProvider: 'codex', aiCommitModel: 'selected-model' })[key as 'aiCommitEnabled'] };
  registerAiCommitIpc({ getStore: () => store as never, getGitService: () => ({ getCommitPromptContext: async () => ({ success: true, currentBranch: 'main', changes: [], diffMode: 'working', diffSummary: 'context' }) }) as never });
  try {
    const calls = vi.mocked(ipcMain.handle).mock.calls;
    const handler = calls[calls.length - 1][1];
    expect(await handler({} as never, testHome())).toEqual({ success: true, message: 'fix: provider invocation' });
    expect(invocation).toHaveBeenCalledWith({ model: 'selected-model', prompt: expect.stringContaining('context') });
    expect(executeLocalHarnessCommand).toHaveBeenLastCalledWith(expect.objectContaining({ command: 'different-cli', args: ['--prompt', 'provider prompt'], env: { PROVIDER_SETTING: 'set' }, cwd: testHome(), timeoutMs: 12345, maxOutputBytes: 1024 * 1024 }), expect.any(AbortSignal), 90_000);
  } finally { invocation.mockRestore(); }
});

describe('canonical commit execution', () => {
  const output = '{"type":"item.completed","item":{"type":"agent_message","text":"fix: completed answer"}}\n{"type":"turn.completed"}';
  function setup(model = '') {
    mockResolveExistingDirectory.mockReturnValue(testHome());
    mockGitServiceGetCommitPromptContext.mockResolvedValue({ success: true, currentBranch: 'main', changes: [], diffMode: 'working', diffSummary: 'patch' });
    const store = { get: (key: string) => ({ aiCommitEnabled: true, aiCommitProvider: 'codex', aiCommitModel: model })[key as 'aiCommitEnabled'] };
    const deps = { getStore: () => store as never, getGitService: () => ({ getCommitPromptContext: mockGitServiceGetCommitPromptContext, withWorkspace: (_identity: unknown, run: () => Promise<unknown>) => run() }) as never };
    return { deps, handler: () => vi.mocked(ipcMain.handle).mock.calls.slice(-1)[0][1] };
  }
  beforeEach(() => { vi.mocked(executeLocalHarnessCommand).mockReset(); });

  test('uses the CLI default without model discovery and summarizes all changes', async () => {
    const { deps, handler } = setup();
    registerAiCommitIpc(deps);
    vi.mocked(executeLocalHarnessCommand).mockResolvedValue({ stdout: output, stderr: 'thinking', exitCode: 0 });
    expect(await handler()({} as never, testHome())).toEqual({ success: true, message: 'fix: completed answer' });
    expect(mockGitServiceGetCommitPromptContext).toHaveBeenLastCalledWith(testHome(), 'all');
    expect(vi.mocked(executeLocalHarnessCommand).mock.calls.slice(-1)[0][0].args).not.toContain('-m');
  });

  test('preserves explicit model and binds the selected managed account', async () => {
    const { deps, handler } = setup('not-in-catalog');
    const resolveBinding = vi.fn(() => ({ environment: { CODEX_HOME: '/owned/account' } }));
    registerAiCommitIpc({ ...deps, getHarnessAccountService: () => ({ resolveBinding }) as never });
    vi.mocked(executeLocalHarnessCommand).mockResolvedValue({ stdout: output, stderr: '', exitCode: 0 });
    expect((await handler()({} as never, testHome())).success).toBe(true);
    expect(resolveBinding).toHaveBeenCalledWith({ environmentId: 'local', harness: 'codex', forLaunch: true });
    expect(executeLocalHarnessCommand).toHaveBeenCalledWith(expect.objectContaining({ env: { CODEX_HOME: '/owned/account' }, args: expect.arrayContaining(['-m', 'not-in-catalog']) }), expect.any(AbortSignal), 90_000);
  });

  test.each([
    { stdout: '', stderr: 'fix: stderr is not an answer', exitCode: 0 },
    { stdout: 'First thinking trace\nfix: guess', stderr: '', exitCode: 0 },
    { stdout: output, stderr: 'failed', exitCode: 1 },
    { stdout: output.replace('fix: completed answer', 'Let me think'), stderr: '', exitCode: 0 },
  ])('returns an explicit failure instead of a thinking/log/failed response: %j', async (result) => {
    const { deps, handler } = setup();
    registerAiCommitIpc(deps);
    vi.mocked(executeLocalHarnessCommand).mockResolvedValue(result);
    expect(await handler()({} as never, testHome())).toEqual({ success: false, error: expect.any(String) });
  });

  test('refuses concurrent inference for the same workspace', async () => {
    const { deps, handler } = setup();
    registerAiCommitIpc(deps);
    let finish!: (result: { stdout: string; stderr: string; exitCode: number }) => void;
    vi.mocked(executeLocalHarnessCommand).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const first = handler()({} as never, testHome());
    expect(await handler()({} as never, testHome())).toMatchObject({ success: false, error: expect.stringContaining('already running') });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    finish({ stdout: output, stderr: '', exitCode: 0 });
    expect((await first).success).toBe(true);
  });

  test('shutdown aborts inference, drains it, and refuses new requests', async () => {
    const { deps, handler } = setup();
    const shutdown = registerAiCommitIpc(deps);
    vi.mocked(executeLocalHarnessCommand).mockImplementation((_request, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new Error('Command aborted')), { once: true });
    }));
    const request = handler()({} as never, testHome());
    await vi.waitFor(() => expect(executeLocalHarnessCommand).toHaveBeenCalled());
    await shutdown();
    expect(await request).toEqual({ success: false, error: 'Command aborted' });
    expect(await handler()({} as never, testHome())).toMatchObject({ success: false, error: expect.stringContaining('shutting down') });
  });

  test('does not spawn after a registered workspace closes during context collection', async () => {
    const { deps, handler } = setup();
    const ws = { workspaceId: 'ws', location: { environmentId: 'local', path: testHome() } };
    const getWorkspace = vi.fn().mockReturnValue(ws);
    mockGitServiceGetCommitPromptContext.mockImplementationOnce(async () => {
      getWorkspace.mockReturnValue(null);
      return { success: true, changes: [], diffSummary: 'patch' };
    });
    registerAiCommitIpc({ ...deps, getWorkspaceRegistry: () => ({ getWorkspace }) as never });
    expect(await handler()({} as never, testHome(), 'ws')).toMatchObject({ success: false, error: expect.stringContaining('closed') });
    expect(executeLocalHarnessCommand).not.toHaveBeenCalled();
  });
});
