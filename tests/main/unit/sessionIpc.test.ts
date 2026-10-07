import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import { removeAttentionAdapterFiles } from '../../../src/main/agentAttentionAdapters';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessSession } from '../../../src/shared/types/session';
import { SESSION_DISCOVER, SESSION_INVOKE } from '../../../src/shared/ipcChannels';
import { toNativePath } from '../../../src/shared/pathNormalize';
import { successfulSessionDiscovery } from '../../_helpers/sessionDiscovery';

const { mockHandle } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
}));

const {
  mockDiscoverSessions,
  mockDiscoverSessionsDetailed,
  mockBuildSessionLaunch,
  mockSpawnPtyProcess,
} = vi.hoisted(() => ({
  mockDiscoverSessions: vi.fn(),
  mockDiscoverSessionsDetailed: vi.fn(),
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
  discoverSessionsDetailed: mockDiscoverSessionsDetailed,
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
  getIsShuttingDown = () => false,
  defaultFlags = ' --yolo ',
): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  mockHandle.mockImplementation((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  });

  registerSessionIpc({
    getTerminals: () => new Map(),
    getMainWindow: () => ({ webContents: { send: vi.fn() } }) as never,
    getSafeWorkspacePath: (workingDir: string) => workingDir,
    getIsShuttingDown,
    getStore: () => ({
      get: vi.fn(() => ({
        codex: { flags: defaultFlags, attentionEnabled },
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

beforeEach(() => {
  mockHandle.mockReset();
  mockDiscoverSessions.mockReset().mockResolvedValue([codexSession, claudeSession]);
  mockDiscoverSessionsDetailed.mockReset().mockImplementation(async (...args) => successfulSessionDiscovery(await mockDiscoverSessions(...args)));
  mockBuildSessionLaunch.mockReset();
  mockSpawnPtyProcess.mockReset();
});

describe('registerSessionIpc', () => {

  it('keeps successful history and returns safe diagnostics only for available providers', async () => {
    mockDiscoverSessionsDetailed.mockResolvedValue({ sessions: [codexSession, claudeSession], harnessStatus: {
      codex: { status: 'success' }, pi: { status: 'error', error: 'secret path/token', failure: { kind: 'storage-changed' } },
      agy: { status: 'error', error: 'unavailable' },
    } });
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handlers = registerHandlers(vi.fn(() => ({ codex: {}, pi: {} })));
    const result = await handlers.get(SESSION_DISCOVER)!({}, 'local-ws', { detailed: true, forceRefresh: true });
    expect(result).toEqual({ sessions: [codexSession], issues: [{ harness: 'pi', message: 'Pi: its session storage format changed.' }] });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(mockDiscoverSessionsDetailed).toHaveBeenCalledWith(toNativePath('/workspace', process.platform), { forceRefresh: true });
    log.mockRestore();
  });

  it('rejects a late local discovery after its registered workspace is closed', async () => {
    let finish!: (value: { sessions: HarnessSession[]; harnessStatus: object }) => void;
    mockDiscoverSessionsDetailed.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    let current: typeof localWorkspace | null = localWorkspace;
    const registry = withCheckoutContexts({ getWorkspace: () => current });
    const handlers = registerHandlers(vi.fn(() => ({ codex: {} })), undefined, () => registry as never);
    const pending = handlers.get(SESSION_DISCOVER)!({}, 'local-ws', { detailed: true });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    current = null; finish({ sessions: [codexSession], harnessStatus: {} });
    await expect(pending).rejects.toThrow('Workspace closed during discovery');
  });

  it('rejects forged Pi files before command construction or spawning', async () => {
    const handlers = registerHandlers(vi.fn(() => ({ pi: { name: 'Pi', command: 'pi', args: [], icon: 'π' } })));
    const session: HarnessSession = { id: 'forged-missing-id', harness: 'pi', title: '', cwd: '/workspace', timestamp: 0, filePath: '/workspace/arbitrary.jsonl' };
    await expect(handlers.get(SESSION_INVOKE)?.({}, 'local-ws', session)).rejects.toThrow('Session was not found');
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
    mockDiscoverSessions.mockResolvedValue([session]);
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
    mockDiscoverSessions.mockResolvedValue([session]);
    await expect(handlers.get(SESSION_INVOKE)?.({}, 'local-ws', session)).rejects.toThrow(/Invalid local session selection|Antigravity session ID is invalid/);
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it('rejects unsafe Antigravity model metadata rediscovered from the native store', async () => {
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
    mockDiscoverSessions.mockResolvedValue([session]);
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

    mockDiscoverSessions.mockResolvedValue([{ ...session, id: session.id.trim(), modelId: session.modelId!.trim() }]);
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

  it.each([false, true])('ordinary resume/fork (%s) uses only fresh native metadata, ignoring renderer launch hints', async (fork) => {
    const native = { ...codexSession, cwd: '/workspace/src', modelId: 'native-model', provider: 'native-provider', filePath: '/native/sessions/owned.jsonl' };
    mockDiscoverSessions.mockResolvedValue([native]);
    mockBuildSessionLaunch.mockReturnValue({ command: 'codex', args: ['resume', native.id] });
    mockSpawnPtyProcess.mockReturnValue({ id: 'term', pid: 1 });
    const handlers = registerHandlers(vi.fn(() => ({ codex: { command: 'codex', args: [], name: 'Codex', icon: '' } })));
    await handlers.get(SESSION_INVOKE)!({}, 'local-ws', { ...codexSession,
      cwd: '/outside', filePath: '/forged/session.jsonl', modelId: 'forged', provider: 'forged',
      checkout: { path: '/outside', branch: 'forged', exists: true },
    }, fork);
    expect(mockDiscoverSessionsDetailed).toHaveBeenCalledWith(nativeWorkspacePath, { forceRefresh: true });
    expect(mockBuildSessionLaunch).toHaveBeenCalledWith({ ...native,
      cwd: toNativePath(native.cwd, process.platform), filePath: toNativePath(native.filePath, process.platform),
    }, fork, '--yolo');
    expect(mockSpawnPtyProcess).toHaveBeenCalledWith(expect.objectContaining({ cwd: toNativePath(native.cwd, process.platform) }));
  });

  it('starts an ordinary resume with measured destination geometry and unchanged native argv', async () => {
    mockBuildSessionLaunch.mockReturnValue({ command: 'codex', args: ['resume', codexSession.id] });
    mockSpawnPtyProcess.mockReturnValue({ id: 'term', pid: 1 });
    const handlers = registerHandlers(vi.fn(() => ({ codex: { command: 'codex', args: [], name: 'Codex', icon: '' } })));
    await handlers.get(SESSION_INVOKE)!({}, 'local-ws', codexSession, false, { initialGeometry: { cols: 130, rows: 43 } });
    expect(mockSpawnPtyProcess).toHaveBeenCalledWith(expect.objectContaining({ initialGeometry: { cols: 130, rows: 43 }, spawnArgs: ['codex', 'resume', codexSession.id] }));
  });

  it.each([null, { cols: 1, rows: 24 }, { cols: 80, rows: 0 }, { cols: 1001, rows: 24 }, { cols: 80, rows: 1001 }, { cols: 80.5, rows: 24 }, { cols: '80', rows: 24 }])(
    'rejects malformed initial geometry %j before discovery or checkout side effects', async (initialGeometry) => {
      const handlers = registerHandlers(vi.fn(() => ({ codex: { command: 'codex', args: [], name: 'Codex', icon: '' } })));
      await expect(handlers.get(SESSION_INVOKE)!({}, 'local-ws', codexSession, false, { initialGeometry })).rejects.toThrow('Invalid initial terminal geometry');
      expect(mockDiscoverSessionsDetailed).not.toHaveBeenCalled();
      expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
    },
  );

  it('rejects user defaults that would override the rediscovered conversation', async () => {
    const handlers = registerHandlers(vi.fn(() => ({ codex: { command: 'codex', args: [], name: 'Codex', icon: '' } })),
      undefined, undefined, false, () => false, 'resume another-session');
    await expect(handlers.get(SESSION_INVOKE)!({}, 'local-ws', codexSession)).rejects.toThrow('conflict with local session selection');
    expect(mockBuildSessionLaunch).not.toHaveBeenCalled();
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it.each(['id', 'harness', 'checkout'] as const)('does not accept a provider validator changing the native %s', async (field) => {
    const native = { ...codexSession, harness: 'pi' as const, filePath: '/native/session.jsonl' };
    mockDiscoverSessions.mockResolvedValue([native]);
    const changed = field === 'id' ? { ...native, id: 'another-session' } : field === 'harness'
      ? { ...native, harness: 'codex' as const } : { ...native, cwd: '/outside' };
    vi.spyOn(getHarnessProvider('pi').sessions, 'validateLocal').mockResolvedValue(changed);
    const handlers = registerHandlers(vi.fn(() => ({ pi: { command: 'pi', args: [], name: 'Pi', icon: '' } })));
    await expect(handlers.get(SESSION_INVOKE)!({}, 'local-ws', native)).rejects.toThrow('Session identity or checkout changed');
    expect(mockBuildSessionLaunch).not.toHaveBeenCalled();
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it('stops before allocating launch resources on shutdown during a native validator await', async () => {
    let shuttingDown = false;
    const native = { ...codexSession, harness: 'pi' as const, filePath: '/native/session.jsonl' };
    mockDiscoverSessions.mockResolvedValue([native]);
    vi.spyOn(getHarnessProvider('pi').sessions, 'validateLocal').mockImplementation(async (session) => {
      shuttingDown = true;
      return session;
    });
    const handlers = registerHandlers(vi.fn(() => ({ pi: { command: 'pi', args: [], name: 'Pi', icon: '' } })),
      undefined, undefined, false, () => shuttingDown);
    await expect(handlers.get(SESSION_INVOKE)!({}, 'local-ws', native)).rejects.toThrow('Workspace was closed');
    expect(mockBuildSessionLaunch).not.toHaveBeenCalled();
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it.each(['deleted', 'other harness', 'other account', 'conflicting evidence'])('does not spawn on %s despite a plausible renderer cwd', async (kind) => {
    const records = kind === 'deleted' ? [] : kind === 'other harness' ? [{ ...codexSession, harness: 'claude' as const }]
      : kind === 'other account' ? [{ ...codexSession, accountId: 'acct_other' }]
      : [codexSession, { ...codexSession, cwd: '/workspace/other' }];
    mockDiscoverSessions.mockResolvedValue(records);
    const handlers = registerHandlers(vi.fn(() => ({ codex: { command: 'codex', args: [], name: 'Codex', icon: '' } })));
    await expect(handlers.get(SESSION_INVOKE)!({}, 'local-ws', codexSession)).rejects.toThrow(
      kind === 'conflicting evidence' ? 'Conflicting' : 'Session was not found',
    );
    expect(mockBuildSessionLaunch).not.toHaveBeenCalled();
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it('does not silently use a candidate when the selected provider failed to read its history', async () => {
    mockDiscoverSessionsDetailed.mockResolvedValue({ sessions: [codexSession], harnessStatus: { codex: { status: 'error', error: 'private path/token' } } });
    const handlers = registerHandlers(vi.fn(() => ({ codex: { command: 'codex', args: [], name: 'Codex', icon: '' } })));
    await expect(handlers.get(SESSION_INVOKE)!({}, 'local-ws', codexSession)).rejects.toThrow('Session history could not be verified');
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it.each(['closed', 'replaced', 'shutdown'])('does not route or spawn after the workspace is %s during native rediscovery', async (kind) => {
    let current: typeof localWorkspace | null = localWorkspace;
    let shuttingDown = false;
    const registry = withCheckoutContexts({ getWorkspace: () => current });
    let finish!: (value: ReturnType<typeof successfulSessionDiscovery>) => void;
    mockDiscoverSessionsDetailed.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const broker = { register: vi.fn(), release: vi.fn() } as never;
    const handlers = registerHandlers(vi.fn(() => ({ codex: { command: 'codex', args: [], name: 'Codex', icon: '' } })), broker,
      () => registry as never, true, () => shuttingDown);
    const pending = handlers.get(SESSION_INVOKE)!({}, 'local-ws', codexSession);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    if (kind === 'closed') current = null;
    if (kind === 'replaced') current = { ...localWorkspace };
    if (kind === 'shutdown') shuttingDown = true;
    finish(successfulSessionDiscovery([codexSession]));
    await expect(pending).rejects.toThrow('Workspace was closed or is being removed');
    expect(mockBuildSessionLaunch).not.toHaveBeenCalled();
    expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
  });

  it.each([null, {}, { ...codexSession, id: '/path' }, { ...codexSession, id: 'bad\nidentifier' }])(
    'rejects malformed selection %j before reading any native store', async (selection) => {
      const handlers = registerHandlers(vi.fn(() => ({ codex: { command: 'codex', args: [], name: 'Codex', icon: '' } })));
      await expect(handlers.get(SESSION_INVOKE)!({}, 'local-ws', selection)).rejects.toThrow('Invalid local session selection');
      expect(mockDiscoverSessionsDetailed).not.toHaveBeenCalled();
      expect(mockSpawnPtyProcess).not.toHaveBeenCalled();
    },
  );

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

  it('rejects native sessions whose rediscovered cwd escapes the selected local workspace', async () => {
    const handlers = registerHandlers(vi.fn(() => ({
      codex: { name: 'Codex', command: 'codex', args: [], icon: 'Codex' },
    })));
    for (const cwd of ['/workspace-other', '/workspace/../other']) {
      mockDiscoverSessions.mockResolvedValue([{ ...codexSession, cwd }]);
      await expect(handlers.get(SESSION_INVOKE)?.({}, 'local-ws', { ...codexSession, cwd: '/workspace' }))
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
    mockDiscoverSessions.mockResolvedValue([session]);
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
