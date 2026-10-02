import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import {
  acquireAgyAttentionPlugin,
  agyAttentionPlugin,
  attentionLaunchOptions,
  claudeAttentionSettings,
  ensureAttentionAdapterFiles,
  ensureProviderAttentionResources,
  releaseAgyAttentionPlugin,
  removeAttentionAdapterFiles,
  withoutAttentionEnvironment,
} from '../../../src/main/agentAttentionAdapters';
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
    expect(Object.keys(settings.hooks)).toEqual(['UserPromptSubmit', 'PermissionRequest', 'Stop', 'PostToolUse', 'Notification', 'SessionEnd']);
    expect(JSON.stringify(settings)).toContain(path.join(ensureProviderAttentionResources('claude', files).resourceRoot!, 'interpreter.mjs'));
  });

  it('configures Antigravity launch options and limits hooks to interaction tools', () => {
    const options = attentionLaunchOptions('agy', ['--model', 'gemini-3.8-flash-high'], {}, files);
    expect(options).toEqual({ args: ['--model', 'gemini-3.8-flash-high'], env: {} });
    const plugin = agyAttentionPlugin(files.command, path.join(ensureProviderAttentionResources('agy', files).resourceRoot!, 'interpreter.mjs'), 'linux');
    expect(plugin.pluginJson.name).toBe('clanker-grid-attention');
    const hooks = plugin.hooksJson['clanker-attention'] as Record<string, Array<{ matcher?: string }>>;
    expect(Object.keys(hooks)).toEqual(['PreInvocation', 'PostInvocation', 'PreToolUse', 'PostToolUse', 'Stop']);
    expect(hooks.PreToolUse[0].matcher).toBe('ask_question|ask_permission|notify_user');
    expect(hooks.PostToolUse[0].matcher).toBe('ask_question|ask_permission|notify_user');
  });

  it('installs the Antigravity plugin only while acquired and preserves unknown files', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-attention-home-'));
    const pluginDirectory = path.join(home, '.gemini', 'config', 'plugins', 'clanker-grid-attention');
    try {
      expect(fs.existsSync(pluginDirectory)).toBe(false);
      acquireAgyAttentionPlugin('term-one', files, home, 'linux');
      acquireAgyAttentionPlugin('term-two', files, home, 'linux');
      expect(fs.existsSync(path.join(pluginDirectory, 'hooks.json'))).toBe(true);
      fs.writeFileSync(path.join(pluginDirectory, 'user-file.txt'), 'keep');

      releaseAgyAttentionPlugin('term-one');
      expect(fs.existsSync(path.join(pluginDirectory, 'hooks.json'))).toBe(true);
      releaseAgyAttentionPlugin('term-two');

      expect(fs.existsSync(path.join(pluginDirectory, 'hooks.json'))).toBe(false);
      expect(fs.readFileSync(path.join(pluginDirectory, 'user-file.txt'), 'utf8')).toBe('keep');
    } finally {
      releaseAgyAttentionPlugin('term-one');
      releaseAgyAttentionPlugin('term-two');
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite an unowned Antigravity plugin', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-attention-home-'));
    const pluginDirectory = path.join(home, '.gemini', 'config', 'plugins', 'clanker-grid-attention');
    fs.mkdirSync(pluginDirectory, { recursive: true });
    fs.writeFileSync(path.join(pluginDirectory, 'plugin.json'), '{"name":"user-plugin"}');
    try {
      expect(() => acquireAgyAttentionPlugin('term-conflict', files, home, 'linux'))
        .toThrow('Refusing to overwrite an unowned Antigravity plugin');
      expect(fs.readFileSync(path.join(pluginDirectory, 'plugin.json'), 'utf8'))
        .toBe('{"name":"user-plugin"}');
    } finally {
      releaseAgyAttentionPlugin('term-conflict');
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
    const result = attentionLaunchOptions('codex', ['codex', 'resume', 'abc'], { CODEX_HOME: '/nonexistent' }, files);
    expect(result?.args[0]).toBe('codex');
    expect(result?.args.slice(-2)).toEqual(['resume', 'abc']);
    const overrides = result!.args.filter((arg) => arg !== '-c' && arg.startsWith('hooks.'));
    expect(overrides.map((arg) => arg.split('=')[0])).toEqual(['hooks.UserPromptSubmit', 'hooks.PermissionRequest', 'hooks.PostToolUse', 'hooks.Stop', 'hooks.SubagentStop', 'hooks.SessionEnd']);
    expect(result!.args.join(' ')).not.toContain('notify=');
    expect(overrides[3]).toContain(JSON.stringify(`node "${files.command}" "${interpreter}" Stop`).slice(1, -1));
    expect(attentionLaunchOptions('codex', ['-p', 'custom'], { CODEX_HOME: '/nonexistent' }, files)).toBeNull();
    expect(attentionLaunchOptions('codex', ['-c', 'hooks.Stop=[]'], { CODEX_HOME: '/nonexistent' }, files)).toBeNull();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-codex-home-'));
    try {
      fs.writeFileSync(path.join(home, 'config.toml'), '[[hooks.SubagentStop]]\n');
      expect(attentionLaunchOptions('codex', [], { CODEX_HOME: home }, files)).toBeNull();
      fs.writeFileSync(path.join(home, 'config.toml'), 'notify = ["legacy"]\n[hooks.state]\n');
      expect(attentionLaunchOptions('codex', [], { CODEX_HOME: home }, files)).not.toBeNull();
      fs.writeFileSync(path.join(home, 'config.toml'), '');
      fs.writeFileSync(path.join(home, 'hooks.json'), '{"hooks":{"Stop":[]}}');
      expect(attentionLaunchOptions('codex', [], { CODEX_HOME: home }, files)).toBeNull();
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
    const received: Array<{ terminalId: string; event: string }> = [];
    const broker = new AgentAttentionBroker((update) => received.push(update), () => undefined);
    try {
      const env = await broker.register('term-hook', 'claude');
      const result = await runHook(env, 'claude', 'UserPromptSubmit', { session_id: 's1', prompt: 'private text' });
      expect(result.code).toBe(0);
      expect(received).toEqual([{ terminalId: 'term-hook', event: 'turn_started' }]);
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
    const received: Array<{ terminalId: string; event: string }> = [];
    const broker = new AgentAttentionBroker((update) => received.push(update), () => undefined);
    try {
      const env = await broker.register('term-agy', 'agy');
      const run = (hook: string, payload: Record<string, unknown>) => runHook(env, 'agy', hook, payload);

      const r1 = await run('PreInvocation', { conversationId: 'c1', invocationNum: 0 });
      expect(r1.code).toBe(0);
      expect(JSON.parse(r1.stdout)).toEqual({});
      expect(received).toEqual([{ terminalId: 'term-agy', event: 'turn_started' }]);

      received.length = 0;
      await run('PreInvocation', { conversationId: 'c1', invocationNum: 1 });
      expect(received).toEqual([]);

      const r3 = await run('PreToolUse', { conversationId: 'c1', toolCall: { name: 'ask_question' } });
      expect(JSON.parse(r3.stdout)).toEqual({ decision: 'allow' });
      expect(received).toEqual([{ terminalId: 'term-agy', event: 'input_requested' }]);

      received.length = 0;
      const r4 = await run('PostToolUse', { conversationId: 'c1', toolCall: { name: 'ask_question' } });
      expect(JSON.parse(r4.stdout)).toEqual({});
      expect(received).toEqual([{ terminalId: 'term-agy', event: 'input_resolved' }]);

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
      expect(received).toEqual([{ terminalId: 'term-agy', event: 'turn_completed' }]);
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
