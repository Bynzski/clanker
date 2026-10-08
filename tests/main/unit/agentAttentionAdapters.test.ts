import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import {
  ensureAgyAttentionPlugin,
  agyAttentionPlugin,
  attentionLaunchOptions,
  claudeAttentionSettings,
  ensureAttentionAdapterFiles,
  ensureProviderAttentionResources,
  removeAttentionAdapterFiles,
  scavengeStaleAttentionRoots,
  migrateLegacyAgyAttentionPlugin,
} from '../../../src/main/agentAttentionAdapters';
import { withoutAttentionEnvironment } from '../../../src/main/environment/attentionEnvironment';
import { attentionRecorder } from '../../_helpers/attentionChanges';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';

afterAll(() => removeAttentionAdapterFiles());

describe('agent attention launch adapters', () => {
  const files = ensureAttentionAdapterFiles();

  it('adds Pi and Claude observers without removing existing flags', () => {
    expect(attentionLaunchOptions('pi', ['--model', 'x', '--no-extensions'], {}, files)?.args)
      .toEqual(['--model', 'x', '--no-extensions', '--extension', path.join(ensureProviderAttentionResources('pi', files).resourceRoot!, 'pi.ts')]);
    expect(attentionLaunchOptions('omp', ['--model', 'x'], {}, files)?.args)
      .toEqual(['--model', 'x', '--extension', path.join(ensureProviderAttentionResources('omp', files).resourceRoot!, 'omp.ts')]);
    const omp = fs.readFileSync(path.join(ensureProviderAttentionResources('omp', files).resourceRoot!, 'omp.ts'), 'utf8');
    expect(omp).toContain("omp.on('session_stop'");
    expect(omp).not.toContain("omp.on('agent_end'");
    expect(attentionLaunchOptions('claude', ['--model', 'x'], {}, files)?.args)
      .toEqual(['--model', 'x', '--settings', path.join(ensureProviderAttentionResources('claude', files).resourceRoot!, 'claude-settings.json')]);
    expect(attentionLaunchOptions('claude', ['--settings', 'custom.json'], {}, files)).toBeNull();
    const settings = JSON.parse(fs.readFileSync(path.join(ensureProviderAttentionResources('claude', files).resourceRoot!, 'claude-settings.json'), 'utf8')) as { hooks: Record<string, unknown> };
    expect(Object.keys(settings.hooks)).toEqual(['UserPromptSubmit', 'PermissionRequest', 'PostToolBatch', 'Stop', 'StopFailure', 'SessionEnd', 'CwdChanged']);
    expect(JSON.stringify(settings)).toContain(JSON.stringify(path.join(ensureProviderAttentionResources('claude', files).resourceRoot!, 'interpreter.mjs')).slice(1, -1));
  });

  it('configures Antigravity launch options and limits hooks to interaction tools', () => {
    const options = attentionLaunchOptions('agy', ['--model', 'gemini-3.8-flash-high'], {}, files);
    expect(options).toEqual({ args: ['--model', 'gemini-3.8-flash-high'], env: { CLANKER_ATTENTION_INTERPRETER: path.join(ensureProviderAttentionResources('agy', files).resourceRoot!, 'interpreter.mjs') } });
    const plugin = agyAttentionPlugin(files.command, path.join(ensureProviderAttentionResources('agy', files).resourceRoot!, 'interpreter.mjs'), 'linux');
    expect(plugin.pluginJson.name).toBe('clanker-grid-attention');
    const hooks = plugin.hooksJson['clanker-attention'] as Record<string, Array<{ matcher?: string }>>;
    expect(Object.keys(hooks)).toEqual(['PreInvocation', 'PostInvocation', 'PreToolUse', 'PostToolUse', 'Stop']);
    expect(hooks.PreToolUse[0].matcher).toBe('ask_question|ask_permission|notify_user');
    expect(hooks.PostToolUse[0].matcher).toBe('ask_question|ask_permission|notify_user');
  });

  it('installs the Antigravity plugin idempotently and preserves unknown files', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-plugin-home-'));
    const pluginDirectory = path.join(home, '.gemini', 'config', 'plugins', 'clanker-grid-attention');
    try {
      expect(fs.existsSync(pluginDirectory)).toBe(false);
      ensureAgyAttentionPlugin(home, 'linux');
      const hooks = fs.readFileSync(path.join(pluginDirectory, 'hooks.json'), 'utf8');
      fs.writeFileSync(path.join(pluginDirectory, 'user-file.txt'), 'keep');
      ensureAgyAttentionPlugin(home, 'linux');
      expect(fs.readFileSync(path.join(pluginDirectory, 'hooks.json'), 'utf8')).toBe(hooks);
      expect(fs.readFileSync(path.join(pluginDirectory, 'user-file.txt'), 'utf8')).toBe('keep');
      expect(fs.readdirSync(pluginDirectory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite an unowned Antigravity plugin', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-attention-home-'));
    const pluginDirectory = path.join(home, '.gemini', 'config', 'plugins', 'clanker-grid-attention');
    fs.mkdirSync(pluginDirectory, { recursive: true });
    fs.writeFileSync(path.join(pluginDirectory, 'plugin.json'), '{"name":"user-plugin"}');
    try {
      expect(() => ensureAgyAttentionPlugin(home, 'linux'))
        .toThrow('Refusing to overwrite an unowned Antigravity plugin');
      expect(fs.readFileSync(path.join(pluginDirectory, 'plugin.json'), 'utf8'))
        .toBe('{"name":"user-plugin"}');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('leaves custom OpenCode plugin directories and pure mode alone', () => {
    expect(attentionLaunchOptions('opencode', [], { OPENCODE_CONFIG_DIR: '/custom' }, files)).toBeNull();
    expect(attentionLaunchOptions('opencode', ['--pure'], {}, files)).toBeNull();
    expect(attentionLaunchOptions('opencode', ['--model', 'x'], {}, files)?.env.OPENCODE_CONFIG_DIR)
      .toBe(path.join(ensureProviderAttentionResources('opencode', files).resourceRoot!, 'opencode'));
  });

  it('does not inherit attention credentials from an earlier launch', () => {
    expect(withoutAttentionEnvironment({
      PATH: '/bin',
      CLANKER_ATTENTION_TOKEN: 'old-token',
      CLANKER_ATTENTION_COMMAND: '/tmp/old-command',
    })).toEqual({ PATH: '/bin' });
  });

  it('uses native Codex hooks instead of legacy notify, placed before resume, and skips conflicts', () => {
    const interpreter = path.join(ensureProviderAttentionResources('codex', files).resourceRoot!, 'interpreter.mjs');
    const posix = (args: string[], env: NodeJS.ProcessEnv = { CODEX_HOME: '/nonexistent' }) => attentionLaunchOptions('codex', args, env, files, undefined, 'linux');
    const result = posix(['codex', 'resume', 'abc']);
    expect(result?.args[0]).toBe('codex');
    expect(result?.args.slice(-2)).toEqual(['resume', 'abc']);
    const overrides = result!.args.filter((arg) => arg !== '-c' && arg.startsWith('hooks.'));
    expect(overrides.map((arg) => arg.split('=')[0])).toEqual(['hooks.UserPromptSubmit', 'hooks.PreToolUse', 'hooks.PermissionRequest', 'hooks.PostToolUse', 'hooks.Stop', 'hooks.SubagentStop', 'hooks.Interrupt', 'hooks.SessionEnd', 'hooks.SessionStart']);
    expect(result!.args.join(' ')).not.toContain('notify=');
    // The definition is identical for every launch (Codex hook trust is keyed by it); the launch
    // resources arrive through the environment.
    expect(overrides[4]).toContain(JSON.stringify('node "$CLANKER_ATTENTION_COMMAND" "$CLANKER_ATTENTION_INTERPRETER" Stop').slice(1, -1));
    expect(result?.args.join(' ')).not.toContain(files.command);
    expect(posix(['codex'])?.env).toEqual({ CLANKER_ATTENTION_INTERPRETER: interpreter });
    const windows = attentionLaunchOptions('codex', [], { CODEX_HOME: '/nonexistent' }, files, undefined, 'win32');
    expect(windows?.env).toEqual({});
    expect(windows?.args[1]).toContain(JSON.stringify(`node.exe "${files.command}"`).slice(1, -1));
    expect(posix(['-p', 'custom'])).toBeNull();
    expect(posix(['-c', 'hooks.Stop=[]'])).toBeNull();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-codex-home-'));
    try {
      fs.writeFileSync(path.join(home, 'config.toml'), '[[hooks.SubagentStop]]\n');
      expect(posix([], { CODEX_HOME: home })).toBeNull();
      fs.writeFileSync(path.join(home, 'config.toml'), 'profile = "work"\n');
      expect(posix([], { CODEX_HOME: home })).toBeNull();
      fs.writeFileSync(path.join(home, 'config.toml'), 'notify = ["legacy"]\n[hooks.state]\n');
      expect(posix([], { CODEX_HOME: home })).not.toBeNull();
      fs.writeFileSync(path.join(home, 'config.toml'), '');
      fs.writeFileSync(path.join(home, 'hooks.json'), '{"hooks":{"Stop":[]}}');
      expect(posix([], { CODEX_HOME: home })).toBeNull();
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('uses an executable and preserves a Windows script path as one argument', () => {
    const windowsCommand = 'C:\\Users\\Jane Doe\\AppData\\Local\\Temp\\attention\\command.mjs';
    const windowsInterpreter = 'C:\\Users\\Jane Doe\\AppData\\Local\\Temp\\attention\\codex\\interpreter.mjs';
    const claude = claudeAttentionSettings(windowsCommand, 'win32', windowsInterpreter);
    expect(claude.hooks.Stop[0].hooks[0]).toMatchObject({ command: 'node.exe', args: [windowsCommand, windowsInterpreter, 'Stop'] });
  });

  const interpreterFor = (id: string) => path.join(ensureProviderAttentionResources(id, files).resourceRoot!, 'interpreter.mjs');
  const runHook = (env: Record<string, string>, harness: string, hook: string, payload: Record<string, unknown>): Promise<{ code: number; stdout: string }> => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [files.command, interpreterFor(harness), hook], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stdin.end(JSON.stringify(payload));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 0, stdout }));
  });

  it('delivers a command hook event without forwarding prompt text', async () => {
    const recorder = attentionRecorder();
    const received = recorder.labels;
    const broker = new AgentAttentionBroker(recorder.onChange, () => undefined);
    try {
      const env = await broker.register('term-hook', 'claude');
      const result = await runHook(env, 'claude', 'UserPromptSubmit', { session_id: 's1', prompt_id: 'p1', prompt: 'private text' });
      expect(result.code).toBe(0);
      expect(received).toEqual(['turn_started']);
    } finally {
      broker.close();
    }
  });

  it('ignores a hook payload when its provider interpreter yields nothing and still answers the host', async () => {
    const broker = new AgentAttentionBroker(() => { throw new Error('unexpected update'); }, () => undefined);
    try {
      const env = await broker.register('term-hook', 'codex');
      const result = await runHook(env, 'codex', 'PreToolUse', { session_id: 's1' });
      expect(result).toEqual({ code: 0, stdout: '{}\n' });
    } finally {
      broker.close();
    }
  });

  it('delivers Antigravity lifecycle events and decisions accurately', async () => {
    const recorder = attentionRecorder();
    const received = recorder.labels;
    const broker = new AgentAttentionBroker(recorder.onChange, () => undefined);
    try {
      const env = await broker.register('term-agy', 'agy');
      const run = (hook: string, payload: Record<string, unknown>) => runHook(env, 'agy', hook, payload);

      const r1 = await run('PreInvocation', { conversationId: 'c1', invocationNum: 0 });
      expect(r1.code).toBe(0);
      expect(JSON.parse(r1.stdout)).toEqual({});
      expect(received).toEqual(['turn_started']);

      received.length = 0;
      await run('PreInvocation', { conversationId: 'c1', invocationNum: 1 });
      expect(received).toEqual([]);

      const r3 = await run('PreToolUse', { conversationId: 'c1', toolCall: { name: 'ask_question' } });
      expect(JSON.parse(r3.stdout)).toEqual({ decision: 'allow' });
      expect(received).toEqual(['input_requested']);

      received.length = 0;
      const r4 = await run('PostToolUse', { conversationId: 'c1', toolCall: { name: 'ask_question' } });
      expect(JSON.parse(r4.stdout)).toEqual({});
      expect(received).toEqual(['input_resolved']);

      // The plugin matcher prevents non-interaction tools; the interpreter is defensive too.
      received.length = 0;
      const r5 = await run('PreToolUse', { conversationId: 'c1', toolCall: { name: 'run_command' } });
      expect(JSON.parse(r5.stdout)).toEqual({});
      expect(received).toEqual([]);

      // Background work still active: Stop is not completion. Another conversation cannot settle either.
      await run('Stop', { conversationId: 'c1', fullyIdle: false });
      await run('Stop', { conversationId: 'c2', fullyIdle: true });
      expect(received).toEqual([]);
      await run('Stop', { conversationId: 'c1', fullyIdle: true });
      expect(received).toEqual(['turn_completed']);
    } finally {
      broker.close();
    }
  });

  it('acknowledges agent exit before a wrapper can enter its fallback shell', async () => {
    const broker = new AgentAttentionBroker(() => undefined);
    try {
      const env = await broker.register('term-exit', 'codex');
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, [files.command, '--ended'], {
          env: { ...process.env, ...env },
        });
        child.once('error', reject);
        child.once('close', resolve);
      });
      expect(code).toBe(0);
      expect(broker.handoffState('term-exit')).toBe('unavailable');
    } finally {
      broker.close();
    }
  });
});

describe('Antigravity attention plugin resilience', () => {
  const files = ensureAttentionAdapterFiles();
  const interpreter = path.join(ensureProviderAttentionResources('agy', files).resourceRoot!, 'interpreter.mjs');
  const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agy-plugin-home-'));
  const pluginsOf = (home: string) => path.join(home, '.gemini', 'config', 'plugins');

  const legacyHooks = (script: string) => {
    const entry = (name: string) => ({ type: 'command', command: `node "${script}" ${name}`, timeout: 10 });
    const matched = (name: string) => ({ matcher: '*', hooks: [entry(name)] });
    return { 'clanker-attention': {
      PreInvocation: [entry('PreInvocation')], PostInvocation: [entry('PostInvocation')],
      PreToolUse: [matched('PreToolUse')], PostToolUse: [matched('PostToolUse')], Stop: [entry('Stop')],
    } };
  };
  const writeLegacy = (home: string, script: string, hooks: unknown = legacyHooks(script), pluginJson: unknown = {
    name: 'clanker-attention', version: '1.0.0', description: 'Clanker Agent Attention Plugin',
  }) => {
    const directory = path.join(pluginsOf(home), 'clanker-attention');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'plugin.json'), JSON.stringify(pluginJson, null, 2));
    fs.writeFileSync(path.join(directory, 'hooks.json'), JSON.stringify(hooks, null, 2));
    return directory;
  };
  const goneScript = path.join(os.tmpdir(), 'clanker-attention-gone01', 'command.mjs');
  const install = (home: string) => {
    ensureAgyAttentionPlugin(home, 'linux');
    return path.join(pluginsOf(home), 'clanker-grid-attention', 'guard.mjs');
  };

  it('removes a legacy plugin that matches the historical payload once its script is gone', () => {
    const home = tempHome();
    try {
      const directory = writeLegacy(home, goneScript);
      migrateLegacyAgyAttentionPlugin(home);
      expect(fs.existsSync(directory)).toBe(false);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('keeps a legacy plugin whose script still exists', () => {
    const home = tempHome();
    try {
      const directory = writeLegacy(home, files.command);
      migrateLegacyAgyAttentionPlugin(home);
      expect(fs.existsSync(path.join(directory, 'hooks.json'))).toBe(true);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('does not touch a similarly named plugin that lacks Clanker provenance', () => {
    const home = tempHome();
    try {
      const userHooks = { 'clanker-attention': { Stop: [{ type: 'command', command: `node "${goneScript}" Stop`, timeout: 10 }] } };
      const renamed = writeLegacy(home, goneScript, userHooks);
      migrateLegacyAgyAttentionPlugin(home);
      expect(fs.existsSync(path.join(renamed, 'hooks.json'))).toBe(true);

      const foreign = writeLegacy(home, goneScript, legacyHooks(goneScript), { name: 'clanker-attention', description: 'My own plugin' });
      migrateLegacyAgyAttentionPlugin(home);
      expect(fs.existsSync(path.join(foreign, 'plugin.json'))).toBe(true);

      const elsewhere = writeLegacy(home, path.join(os.tmpdir(), 'my-tool', 'command.mjs'));
      migrateLegacyAgyAttentionPlugin(home);
      expect(fs.existsSync(path.join(elsewhere, 'hooks.json'))).toBe(true);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('preserves a legacy directory that holds unrecognized files', () => {
    const home = tempHome();
    try {
      const directory = writeLegacy(home, goneScript);
      fs.writeFileSync(path.join(directory, 'notes.txt'), 'keep');
      migrateLegacyAgyAttentionPlugin(home);
      expect(fs.readFileSync(path.join(directory, 'notes.txt'), 'utf8')).toBe('keep');
      expect(fs.existsSync(path.join(directory, 'hooks.json'))).toBe(true);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('references only the persistent guard from the installed plugin', () => {
    const home = tempHome();
    try {
      const guard = install(home);
      const hooks = fs.readFileSync(path.join(pluginsOf(home), 'clanker-grid-attention', 'hooks.json'), 'utf8');
      expect(hooks).toContain(JSON.stringify(guard).slice(1, -1));
      expect(hooks).not.toContain('clanker-attention-');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  const runGuard = (guard: string, hook: string, payload: Record<string, unknown>, env: Record<string, string>) =>
    new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [guard, hook], { env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['pipe', 'pipe', 'ignore'] });
      let stdout = '';
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stdin.end(JSON.stringify(payload));
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout }));
    });
  const askPayload = { conversationId: 'c1', toolCall: { name: 'ask_question' } };

  it('is inert for Antigravity launched without Clanker attention', async () => {
    const home = tempHome();
    try {
      const guard = install(home);
      expect(await runGuard(guard, 'PreToolUse', askPayload, {})).toEqual({ code: 0, stdout: '{}\n' });
      // Another harness's credentials do not make this an Antigravity attention launch.
      expect(await runGuard(guard, 'PreToolUse', askPayload, {
        CLANKER_ATTENTION_TOKEN: 't', CLANKER_ATTENTION_HARNESS: 'codex', CLANKER_ATTENTION_COMMAND: files.command, CLANKER_ATTENTION_INTERPRETER: interpreter,
      })).toEqual({ code: 0, stdout: '{}\n' });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('fails open when the temp resources of a crashed run are gone', async () => {
    const home = tempHome();
    const stale = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-attention-'));
    try {
      const guard = install(home);
      const env = {
        CLANKER_ATTENTION_PORT: '1', CLANKER_ATTENTION_TOKEN: 't', CLANKER_ATTENTION_HARNESS: 'agy',
        CLANKER_ATTENTION_COMMAND: path.join(stale, 'command.mjs'), CLANKER_ATTENTION_INTERPRETER: path.join(stale, 'interpreter.mjs'),
      };
      fs.rmSync(stale, { recursive: true, force: true });
      // The plugin survives (Clanker never released it) and must not block PreToolUse.
      expect(fs.existsSync(guard)).toBe(true);
      expect(await runGuard(guard, 'PreToolUse', askPayload, env)).toEqual({ code: 0, stdout: '{}\n' });
      expect(await runGuard(guard, 'Stop', { conversationId: 'c1', fullyIdle: true }, env)).toEqual({ code: 0, stdout: '{}\n' });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(stale, { recursive: true, force: true });
    }
  });

  it('fails open when the bridge exists but cannot run', async () => {
    const home = tempHome();
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-attention-'));
    try {
      const guard = install(home);
      // command.mjs without its observer module exits non-zero.
      fs.copyFileSync(files.command, path.join(broken, 'command.mjs'));
      fs.copyFileSync(interpreter, path.join(broken, 'interpreter.mjs'));
      const env = {
        CLANKER_ATTENTION_TOKEN: 't', CLANKER_ATTENTION_HARNESS: 'agy',
        CLANKER_ATTENTION_COMMAND: path.join(broken, 'command.mjs'), CLANKER_ATTENTION_INTERPRETER: path.join(broken, 'interpreter.mjs'),
      };
      expect(await runGuard(guard, 'PreToolUse', askPayload, env)).toEqual({ code: 0, stdout: '{}\n' });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(broken, { recursive: true, force: true });
    }
  });

  it('answers exactly once when the bridge hangs past the guard timeout', async () => {
    const home = tempHome();
    const slow = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-slow-bridge-'));
    try {
      const guard = install(home);
      fs.writeFileSync(path.join(slow, 'command.mjs'), 'setTimeout(() => {}, 60000);');
      fs.writeFileSync(path.join(slow, 'interpreter.mjs'), '');
      const result = await runGuard(guard, 'PreToolUse', askPayload, {
        CLANKER_ATTENTION_TOKEN: 't', CLANKER_ATTENTION_HARNESS: 'agy',
        CLANKER_ATTENTION_COMMAND: path.join(slow, 'command.mjs'), CLANKER_ATTENTION_INTERPRETER: path.join(slow, 'interpreter.mjs'),
        CLANKER_ATTENTION_GUARD_TIMEOUT_MS: '200',
      });
      expect(result).toEqual({ code: 0, stdout: '{}\n' });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(slow, { recursive: true, force: true });
    }
  });

  it('still delivers Antigravity lifecycle events and decisions through the guard', async () => {
    const home = tempHome();
    const recorder = attentionRecorder();
    const received = recorder.labels;
    const broker = new AgentAttentionBroker(recorder.onChange, () => undefined);
    try {
      const guard = install(home);
      const env = {
        ...(await broker.register('term-live', 'agy')),
        CLANKER_ATTENTION_COMMAND: files.command, CLANKER_ATTENTION_INTERPRETER: interpreter,
      };
      expect(JSON.parse((await runGuard(guard, 'PreInvocation', { conversationId: 'c1', invocationNum: 0 }, env)).stdout)).toEqual({});
      expect(received).toEqual(['turn_started']);
      received.length = 0;
      expect(JSON.parse((await runGuard(guard, 'PreToolUse', askPayload, env)).stdout)).toEqual({ decision: 'allow' });
      expect(received).toEqual(['input_requested']);
      received.length = 0;
      await runGuard(guard, 'PostToolUse', askPayload, env);
      await runGuard(guard, 'Stop', { conversationId: 'c1', fullyIdle: true }, env);
      expect(received).toEqual(['input_resolved', 'turn_completed']);
    } finally {
      broker.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('keeps the shared plugin installed across installs, migrations and launches', () => {
    // Several Clanker processes share this directory, and Antigravity sessions outlive them.
    const home = tempHome();
    try {
      const guard = install(home);
      migrateLegacyAgyAttentionPlugin(home);
      install(home);
      expect(fs.existsSync(guard)).toBe(true);
      expect(fs.existsSync(path.join(pluginsOf(home), 'clanker-grid-attention', 'hooks.json'))).toBe(true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('scavenges only attention roots whose owner is gone', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-scavenge-'));
    const root = (name: string, pid?: number | string) => {
      const directory = path.join(tmp, name);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'command.mjs'), '');
      if (pid !== undefined) fs.writeFileSync(path.join(directory, '.clanker-pid'), String(pid));
      return directory;
    };
    try {
      const deadPid = await new Promise<number>((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', '']);
        child.once('error', reject);
        child.once('close', () => resolve(child.pid!));
      });
      const dead = root('clanker-attention-dead01', deadPid);
      const live = root('clanker-attention-live01', process.pid);
      const oldUnmarked = root('clanker-attention-old001');
      const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldUnmarked, longAgo, longAgo);
      const unrelated = path.join(tmp, 'clanker-attention-unrelated-dir');
      fs.mkdirSync(unrelated);
      fs.mkdirSync(path.join(tmp, 'target'));
      fs.writeFileSync(path.join(tmp, 'target', 'command.mjs'), '');
      fs.symlinkSync(path.join(tmp, 'target'), path.join(tmp, 'clanker-attention-link01'));

      scavengeStaleAttentionRoots(tmp);

      expect(fs.existsSync(dead)).toBe(false);
      // No owner record: not provably dead, however old.
      expect(fs.existsSync(oldUnmarked)).toBe(true);
      expect(fs.existsSync(live)).toBe(true);
      expect(fs.existsSync(unrelated)).toBe(true);
      expect(fs.existsSync(path.join(tmp, 'target', 'command.mjs'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
