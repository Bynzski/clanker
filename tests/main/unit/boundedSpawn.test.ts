import { describe, expect, it } from 'vitest';
import { planBoundedSpawn, resolveWindowsExecutable, UnsafeBatchArgumentError } from '../../../src/main/environment/boundedSpawn';

const files = new Set([
  
  'C:\\bin\\tool.exe', 'C:\\bin\\shim.cmd', 'C:\\npm\\codex.cmd', 'C:\\bin\\old.bat', 'C:\\later\\tool.cmd', 'C:\\Program Files\\x\\sp ace.cmd',
]);
const win = (extra: Record<string, string> = {}) => ({
  platform: 'win32' as const,
  env: { Path: 'C:\\bin;C:\\npm;C:\\later;"C:\\Program Files\\x"', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe', ...extra },
  fileExists: (file: string) => [...files].some((known) => known.toLowerCase() === file.toLowerCase()),
});

describe('planBoundedSpawn', () => {
  it('passes the command through unchanged on POSIX', () => {
    expect(planBoundedSpawn('tool', ['a b', '&|'], { platform: 'linux', env: {} })).toEqual({ file: 'tool', args: ['a b', '&|'] });
  });
  it('resolves .exe via PATH/PATHEXT (case-insensitive Path key) and launches it directly with intact argv', () => {
    const args = ['a b', '&', '|', '<', '>', '^', '"q"', '%PATH%'];
    const plan = planBoundedSpawn('tool', args, win())!;
    expect(plan.file.toLowerCase()).toBe('c:\\bin\\tool.exe');
    expect(plan.args).toEqual(args);
    expect(plan.windowsVerbatimArguments).toBeUndefined();
  });
  it('honors PATHEXT order and explicit extensions', () => {
    expect(resolveWindowsExecutable('shim', win())?.toLowerCase()).toBe('c:\\bin\\shim.cmd');
    expect(resolveWindowsExecutable('old.bat', win())).toBe('C:\\bin\\old.bat');
    expect(resolveWindowsExecutable('tool', win({ PATHEXT: '.CMD' }))?.toLowerCase()).toBe('c:\\later\\tool.cmd');
    expect(resolveWindowsExecutable('sp ace', win())?.toLowerCase()).toBe('c:\\program files\\x\\sp ace.cmd');
  });
  it('returns null for a missing executable so it classifies as unavailable', () => {
    expect(planBoundedSpawn('nothing', [], win())).toBeNull();
  });
  it('routes .cmd/.bat through cmd.exe with escaped, verbatim arguments and never shell: true', () => {
    const plan = planBoundedSpawn('codex', ['plain', 'a b', '&calc', 'x|y', 'say "hi"', '^'], win())!;
    expect(plan.file).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(plan.windowsVerbatimArguments).toBe(true);
    expect(plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    const line = plan.args[3];
    expect(line.toLowerCase().startsWith('""c:\\npm\\codex.cmd"')).toBe(true);
    // No unescaped metacharacter outside caret-escaping can split the command line.
    const body = line.slice(1, -1).replace(/^"[^"]*"/, '');
    expect(body).not.toMatch(/(?<!\^)[&|<>]/);
    expect(body).toContain('^^^&calc');
  });
  it('rejects batch arguments cmd.exe cannot carry safely', () => {
    expect(() => planBoundedSpawn('shim', ['%COMSPEC%'], win())).toThrow(UnsafeBatchArgumentError);
    expect(() => planBoundedSpawn('shim', ['a\nb'], win())).toThrow(UnsafeBatchArgumentError);
    expect(() => planBoundedSpawn('shim', ['a\rb'], win())).toThrow(UnsafeBatchArgumentError);
    // The same characters are harmless for a real executable.
    expect(planBoundedSpawn('tool', ['%PATH%', 'a\nb'], win())).toMatchObject({ args: ['%PATH%', 'a\nb'] });
  });
});
