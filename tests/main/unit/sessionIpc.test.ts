import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import { removeAttentionAdapterFiles } from '../../../src/main/agentAttentionAdapters';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  getWorkspaceRegistry: NonNullable<Parameters<typeof registerSessionIpc>[0]['getWorkspaceRegistry']> = () => ({
    getWorkspace: (id: string) => id === 'local-ws'
      ? { workspaceId: 'local-ws', location: { environmentId: 'local', path: '/workspace' } }
      : null,
  }) as never,
  attentionEnabled = false,
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
        codex: { flags: ' --yolo ', attentionEnabled },
      })),
    }) as never,
    getHarnessOptions,
    agentAttentionBroker,
    getWorkspaceRegistry,
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
    await expect(handlers.get(SESSION_INVOKE)?.({}, 'local-ws', session)).rejects.toThrow('OMP session file is invalid');
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
    await expect(handlers.get(SESSION_INVOKE)?.({}, 'local-ws', session)).rejects.toThrow('Antigravity session ID is invalid');
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
    await expect(handlers.get(SESSION_INVOKE)?.({}, 'local-ws', session)).rejects.toThrow('Antigravity model ID is invalid');
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

    const result = await handlers.get(SESSION_INVOKE)?.({}, 'local-ws', session);
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

    await expect(handlers.get(SESSION_INVOKE)?.({}, 'local-ws', session)).rejects.toThrow('hermes session invocation is not supported');
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

    const result = await handlers.get(SESSION_DISCOVER)?.({}, 'local-ws');

    expect(result).toEqual([claudeSession]);
    expect(mockDiscoverSessions).toHaveBeenCalledWith(nativeWorkspacePath);
  });

  it('routes discovery by registered environment even for identical local and remote paths', async () => {
    const discoverA = vi.fn().mockResolvedValue([{ ...codexSession, title: 'Host A' }]);
    const discoverB = vi.fn().mockResolvedValue([{ ...codexSession, title: 'Host B' }]);
    const workspaces = {
      a: { location: { environmentId: 'ssh-a', path: '/workspace' }, environment: { capabilities: { sessionDiscovery: true }, discoverSessions: discoverA } },
      b: { location: { environmentId: 'ssh-b', path: '/workspace' }, environment: { capabilities: { sessionDiscovery: true }, discoverSessions: discoverB } },
    };
    const handlers = registerHandlers(undefined, undefined, () => ({ getWorkspace: (id: keyof typeof workspaces) => workspaces[id] }) as never);
    expect(await handlers.get(SESSION_DISCOVER)?.({}, 'a')).toEqual([expect.objectContaining({ title: 'Host A' })]);
    expect(await handlers.get(SESSION_DISCOVER)?.({}, 'b')).toEqual([expect.objectContaining({ title: 'Host B' })]);
    expect(discoverA).toHaveBeenCalledWith('/workspace');
    expect(discoverB).toHaveBeenCalledWith('/workspace');
    expect(mockDiscoverSessions).not.toHaveBeenCalled();
  });

  it('discards remote discovery when the workspace registration changes while reading', async () => {
    let resolve!: (sessions: HarnessSession[]) => void;
    const discover = vi.fn(() => new Promise<HarnessSession[]>((res) => { resolve = res; }));
    const workspace = { location: { environmentId: 'ssh-a', path: '/workspace' }, environment: { capabilities: { sessionDiscovery: true }, discoverSessions: discover } };
    const getWorkspace = vi.fn().mockReturnValue(workspace);
    const handlers = registerHandlers(undefined, undefined, () => ({ getWorkspace }) as never);
    const discovery = handlers.get(SESSION_DISCOVER)?.({}, 'a');
    getWorkspace.mockReturnValue({ ...workspace });
    resolve([codexSession]);
    await expect(discovery).rejects.toThrow('closed during discovery');
    expect(mockDiscoverSessions).not.toHaveBeenCalled();
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
      handlers.get(SESSION_INVOKE)?.({}, 'local-ws', codexSession, false)
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

    const result = await handlers.get(SESSION_INVOKE)?.({}, 'local-ws', codexSession, true);

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
  it('keeps local discovery and invocation distinct from a remote workspace at the same path', async () => {
    const getWorkspace = vi.fn((id: string) => ({
      'local-ws': { workspaceId: 'local-ws', location: { environmentId: 'local', path: '/workspace' } },
      'remote-ws': { workspaceId: 'remote-ws', location: { environmentId: 'vps', path: '/workspace' } },
    })[id as 'local-ws' | 'remote-ws'] ?? null);
    const handlers = registerHandlers(vi.fn(() => ({
      codex: { name: 'Codex', command: 'codex', args: [], icon: 'Codex' },
    })), undefined, () => ({ getWorkspace }) as never);
    mockDiscoverSessions.mockResolvedValue([codexSession]);
    mockBuildSessionInvokeArgs.mockReturnValue({ spawnCmd: 'codex', spawnArgs: ['resume', 'codex-session'] });
    mockSpawnPtyProcess.mockReturnValue({ id: 'term-1', pid: 123 });

    expect(await handlers.get(SESSION_DISCOVER)?.({}, 'remote-ws')).toEqual([]);
    expect(mockDiscoverSessions).not.toHaveBeenCalled();
    await expect(handlers.get(SESSION_INVOKE)?.({}, 'remote-ws', codexSession, false))
      .rejects.toThrow('Remote session invocation is not supported');
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();

    expect(await handlers.get(SESSION_DISCOVER)?.({}, 'local-ws')).toEqual([codexSession]);
    expect(mockDiscoverSessions).toHaveBeenCalledWith(nativeWorkspacePath);
    expect(await handlers.get(SESSION_INVOKE)?.({}, 'local-ws', codexSession, false))
      .toEqual(expect.objectContaining({ id: 'term-1', harnessId: 'codex' }));
  });

  it('rejects stale or path-shaped IDs even when the session cwd belongs to a local workspace', async () => {
    const handlers = registerHandlers();
    for (const workspaceId of ['stale-ws', '/workspace', '']) {
      await expect(handlers.get(SESSION_DISCOVER)?.({}, workspaceId)).rejects.toThrow('Workspace is not registered');
      await expect(handlers.get(SESSION_INVOKE)?.({}, workspaceId, codexSession))
        .rejects.toThrow('Workspace is not registered');
    }
    expect(mockDiscoverSessions).not.toHaveBeenCalled();
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it('rejects sessions whose cwd escapes the selected local workspace', async () => {
    const handlers = registerHandlers(vi.fn(() => ({
      codex: { name: 'Codex', command: 'codex', args: [], icon: 'Codex' },
    })));
    for (const cwd of ['/workspace-other', '/workspace/../other']) {
      await expect(handlers.get(SESSION_INVOKE)?.({}, 'local-ws', { ...codexSession, cwd }))
        .rejects.toThrow('Session working directory is outside the workspace');
    }
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });
});

afterAll(() => removeAttentionAdapterFiles());
it('disposes prepared provider attention if PTY creation fails', async () => {
  const dispose = vi.fn();
  const prepare = vi.spyOn(getHarnessProvider('codex').attention!.local!, 'prepare')
    .mockReturnValue({ args: ['codex', 'resume', 'codex-session'], env: {}, dispose });
  const broker = { register: vi.fn().mockResolvedValue({}), release: vi.fn() } as never;
  const handlers = registerHandlers(vi.fn(() => ({ codex: { command: 'codex', args: [], name: 'Codex', icon: '' } })), broker, undefined, true);
  mockBuildSessionInvokeArgs.mockReturnValue({ spawnCmd: 'wrapper', spawnArgs: ['codex', 'resume', 'codex-session'] });
  mockSpawnPtyProcess.mockImplementation(() => { throw new Error('PTY failed'); });
  await expect(handlers.get(SESSION_INVOKE)!({}, 'local-ws', codexSession)).rejects.toThrow('PTY failed');
  expect(prepare).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
});
