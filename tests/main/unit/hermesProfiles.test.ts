import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, symlink, rm, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isValidHarnessProfileName } from '../../../src/shared/harnessProfiles';
import { HarnessCapabilityError } from '../../../src/main/harnesses/types';
import { hermesProvider } from '../../../src/main/harnesses/hermes';
import type { HarnessCommandRequest } from '../../../src/main/harnesses/commandExecution';

// Real, canonical directories: main now canonicalizes with its own filesystem APIs.
let FIXTURE = '';
let HOME = '';
beforeAll(async () => {
  FIXTURE = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hermes-profiles-')));
  HOME = path.join(FIXTURE, 'hermes');
  await mkdir(HOME);
});
afterAll(async () => { await rm(FIXTURE, { recursive: true, force: true }); });

function executorFor(configPath = path.join(HOME, 'config.yaml')) {
  const run = vi.fn(async (request: HarnessCommandRequest) => {
    const args = request.args ?? [];
    let stdout = '';
    if (args.includes('path')) stdout = `${configPath}\n`;
    else if (args.includes('get')) stdout = 'local\n';
    else if (args.includes('--help')) stdout = 'options: --in PATH  --tui\n';
    return { stdout, stderr: '', exitCode: 0 };
  });
  return { run };
}

describe('Hermes native profiles capability', () => {
  it('keeps the native root when a named profile resolves through a symlink outside it', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'hermes-profile-root-'));
    try {
      const root = path.join(fixture, 'root');
      const target = path.join(fixture, 'external-profile');
      const named = path.join(root, 'profiles', 'coder');
      await mkdir(path.dirname(named), { recursive: true });
      await mkdir(target);
      await symlink(target, named, process.platform === 'win32' ? 'junction' : 'dir');
      const executor = {
        run: vi.fn(async (request: HarnessCommandRequest) => {
          const args = request.args ?? [];
          const stdout = args.includes('path')
            ? path.join(args[1] === 'default' ? root : named, 'config.yaml')
            : args.includes('get') ? 'local' : '--in PATH --tui';
          return { stdout, stderr: '', exitCode: 0 };
        }),
      };
      const profile = await hermesProvider.profiles.resolve(executor, 'coder');
      expect(profile).toMatchObject({ home: target, rootHome: root });
      const launch = hermesProvider.profiles.buildLaunch(profile, fixture);
      expect(launch.env.HERMES_HOME).toBe(root);
      expect(launch.args).toEqual(['-p', 'coder', '--tui', '--in', fixture]);
      expect(executor.run.mock.calls.some(([request]) => JSON.stringify(request.args) === JSON.stringify(['-p', 'default', 'config', 'path']))).toBe(true);
    } finally { await rm(fixture, { recursive: true, force: true }); }
  });
  it.each(['coder\n', 'coder\r', 'coder\r\n', 'coder ', 'coder\t', 'coder\u0000'])('shared validation rejects the exact malformed name %j', (name) => {
    expect(isValidHarnessProfileName(name)).toBe(false);
  });
  it('retains compatibility for default-profile metadata whose home is already the root', () => {
    const launch = hermesProvider.profiles.buildLaunch({ name: 'default', label: 'Default', home: '/native/root' }, '/workspace');
    expect(launch.env.HERMES_HOME).toBe('/native/root');
  });
  it.each(['relative', '/root/../other', '/root\nother', ''])('rejects unsafe canonical root metadata %j', (rootHome) => {
    expect(() => hermesProvider.profiles.buildLaunch({ name: 'coder', label: 'Coder', home: '/canonical/profile', rootHome }, '/workspace')).toThrow();
  });
  it.each(['relative/config.yaml', '/root/../config.yaml', '/root/config.yaml\nwarning', '/root/not-config.txt'])('validates the default root CLI path independently of the selected home %j', async (rootConfig) => {
    const executor = executorFor();
    const original = executor.run.getMockImplementation()!;
    executor.run.mockImplementation((request) => request.args?.[1] === 'default' && request.args.includes('path')
      ? Promise.resolve({ stdout: rootConfig, stderr: '', exitCode: 0 }) : original(request));
    await expect(hermesProvider.profiles.resolve(executor, 'coder')).rejects.toMatchObject({ kind: 'parse-failure' });
    expect(executor.run.mock.calls.every(([request]) => request.command === 'hermes')).toBe(true);
  });
  it('fails closed for named profile metadata missing its native root', () => {
    expect(() => hermesProvider.profiles.buildLaunch({ name: 'coder', label: 'Coder', home: '/external/profile' }, '/workspace')).toThrow();
  });
  it('declares probe exclusions without losing the intended root, and excludes inherited resume/bypass policy on launch', () => {
    const launch = hermesProvider.profiles.buildLaunch({ name: 'coder', label: 'Coder', home: '/canonical/hermes', rootHome: '/canonical/hermes' }, '/workspace');
    expect(hermesProvider.profiles.probeUnsetEnvironmentKeys).toContain('HERMES_CONFIG');
    expect(hermesProvider.profiles.probeUnsetEnvironmentKeys).not.toContain('HERMES_HOME');
    for (const key of ['HERMES_RESUME', 'HERMES_PROFILE', 'HERMES_YOLO_MODE', 'HERMES_CONFIG_PATH', 'HERMES_ENV_PATH']) expect(launch.unsetEnvironmentKeys).toContain(key);
  });
  it('returns an empty inventory for a compatible native table with no profiles', async () => {
    const executor = executorFor();
    executor.run.mockResolvedValueOnce({ stdout: 'Profile  Model  Gateway  Alias  Distribution\n────\n', stderr: '', exitCode: 0 });
    expect(await hermesProvider.profiles.discover(executor)).toEqual([]);
    expect(executor.run).toHaveBeenCalledTimes(1);
  });
  it('accepts native ANSI-colored argparse help flags', async () => {
    const executor = executorFor();
    const original = executor.run.getMockImplementation()!;
    executor.run.mockImplementation((request) => request.args?.includes('--help')
      ? Promise.resolve({ stdout: '  \u001b[36m--in \u001b[33mDIR\u001b[0m\n  \u001b[36m--tui\u001b[0m  Launch the modern TUI', stderr: '', exitCode: 0 }) : original(request));
    expect(await hermesProvider.profiles.resolve(executor, 'default')).toMatchObject({ name: 'default' });
  });
  it('preserves trailing spaces in a canonical native home instead of changing its identity', async () => {
    const spaced = path.join(FIXTURE, 'home with space ');
    await mkdir(spaced);
    expect(await hermesProvider.profiles.resolve(executorFor(path.join(spaced, 'config.yaml')), 'coder')).toMatchObject({ home: spaced });
  });
  it.each([
    new Error('private credential diagnostic'),
    Object.assign(new Error('private credential diagnostic'), { code: 'ENOENT' }),
    new HarnessCapabilityError('timeout', 'private credential diagnostic', { stderr: 'secret' }),
  ])('redacts executor failures while preserving their classification', async (error) => {
    const executor = executorFor();
    executor.run.mockRejectedValueOnce(error);
    const result = await hermesProvider.profiles.resolve(executor, 'coder').catch((failure: unknown) => failure);
    expect(result).toBeInstanceOf(HarnessCapabilityError);
    expect(result).toMatchObject({ kind: error instanceof HarnessCapabilityError ? 'timeout' : 'code' in error ? 'binary-unavailable' : 'command-failed' });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(result).toHaveProperty('cause', undefined);
  });
  it('reports deleted or missing native profiles without retaining CLI diagnostic output', async () => {
    const executor = executorFor();
    executor.run.mockResolvedValueOnce({ stdout: 'secret', stderr: 'private diagnostic', exitCode: 1 });
    const error = await hermesProvider.profiles.resolve(executor, 'deleted').catch((failure: unknown) => failure);
    expect(error).toMatchObject({ kind: 'command-failed', cause: undefined });
    expect(JSON.stringify(error)).not.toContain('private');
    expect(executor.run).toHaveBeenCalledTimes(1);
  });
  it('builds an explicit launch preserving cwd spaces and excluding inherited selectors', () => {
    const profile = { name: 'coder', label: 'Coder', home: '/canonical/hermes', rootHome: '/canonical/hermes' };
    const launch = hermesProvider.profiles.buildLaunch(profile, '/workspace/my project');
    expect(launch.command).toBe('hermes');
    expect(launch.args).toEqual(['-p', 'coder', '--tui', '--in', '/workspace/my project']);
    const inherited = { HERMES_CONFIG: '/other/config', HERMES_ENV: '/other/env', HERMES_HOME: '/other/home', HERMES_PROFILE_NAME: 'other', TERMINAL_CWD: '/other/cwd', TERMINAL_ENV: 'docker', TERMINAL_BACKEND: 'ssh', HERMES_TERMINAL_BACKEND: 'docker', KEEP: 'yes' };
    const environment: Record<string, string> = { ...inherited };
    for (const key of launch.unsetEnvironmentKeys) delete environment[key];
    Object.assign(environment, launch.env);
    expect(environment).toEqual({ KEEP: 'yes', HERMES_HOME: profile.home, HERMES_PROFILE_NAME: 'coder', TERMINAL_CWD: '/workspace/my project', TERMINAL_ENV: 'local', TERMINAL_BACKEND: 'local', HERMES_TERMINAL_BACKEND: 'local' });
    expect(launch.env).not.toHaveProperty('HERMES_YOLO_MODE');
  });
  it.each(['relative', '/a/../cwd', '/a\nother'])('rejects non-native launch cwd %j', (cwd) => {
    expect(() => hermesProvider.profiles.buildLaunch({ name: 'coder', label: 'coder', home: '/canonical/hermes', rootHome: '/canonical/hermes' }, cwd)).toThrow();
  });
  it.each([
    '', 'Profiles: default',
    'Profile  Model  Gateway  Alias  Distribution\nnot separator\ndefault  m  stopped  —  —',
    'Name  Model  Gateway  Alias  Distribution\n────\ndefault  m  stopped  —  —',
    'Profile  Model  Gateway  Alias  Distribution\n────\ndefault  m  stopped  —  —\ndefault  m  stopped  —  —',
    'Profile  Model  Gateway  Alias  Distribution\n────\ndefault  m  stopped  —  —\ninvalid name  m  stopped  —  —',
    'Profile  Model  Gateway  Alias  Distribution\n────\ndefault',
    `Profile  Model  Gateway  Alias  Distribution\n────\n${Array.from({ length: 33 }, (_, i) => `profile${i}  m  stopped  —  —`).join('\n')}`,
  ])('rejects the whole incompatible, malformed or overflowing table before resolution', async (table) => {
    const executor = executorFor();
    executor.run.mockImplementationOnce(async () => ({ stdout: table, stderr: '', exitCode: 0 }));
    await expect(hermesProvider.profiles.discover(executor)).rejects.toMatchObject({ kind: 'parse-failure' });
    expect(executor.run).toHaveBeenCalledTimes(1);
  });
  it('discovers names only from the verified native table then resolves each sequentially', async () => {
    const executor = executorFor();
    executor.run.mockImplementationOnce(async () => ({ stdout: '\u001b[32m Profile  Model  Gateway  Alias  Distribution\u001b[0m\n ─────  ─────  ─────  ─────  ─────\n ◆default  model  stopped  —  —\n coder-2  model  stopped  coder  —\n', stderr: '', exitCode: 0 }));
    expect(await hermesProvider.profiles.discover(executor)).toEqual([
      { name: 'default', label: 'default', home: HOME, rootHome: HOME },
      { name: 'coder-2', label: 'coder-2', home: HOME, rootHome: HOME },
    ]);
    expect(executor.run.mock.calls[0][0].args).toEqual(['profile', 'list']);
  });
  it.each(['relative/config.yaml', 'C:config.yaml', '\\home\\config.yaml', '/native/hermes/not-config.txt', '/a/config.yaml\nwarning', '/a/../config.yaml', '/a/\u0000/config.yaml'])('rejects unsafe native config path %j', async (config) => {
    await expect(hermesProvider.profiles.resolve(executorFor(config), 'coder')).rejects.toMatchObject({ kind: 'parse-failure' });
  });
  it.each(['C:\\Users\\Jay\\Hermes Profile\\config.yaml', '\\\\server\\share\\hermes\\config.yaml'])('still validates Windows-shaped config paths syntactically, then fails closed when the directory does not exist here %j', async (config) => {
    await expect(hermesProvider.profiles.resolve(executorFor(config), 'coder')).rejects.toMatchObject({ kind: 'command-failed', message: 'Hermes profile directory is unavailable' });
  });
  it('fails closed for a missing or non-directory home without leaking the host path', async () => {
    const file = path.join(FIXTURE, 'a-file');
    await writeFile(file, 'x');
    for (const home of [path.join(FIXTURE, 'does-not-exist'), file]) {
      const error = await hermesProvider.profiles.resolve(executorFor(path.join(home, 'config.yaml')), 'coder').catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(HarnessCapabilityError);
      expect(error).toMatchObject({ kind: 'command-failed', message: 'Hermes profile directory is unavailable', cause: undefined });
      expect(JSON.stringify(error)).not.toContain(FIXTURE);
    }
  });
  it('canonicalizes the default and named profile homes independently, through symlinks', async () => {
    const root = path.join(FIXTURE, 'canon-root');
    const target = path.join(FIXTURE, 'canon-external');
    const rootLink = path.join(FIXTURE, 'canon-root-link');
    await mkdir(root); await mkdir(target);
    await mkdir(path.join(root, 'profiles'));
    const kind = process.platform === 'win32' ? 'junction' : 'dir';
    await symlink(root, rootLink, kind);
    await symlink(target, path.join(root, 'profiles', 'coder'), kind);
    const executor = { run: vi.fn(async (request: HarnessCommandRequest) => {
      const args = request.args ?? [];
      const stdout = args.includes('path')
        ? path.join(args[1] === 'default' ? rootLink : path.join(rootLink, 'profiles', 'coder'), 'config.yaml')
        : args.includes('get') ? 'local' : '--in PATH --tui';
      return { stdout, stderr: '', exitCode: 0 };
    }) };
    expect(await hermesProvider.profiles.resolve(executor, 'default')).toMatchObject({ home: root, rootHome: root });
    expect(await hermesProvider.profiles.resolve(executor, 'coder')).toMatchObject({ home: target, rootHome: root });
  });
  it('resolves and discovers with no external node executable (executor reports node unavailable)', async () => {
    const inner = executorFor();
    const run = vi.fn(async (request: HarnessCommandRequest) => {
      if (request.command === 'node') throw Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT' });
      return inner.run(request);
    });
    expect(await hermesProvider.profiles.resolve({ run }, 'coder')).toMatchObject({ home: HOME, rootHome: HOME });
    run.mockImplementationOnce(async () => ({ stdout: 'Profile  Model  Gateway  Alias  Distribution\n────\ndefault  m  stopped  —  —\n', stderr: '', exitCode: 0 }));
    expect(await hermesProvider.profiles.discover({ run })).toHaveLength(1);
    expect(run.mock.calls.every(([request]) => request.command === 'hermes')).toBe(true);
  });
  it.each(['docker', 'ssh', '', 'local\nextra'])('fails closed for backend %j', async (backend) => {
    const executor = executorFor();
    executor.run.mockImplementationOnce(async () => ({ stdout: '/native/hermes/config.yaml', stderr: '', exitCode: 0 }));
    executor.run.mockImplementationOnce(async () => ({ stdout: backend, stderr: '', exitCode: 0 }));
    await expect(hermesProvider.profiles.resolve(executor, 'coder')).rejects.toMatchObject({ kind: 'unsupported' });
    expect(executor.run).toHaveBeenCalledTimes(2);
  });
  it.each(['--in PATH', '--tui', '--inside --tuition'])('rejects help without exact launch flags %j', async (help) => {
    const executor = executorFor();
    const original = executor.run.getMockImplementation()!;
    executor.run.mockImplementation((request) => request.args?.includes('--help')
      ? Promise.resolve({ stdout: help, stderr: '', exitCode: 0 }) : original(request));
    await expect(hermesProvider.profiles.resolve(executor, 'coder')).rejects.toMatchObject({ kind: 'unsupported' });
  });
  it('probes the launch parser with the exact bounded top-level help invocation, not the chat subparser', async () => {
    const executor = executorFor();
    await hermesProvider.profiles.resolve(executor, 'coder');
    const helpCalls = executor.run.mock.calls.map(([request]) => request).filter((request) => request.args?.includes('--help'));
    expect(helpCalls).toHaveLength(1);
    expect(helpCalls[0]).toMatchObject({ command: 'hermes', args: ['-p', 'coder', '--help'], timeoutMs: 5000, maxOutputBytes: 32768 });
    expect(JSON.stringify(executor.run.mock.calls)).not.toContain('chat');
  });
  it.each(['  --in DIR', '  --tui', '--inside DIR --tuition'])('requires both exact flags in the top-level help %j', async (help) => {
    const executor = executorFor();
    const original = executor.run.getMockImplementation()!;
    executor.run.mockImplementation((request) => request.args?.includes('--help')
      ? Promise.resolve({ stdout: help, stderr: '', exitCode: 0 }) : original(request));
    await expect(hermesProvider.profiles.resolve(executor, 'coder')).rejects.toMatchObject({ kind: 'unsupported' });
  });
  it.each(['', '../coder', ' coder', 'coder ', '--help', 'a'.repeat(65), 'coder\n', 'α'])('rejects invalid exact profile name %j before executing', async (name) => {
    const executor = executorFor();
    await expect(hermesProvider.profiles.resolve(executor, name)).rejects.toMatchObject({ kind: 'parse-failure' });
    expect(executor.run).not.toHaveBeenCalled();
  });
  it('resolves an explicit native profile with only bounded Hermes CLI probes and canonical home', async () => {
    expect(hermesProvider).toHaveProperty('profiles');
    const executor = executorFor();
    const profiles = hermesProvider.profiles;
    expect(await profiles.resolve(executor, 'coder')).toEqual({ name: 'coder', label: 'coder', home: HOME, rootHome: HOME });
    expect(executor.run.mock.calls.map(([request]) => [request.command, request.args])).toEqual([
      ['hermes', ['-p', 'coder', 'config', 'path']],
      ['hermes', ['-p', 'coder', 'config', 'get', 'terminal.backend']],
      ['hermes', ['-p', 'coder', '--help']],
      ['hermes', ['-p', 'default', 'config', 'path']],
    ]);
    for (const [request] of executor.run.mock.calls) {
      expect(request.timeoutMs).toBeGreaterThan(0);
      expect(request.maxOutputBytes).toBeLessThanOrEqual(32768);
      expect(request.env ?? {}).not.toHaveProperty('HERMES_HOME');
    }
  });
});
