import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessSession } from '../../../src/shared/types/session';
import { SESSION_DISCOVER, SESSION_INVOKE } from '../../../src/shared/ipcChannels';
import { toNativePath } from '../../../src/shared/pathNormalize';

const { mockHandle } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
}));

const {
  mockDiscoverSessions,
  mockBuildSessionInvokeArgs,
  mockSpawnPtyProcess,
} = vi.hoisted(() => ({
  mockDiscoverSessions: vi.fn(),
  mockBuildSessionInvokeArgs: vi.fn(),
  mockSpawnPtyProcess: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockHandle,
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('../../../src/main/sessionHistory', () => ({
  discoverSessions: mockDiscoverSessions,
  buildSessionInvokeArgs: mockBuildSessionInvokeArgs,
}));

vi.mock('../../../src/main/ipc/ptySpawn', () => ({
  spawnPtyProcess: mockSpawnPtyProcess,
}));

vi.mock('../../../src/main/platformShell', () => ({
  defaultShell: vi.fn(() => '/bin/bash'),
}));

import { registerSessionIpc } from '../../../src/main/ipc/sessionIpc';

type Handler = (_event: unknown, ...args: unknown[]) => unknown;

function registerHandlers(
  getHarnessOptions = vi.fn(() => ({}))
): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  mockHandle.mockImplementation((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  });

  registerSessionIpc({
    getTerminals: () => new Map(),
    getMainWindow: () => ({ webContents: { send: vi.fn() } }) as never,
    getSafeWorkspacePath: (workingDir: string) => workingDir,
    getIsShuttingDown: () => false,
    getStore: () => ({
      get: vi.fn(() => ({
        codex: { flags: ' --yolo ' },
      })),
    }) as never,
    getHarnessOptions,
  });

  return handlers;
}

const codexSession: HarnessSession = {
  id: 'codex-session',
  harness: 'codex',
  title: 'Codex session',
  cwd: '/workspace',
  timestamp: 1000,
};

const claudeSession: HarnessSession = {
  id: 'claude-session',
  harness: 'claude',
  title: 'Claude session',
  cwd: '/workspace',
  timestamp: 2000,
};

const nativeWorkspacePath = toNativePath('/workspace', process.platform);

describe('registerSessionIpc', () => {
  beforeEach(() => {
    mockHandle.mockReset();
    mockDiscoverSessions.mockReset();
    mockBuildSessionInvokeArgs.mockReset();
    mockSpawnPtyProcess.mockReset();
  });

  it('filters discovered sessions to currently available harnesses', async () => {
    mockDiscoverSessions.mockResolvedValue([codexSession, claudeSession]);

    const handlers = registerHandlers(vi.fn(() => ({
      claude: {
        name: 'Claude',
        command: 'claude',
        args: [],
        icon: 'Claude',
      },
    })));

    const result = await handlers.get(SESSION_DISCOVER)?.({}, '/workspace');

    expect(result).toEqual([claudeSession]);
    expect(mockDiscoverSessions).toHaveBeenCalledWith(nativeWorkspacePath);
  });

  it('rejects invoking a session when its harness is no longer available', async () => {
    const handlers = registerHandlers(vi.fn(() => ({
      claude: {
        name: 'Claude',
        command: 'claude',
        args: [],
        icon: 'Claude',
      },
    })));

    await expect(
      handlers.get(SESSION_INVOKE)?.({}, codexSession, false)
    ).rejects.toThrow('codex harness is not available');

    expect(mockBuildSessionInvokeArgs).not.toHaveBeenCalled();
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it('invokes a session when its harness is available', async () => {
    mockBuildSessionInvokeArgs.mockReturnValue({
      spawnCmd: 'codex',
      spawnArgs: ['resume', 'codex-session', '--yolo'],
    });
    mockSpawnPtyProcess.mockReturnValue({ id: 'term-1', pid: 123 });

    const handlers = registerHandlers(vi.fn(() => ({
      codex: {
        name: 'Codex',
        command: 'codex',
        args: [],
        icon: 'Codex',
        env: { CODEX_HOME: '/tmp/codex' },
      },
    })));

    const result = await handlers.get(SESSION_INVOKE)?.({}, codexSession, true);

    expect(result).toEqual({ id: 'term-1', pid: 123 });
    expect(mockBuildSessionInvokeArgs).toHaveBeenCalledWith(
      { ...codexSession, cwd: nativeWorkspacePath },
      true,
      '--yolo'
    );
    expect(mockSpawnPtyProcess).toHaveBeenCalledWith(expect.objectContaining({
      spawnCmd: 'codex',
      spawnArgs: ['resume', 'codex-session', '--yolo'],
      cwd: nativeWorkspacePath,
      env: expect.objectContaining({
        CODEX_HOME: '/tmp/codex',
        CLANKER_GRID_FALLBACK_SHELL: '/bin/bash',
      }),
    }));
  });
});
