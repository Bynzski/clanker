/** Real Git + IPC + registry; SSH uses its real environment with a local command transport. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { testHome } from '../../_helpers/tempPaths';

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock('electron', () => ({
  app: { getPath: () => testHome() }, BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
}));
import { registerGitIpc } from '../../../src/main/ipc/gitIpc';
import { withGitRepositoryDiscovery } from '../../../src/main/gitRepositoryDiscovery';
import { GitService } from '../../../src/main/gitService';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { LocalEnvironment } from '../../../src/main/environment/localEnvironment';
import { SshEnvironment } from '../../../src/main/remote/sshEnvironment';
import { SshExecutionError, type SshCommandExecutor, type SshExecOptions } from '../../../src/main/remote/sshCommandExecutor';
import { GIT_INIT, GIT_STATUS_UPDATE } from '../../../src/shared/ipcChannels';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import { toPosixPath } from '../../../src/shared/pathNormalize';

const execute = promisify(execFile);
const absent = 'fatal: not a git repository (or any of the parent directories): .git\n';
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-init-')); handlers.clear(); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

for (const remote of [false, true]) describe(`${remote ? 'SSH' : 'local'} repository initialization`, () => {
  async function setup() {
    const cwd = toPosixPath(root);
    const transport = { exec: vi.fn(async (_target: string, command: string, args: string[], options?: SshExecOptions) => {
      try {
        const result = await execute(command, args, { cwd: options?.cwd, env: { ...process.env, ...options?.remoteEnv } });
        return { ...result, exitCode: 0 };
      } catch (error) {
        const failure = error as Error & { code: number; stdout: string; stderr: string };
        throw new SshExecutionError(failure.message, failure.code, failure.stdout, failure.stderr);
      }
    }) };
    const environment = remote ? new SshEnvironment({ id: 'ssh-fixture', kind: 'ssh', label: 'Fixture', target: 'fixture@host' }, transport as unknown as SshCommandExecutor) : new LocalEnvironment();
    const registry = new WorkspaceRegistry(() => environment);
    const registration = await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: cwd, environmentId: environment.id });
    expect(registration.success).toBe(true);
    const runGit = vi.spyOn(environment, 'execGit');
    const service = new GitService(() => undefined, undefined, undefined, undefined, async (target, args, timeout, workspaceId, environmentId, contextId) => {
      const ws = registry.getWorkspace(workspaceId!);
      const context = contextId ? registry.resolveCheckoutContext(workspaceId!, contextId) : undefined;
      if (!ws || ws.location.environmentId !== environmentId || (contextId ? context?.path : ws.location.path) !== target || context?.missing) throw new Error('Workspace identity is no longer registered');
      return ws.environment.execGit(target, args, timeout);
    });
    const send = vi.fn();
    registerGitIpc({ getGitService: () => service, getWorkspaceRegistry: () => registry, getMainWindow: () => ({ webContents: { send } }) as never });
    const identity = { workspaceId: 'ws', environmentId: environment.id, workspacePath: cwd, checkoutContextId: mainCheckoutContextId('ws') };
    const status = () => service.withWorkspace(identity, () => service.getStatus(cwd));
    const init = () => handlers.get(GIT_INIT)!(null, cwd, 'main', 'ws', identity.checkoutContextId) as Promise<{ success: boolean; error?: string }>;
    return { registry, environment, service, runGit, transport, send, status, init, identity, cwd };
  }

  it('verifies absence, initializes the same root, refreshes its tagged status and rediscovers after reopening', async () => {
    const fixture = await setup();
    fs.writeFileSync(path.join(root, 'keep.txt'), 'retain\n');
    expect(await fixture.status()).toMatchObject({ success: true, isRepo: false });
    expect(await fixture.init()).toEqual({ success: true });
    expect(fixture.send).toHaveBeenCalledWith(GIT_STATUS_UPDATE, expect.objectContaining({ ...fixture.identity, success: true, isRepo: true, currentBranch: 'main' }));
    expect(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8')).toBe('retain\n');
    expect(await fixture.init()).toEqual({ success: false, error: 'Already a git repository' });
    fixture.registry.unregisterWorkspace('ws');
    expect((await fixture.registry.registerWorkspace({ workspaceId: 'ws', workspacePath: fixture.cwd, environmentId: fixture.environment.id })).success).toBe(true);
    expect(await fixture.status()).toMatchObject({ success: true, isRepo: true, currentBranch: 'main' });
    if (remote) expect(fixture.transport.exec).toHaveBeenCalledWith('fixture@host', 'git', expect.any(Array), expect.objectContaining({ cwd: fixture.cwd, remoteEnv: { GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }));
  });

  it.each([
    ['missing Git', () => Object.assign(new Error('Git missing'), { code: 'ENOENT' })],
    ['inaccessible directory', () => Object.assign(new Error('Permission denied'), { code: 'EACCES' })],
    ['uncertain discovery error', () => Object.assign(new Error(absent), { code: 128 })],
    ['broken gitfile', () => Object.assign(new Error('broken'), { code: 128, stderr: 'fatal: not a git repository: /missing.git' })],
    ['SSH transport failure containing a Git diagnostic', () => new SshExecutionError('Connection lost', 255, '', absent)],
    ['cancelled command', () => Object.assign(new Error('timed out'), { code: 128, stderr: absent, killed: true })],
  ])('refuses %s and recovers on a fresh verified status', async (_name, error) => {
    const fixture = await setup();
    fixture.runGit.mockRejectedValueOnce(error());
    expect(await fixture.init()).toMatchObject({ success: false, error: expect.any(String) });
    expect(fixture.runGit.mock.calls.some(([, args]) => args[0] === 'init')).toBe(false);
    expect(fs.existsSync(path.join(root, '.git'))).toBe(false);
    expect(await fixture.status()).toMatchObject({ success: true, isRepo: false });
    expect(await fixture.init()).toEqual({ success: true });
  });

  it('refuses an unknown/foreign checkout and a closed workspace without executing Git', async () => {
    const fixture = await setup();
    for (const invalid of ['foreign::main', '', ' ', 123]) {
      await expect(handlers.get(GIT_INIT)!(null, fixture.cwd, 'main', 'ws', invalid)).rejects.toThrow(/not registered|Invalid checkout identity/);
    }
    fixture.registry.unregisterWorkspace('ws');
    await expect(fixture.init()).rejects.toThrow('no longer registered');
    expect(fixture.runGit).not.toHaveBeenCalled();
  });

  it('refuses initialization when the workspace closes during discovery', async () => {
    const fixture = await setup();
    const original = fixture.environment.execGit.bind(fixture.environment);
    fixture.runGit.mockImplementationOnce(async (...args) => {
      try { return await original(...args); } finally { fixture.registry.unregisterWorkspace('ws'); }
    });
    expect(await fixture.init()).toMatchObject({ success: false });
    expect(fs.existsSync(path.join(root, '.git'))).toBe(false);
  });

  it('refuses a replaced physical root after verified discovery', async () => {
    const fixture = await setup();
    vi.spyOn(fixture.environment, 'validateWorkspacePath').mockResolvedValueOnce({ valid: false, error: 'Gone' });
    expect(await fixture.init()).toMatchObject({ success: false });
    expect(fs.existsSync(path.join(root, '.git'))).toBe(false);
  });

  it('refuses a replaced registration with the same workspace id and root', async () => {
    const fixture = await setup();
    const original = fixture.environment.execGit.bind(fixture.environment);
    fixture.runGit.mockImplementationOnce(async (...args) => {
      try { return await original(...args); } finally {
        fixture.registry.unregisterWorkspace('ws');
        await fixture.registry.registerWorkspace({ workspaceId: 'ws', workspacePath: fixture.cwd, environmentId: fixture.environment.id });
      }
    });
    expect(await fixture.init()).toMatchObject({ success: false });
    expect(fs.existsSync(path.join(root, '.git'))).toBe(false);
  });

  it('rechecks pending removal reservations before initialization', async () => {
    const fixture = await setup();
    vi.spyOn(fixture.registry, 'isCheckoutPathReserved').mockReturnValue(true);
    expect(await fixture.init()).toMatchObject({ success: false });
    expect(fs.existsSync(path.join(root, '.git'))).toBe(false);
  });

  it('does not initialize corrupt Git metadata that produces the same discovery diagnostic', async () => {
    const fixture = await setup();
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(root, '.git', 'objects'));
    fs.mkdirSync(path.join(root, '.git', 'refs'));
    expect(await fixture.status()).toMatchObject({ success: false, isRepo: false });
    expect(await fixture.init()).toMatchObject({ success: false });
    expect(fixture.runGit.mock.calls.some(([, args]) => args[0] === 'init')).toBe(false);
    expect(fs.existsSync(path.join(root, '.git', 'HEAD'))).toBe(false);
  });

  it('keeps a missing directory unavailable and recovers when it returns', async () => {
    const fixture = await setup();
    fs.rmdirSync(root);
    expect(await fixture.status()).toMatchObject({ success: false, isRepo: false });
    expect(await fixture.init()).toMatchObject({ success: false });
    fs.mkdirSync(root);
    expect(await fixture.status()).toMatchObject({ success: true, isRepo: false });
    expect(await fixture.init()).toEqual({ success: true });
  });
});

// A bare repository is a Git failure for status, never an empty directory to initialize.
it('does not classify a bare repository as an initializable directory', async () => {
  await execute('git', ['init', '--bare', root]);
  const service = new GitService(() => undefined);
  expect(await service.getStatus(root)).toMatchObject({ success: false, isRepo: false });
});

it('recognizes Git discovery stopping at a filesystem boundary', async () => {
  const service = new GitService(() => undefined, undefined, undefined, undefined, () => withGitRepositoryDiscovery(async () => {
    throw Object.assign(new Error('Git discovery'), { code: 128, stderr: 'fatal: not a git repository (or any parent up to mount point /mnt)\nStopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).\n' });
  }, async () => false));
  expect(await service.getStatus('/mnt/project')).toMatchObject({ success: true, isRepo: false });
});
