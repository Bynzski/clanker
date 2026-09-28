import { describe, it, expect } from 'vitest';
import { spawnPtyProcess } from '../../../src/main/ipc/ptySpawn';
import { RecipeCommandStartup } from '../../../src/main/recipeCommandStartup';
import { defaultShell } from '../../../src/main/platformShell';
import type { Terminal } from '../../../src/main/ipc/terminalIpc';

describe('recipe command startup through the PTY', () => {
  it('observes an immediate command failure after the shell PTY successfully spawns', async () => {
    const terminals = new Map<string, Terminal>();
    const monitor = new RecipeCommandStartup();
    const result = spawnPtyProcess({
      id: 'recipe-command-test',
      spawnCmd: process.platform === 'win32' ? defaultShell() : '/bin/bash',
      spawnArgs: process.platform === 'win32' ? [] : ['-i'],
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      terminals,
      mainWindow: null,
      getIsShuttingDown: () => false,
      recipeCommandStartup: monitor,
    });
    expect(result.pid).toBeGreaterThan(0);
    const terminal = terminals.get(result.id)!;
    const output: string[] = [];
    terminal.pty.onData((data) => output.push(data));
    try {
      terminal.pty.write(`${monitor.wrap('clanker_recipe_command_that_does_not_exist')}\r`);
      monitor.onReady();
      const outcome = await monitor.wait();
      expect(outcome, output.join('')).toMatchObject({ status: 'failed' });
      if (outcome.status === 'failed') expect(outcome.error).toMatch(/code (?:1|127)/);
    } finally {
      try { terminal.pty.kill(); } catch { /* Windows PTY may already be gone. */ }
    }
  }, 10000);

  it('marks a still-running command started without waiting for its exit', async () => {
    const terminals = new Map<string, Terminal>();
    const monitor = new RecipeCommandStartup();
    const result = spawnPtyProcess({
      id: 'recipe-long-command-test',
      spawnCmd: process.platform === 'win32' ? defaultShell() : '/bin/bash',
      spawnArgs: process.platform === 'win32' ? [] : ['-i'],
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      terminals, mainWindow: null, getIsShuttingDown: () => false,
      recipeCommandStartup: monitor,
    });
    const terminal = terminals.get(result.id)!;
    try {
      const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 5' : 'sleep 5';
      terminal.pty.write(`${monitor.wrap(command)}\r`);
      monitor.onReady();
      expect(await monitor.wait()).toEqual({ status: 'started' });
    } finally {
      try { terminal.pty.kill(); } catch { /* Windows PTY may already be gone. */ }
    }
  }, 10000);
});
