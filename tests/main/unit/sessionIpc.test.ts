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
  mockBuildSessionLaunch,
  mockSpawnPtyProcess,
} = vi.hoisted(() => ({
  mockDiscoverSessions: vi.fn(),
  mockBuildSessionLaunch: vi.fn(),
  mockSpawnPtyProcess: vi.fn(),
}));

// These tests exercise unrelated resume behaviour against a fictional '/workspace'; the real
// filesystem-backed containment rule is covered by sessionIpcWorktrees.test.ts and the real-Git test.
vi.mock('../../../src/main/localPathContainment', async () => {
  const path = await import('node:path');
  return { isInsideRoot: (root: string, target: string) => {
    const relative = path.relative(root, target);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockHandle,
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('../../../src/main/sessionHistory', () => ({
  discoverSessions: mockDiscoverSessions,
  buildSessionLaunch: mockBuildSessionLaunch,
}));

vi.mock('../../../src/main/ipc/ptySpawn', () => ({
  spawnPtyProcess: mockSpawnPtyProcess,
}));

vi.mock('../../../src/main/platformShell', () => ({
  defaultShell: vi.fn(() => '/bin/bash'),
}));

import { registerSessionIpc } from '../../../src/main/ipc/sessionIpc';
import { withCheckoutContexts } from '../../_helpers/checkoutContexts';

type Handler = (_event: unknown, ...args: unknown[]) => unknown;

// The real registry hands out one object per workspace; resume checks that identity before spawning.
const localWorkspace = { workspaceId: 'local-ws', location: { environmentId: 'local', path: '/workspace' } };
const stableLocalRegistry = () => withCheckoutContexts({ getWorkspace: (id: string) => id === 'local-ws' ? localWorkspace : null });

function registerHandlers(
  getHarnessOptions = vi.fn(() => ({})),
  agentAttentionBroker?: Parameters<typeof registerSessionIpc>[0]['agentAttentionBroker'],
  getWorkspaceRegistry: NonNullable<Parameters<typeof registerSessionIpc>[0]['getWorkspaceRegistry']> = () => stableLocalRegistry() as never,
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
    ensureHarnessWrapperScript: () => '/wrapper',
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
    mockBuildSessionLaunch.mockReset();
    mockSpawnPtyProcess.mockReset();
  });

  it('rejects forged Pi files before command construction or spawning', async () => {
    const handlers = registerHandlers(vi.fn(() => ({ pi: { name: 'Pi', command: 'pi', args: [], icon: 'π' } })));
    const session: HarnessSession = { id: 'forged-missing-id', harness: 'pi', title: '', cwd: '/workspace', timestamp: 0, filePath: '/workspace/arbitrary.jsonl' };
    await expect(handlers.get(SESSION_INVOKE)?.({}, 'local-ws', session)).rejects.toMatchObject({ kind: 'not-configured' });
    expect(mockBuildSessionLaunch).not.toHaveBeenCalled();
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
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
    expect(mockBuildSessionLaunch).not.toHaveBeenCalled();
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it('invokes an Antigravity session with a valid UUID', async () => {
    mockBuildSessionLaunch.mockReturnValue({
      command: 'agy',
      args: ['--conversation', '79cbc62b-b055-48a5-8655-d9aa83d3a00f'],
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
    expect(mockBuildSessionLaunch).toHaveBeenCalledWith(
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
    expect(mockBuildSessionLaunch).not.toHaveBeenCalled();
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
    const handlers = registerHandlers(undefined, undefined, () => withCheckoutContexts({ getWorkspace: (id: keyof typeof workspaces) => workspaces[id] }) as never);
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
    const handlers = registerHandlers(undefined, undefined, () => withCheckoutContexts({ getWorkspace }) as never);
    const discovery = handlers.get(SESSION_DISCOVER)?.({}, 'a');
    // Main first reads the workspace's Git worktree evidence, then starts the host scan.
    await vi.waitFor(() => expect(discover).toHaveBeenCalled());
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

    expect(mockBuildSessionLaunch).not.toHaveBeenCalled();
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it('invokes a session when its harness is available', async () => {
    mockBuildSessionLaunch.mockReturnValue({
      command: 'codex',
      args: ['resume', 'codex-session', '--yolo'],
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

    expect(result).toEqual({ id: 'term-1', pid: 123, harnessId: 'codex', attentionEnabled: false, checkoutContextId: 'local-ws::main', workingDir: '/workspace' });
    // A fork creates a new native session: the old ID is never pre-seeded.
    expect(broker.register).toHaveBeenCalledWith(expect.any(String), 'codex', { rootSessionId: undefined, authority: 'full', quality: 'hook' });
    expect(mockBuildSessionLaunch).toHaveBeenCalledWith(
      { ...codexSession, cwd: nativeWorkspacePath },
      true,
      '--yolo'
    );
    expect(mockSpawnPtyProcess).toHaveBeenCalledWith(expect.objectContaining({
      spawnCmd: '/wrapper',
      spawnArgs: ['codex', 'resume', 'codex-session', '--yolo'],
      cwd: nativeWorkspacePath,
      env: expect.objectContaining({
        CODEX_HOME: '/tmp/codex',
        CLANKER_ATTENTION_TOKEN: 'test-token',
        CLANKER_ATTENTION_COMMAND: expect.any(String),
        CLANKER_GRID_FALLBACK_SHELL: '/bin/bash',
      }),
    }));
  });
  it('records no durable task-session state when resuming a native conversation', async () => {
    mockBuildSessionLaunch.mockReturnValue({ command: 'codex', args: ['resume', 'codex-session'] });
    mockSpawnPtyProcess.mockReturnValue({ id: 'term-1', pid: 123 });
    const storeSet = vi.fn();
    const handlers = new Map<string, Handler>();
    mockHandle.mockImplementation((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    });
    registerSessionIpc({
      getTerminals: () => new Map(),
      getMainWindow: () => null,
      getSafeWorkspacePath: (workingDir: string) => workingDir,
      getIsShuttingDown: () => false,
      getStore: () => ({ get: vi.fn(() => ({ codex: { flags: '' } })), set: storeSet }) as never,
      getHarnessOptions: vi.fn(() => ({ codex: { name: 'Codex', command: 'codex', args: [], icon: 'Codex' } })),
      ensureHarnessWrapperScript: () => '/wrapper',
      getWorkspaceRegistry: () => stableLocalRegistry() as never,
    });

    await handlers.get(SESSION_INVOKE)?.({}, 'local-ws', codexSession);

    expect(mockSpawnPtyProcess).toHaveBeenCalledTimes(1);
    expect(storeSet.mock.calls.map(([key]) => key)).not.toContain('taskSessions');
  });

  it('keeps local discovery and invocation distinct from a remote workspace at the same path', async () => {
    const known = {
      'local-ws': { workspaceId: 'local-ws', location: { environmentId: 'local', path: '/workspace' } },
      'remote-ws': { workspaceId: 'remote-ws', location: { environmentId: 'vps', path: '/workspace' } },
    };
    const getWorkspace = vi.fn((id: string) => known[id as 'local-ws' | 'remote-ws'] ?? null);
    const handlers = registerHandlers(vi.fn(() => ({
      codex: { name: 'Codex', command: 'codex', args: [], icon: 'Codex' },
    })), undefined, () => withCheckoutContexts({ getWorkspace }) as never);
    mockDiscoverSessions.mockResolvedValue([codexSession]);
    mockBuildSessionLaunch.mockReturnValue({ command: 'codex', args: ['resume', 'codex-session'] });
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
  mockBuildSessionLaunch.mockReturnValue({ command: 'codex', args: ['resume', 'codex-session'] });
  mockSpawnPtyProcess.mockImplementation(() => { throw new Error('PTY failed'); });
  await expect(handlers.get(SESSION_INVOKE)!({}, 'local-ws', codexSession)).rejects.toThrow('PTY failed');
  expect(prepare).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
});

describe('trusted resume identity for local attention', () => {
  const resume = async (session: HarnessSession, fork: boolean) => {
    mockHandle.mockReset();
    mockBuildSessionLaunch.mockReturnValue({ command: session.harness, args: ['resume', session.id] });
    mockSpawnPtyProcess.mockReturnValue({ id: 'term-1', pid: 123 });
    const broker = { register: vi.fn().mockResolvedValue({}), release: vi.fn() };
    const handlers = registerHandlers(vi.fn(() => ({
      [session.harness]: { name: session.harness, command: session.harness, args: [], icon: '' },
    })), broker as never);
    await handlers.get(SESSION_INVOKE)?.({}, 'local-ws', session, fork);
    return broker.register.mock.calls[0];
  };
  it('seeds the validated native ID for a non-fork resume only', async () => {
    expect(await resume(codexSession, false)).toEqual([expect.any(String), 'codex', { rootSessionId: 'codex-session', authority: 'full', quality: 'hook' }]);
    expect((await resume(codexSession, true))[2]).toEqual({ rootSessionId: undefined, authority: 'full', quality: 'hook' });
  });
  it('does not seed when a provider may re-identify the resumed session', async () => {
    expect((await resume(claudeSession, false))[2]).toEqual({ rootSessionId: undefined, authority: 'partial', quality: 'hook' });
  });
});
