import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, readFileSync, chmodSync, mkdirSync, writeFileSync, symlinkSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agyAttentionPlugin } from '../../../src/main/agentAttentionAdapters';
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
    const broker = new AgentAttentionBroker(updates);
    brokers.push(broker);
    const remoteToken = broker.registerRemote('ssh-a', 'opencode');
    const local = await broker.register('local-a', 'opencode');
    const raw = JSON.stringify({ version: 1, token: remoteToken, harness: 'opencode', event: 'turn_completed' });
    broker.receive(raw);
    broker.receiveRemote('ssh-b', raw);
    broker.receiveRemote('ssh-a', JSON.stringify({ version: 1, token: local.CLANKER_ATTENTION_TOKEN, harness: 'opencode', event: 'turn_completed' }));
    expect(updates).not.toHaveBeenCalled();
    broker.receiveRemote('ssh-a', raw);
    expect(updates).toHaveBeenCalledExactlyOnceWith({ terminalId: 'ssh-a', event: 'turn_completed' });
    broker.release('ssh-a');
    broker.receiveRemote('ssh-a', raw);
    expect(updates).toHaveBeenCalledTimes(1);
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
    if (harness === 'codex') expect(prepared.args[1]).toContain('notify=');
    if (harness === 'claude') {
      const settings = JSON.parse(readFileSync(join(root, 'claude-settings.json'), 'utf8'));
      expect(settings.hooks.Stop[0].hooks[0].command).toContain(`${root}/command.mjs`);
    }
    if (harness === 'opencode') expect(prepared.env.OPENCODE_CONFIG_DIR).toBe(join(root, 'opencode'));
    if (harness === 'pi' || harness === 'omp') expect(prepared.args.slice(-2)).toEqual(['--extension', join(root, `${harness}.ts`)]);
    if (harness === 'agy') expect(readFileSync(join(home, '.gemini/config/plugins/clanker-grid-remote-attention/hooks.json'), 'utf8')).toContain('$CLANKER_REMOTE_ATTENTION_COMMAND');
    if (harness === 'hermes') expect(exec).toHaveBeenCalledTimes(2);
    writeFileSync(join(root, 'preserve.txt'), 'unknown');
    await prepared.release();
    expect(readFileSync(join(root, 'preserve.txt'), 'utf8')).toBe('unknown');
    expect(() => readFileSync(join(root, 'command.mjs'))).toThrow();
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
    ['-c', 'notify=[]'], ['--config', 'notify=[]'], ['-cnotify=[]'], ['--config=notify=[]'],
    ['-cprofiles.custom.notify=[]'], ['--config=profiles.custom.notify=[]'],
    ['-c', ' notify = []'], ['-cprofile="custom"'], ['--config=profile="custom"'], ['-pcustom'],
  ])('rejects Codex hook/profile overrides in %j', async (...args) => {
    const { executor } = fixture();
    await expect(prepareSshAttention(executor, 'host', 'codex', args, token))
      .rejects.toThrow('cannot replace a Codex profile or notify command');
  });

  it.each([['-csandbox_mode="read-only"'], ['--config', 'model_reasoning_effort="high"']])('preserves unrelated Codex overrides in %j', async (...args) => {
    const { executor } = fixture();
    const prepared = await prepareSshAttention(executor, 'host', 'codex', args, token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..');
    roots.push(root);
    expect(prepared.args.slice(2)).toEqual(args);
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
    const hook = hooks['clanker-attention'].Stop[0].command;
    const stdout = execFileSync('python3', ['-c', CAPTURE_TTY, 'sh', '-c', `printf '%s' '{}' | ${hook}`], {
      encoding: 'utf8', env: { ...process.env, ...prepared.env }, timeout: 10000,
    });
    const events: Array<{ event: string }> = [];
    createRemoteAttentionFilter((raw) => events.push(JSON.parse(raw)))(stdout);
    expect(events.map((event) => event.event)).toEqual(['turn_completed']);
    await prepared.release();
  });

  it('upgrades the exact previous owned Antigravity hooks and refuses other edits', async () => {
    const { executor, home } = fixture();
    const prepared = await prepareSshAttention(executor, 'host', 'agy', [], token);
    roots.push(join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..'));
    const pluginPath = join(home, '.gemini/config/plugins/clanker-grid-remote-attention/hooks.json');
    const guarded = readFileSync(pluginPath, 'utf8');
    writeFileSync(pluginPath, JSON.stringify(agyAttentionPlugin('$CLANKER_REMOTE_ATTENTION_COMMAND', 'linux').hooksJson));
    const upgraded = await prepareSshAttention(executor, 'host', 'agy', [], token);
    roots.push(join(upgraded.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..'));
    expect(readFileSync(pluginPath, 'utf8')).toBe(guarded);
    writeFileSync(pluginPath, 'user modification');
    await expect(prepareSshAttention(executor, 'host', 'agy', [], token)).rejects.toThrow('Refusing to overwrite');
    expect(readFileSync(pluginPath, 'utf8')).toBe('user modification');
    await prepared.release();
    await upgraded.release();
  });

  it('preserves existing Codex notify configuration and unowned/shared writable plugin directories', async () => {
    const { executor, home } = fixture();
    mkdirSync(join(home, '.codex'));
    writeFileSync(join(home, '.codex/config.toml'), 'notify = ["custom"]\n');
    await expect(prepareSshAttention(executor, 'host', 'codex', [], token)).rejects.toThrow('host Codex notify');
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

  it('delivers real OpenCode lifecycle and permission events over a tty without forwarding payloads', async () => {
    const { executor } = fixture();
    const prepared = await prepareSshAttention(executor, 'host', 'opencode', [], token);
    const root = join(prepared.env.CLANKER_REMOTE_ATTENTION_COMMAND, '..');
    roots.push(root);
    const runner = join(root, 'runner.mjs');
    writeFileSync(runner, `import { ClankerAttention } from './opencode/plugins/clanker-attention.js';
const plugin = await ClankerAttention();
for (const [type, properties] of [
  ['session.status', {sessionID:'session-a', status:{type:'busy'}}],
  ['permission.asked', {sessionID:'session-a', prompt:'PRIVATE CONTENT'}],
  ['permission.replied', {sessionID:'session-a'}],
  ['session.idle', {sessionID:'session-b'}],
  ['session.idle', {sessionID:'session-a'}],
]) await plugin.event({event:{type, properties}});
`);
    const stdout = execFileSync('python3', ['-c', CAPTURE_TTY, process.execPath, runner], {
      encoding: 'utf8', env: { ...process.env, ...prepared.env }, timeout: 10000,
    });
    const events: Array<{ event: string }> = [];
    createRemoteAttentionFilter((raw) => events.push(JSON.parse(raw)))(stdout);
    expect(events.map((event) => event.event)).toEqual(['turn_started', 'input_requested', 'input_resolved', 'turn_completed']);
    expect(stdout).not.toContain('PRIVATE CONTENT');
    await prepared.release();
  });

  it('maps Hermes observer hooks to advisory events and excludes sensitive callback fields', () => {
    const script = HERMES_REMOTE_ATTENTION_PLUGIN + `
class Context:
    def register_hook(self, name, callback):
        callback(session_id='session-a', turn_id='turn-a', user_message='PRIVATE CONTENT')
register(Context())
`;
    const stdout = execFileSync('python3', ['-c', CAPTURE_TTY, 'python3', '-c', script], {
      encoding: 'utf8', env: { ...process.env, CLANKER_REMOTE_ATTENTION_TOKEN: token, CLANKER_REMOTE_ATTENTION_HARNESS: 'hermes' }, timeout: 10000,
    });
    const events: Array<{ event: string }> = [];
    createRemoteAttentionFilter((raw) => events.push(JSON.parse(raw)))(stdout);
    expect(events.map((event) => event.event)).toEqual(['turn_started', 'turn_completed', 'input_requested', 'input_resolved']);
    expect(stdout).not.toContain('PRIVATE CONTENT');
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
const ctx = {sessionManager:{getSessionId:()=>'session-a'}};
for (const name of ['agent_start', '${harness === 'pi' ? 'agent_settled' : 'agent_end'}', 'session_shutdown']) await callbacks[name]({}, ctx);
`);
      args = [runner];
    } else {
      const input = harness === 'codex' ? { type: 'agent-turn-complete', 'thread-id': 'session-a' }
        : { hook_event_name: 'Stop', session_id: 'session-a' };
      args = [join(root, 'command.mjs'), JSON.stringify(input)];
    }
    const stdout = execFileSync('python3', ['-c', CAPTURE_TTY, process.execPath, ...args], {
      encoding: 'utf8', env: { ...process.env, ...prepared.env }, timeout: 10000,
    });
    const events: Array<{ event: string }> = [];
    createRemoteAttentionFilter((raw) => events.push(JSON.parse(raw)))(stdout);
    expect(events.map((event) => event.event)).toEqual(harness === 'pi' || harness === 'omp'
      ? ['turn_started', 'turn_completed', 'session_ended'] : ['turn_completed']);
    await prepared.release();
  });
});


describe.skipIf(process.platform === 'win32')('SSH attention launch wrapper', () => {
  it('delivers hook events, retires attention, cleans launch files, and leaves a credential-free fallback shell', async () => {
    const { executor, home } = fixture();
    mkdirSync(join(home, 'bin'));
    const fakeHarness = join(home, 'bin/opencode');
    writeFileSync(fakeHarness, `#!/bin/sh
exec node --input-type=module -e 'const {ClankerAttention}=await import(process.env.OPENCODE_CONFIG_DIR+"/plugins/clanker-attention.js"); const plugin=await ClankerAttention(); await plugin.event({event:{type:"session.idle",properties:{sessionID:"test-session"}}});'
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
    expect(events.map((event) => event.event)).toEqual(['turn_completed', 'session_ended']);
    expect(visible).toContain('fallback-ready');
    expect(visible).not.toContain('credentials-leaked');
    expect(visible).not.toContain(token);
    const preparation = executor.exec as ReturnType<typeof vi.fn>;
    const response = JSON.parse((await preparation.mock.results[0].value).stdout);
    expect(() => readFileSync(join(response.root, 'command.mjs'))).toThrow();
    await resolved.releaseAttention?.();
  });
});
