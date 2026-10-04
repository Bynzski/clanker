import { describe, expect, it } from 'vitest';
import { resolveHarnessPtySpawn, resolveHarnessSpawn } from '../../../src/main/harnessLaunch';
import { HarnessCapabilityError } from '../../../src/main/harnesses/types';
import { parseMsvcrtArgv, ptyCommandLine } from '../../_helpers/windowsCommandLine';

const COMSPEC = 'C:\\Windows\\System32\\cmd.exe';
// Representative harness argv whose last element is an arbitrary workspace path.
const buildLaunch = (cwd: string) => ({ command: 'hermes', args: ['-p', 'reviewer', '--tui', '--in', cwd] });

function windows(installed: string[]) {
  const files = new Set(installed.map((file) => file.toLowerCase()));
  return {
    platform: 'win32' as const,
    env: { Path: 'C:\\Tools;C:\\Users\\dev\\AppData\\Roaming\\npm', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: COMSPEC },
    fileExists: (file: string) => files.has(file.toLowerCase()),
  };
}

// The real descriptor → the real PTY spawn planner → node-pty's real Windows serializer.
function launchFor(cwd: string, installed: string[]) {
  const launch = buildLaunch(cwd);
  const plan = resolveHarnessPtySpawn(launch.command, launch.args, null, windows(installed));
  return { launch, plan, commandLine: ptyCommandLine(plan.spawnCmd, plan.spawnArgs) };
}

const CWDS = [
  'C:\\Users\\dev\\work\\app',
  'C:\\Users\\dev\\My Projects\\app',
  'C:\\Users\\dev\\R&D\\app',
  'C:\\Users\\dev\\Tom & Jerry (v2)\\app',
  'C:\\Users\\dev\\100% done (final)\\app',
  'C:\\Users\\dev\\a^b!c,d;e\\trailing space ',
];

describe('resolveHarnessPtySpawn on Windows', () => {
  describe('real executables (.exe) never involve cmd.exe', () => {
    it.each(CWDS)('preserves every argument boundary for %s', (cwd) => {
      const { launch, plan, commandLine } = launchFor(cwd, ['C:\\Tools\\hermes.exe']);
      expect(plan.spawnCmd.toLowerCase()).toBe('c:\\tools\\hermes.exe');
      expect(Array.isArray(plan.spawnArgs)).toBe(true);
      expect(parseMsvcrtArgv(commandLine).slice(1)).toEqual(launch.args);
      expect(parseMsvcrtArgv(commandLine).slice(-1)[0]).toBe(cwd);
      expect(commandLine.toLowerCase()).not.toContain('cmd.exe');
    });
  });

  describe('npm-style .cmd shims keep PATHEXT resolution through cmd.exe with escaped, verbatim arguments', () => {
    const shim = ['C:\\Users\\dev\\AppData\\Roaming\\npm\\hermes.cmd'];

    it('resolves an ordinary workspace path and hands node-pty one verbatim command line', () => {
      const { plan, commandLine } = launchFor('C:\\Users\\dev\\work\\app', shim);
      expect(plan.spawnCmd).toBe(COMSPEC);
      expect(typeof plan.spawnArgs).toBe('string');
      expect(commandLine.toLowerCase().startsWith(`${COMSPEC} /d /s /c ""c:\\users\\dev\\appdata\\roaming\\npm\\hermes.cmd" `.toLowerCase())).toBe(true);
    });

    it.each(CWDS.filter((cwd) => !cwd.includes('%')))('leaves no live cmd metacharacter or argument split for %s', (cwd) => {
      const { launch, commandLine } = launchFor(cwd, shim);
      const body = commandLine.slice(`${COMSPEC} /d /s /c `.length);
      // Drop the wrapper quotes and the quoted shim path, then caret-escaped characters; what remains
      // is what cmd.exe would act on. Only the argument-separating spaces may stay live.
      const live = body.slice(1, -1).replace(/^"[^"]*"/, '').replace(/\^./g, '');
      expect(live).not.toMatch(/[&|<>()!"%,;]/);
      expect(live.trim().split(' ')).toHaveLength(launch.args.length);
    });

    it.each(['C:\\Users\\dev\\100% done\\app', 'C:\\Users\\dev\\%USERPROFILE%\\app'])('fails closed instead of letting cmd.exe expand or split %j', (cwd) => {
      expect(() => launchFor(cwd, shim)).toThrow(HarnessCapabilityError);
      expect(() => launchFor(cwd, shim)).toThrow(/cannot be passed safely/);
    });

    it('prefers the .exe over a shim of the same name when both exist (PATHEXT order)', () => {
      const { plan } = launchFor('C:\\Users\\dev\\100%\\app', ['C:\\Tools\\hermes.exe', ...shim]);
      expect(plan.spawnCmd.toLowerCase()).toBe('c:\\tools\\hermes.exe');
    });
  });

  it('fails closed with a typed error when the command cannot be resolved, never falling back to cmd /c', () => {
    expect(() => launchFor('C:\\work\\a & b', [])).toThrow(HarnessCapabilityError);
    try { launchFor('C:\\work\\a & b', []); } catch (error) { expect((error as HarnessCapabilityError).kind).toBe('binary-unavailable'); }
  });

  it('keeps the POSIX wrapper form and the legacy non-PTY resolver unchanged', () => {
    expect(resolveHarnessPtySpawn('hermes', ['-p', 'x'], '/wrapper', { env: {}, platform: 'linux' }))
      .toEqual({ spawnCmd: '/wrapper', spawnArgs: ['hermes', '-p', 'x'] });
    expect(resolveHarnessPtySpawn('hermes', ['-p', 'x'], null, { env: {}, platform: 'linux' }))
      .toEqual({ spawnCmd: 'hermes', spawnArgs: ['-p', 'x'] });
    expect(resolveHarnessSpawn('codex', ['a'], '/wrapper')).toEqual({ spawnCmd: '/wrapper', spawnArgs: ['codex', 'a'] });
  });
});
