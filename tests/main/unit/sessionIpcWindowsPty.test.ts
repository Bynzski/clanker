import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessSession } from '../../../src/shared/types/session';
import { SESSION_INVOKE } from '../../../src/shared/ipcChannels';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import { removeAttentionAdapterFiles } from '../../../src/main/agentAttentionAdapters';
import { withCheckoutContexts } from '../../_helpers/checkoutContexts';
import { parseMsvcrtArgv, ptyCommandLine } from '../../_helpers/windowsCommandLine';

const { mockHandle, mockSpawnPty } = vi.hoisted(() => ({ mockHandle: vi.fn(), mockSpawnPty: vi.fn() }));
// These tests exercise unrelated resume behaviour against a fictional '/workspace'; the real
// filesystem-backed containment rule is covered by sessionIpcWorktrees.test.ts and the real-Git test.
vi.mock('../../../src/main/localPathContainment', async () => {
  const path = await import('node:path');
  return { isInsideRoot: (root: string, target: string) => {
    const relative = path.relative(root, target);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } };
});

vi.mock('electron', () => ({ ipcMain: { handle: mockHandle }, BrowserWindow: vi.fn() }));
vi.mock('../../../src/main/ipc/ptySpawn', () => ({ spawnPtyProcess: mockSpawnPty }));

import { registerSessionIpc } from '../../../src/main/ipc/sessionIpc';

// Real buildSessionLaunch + real PTY planner; only the Windows platform/file seams are injected.
const COMSPEC = 'C:\\Windows\\System32\\cmd.exe';
const EXE = 'C:\\Tools\\codex.exe';
const SHIM = 'C:\\npm\\codex.cmd';
const session: HarnessSession = { id: 'codex-session', harness: 'codex', title: 't', cwd: '/workspace', timestamp: 1 };
const NASTY_FLAGS = ['C:\\R&D(x)\\a^b!c', 'plain'];

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
let savedEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  savedEnv = { ...process.env };
  for (const key of Object.keys(process.env)) if (/^(path|pathext|comspec)$/i.test(key)) delete process.env[key];
  Object.assign(process.env, { Path: 'C:\\Tools;C:\\npm', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: COMSPEC });
  mockHandle.mockReset();
  mockSpawnPty.mockReset().mockReturnValue({ id: 'term', pid: 1 });
});
afterEach(() => { process.env = savedEnv; vi.restoreAllMocks(); });
afterAll(() => removeAttentionAdapterFiles());

const wsObject = { workspaceId: 'ws', location: { environmentId: 'local', path: '/workspace' } };
const registry = withCheckoutContexts({ getWorkspace: (id: string) => id === 'ws' ? wsObject : null });

function setup(options: { installed: string[]; flags?: string; wrapper?: string | null; platform?: NodeJS.Platform; attention?: boolean; harnessEnv?: Record<string, string> }) {
  const handlers = new Map<string, Handler>();
  mockHandle.mockImplementation((channel: string, handler: Handler) => handlers.set(channel, handler));
  const files = new Set(options.installed.map((file) => file.toLowerCase()));
  const fileExists = vi.fn((file: string) => files.has(file.toLowerCase()));
  registerSessionIpc({
    getTerminals: () => new Map(), getMainWindow: () => null, getSafeWorkspacePath: (dir: string) => dir, getIsShuttingDown: () => false,
    getStore: () => ({ get: () => ({ codex: { flags: options.flags ?? '', attentionEnabled: options.attention === true } }) }) as never,
    getHarnessOptions: () => ({ codex: { name: 'Codex', command: 'codex', args: [], icon: '', ...(options.harnessEnv ? { env: options.harnessEnv } : {}) } }),
    agentAttentionBroker: options.attention ? { register: vi.fn().mockResolvedValue({}), release: vi.fn() } as never : undefined,
    getWorkspaceRegistry: () => registry as never,
    ensureHarnessWrapperScript: () => options.wrapper ?? null,
    harnessSpawnOverrides: { platform: options.platform ?? 'win32', fileExists },
  });
  const invoke = (fork = false) => handlers.get(SESSION_INVOKE)!({}, 'ws', session, fork);
  const spawned = () => mockSpawnPty.mock.calls[mockSpawnPty.mock.calls.length - 1][0] as { spawnCmd: string; spawnArgs: string[] | string; env: Record<string, string> };
  return { invoke, spawned, fileExists };
}

describe('local session resume/fork through the Windows PTY planner', () => {
  it('launches a resolved .exe directly with discrete argv and never cmd.exe', async () => {
    const { invoke, spawned } = setup({ installed: [EXE], flags: NASTY_FLAGS.join(' ') });
    const result = await invoke();
    // PR #92 contract preserved: local resume belongs to the workspace main checkout context.
    expect(result).toMatchObject({ checkoutContextId: 'ws::main' });
    expect((mockSpawnPty.mock.calls[0][0] as { checkoutContextId?: string }).checkoutContextId).toBe('ws::main');
    const { spawnCmd, spawnArgs } = spawned();
    expect(spawnCmd.toLowerCase()).toBe(EXE.toLowerCase());
    expect(spawnArgs).toEqual(['resume', 'codex-session', ...NASTY_FLAGS]);
    expect(parseMsvcrtArgv(ptyCommandLine(spawnCmd, spawnArgs)).slice(1)).toEqual(['resume', 'codex-session', ...NASTY_FLAGS]);
    expect(ptyCommandLine(spawnCmd, spawnArgs).toLowerCase()).not.toContain('cmd.exe');
  });

  it('fork also goes through the planner', async () => {
    const { invoke, spawned } = setup({ installed: [EXE] });
    await invoke(true);
    expect(spawned().spawnCmd.toLowerCase()).toBe(EXE.toLowerCase());
  });

  it('routes a .cmd shim through the escaped cmd.exe /d /s /c plan with no live metacharacters', async () => {
    const { invoke, spawned } = setup({ installed: [SHIM], flags: NASTY_FLAGS.join(' ') });
    await invoke();
    const { spawnCmd, spawnArgs } = spawned();
    expect(spawnCmd).toBe(COMSPEC);
    expect(typeof spawnArgs).toBe('string');
    const line = ptyCommandLine(spawnCmd, spawnArgs);
    expect(line.startsWith(`${COMSPEC} /d /s /c "`)).toBe(true);
    const live = line.slice(`${COMSPEC} /d /s /c `.length).slice(1, -1).replace(/^"[^"]*"/, '').replace(/\^./g, '');
    expect(live).not.toMatch(/[&|<>()!"%,;]/);
  });

  it.each(['100%done', '%USERPROFILE%'])('fails closed on %s for a batch shim without creating a PTY', async (flag) => {
    const { invoke } = setup({ installed: [SHIM], flags: flag });
    await expect(invoke()).rejects.toThrow(/cannot be passed safely/);
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('fails closed when the harness cannot be resolved, never falling back to cmd /c', async () => {
    const { invoke } = setup({ installed: [] });
    await expect(invoke()).rejects.toThrow(/not installed/);
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('allows a literal % for a direct executable', async () => {
    const { invoke, spawned } = setup({ installed: [EXE], flags: '100%done' });
    await invoke();
    expect(spawned().spawnArgs).toEqual(['resume', 'codex-session', '100%done']);
  });

  describe('attention argv is planned after mutation', () => {
    const mutate = (extra: string[]) => vi.spyOn(getHarnessProvider('codex').attention!.local!, 'prepare')
      .mockImplementation(() => ({ args: ['resume', 'codex-session', ...extra], env: {}, dispose: vi.fn() }));

    it('includes an attention-added path in the final .exe argv', async () => {
      const added = ['-c', 'hooks=C:\\Attn Dir\\hook (x)&y.js'];
      mutate(added);
      const { invoke, spawned } = setup({ installed: [EXE], attention: true });
      await invoke();
      expect(spawned().spawnArgs).toEqual(['resume', 'codex-session', ...added]);
    });

    it('rejects an unsafe attention-added argument for a batch shim (planning ran on the mutated argv)', async () => {
      mutate(['-c', 'hooks=C:\\50%\\hook.js']);
      const { invoke } = setup({ installed: [SHIM], attention: true });
      await expect(invoke()).rejects.toThrow(/cannot be passed safely/);
      expect(mockSpawnPty).not.toHaveBeenCalled();
    });

    it('escapes an attention-added path for a batch shim', async () => {
      mutate(['-c', 'hooks=C:\\Attn Dir\\h&k.js']);
      const { invoke, spawned } = setup({ installed: [SHIM], attention: true });
      await invoke();
      const line = ptyCommandLine(spawned().spawnCmd, spawned().spawnArgs);
      expect(line).toContain('Attn^^^ Dir');
      expect(line.slice(`${COMSPEC} /d /s /c `.length).slice(1, -1).replace(/^"[^"]*"/, '').replace(/\^./g, '')).not.toMatch(/[&]/);
    });
  });

  it('resolves against the final child PATH/PATHEXT/ComSpec, including harness-env overrides and key casing', async () => {
    process.env.Path = 'C:\\Old'; // process PATH has no codex; the harness env supplies the final one
    const custom = 'C:\\Custom\\codex.bat';
    const { invoke, spawned } = setup({ installed: [custom], harnessEnv: { Path: 'C:\\Custom', PATHEXT: '.BAT', ComSpec: 'D:\\sys\\cmd.exe' } });
    await invoke();
    expect(spawned().spawnCmd).toBe('D:\\sys\\cmd.exe');
    expect(ptyCommandLine(spawned().spawnCmd, spawned().spawnArgs).toLowerCase()).toContain('c:\\custom\\codex.bat');
  });

  it('keeps the POSIX wrapper form with the final argv and no planning', async () => {
    const { invoke, spawned, fileExists } = setup({ installed: [], wrapper: '/home/u/.clanker-grid/harness-wrapper.sh', platform: 'linux', flags: '--yolo' });
    await invoke();
    expect(spawned().spawnCmd).toBe('/home/u/.clanker-grid/harness-wrapper.sh');
    expect(spawned().spawnArgs).toEqual(['codex', 'resume', 'codex-session', '--yolo']);
    expect(fileExists).not.toHaveBeenCalled();
  });
});
