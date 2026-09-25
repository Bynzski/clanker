import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { attentionLaunchOptions, claudeAttentionSettings, ensureAttentionAdapterFiles, removeAttentionAdapterFiles, withoutAttentionEnvironment } from '../../../src/main/agentAttentionAdapters';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';

afterAll(() => removeAttentionAdapterFiles());

describe('agent attention launch adapters', () => {
  const files = ensureAttentionAdapterFiles();

  it('adds Pi and Claude observers without removing existing flags', () => {
    expect(attentionLaunchOptions('pi', ['--model', 'x', '--no-extensions'], {}, files)?.args)
      .toEqual(['--model', 'x', '--no-extensions', '--extension', files.piExtension]);
    expect(attentionLaunchOptions('claude', ['--model', 'x'], {}, files)?.args)
      .toEqual(['--model', 'x', '--settings', files.claudeSettings]);
    expect(attentionLaunchOptions('claude', ['--settings', 'custom.json'], {}, files)).toBeNull();
    const settings = JSON.parse(fs.readFileSync(files.claudeSettings, 'utf8')) as { hooks: Record<string, unknown> };
    expect(Object.keys(settings.hooks)).toContain('Notification');
  });

  it('leaves custom OpenCode plugin directories and pure mode alone', () => {
    expect(attentionLaunchOptions('opencode', [], { OPENCODE_CONFIG_DIR: '/custom' }, files)).toBeNull();
    expect(attentionLaunchOptions('opencode', ['--pure'], {}, files)).toBeNull();
    expect(attentionLaunchOptions('opencode', ['--model', 'x'], {}, files)?.env.OPENCODE_CONFIG_DIR)
      .toBe(files.opencodeDirectory);
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
});
