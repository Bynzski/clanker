import * as registry from '../../../src/main/harnesses/registry';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync, readFileSync, chmodSync, mkdirSync, writeFileSync, symlinkSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legacyHooks } from '../../../src/main/harnesses/agy/remoteAttention';
import { LEGACY_HERMES_REMOTE_ATTENTION_PLUGIN, PREVIOUS_HERMES_REMOTE_ATTENTION_PLUGIN } from '../../../src/main/harnesses/hermes/remoteAttention';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';
import { createRemoteAttentionFilter, REMOTE_ATTENTION_PREFIX } from '../../../src/main/remote/remoteAttentionTransport';
import { prepareSshAttention, HERMES_REMOTE_ATTENTION_PLUGIN } from '../../../src/main/remote/sshAgentAttention';
import { SshEnvironment } from '../../../src/main/remote/sshEnvironment';
import type { SshCommandExecutor } from '../../../src/main/remote/sshCommandExecutor';

const roots: string[] = [];
const brokers: AgentAttentionBroker[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { force: true, recursive: true }));
  brokers.splice(0).forEach((broker) => broker.close());
});
const frame = (raw: string) => REMOTE_ATTENTION_PREFIX + Buffer.from(raw).toString('base64') + '\x07';
const token = 'a'.repeat(64);

// Exercise the host scripts locally with a unique HOME, without any installed harness or model call.
function fixture(extraEnv: Record<string, string> = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'clanker-attention-test-')));
  roots.push(home);
  const exec = vi.fn(async (_target: string, command: string, args: string[], options?: { input?: string | Buffer }) => {
    if (args.some((arg) => arg.includes("exec 'hermes' 'plugins' 'enable'"))) return { stdout: '', stderr: '', exitCode: 0 };
    const result = spawnSync(command === 'sh' ? '/bin/sh' : command, args, { input: options?.input, encoding: 'utf8',
      env: { ...process.env, HOME: home, HERMES_HOME: '', HERMES_PROFILE: '', OPENCODE_CONFIG_DIR: '', CODEX_HOME: '', ...extraEnv } });
    if (result.status !== 0) throw new Error(result.stderr);
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  });
  return { home, exec, executor: { exec } as unknown as SshCommandExecutor };
}

// A real controlling tty catches regressions that stdout-only tests miss.
const CAPTURE_TTY = `import errno, os, select, sys, time
pid, fd = os.forkpty()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
output = b''
deadline = time.monotonic() + 5
while time.monotonic() < deadline:
    if not select.select([fd], [], [], 0.1)[0]:
        continue
    try:
        chunk = os.read(fd, 65536)
    except OSError as error:
        if error.errno == errno.EIO:
            break
        raise
    if not chunk:
        break
    output += chunk
else:
    os.kill(pid, 9)
os.close(fd)
os.waitpid(pid, 0)
sys.stdout.buffer.write(output)
`;

describe('SSH attention event boundary', () => {
  it('isolates remote credentials from the loopback listener, other terminals, and retired launches', async () => {
    const updates = vi.fn();
    const broker = new AgentAttentionBroker(updates, () => undefined);
    brokers.push(broker);
    const remoteToken = broker.registerRemote('ssh-a', 'opencode');
    const local = await broker.register('local-a', 'opencode');
    const raw = JSON.stringify({ version: 1, token: remoteToken, harness: 'opencode', event: 'turn_started', scope: 'root', sessionId: 'session-a', turnId: '1' });
    broker.receive(raw);
    broker.receiveRemote('ssh-b', raw);
    broker.receiveRemote('ssh-a', JSON.stringify({ version: 1, token: local.CLANKER_ATTENTION_TOKEN, harness: 'opencode', event: 'turn_started', scope: 'root', sessionId: 'session-a', turnId: '1' }));
    expect(updates).not.toHaveBeenCalled();
    broker.receiveRemote('ssh-a', raw);
    expect(updates).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ terminalId: 'ssh-a', snapshot: expect.objectContaining({ runtime: expect.objectContaining({ status: 'running' }) }) }));
    broker.release('ssh-a');
    expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ terminalId: 'ssh-a', snapshot: null }));
    broker.receiveRemote('ssh-a', raw);
    expect(updates).toHaveBeenCalledTimes(2);
  });

  it('extracts split and adjacent lifecycle frames while preserving Unicode, escape sequences, and ordinary output', () => {
    const receive = vi.fn();
    const filter = createRemoteAttentionFilter(receive);
    const raw = JSON.stringify({ event: 'turn_started' });
    const input = 'α\x1b[31mhello' + frame(raw) + frame(raw) + '世界\r\n';
    let output = '';
    for (const char of input) output += filter(char);
    expect(output).toBe('α\x1b[31mhello世界\r\n');
    expect(receive.mock.calls).toEqual([[raw], [raw]]);
    expect(filter('normal\x1b]0;title\x07')).toBe('normal\x1b]0;title\x07');
  });

  it('rejects malformed and oversized messages and bounds buffering of unterminated frames', () => {
    const receive = vi.fn();
    const filter = createRemoteAttentionFilter(receive);
    expect(filter(REMOTE_ATTENTION_PREFIX + 'not base64!\x07ok')).toBe('ok');
    expect(filter(frame('x'.repeat(2049)) + 'ok')).toBe('ok');
    const unterminated = REMOTE_ATTENTION_PREFIX + 'x'.repeat(5000);
    expect(filter(unterminated)).toBe(unterminated);
    expect(filter('still visible')).toBe('still visible');
    expect(receive).not.toHaveBeenCalled();
  });

  it('consumes oversized BEL-terminated private frames and preserves trailing PTY output exactly', () => {
    const receive = vi.fn();
    const filter = createRemoteAttentionFilter(receive);
    // Reserved control frames are never rendered, including malformed frames.
    const trailing = '\r\n世界\x1b[31mordinary output\x1b[0m';
    expect(filter(REMOTE_ATTENTION_PREFIX + 'A'.repeat(5000) + '\x07' + trailing)).toBe(trailing);
    expect(receive).not.toHaveBeenCalled();
    expect(filter('next chunk')).toBe('next chunk');
  });
});

describe.skipIf(process.platform === 'win32')('remote attention adapters', () => {
  it('uses the prepared user CLI PATH for out-of-band cleanup when system PATH has no Python', async () => {
    const { executor, home, exec } = fixture({ PATH: '' });
    const bin = join(home, '.local/bin');
    mkdirSync(bin, { recursive: true });
    const python = execFileSync('/bin/sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).trim();
    symlinkSync(python, join(bin, 'python3'));
    expect(spawnSync('python3', ['--version'], { env: { PATH: '' } }).error).toBeDefined();
    const prepared = await prepareSshAttention(executor, 'host', 'opencode', [], token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..');
    roots.push(root);
    expect(existsSync(join(root, 'command.mjs'))).toBe(true);
    await prepared.release();
    expect(exec.mock.calls[1][1]).toBe('sh');
    expect(existsSync(root)).toBe(false);
  });

  it('normalizes a setgid TMPDIR launch root to 0700 and preserves unknown files during release', async () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'clanker-sgid-test-')));
    roots.push(parent);
    chmodSync(parent, 0o2700);
    expect(statSync(parent).mode & 0o7777).toBe(0o2700);
    const { executor } = fixture({ TMPDIR: parent });
    const prepared = await prepareSshAttention(executor, 'host', 'opencode', [], token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..');
    expect(root.startsWith(parent + '/')).toBe(true);
    expect(statSync(root).mode & 0o7777).toBe(0o700);
    writeFileSync(join(root, 'unknown.txt'), 'preserve');
    await prepared.release();
    expect(readFileSync(join(root, 'unknown.txt'), 'utf8')).toBe('preserve');
    expect(existsSync(join(root, 'command.mjs'))).toBe(false);
    expect(existsSync(join(root, 'opencode'))).toBe(false);
    expect(statSync(root).mode & 0o7777).toBe(0o700);
    rmSync(join(root, 'unknown.txt'));
    await prepared.release();
    expect(existsSync(root)).toBe(false);
  });
  it.each(['codex', 'claude', 'opencode', 'pi', 'omp', 'agy', 'hermes'])('prepares isolated %s hooks and cleans launch files without deleting unrecognized files', async (harness) => {
    const { executor, home, exec } = fixture();
    const prepared = await prepareSshAttention(executor, 'test-host', harness, ['--model', 'test'], token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..');
    roots.push(root);
    expect(prepared.env.CLANKER_REMOTE_ATTENTION_TOKEN).toBe(token);
    expect(prepared.env.CLANKER_ATTENTION_PORT).toBeUndefined();
    expect(readFileSync(join(root, 'observer.mjs'), 'utf8')).toContain('/dev/tty');
    if (harness === 'codex') {
      expect(prepared.args.filter((arg) => arg.startsWith('hooks.')).map((arg) => arg.split('=')[0])).toEqual(['hooks.UserPromptSubmit', 'hooks.PreToolUse', 'hooks.PermissionRequest', 'hooks.PostToolUse', 'hooks.Stop', 'hooks.SubagentStop', 'hooks.Interrupt', 'hooks.SessionEnd', 'hooks.SessionStart']);
      expect(prepared.args.join(' ')).not.toContain('notify=');
      expect(prepared.args.join(' ')).toContain(JSON.stringify('node "$CLANKER_REMOTE_ATTENTION_COMMAND" "$CLANKER_REMOTE_ATTENTION_INTERPRETER" Stop').slice(1, -1));
      expect(prepared.args.join(' ')).not.toContain(root);
      expect(prepared.env.CLANKER_REMOTE_ATTENTION_INTERPRETER).toBe(`${root}/interpreter.mjs`);
    }
    if (harness === 'claude') {
      const settings = JSON.parse(readFileSync(join(root, 'claude-settings.json'), 'utf8'));
      expect(settings.hooks.Stop[0].hooks[0].command).toContain(`${root}/command.mjs`);
    }
    if (harness === 'opencode') expect(prepared.env.OPENCODE_CONFIG_DIR).toBe(join(root, 'opencode'));
    if (harness === 'pi' || harness === 'omp') expect(prepared.args.slice(-2)).toEqual(['--extension', join(root, `${harness}.ts`)]);
    if (harness === 'agy') expect(readFileSync(join(home, '.gemini/config/plugins/clanker-grid-remote-attention/hooks.json'), 'utf8')).toContain('$CLANKER_REMOTE_ATTENTION_COMMAND');
    expect(exec).toHaveBeenCalledTimes(harness === 'hermes' ? 2 : 1);
    const payload = JSON.parse(String(exec.mock.calls[0][3]?.input));
    const expectedFiles = ['command.mjs', 'observer.mjs', ...(['codex', 'claude', 'agy'].includes(harness) ? ['interpreter.mjs'] : []), ...(harness === 'pi' ? ['pi.ts'] : harness === 'omp' ? ['omp.ts'] : harness === 'opencode' ? ['opencode/observer.mjs', 'opencode/plugins/clanker-attention.js'] : [])];
    expect(Object.keys(payload.files).sort()).toEqual(expectedFiles.sort());
    writeFileSync(join(root, 'preserve.txt'), 'unknown');
    await prepared.release();
    expect(readFileSync(join(root, 'preserve.txt'), 'utf8')).toBe('unknown');
    expect(() => readFileSync(join(root, 'command.mjs'))).toThrow();
  });

  it('prepares and cleans a synthetic provider resource and environment without transport changes', async () => {
    const provider = registry.getHarnessProvider('pi');
    const lookup = vi.spyOn(registry, 'findHarnessProvider').mockReturnValue({ ...provider, attention: { remote: {
      requiresNode: false, validate: '',
      resources: () => ({ 'future/nested/observer.py': '# new provider resource' }),
      environmentKeys: ['FUTURE_PLUGIN_ROOT'],
      configure: "    env['FUTURE_PLUGIN_ROOT'] = os.path.join(root, 'future')",
    } } });
    try {
      const { executor, exec } = fixture();
      const prepared = await prepareSshAttention(executor, 'host', 'pi', [], token);
      const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..'); roots.push(root);
      expect(readFileSync(join(root, 'future/nested/observer.py'), 'utf8')).toBe('# new provider resource');
      expect(prepared.env.FUTURE_PLUGIN_ROOT).toBe(join(root, 'future'));
      await prepared.release(); await prepared.release();
      expect(existsSync(root)).toBe(false);
      expect(exec).toHaveBeenCalledTimes(3); // one preparation, two idempotent cleanup executions
    } finally { lookup.mockRestore(); }
  });

  it('rejects cleanup ownership mismatches before removing resources', async () => {
    const { executor, exec } = fixture();
    const prepared = await prepareSshAttention(executor, 'host', 'codex', [], token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..'); roots.push(root);
    const execute = exec.getMockImplementation()!;
    // Simulate a different host UID without requiring privileged chown.
    exec.mockImplementationOnce((target, command, args, options) => execute(target, command,
      args.map((value) => value.split('os.geteuid()').join('(os.geteuid() + 1)')), options));
    await expect(prepared.release()).rejects.toThrow();
    expect(existsSync(join(root, 'command.mjs'))).toBe(true);
    await prepared.release(); expect(existsSync(root)).toBe(false);
  });

  it('cleans the private launch manifest after plugin enabling fails, preserving the persistent plugin', async () => {
    const { executor, exec, home } = fixture();
    const execute = exec.getMockImplementation()!;
    let launchRoot = '';
    exec.mockImplementation(async (target, command, args, options) => {
      if (args.some((value) => value.includes("exec 'hermes' 'plugins' 'enable'"))) throw new Error('enable failed');
      const result = await execute(target, command, args, options);
      if (options?.input) launchRoot = JSON.parse(result.stdout).root;
      return result;
    });
    await expect(prepareSshAttention(executor, 'host', 'hermes', [], token)).rejects.toThrow('enable failed');
    expect(exec).toHaveBeenCalledTimes(3);
    expect(existsSync(launchRoot)).toBe(false);
    expect(existsSync(join(home, '.hermes/plugins/clanker-grid-remote-attention/__init__.py'))).toBe(true);
  });

  it.each(['file-symlink', 'parent-symlink', 'manifest-symlink', 'file-mode', 'root-mode', 'manifest-traversal'])('fails closed during %s cleanup and permits safe recovery', async (tamper) => {
    const { executor, home } = fixture();
    const prepared = await prepareSshAttention(executor, 'host', 'opencode', [], token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..'); roots.push(root);
    const external = join(home, 'external'); mkdirSync(external);
    const externalFile = join(external, 'keep'); writeFileSync(externalFile, 'preserve', { mode: 0o600 });
    const manifest = join(root, '.clanker-resources.json'); const original = readFileSync(manifest, 'utf8');
    if (tamper === 'file-symlink') { rmSync(join(root, 'command.mjs')); symlinkSync(externalFile, join(root, 'command.mjs')); }
    if (tamper === 'parent-symlink') { rmSync(join(root, 'opencode'), { recursive: true }); symlinkSync(external, join(root, 'opencode')); }
    if (tamper === 'manifest-symlink') { rmSync(manifest); symlinkSync(externalFile, manifest); }
    if (tamper === 'file-mode') chmodSync(join(root, 'command.mjs'), 0o666);
    if (tamper === 'root-mode') chmodSync(root, 0o777);
    if (tamper === 'manifest-traversal') writeFileSync(manifest, JSON.stringify({ files: ['../external/keep'], directories: [] }));
    await expect(prepared.release()).rejects.toThrow();
    expect(readFileSync(externalFile, 'utf8')).toBe('preserve');
    // No listed files are deleted before full manifest validation.
    expect(existsSync(join(root, 'observer.mjs'))).toBe(true);
    if (tamper === 'file-symlink') { rmSync(join(root, 'command.mjs')); }
    if (tamper === 'parent-symlink') { rmSync(join(root, 'opencode')); }
    if (tamper === 'manifest-symlink') { rmSync(manifest); writeFileSync(manifest, original, { mode: 0o600 }); }
    if (tamper === 'file-mode') chmodSync(join(root, 'command.mjs'), 0o600);
    if (tamper === 'root-mode') chmodSync(root, 0o700);
    if (tamper === 'manifest-traversal') writeFileSync(manifest, original);
    await prepared.release(); expect(existsSync(root)).toBe(false);
  });

  it.each([
    ['claude', ['--settings=custom.json'], {}], ['codex', ['--profile=custom'], {}],
    ['pi', ['--no-extensions'], {}], ['omp', ['--no-extensions'], {}],
    ['opencode', ['--attach=http://localhost:1234'], {}], ['opencode', [], { OPENCODE_CONFIG_DIR: '/custom' }],
    ['hermes', [], { HERMES_PROFILE: 'custom' }],
  ] as const)('refuses conflicting %s configuration', async (harness, args, env) => {
    const { executor } = fixture(env);
    await expect(prepareSshAttention(executor, 'host', harness, [...args], token)).rejects.toThrow();
  });

  it.each([
    ['-c', 'hooks.Stop=[]'], ['--config', 'hooks.Stop=[]'], ['-chooks.Stop=[]'], ['--config=hooks.Stop=[]'],
    ['-cprofiles.custom.hooks.Stop=[]'], ['--config=profiles.custom.hooks.Stop=[]'],
    ['-c', ' hooks.Stop = []'], ['-cprofile="custom"'], ['--config=profile="custom"'], ['-pcustom'],
  ])('rejects Codex hook/profile overrides in %j', async (...args) => {
    const { executor } = fixture();
    await expect(prepareSshAttention(executor, 'host', 'codex', args, token))
      .rejects.toThrow('cannot replace a Codex profile or hook configuration');
  });

  it.each([['-csandbox_mode="read-only"'], ['--config', 'model_reasoning_effort="high"']])('preserves unrelated Codex overrides in %j', async (...args) => {
    const { executor } = fixture();
    const prepared = await prepareSshAttention(executor, 'host', 'codex', args, token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..');
    roots.push(root);
    expect(prepared.args.slice(-args.length)).toEqual(args);
    await prepared.release();
  });

  it('keeps every installed Antigravity hook inert without complete matching launch credentials', async () => {
    const { executor, home } = fixture();
    const prepared = await prepareSshAttention(executor, 'host', 'agy', [], token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..');
    roots.push(root);
    mkdirSync(join(home, 'bin'));
    const marker = join(home, 'node-executed');
    writeFileSync(join(home, 'bin/node'), `#!/bin/sh\nprintf executed > '${marker}'\nexit 99\n`, { mode: 0o700 });
    const pluginPath = join(home, '.gemini/config/plugins/clanker-grid-remote-attention/hooks.json');
    const hooks = JSON.parse(readFileSync(pluginPath, 'utf8'));
    const commands: string[] = [];
    const collect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (typeof record.command === 'string') commands.push(record.command);
      Object.values(record).forEach(collect);
    };
    collect(hooks);
    expect(commands).toHaveLength(5);
    const cases = [
      { CLANKER_REMOTE_ATTENTION_TOKEN: '', CLANKER_REMOTE_ATTENTION_HARNESS: '', CLANKER_REMOTE_ATTENTION_COMMAND: '' },
      { ...prepared.env, CLANKER_REMOTE_ATTENTION_TOKEN: '' },
      { ...prepared.env, CLANKER_REMOTE_ATTENTION_HARNESS: '' },
      { ...prepared.env, CLANKER_REMOTE_ATTENTION_HARNESS: 'claude' },
      { ...prepared.env, CLANKER_REMOTE_ATTENTION_COMMAND: '' },
      { ...prepared.env, CLANKER_REMOTE_ATTENTION_COMMAND: join(home, 'missing-command') },
    ];
    for (const command of commands) {
      for (const env of cases) {
        const result = spawnSync('/bin/sh', ['-c', command], {
          input: JSON.stringify({ invocationNum: 0, toolCall: { name: 'ask_permission' } }), encoding: 'utf8',
          env: { ...process.env, ...env, PATH: join(home, 'bin') },
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(JSON.parse(result.stdout)).toEqual({});
      }
    }
    expect(() => readFileSync(marker)).toThrow();
    const hook = hooks['clanker-attention'].PreInvocation[0].command;
    const stdout = execFileSync('python3', ['-c', CAPTURE_TTY, 'sh', '-c', `printf '%s' '{"conversationId":"c1","invocationNum":0}' | ${hook}`], {
      encoding: 'utf8', env: { ...process.env, ...prepared.env }, timeout: 10000,
    });
    const events: Array<{ event: string }> = [];
    createRemoteAttentionFilter((raw) => events.push(JSON.parse(raw)))(stdout);
    expect(events.map((event) => event.event)).toEqual(['turn_started']);
    await prepared.release();
  });

  it('upgrades exactly the previous owned Hermes observer sources and refuses other edits', async () => {
    const { executor, home } = fixture();
    const pluginFile = join(home, '.hermes/plugins/clanker-grid-remote-attention/__init__.py');
    const first = await prepareSshAttention(executor, 'host', 'hermes', [], token);
    roots.push(join(first.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..'));
    await first.release();
    expect(readFileSync(pluginFile, 'utf8')).toBe(HERMES_REMOTE_ATTENTION_PLUGIN);
    for (const previous of [LEGACY_HERMES_REMOTE_ATTENTION_PLUGIN, PREVIOUS_HERMES_REMOTE_ATTENTION_PLUGIN]) {
      writeFileSync(pluginFile, previous);
      const upgraded = await prepareSshAttention(executor, 'host', 'hermes', [], token);
      roots.push(join(upgraded.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..'));
      await upgraded.release();
      expect(readFileSync(pluginFile, 'utf8')).toBe(HERMES_REMOTE_ATTENTION_PLUGIN);
    }
    writeFileSync(pluginFile, '# user edit');
    await expect(prepareSshAttention(executor, 'host', 'hermes', [], token)).rejects.toThrow('Refusing to overwrite');
    expect(readFileSync(pluginFile, 'utf8')).toBe('# user edit');
  });

  it('removes the per-terminal epoch state with the launch root', async () => {
    const { executor } = fixture();
    const prepared = await prepareSshAttention(executor, 'host', 'agy', [], token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..');
    roots.push(root);
    const input = JSON.stringify({ conversationId: 'c1', invocationNum: 0 });
    execFileSync('python3', ['-c', CAPTURE_TTY, 'sh', '-c', `printf '%s' '${input}' | "${process.execPath}" "${join(root, 'command.mjs')}" "${join(root, 'interpreter.mjs')}" PreInvocation`], {
      encoding: 'utf8', env: { ...process.env, ...prepared.env }, timeout: 10000,
    });
    expect(readdirSync(root).some((name) => name.startsWith('.clanker-state-'))).toBe(true);
    // Artifacts a crashed or failed transaction can leave behind are private launch state too.
    const base = join(root, '.clanker-state-0123456789abcdef');
    for (const suffix of ['.poison', '.json.4242.tmp']) { writeFileSync(base + suffix, '', { mode: 0o600 }); chmodSync(base + suffix, 0o600); }
    mkdirSync(`${base}.json.lock`, { mode: 0o700 });
    chmodSync(`${base}.json.lock`, 0o700);
    writeFileSync(join(`${base}.json.lock`, 'owner'), '1:abc', { mode: 0o600 });
    chmodSync(join(`${base}.json.lock`, 'owner'), 0o600);
    await prepared.release();
    expect(existsSync(root)).toBe(false);
  });

  it('keeps launch state it does not own when cleaning bridge artifacts', async () => {
    const { executor } = fixture();
    const prepared = await prepareSshAttention(executor, 'host', 'agy', [], token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..');
    roots.push(root);
    writeFileSync(join(root, '.clanker-state-nothex.json'), 'user');
    await prepared.release();
    expect(readFileSync(join(root, '.clanker-state-nothex.json'), 'utf8')).toBe('user');
  });

  it('upgrades the exact previous owned Antigravity hooks and refuses other edits', async () => {
    const { executor, home } = fixture();
    const prepared = await prepareSshAttention(executor, 'host', 'agy', [], token);
    roots.push(join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..'));
    const pluginPath = join(home, '.gemini/config/plugins/clanker-grid-remote-attention/hooks.json');
    const guarded = readFileSync(pluginPath, 'utf8');
    for (const previous of [legacyHooks(false), legacyHooks(true)]) {
      expect(previous).not.toBe(guarded);
      writeFileSync(pluginPath, previous);
      const refreshed = await prepareSshAttention(executor, 'host', 'agy', [], token);
      roots.push(join(refreshed.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..'));
      expect(readFileSync(pluginPath, 'utf8')).toBe(guarded);
      await refreshed.release();
    }
    const upgraded = await prepareSshAttention(executor, 'host', 'agy', [], token);
    roots.push(join(upgraded.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..'));
    writeFileSync(pluginPath, 'user modification');
    await expect(prepareSshAttention(executor, 'host', 'agy', [], token)).rejects.toThrow('Refusing to overwrite');
    expect(readFileSync(pluginPath, 'utf8')).toBe('user modification');
    await prepared.release();
    await upgraded.release();
  });

  it('preserves existing Codex hook configuration and unowned/shared writable plugin directories', async () => {
    const { executor, home } = fixture();
    mkdirSync(join(home, '.codex'));
    writeFileSync(join(home, '.codex/config.toml'), '[[hooks.Stop]]\n');
    await expect(prepareSshAttention(executor, 'host', 'codex', [], token)).rejects.toThrow('host Codex hook');
    writeFileSync(join(home, '.codex/config.toml'), '');
    writeFileSync(join(home, '.codex/hooks.json'), '{"hooks":{"SubagentStop":[]}}');
    await expect(prepareSshAttention(executor, 'host', 'codex', [], token)).rejects.toThrow('host Codex hook');
    rmSync(join(home, '.codex/hooks.json'));
    mkdirSync(join(home, '.gemini'));
    chmodSync(join(home, '.gemini'), 0o777);
    await expect(prepareSshAttention(executor, 'host', 'agy', [], token)).rejects.toThrow('Unsafe');
    chmodSync(join(home, '.gemini'), 0o700);
    mkdirSync(join(home, '.gemini/config/plugins/clanker-grid-remote-attention'), { recursive: true });
    const filename = join(home, '.gemini/config/plugins/clanker-grid-remote-attention/plugin.json');
    writeFileSync(filename, 'user plugin');
    await expect(prepareSshAttention(executor, 'host', 'agy', [], token)).rejects.toThrow('Refusing to overwrite');
    expect(readFileSync(filename, 'utf8')).toBe('user plugin');
  });

  it('delivers real OpenCode root lifecycle and permission events over a tty without forwarding payloads', async () => {
    const { executor } = fixture();
    const prepared = await prepareSshAttention(executor, 'host', 'opencode', [], token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..');
    roots.push(root);
    const runner = join(root, 'runner.mjs');
    writeFileSync(runner, `import { ClankerAttention } from './opencode/plugins/clanker-attention.js';
const sessions = { 'session-a': {id:'session-a'}, 'session-b': {id:'session-b', parentID:'session-a'} };
const plugin = await ClankerAttention({ client: { session: { get: async ({ path }) => ({ data: sessions[path.id] }) } } });
for (const [type, properties] of [
  ['session.status', {sessionID:'session-a', status:{type:'busy'}}],
  ['permission.asked', {sessionID:'session-a', id:'perm-1', prompt:'PRIVATE CONTENT'}],
  ['permission.replied', {sessionID:'session-a', requestID:'perm-1'}],
  ['session.idle', {sessionID:'session-b'}],
  ['session.idle', {sessionID:'session-a'}],
  ['session.idle', {sessionID:'unknown-session'}],
]) await plugin.event({event:{type, properties}});
`);
    const stdout = execFileSync('python3', ['-c', CAPTURE_TTY, process.execPath, runner], {
      encoding: 'utf8', env: { ...process.env, ...prepared.env }, timeout: 10000,
    });
    const events: Array<{ event: string; scope?: string }> = [];
    createRemoteAttentionFilter((raw) => events.push(JSON.parse(raw)))(stdout);
    expect(events.map((event) => [event.event, event.scope])).toEqual([
      ['turn_started', 'root'], ['input_requested', 'root'], ['input_resolved', 'root'], ['turn_completed', 'child'], ['turn_completed', 'root'],
    ]);
    expect(stdout).not.toContain('PRIVATE CONTENT');
    await prepared.release();
  });

  it('carries trusted resume identity to the host, and only when one is supplied', async () => {
    const { executor, exec } = fixture();
    const seeded = await prepareSshAttention(executor, 'host', 'opencode', [], token, { rootSessionId: 'ses_resume.1' });
    roots.push(join(seeded.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..'));
    expect(seeded.env.CLANKER_ATTENTION_SESSION_ID).toBe('ses_resume.1');
    expect(JSON.parse(String(exec.mock.calls[0][3]?.input)).rootSessionId).toBe('ses_resume.1');
    await seeded.release();
    const fresh = await prepareSshAttention(executor, 'host', 'opencode', [], token);
    roots.push(join(fresh.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..'));
    expect(fresh.env.CLANKER_ATTENTION_SESSION_ID).toBeUndefined();
    await fresh.release();
    await expect(prepareSshAttention(executor, 'host', 'opencode', [], token, { rootSessionId: 'bad id; rm' })).rejects.toThrow();
  });
});

// Run the shared hook mappings against an actual tty for the other hook/extension harnesses.
describe.skipIf(process.platform === 'win32')('remote hook and extension delivery', () => {
  it.each(['codex', 'claude', 'agy', 'pi', 'omp'])('delivers %s lifecycle events through its native adapter', async (harness) => {
    const { executor } = fixture();
    const prepared = await prepareSshAttention(executor, 'host', harness, [], token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..');
    roots.push(root);
    let args: string[];
    if (harness === 'pi' || harness === 'omp') {
      const runner = join(root, 'runner.mjs');
      writeFileSync(runner, `import install from './${harness}.ts';
const callbacks = {};
install({on:(name, callback) => {callbacks[name] = callback;}});
const ctx = {sessionManager:{getSessionId:()=>'session-a'}, agent:{kind:'main'}};
// agent_end is deliberately not a completion for OMP and must stay unobserved.
if (${JSON.stringify(harness)} === 'pi') {
  await callbacks.agent_start({}, ctx);
  await callbacks.ui_prompt_start({kind:'confirm', title:'private prompt'}, ctx);
  await callbacks.ui_prompt_end({kind:'confirm'}, ctx);
  await callbacks.message_end({message:{role:'assistant', stopReason:'error', errorMessage:'private failure'}}, ctx);
  await callbacks.agent_settled({aborted:false}, ctx);
  await callbacks.agent_start({}, ctx);
  await callbacks.agent_settled({aborted:true}, ctx);
  await callbacks.session_shutdown({}, ctx);
} else {
  for (const name of ['agent_start', 'agent_settled', 'agent_end', 'session_stop', 'session_shutdown']) if (callbacks[name]) await callbacks[name]({}, ctx);
}
`);
      args = [runner];
    } else {
      // Hook payloads arrive on stdin; the pty stays the controlling terminal for the frame.
      const run = (hook: string, input: object) => `printf '%s' '${JSON.stringify(input)}' | "${process.execPath}" "${join(root, 'command.mjs')}" "${join(root, 'interpreter.mjs')}" ${hook}`;
      const hooks = harness === 'agy'
        ? [run('PreInvocation', { conversationId: 'session-a', invocationNum: 0 }), run('Stop', { conversationId: 'session-a', fullyIdle: true })]
        : harness === 'claude'
          ? [run('UserPromptSubmit', { session_id: 'session-a', prompt_id: 'p1' }), run('Stop', { session_id: 'session-a', prompt_id: 'p1' })]
          : [run('UserPromptSubmit', { session_id: 'session-a', turn_id: 'turn-a' }), run('Stop', { session_id: 'session-a', turn_id: 'turn-a' })];
      args = [hooks.join(' && ')];
    }
    const stdout = execFileSync('python3', ['-c', CAPTURE_TTY, ...(harness === 'pi' || harness === 'omp' ? [process.execPath, ...args] : ['sh', '-c', ...args])], {
      encoding: 'utf8', env: { ...process.env, ...prepared.env }, timeout: 10000,
    });
    const events: Array<{ event: string; scope?: string; sessionId?: string }> = [];
    createRemoteAttentionFilter((raw) => events.push(JSON.parse(raw)))(stdout);
    expect(events.map((event) => event.event)).toEqual(harness === 'pi'
      ? ['turn_started', 'input_requested', 'input_resolved', 'turn_failed', 'turn_started', 'turn_interrupted', 'session_ended']
      : harness === 'omp' ? ['turn_started', 'turn_completed', 'session_ended'] : ['turn_started', 'turn_completed']);
    expect(JSON.stringify(events)).not.toContain('private');
    if (harness === 'pi') {
      expect(events[2]).toMatchObject({ inputId: (events[1] as { inputId?: string }).inputId, turnId: '1' });
    }
    expect(events.every((event) => event.scope === 'root' && event.sessionId === 'session-a')).toBe(true);
    // Both ends of a turn carry the same turn identity (native, or a provider-owned epoch).
    expect(new Set(events.filter((event) => event.event !== 'session_ended').map((event) => (event as { turnId?: string }).turnId)).size).toBe(harness === 'pi' ? 2 : 1);
    await prepared.release();
  });
});


// The permission lifecycle keeps correlation state in the bridge store, so run the real command
// bridge over a tty exactly as a remote host would, with no model call.
describe.skipIf(process.platform === 'win32')('remote permission lifecycle through the real bridge', () => {
  async function frames(harness: 'claude' | 'codex', steps: Array<[string, object]>) {
    const { executor } = fixture();
    const prepared = await prepareSshAttention(executor, 'host', harness, [], token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..');
    roots.push(root);
    const run = ([hook, input]: [string, object]) => `printf '%s' '${JSON.stringify(input)}' | "${process.execPath}" "${join(root, 'command.mjs')}" "${join(root, 'interpreter.mjs')}" ${hook}`;
    const stdout = execFileSync('python3', ['-c', CAPTURE_TTY, 'sh', '-c', steps.map(run).join(' && ')], {
      encoding: 'utf8', env: { ...process.env, ...prepared.env }, timeout: 20000,
    });
    const events: Array<{ event: string; turnId?: string; inputId?: string; requestKind?: string }> = [];
    createRemoteAttentionFilter((raw) => events.push(JSON.parse(raw)))(stdout);
    expect(stdout).not.toContain('SECRET');
    await prepared.release();
    expect(events.filter((event) => event.event === 'observer_diagnostic').every((event) => !('turnId' in event))).toBe(true);
    return events.filter((event) => event.event !== 'observer_diagnostic');
  }
  it('Claude: PermissionRequest (no tool_use_id) waits until PostToolBatch', async () => {
    const common = { session_id: 's', prompt_id: 'p1' };
    const events = await frames('claude', [
      ['UserPromptSubmit', common],
      ['PermissionRequest', { ...common, tool_name: 'Bash', tool_input: { command: 'SECRET' } }],
      ['PermissionRequest', { ...common, tool_name: 'Bash', tool_input: { command: 'SECRET' } }],
      ['PostToolBatch', { ...common, tool_calls: [{ tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'SECRET' }, tool_response: 'SECRET' }] }],
      ['PostToolBatch', common],
      ['StopFailure', { ...common, error: 'rate_limit', error_details: 'SECRET' }],
    ]);
    expect(events.map((event) => event.event)).toEqual(['turn_started', 'input_requested', 'input_resolved', 'turn_failed']);
    expect(events[1].requestKind).toBe('approval');
    expect(new Set(events.map((event) => event.turnId))).toEqual(new Set(['p1']));
  });
  it('Codex: an unrelated PostToolUse does not resolve the waiting call', async () => {
    const turn = { session_id: 's', turn_id: 't1' };
    const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });
    const events = await frames('codex', [
      ['UserPromptSubmit', turn],
      ['PreToolUse', { ...turn, tool_use_id: 'a', ...bash('SECRET-A') }],
      ['PreToolUse', { ...turn, tool_use_id: 'b', ...bash('ls') }],
      ['PermissionRequest', { ...turn, ...bash('SECRET-A') }],
      ['PostToolUse', { ...turn, tool_use_id: 'b', ...bash('ls'), tool_response: 'SECRET' }],
      ['PostToolUse', { ...turn, tool_use_id: 'a', ...bash('SECRET-A'), tool_response: 'SECRET' }],
      ['Interrupt', turn],
    ]);
    expect(events.map((event) => event.event)).toEqual(['turn_started', 'input_requested', 'input_resolved', 'turn_interrupted']);
  });
});

describe.skipIf(process.platform === 'win32')('SSH attention launch wrapper', () => {
  it('delivers hook events, retires attention, cleans launch files, and leaves a credential-free fallback shell', async () => {
    const { executor, home } = fixture();
    mkdirSync(join(home, 'bin'));
    const fakeHarness = join(home, 'bin/opencode');
    writeFileSync(fakeHarness, `#!/bin/sh
exec node --input-type=module -e 'const {ClankerAttention}=await import(process.env.OPENCODE_CONFIG_DIR+"/plugins/clanker-attention.js"); const plugin=await ClankerAttention({client:{session:{get:async()=>({data:{id:"test-session"}})}}}); for (const type of ["session.status", "session.idle"]) await plugin.event({event:{type, properties:{sessionID:"test-session", status:{type:"busy"}}}});'
`, { mode: 0o700 });
    const fallback = join(home, 'fallback-shell');
    writeFileSync(fallback, `#!/bin/sh
if [ -n "$CLANKER_REMOTE_ATTENTION_TOKEN$CLANKER_ATTENTION_TOKEN" ]; then echo credentials-leaked; exit 1; fi
printf 'fallback-ready'
`, { mode: 0o700 });
    const environment = new SshEnvironment({ id: 'host', kind: 'ssh', label: 'host', target: 'host' }, executor);
    const resolved = await environment.resolveTerminalSpawn({ id: 'terminal-a', workingDir: home, harness: 'opencode', attentionToken: token });
    expect(resolved.attentionEnabled).toBe(true);
    const stdout = execFileSync('python3', ['-c', CAPTURE_TTY, 'sh', '-c', resolved.spawnArgs[2]], {
      encoding: 'utf8', env: { ...process.env, HOME: home, SHELL: fallback, CLANKER_ATTENTION_TOKEN: 'desktop-secret', CLANKER_REMOTE_ATTENTION_TOKEN: 'old-secret' }, timeout: 10000,
    });
    const events: Array<{ event: string }> = [];
    const visible = createRemoteAttentionFilter((raw) => events.push(JSON.parse(raw)))(stdout);
    expect(events.map((event) => event.event)).toEqual(['turn_started', 'turn_completed', 'agent_exited']);
    expect(visible).toContain('fallback-ready');
    expect(visible).not.toContain('credentials-leaked');
    expect(visible).not.toContain(token);
    const preparation = executor.exec as ReturnType<typeof vi.fn>;
    const response = JSON.parse((await preparation.mock.results[0].value).stdout);
    expect(() => readFileSync(join(response.root, 'command.mjs'))).toThrow();
    await resolved.releaseAttention?.();
  });
});
