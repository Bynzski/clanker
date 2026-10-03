import { describe, expect, it, vi } from 'vitest';
import { executeLocalHarnessCommand } from '../../../src/main/environment/localCommandExecutor';
import { executeSshHarnessCommand } from '../../../src/main/remote/sshHarnessCommand';
import { SshExecutionError, type SshCommandExecutor } from '../../../src/main/remote/sshCommandExecutor';
import { SshEnvironment } from '../../../src/main/remote/sshEnvironment';
import { HarnessCapabilityError } from '../../../src/main/harnesses/types';
import { normalizeHarnessCommand, MAX_COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT_BYTES } from '../../../src/main/harnesses/commandExecution';

const node = (code: string, extra: Partial<Parameters<typeof executeLocalHarnessCommand>[0]> = {}) =>
  ({ command: 'node', args: ['-e', code], ...extra });

describe('normalizeHarnessCommand', () => {
  it('clamps bounds and rejects unsafe shapes', () => {
    expect(normalizeHarnessCommand({ command: 'x', timeoutMs: 1e9, maxOutputBytes: 1e12 })).toMatchObject({ timeoutMs: MAX_COMMAND_TIMEOUT_MS, maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES });
    expect(() => normalizeHarnessCommand({ command: '/bin/sh' })).toThrow(HarnessCapabilityError);
    expect(() => normalizeHarnessCommand({ command: 'a b' })).toThrow(HarnessCapabilityError);
    expect(() => normalizeHarnessCommand({ command: 'x', args: ['a\0'] })).toThrow(HarnessCapabilityError);
    expect(() => normalizeHarnessCommand({ command: 'x', env: { CLANKER_ATTENTION_TOKEN: 't' } })).toThrow(HarnessCapabilityError);
    expect(() => normalizeHarnessCommand({ command: 'x', env: { 'BAD-NAME': 't' } })).toThrow(HarnessCapabilityError);
  });
});

describe('local bounded execution', () => {
  it('accepts a main-owned sanitized base environment without mutating the process environment', async () => {
    vi.stubEnv('HERMES_CONFIG', '/unwanted-config');
    try {
      const baseEnv = { ...process.env };
      delete baseEnv.HERMES_CONFIG;
      const result = await executeLocalHarnessCommand(node('console.log(process.env.HERMES_CONFIG || "unset")'), undefined, { baseEnv });
      expect(result.stdout.trim()).toBe('unset');
      expect(process.env.HERMES_CONFIG).toBe('/unwanted-config');
    } finally { vi.unstubAllEnvs(); }
  });
  it('returns stdout, stderr and stdin round trip', async () => {
    const result = await executeLocalHarnessCommand(node('process.stdin.on("data",d=>{process.stdout.write(String(d).toUpperCase());console.error("e")})', { stdin: 'abc' }));
    expect(result).toEqual({ stdout: 'ABC', stderr: 'e\n', exitCode: 0 });
  });
  it('returns non-zero exits as results', async () => {
    expect(await executeLocalHarnessCommand(node('console.log("x");process.exit(3)'))).toMatchObject({ stdout: 'x\n', exitCode: 3 });
  });
  it('passes env but strips attention credentials from the inherited environment', async () => {
    process.env.CLANKER_ATTENTION_TOKEN = 'secret';
    try {
      const result = await executeLocalHarnessCommand(node('console.log(process.env.FOO + "|" + process.env.CLANKER_ATTENTION_TOKEN)', { env: { FOO: 'bar' } }));
      expect(result.stdout.trim()).toBe('bar|undefined');
    } finally { delete process.env.CLANKER_ATTENTION_TOKEN; }
  });
  it('fails with typed timeout, output-limit, missing binary and abort errors', async () => {
    await expect(executeLocalHarnessCommand(node('setTimeout(()=>{},5000)', { timeoutMs: 100 }))).rejects.toMatchObject({ kind: 'timeout' });
    await expect(executeLocalHarnessCommand(node('console.log("x".repeat(5000))', { maxOutputBytes: 1000 }))).rejects.toMatchObject({ kind: 'output-limit' });
    await expect(executeLocalHarnessCommand({ command: 'clanker-no-such-binary-xyz' })).rejects.toMatchObject({ kind: 'binary-unavailable' });
    const controller = new AbortController();
    const pending = executeLocalHarnessCommand(node('setTimeout(()=>{},5000)'), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    await expect(executeLocalHarnessCommand(node(''), controller.signal)).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('SSH bounded execution', () => {
  const executor = (exec: ReturnType<typeof vi.fn>) => ({ exec }) as unknown as SshCommandExecutor;

  it('delegates to SshCommandExecutor for the target with bounds, env, cwd and stdin', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'out', stderr: '', exitCode: 0 });
    const signal = new AbortController().signal;
    const result = await executeSshHarnessCommand(executor(exec), 'dev@host', { command: 'tool', args: ['--json', "a'b"], cwd: '/ws', env: { FOO: 'x' }, stdin: 'in', timeoutMs: 1234, maxOutputBytes: 99 }, signal);
    expect(result).toEqual({ stdout: 'out', stderr: '', exitCode: 0 });
    const [target, command, args, options] = exec.mock.calls[0];
    expect(target).toBe('dev@host');
    expect(command).toBe('sh');
    expect(args[0]).toBe('-c');
    expect(args[1]).toContain("exec 'tool' '--json' 'a'\\''b'");
    expect(options).toMatchObject({ signal, cwd: '/ws', timeoutMs: 1234, maxBuffer: 99, input: 'in', remoteEnv: { FOO: 'x' } });
  });
  it('maps failures to typed errors and keeps remote non-zero exits as results', async () => {
    const run = (error: unknown) => executeSshHarnessCommand(executor(vi.fn().mockRejectedValue(error)), 'h', { command: 't' });
    expect(await run(new SshExecutionError('bad', 2, 'o', 'e'))).toEqual({ stdout: 'o', stderr: 'e', exitCode: 2 });
    await expect(run(new SshExecutionError('x', 255, '', ''))).rejects.toMatchObject({ kind: 'transport-failure' });
    // 127 is program output, not proof the harness is missing (availability is probed separately).
    expect(await run(new SshExecutionError('x', 127, '', ''))).toMatchObject({ exitCode: 127 });
    await expect(run(new Error('Remote SSH command timed out after 5ms'))).rejects.toMatchObject({ kind: 'timeout' });
    await expect(run(new Error('Remote SSH command stdout exceeded limit of 5 bytes'))).rejects.toMatchObject({ kind: 'output-limit' });
    await expect(run(new Error('Remote SSH command aborted'))).rejects.toMatchObject({ kind: 'aborted' });
  });
  it('is exposed by SshEnvironment through its own executor and target', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: '{}', stderr: '', exitCode: 0 });
    const env = new SshEnvironment({ kind: 'ssh', id: 'ssh-1', label: 'r', target: 'me@remote' }, executor(exec));
    await env.executeHarnessCommand({ command: 'tool' });
    expect(exec.mock.calls[0][0]).toBe('me@remote');
  });
});
