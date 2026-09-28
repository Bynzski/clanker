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
  getHarnessOptions = vi.fn(() => ({})),
  agentAttentionBroker?: Parameters<typeof registerSessionIpc>[0]['agentAttentionBroker'],
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
    agentAttentionBroker,
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

  it('rejects an OMP session without a JSONL file path', async () => {
    const handlers = registerHandlers(vi.fn(() => ({
      omp: { name: 'Oh My Pi', command: 'omp', args: [], icon: 'π' },
    })));
    const session: HarnessSession = {
      id: 'session-1', harness: 'omp', title: 'Task', cwd: '/workspace',
      timestamp: 1, filePath: '/workspace/session.txt',
    };
    await expect(handlers.get(SESSION_INVOKE)?.({}, session)).rejects.toThrow('OMP session file is invalid');
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it.each([
    'invalid; rm -rf /',
    '------------------------------------',
    '79cbc62bb05548a58655d9aa83d3a00f0000',
  ])('rejects an Antigravity session with invalid UUID %s', async (id) => {
    const handlers = registerHandlers(vi.fn(() => ({
      agy: { name: 'Antigravity', command: 'agy', args: [], icon: '🪐' },
    })));
    const session: HarnessSession = {
      id, harness: 'agy', title: 'Task', cwd: '/workspace', timestamp: 1,
    };
    await expect(handlers.get(SESSION_INVOKE)?.({}, session)).rejects.toThrow('Antigravity session ID is invalid');
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it('rejects an unsafe renderer-supplied Antigravity model ID', async () => {
    const handlers = registerHandlers(vi.fn(() => ({
      agy: { name: 'Antigravity', command: 'agy', args: [], icon: '🪐' },
    })));
    const session: HarnessSession = {
      id: '79cbc62b-b055-48a5-8655-d9aa83d3a00f',
      harness: 'agy',
      title: 'Task',
      cwd: '/workspace',
      timestamp: 1,
      modelId: 'gemini&calc',
    };
    await expect(handlers.get(SESSION_INVOKE)?.({}, session)).rejects.toThrow('Antigravity model ID is invalid');
    expect(mockBuildSessionInvokeArgs).not.toHaveBeenCalled();
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it('invokes an Antigravity session with a valid UUID', async () => {
    mockBuildSessionInvokeArgs.mockReturnValue({
      spawnCmd: '/bin/agy',
      spawnArgs: ['agy', '--conversation', '79cbc62b-b055-48a5-8655-d9aa83d3a00f'],
    });
    mockSpawnPtyProcess.mockReturnValue({
      ptyProcess: { pid: 12345 },
      cleanup: vi.fn(),
    });

    const handlers = registerHandlers(vi.fn(() => ({
      agy: { name: 'Antigravity', command: 'agy', args: [], icon: '🪐' },
    })));
    const session: HarnessSession = {
      id: ' 79cbc62b-b055-48a5-8655-d9aa83d3a00f ',
      harness: 'agy',
      title: 'Task',
      cwd: '/workspace',
      timestamp: 1,
      modelId: ' gemini-3.8-flash-high ',
    };

    const result = await handlers.get(SESSION_INVOKE)?.({}, session);
    expect(result).toEqual(expect.objectContaining({ harnessId: 'agy', ptyProcess: { pid: 12345 } }));
    expect(mockBuildSessionInvokeArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '79cbc62b-b055-48a5-8655-d9aa83d3a00f',
        harness: 'agy',
        modelId: 'gemini-3.8-flash-high',
      }),
      false,
      undefined
    );
  });

  it('rejects Hermes session payloads instead of launching Claude resume', async () => {
    const handlers = registerHandlers(vi.fn(() => ({
      hermes: { name: 'Hermes', command: 'hermes', args: ['--tui'], icon: '☿' },
    })));
    const session = { ...codexSession, harness: 'hermes' } as unknown as HarnessSession;

    await expect(handlers.get(SESSION_INVOKE)?.({}, session)).rejects.toThrow('hermes session invocation is not supported');
    expect(mockBuildSessionInvokeArgs).not.toHaveBeenCalled();
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
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

    const broker = { register: vi.fn().mockResolvedValue({ CLANKER_ATTENTION_TOKEN: 'test-token' }), release: vi.fn() };
    const handlers = registerHandlers(vi.fn(() => ({
      codex: {
        name: 'Codex',
        command: 'codex',
        args: [],
        icon: 'Codex',
        env: { CODEX_HOME: '/tmp/codex' },
      },
    })), broker as never);

    const result = await handlers.get(SESSION_INVOKE)?.({}, codexSession, true);

    expect(result).toEqual({ id: 'term-1', pid: 123, harnessId: 'codex', attentionEnabled: false });
    expect(broker.register).toHaveBeenCalledWith(expect.any(String), 'codex');
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
        CLANKER_ATTENTION_TOKEN: 'test-token',
        CLANKER_ATTENTION_COMMAND: expect.any(String),
        CLANKER_GRID_FALLBACK_SHELL: '/bin/bash',
      }),
    }));
  });
});
