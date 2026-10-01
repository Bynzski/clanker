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
      .toEqual(['--model', 'x', '--no-extensions', '--extension', path.join(path.dirname(files.command), 'pi.ts')]);
    expect(attentionLaunchOptions('omp', ['--model', 'x'], {}, files)?.args)
      .toEqual(['--model', 'x', '--extension', path.join(path.dirname(files.command), 'omp.ts')]);
    expect(fs.readFileSync(path.join(path.dirname(files.command), 'omp.ts'), 'utf8')).toContain("omp.on('agent_end'");
    expect(attentionLaunchOptions('claude', ['--model', 'x'], {}, files)?.args)
      .toEqual(['--model', 'x', '--settings', path.join(path.dirname(files.command), 'claude-settings.json')]);
    expect(attentionLaunchOptions('claude', ['--settings', 'custom.json'], {}, files)).toBeNull();
    const settings = JSON.parse(fs.readFileSync(path.join(path.dirname(files.command), 'claude-settings.json'), 'utf8')) as { hooks: Record<string, unknown> };
    expect(Object.keys(settings.hooks)).toContain('Notification');
  });

  it('configures Antigravity launch options and limits hooks to interaction tools', () => {
    const options = attentionLaunchOptions('agy', ['--model', 'gemini-3.8-flash-high'], {}, files);
    expect(options).toEqual({ args: ['--model', 'gemini-3.8-flash-high'], env: {} });
    const plugin = agyAttentionPlugin(files.command, 'linux');
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
      .toBe(path.join(path.dirname(files.command), 'opencode'));
  });

  it('does not inherit attention credentials from an earlier launch', () => {
    expect(withoutAttentionEnvironment({
      PATH: '/bin',
      CLANKER_ATTENTION_TOKEN: 'old-token',
      CLANKER_ATTENTION_COMMAND: '/tmp/old-command',
    })).toEqual({ PATH: '/bin' });
  });

  it('places Codex config before resume and skips an explicit profile', () => {
    const result = attentionLaunchOptions('codex', ['codex', 'resume', 'abc'], { CODEX_HOME: '/nonexistent' }, files);
    expect(result?.args.slice(0, 4)).toEqual(['codex', '-c', expect.stringContaining('notify='), 'resume']);
    expect(attentionLaunchOptions('codex', ['-p', 'custom'], { CODEX_HOME: '/nonexistent' }, files)).toBeNull();
  });

  it('uses an executable and preserves a Windows script path as one argument', () => {
    const windowsCommand = 'C:\\Users\\Jane Doe\\AppData\\Local\\Temp\\attention\\command.mjs';
    const claude = claudeAttentionSettings(windowsCommand, 'win32');
    expect(claude.hooks.Stop[0].hooks[0]).toMatchObject({ command: 'node.exe', args: [windowsCommand] });
    const codex = attentionLaunchOptions('codex', ['resume', 'abc'], { CODEX_HOME: '/nonexistent' }, { ...files, command: windowsCommand }, undefined, 'win32');
    expect(codex?.args[1]).toBe(`notify=${JSON.stringify(['node.exe', windowsCommand])}`);
  });

  it('delivers a command hook event without forwarding prompt text', async () => {
    const received: Array<{ terminalId: string; event: string }> = [];
    const broker = new AgentAttentionBroker((update) => received.push(update));
    try {
      const env = await broker.register('term-hook', 'claude');
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [files.command], {
          env: { ...process.env, ...env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'private text' }));
        child.once('error', reject);
        child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`hook exited ${code}`)));
      });
      expect(received).toEqual([{ terminalId: 'term-hook', event: 'turn_started', sessionId: 's1' }]);
    } finally {
      broker.close();
    }
  });

  it('delivers Antigravity lifecycle events and decisions accurately', async () => {
    const received: Array<{ terminalId: string; event: string }> = [];
    const broker = new AgentAttentionBroker((update) => received.push(update));
    try {
      const env = await broker.register('term-agy', 'agy');

      // Helper to run command.mjs with hook event arg and stdin JSON
      const runHook = (hookArg: string, payload: Record<string, unknown>): Promise<{ code: number; stdout: string }> => {
        return new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [files.command, hookArg], {
            env: { ...process.env, ...env },
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          let stdout = '';
          child.stdout.on('data', (d) => { stdout += d.toString(); });
          child.stdin.end(JSON.stringify(payload));
          child.once('error', reject);
          child.once('close', (code) => resolve({ code: code ?? 0, stdout }));
        });
      };

      // 1. PreInvocation with invocationNum = 0 -> turn_started
      const r1 = await runHook('PreInvocation', { conversationId: 'c1', invocationNum: 0 });
      expect(r1.code).toBe(0);
      expect(JSON.parse(r1.stdout)).toEqual({});
      expect(received).toEqual([{ terminalId: 'term-agy', event: 'turn_started', sessionId: 'c1' }]);

      // 2. PreInvocation with invocationNum = 1 -> no new event
      received.length = 0;
      const r2 = await runHook('PreInvocation', { conversationId: 'c1', invocationNum: 1 });
      expect(r2.code).toBe(0);
      expect(received).toEqual([]);

      // 3. PreToolUse for ask_question -> input_requested & decision allow
      const r3 = await runHook('PreToolUse', { conversationId: 'c1', toolCall: { name: 'ask_question' } });
      expect(r3.code).toBe(0);
      expect(JSON.parse(r3.stdout)).toEqual({ decision: 'allow' });
      expect(received).toEqual([{ terminalId: 'term-agy', event: 'input_requested', sessionId: 'c1' }]);

      // 4. PostToolUse for ask_question -> input_resolved
      received.length = 0;
      const r4 = await runHook('PostToolUse', { conversationId: 'c1', toolCall: { name: 'ask_question' } });
      expect(r4.code).toBe(0);
      expect(JSON.parse(r4.stdout)).toEqual({});
      expect(received).toEqual([{ terminalId: 'term-agy', event: 'input_resolved', sessionId: 'c1' }]);

      // 5. A non-interaction tool is ignored defensively. The plugin matcher
      // prevents this call in Antigravity, so no permission decision is made.
      received.length = 0;
      const r5 = await runHook('PreToolUse', { conversationId: 'c1', toolCall: { name: 'run_command' } });
      expect(r5.code).toBe(0);
      expect(JSON.parse(r5.stdout)).toEqual({});
      expect(received).toEqual([]);

      // 6. Stop -> turn_completed
      received.length = 0;
      const r6 = await runHook('Stop', { conversationId: 'c1', terminationReason: 'NO_TOOL_CALL' });
      expect(r6.code).toBe(0);
      expect(JSON.parse(r6.stdout)).toEqual({});
      expect(received).toEqual([{ terminalId: 'term-agy', event: 'turn_completed', sessionId: 'c1' }]);
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
