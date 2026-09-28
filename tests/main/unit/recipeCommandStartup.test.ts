import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawnPtyProcess } from '../../../src/main/ipc/ptySpawn';
import { RecipeCommandStartup } from '../../../src/main/recipeCommandStartup';
import { defaultShell } from '../../../src/main/platformShell';
import type { Terminal } from '../../../src/main/ipc/terminalIpc';

describe('RecipeCommandStartup unit', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('wraps commands appropriately for bash, PowerShell, and fish', () => {
    const monitor = new RecipeCommandStartup();
    const bashWrapped = monitor.wrap('echo 1', 'linux', '/bin/bash');
    expect(bashWrapped).toMatch(/^\{ echo 1; \}; clanker_recipe_exit=\$\?; printf 'CLANKER_RECIPE_[a-f0-9]+_%s\\n' "\$clanker_recipe_exit"$/);

    const winWrapped = monitor.wrap('echo 1', 'win32', '');
    expect(winWrapped).toMatch(/^try \{ \. \{ echo 1 \}; \$clankerRecipeExit = .* finally \{ Write-Output "CLANKER_RECIPE_[a-f0-9]+_\$clankerRecipeExit" \}$/);

    const pwshWrapped = monitor.wrap('echo 1', 'linux', '/usr/bin/pwsh');
    expect(pwshWrapped).toMatch(/^try \{ \. \{ echo 1 \}; \$clankerRecipeExit = .* finally \{ Write-Output "CLANKER_RECIPE_[a-f0-9]+_\$clankerRecipeExit" \}$/);

    const powershellWrapped = monitor.wrap('echo 1', 'linux', 'powershell.exe');
    expect(powershellWrapped).toMatch(/^try \{ \. \{ echo 1 \}; \$clankerRecipeExit = .* finally \{ Write-Output "CLANKER_RECIPE_[a-f0-9]+_\$clankerRecipeExit" \}$/);

    const fishWrapped = monitor.wrap('echo 1', 'linux', '/usr/bin/fish');
    expect(fishWrapped).toMatch(/^begin; echo 1; end; set -l clanker_recipe_exit \$status; printf 'CLANKER_RECIPE_[a-f0-9]+_%s\\n' \$clanker_recipe_exit$/);
  });

  it('resolves success when exit code 0 is received', async () => {
    const monitor = new RecipeCommandStartup();
    const marker = monitor.wrap('cmd').match(/CLANKER_RECIPE_[a-f0-9]+_/)?.[0] ?? '';
    expect(marker).toBeTruthy();

    monitor.onData(`running command...\n${marker}0\n`);
    const outcome = await monitor.wait();
    expect(outcome).toEqual({ status: 'success' });
  });

  it('resolves failed when a non-zero exit code is received', async () => {
    const monitor = new RecipeCommandStartup();
    const marker = monitor.wrap('cmd').match(/CLANKER_RECIPE_[a-f0-9]+_/)?.[0] ?? '';
    expect(marker).toBeTruthy();

    monitor.onData(`command error output\n${marker}127\n`);
    const outcome = await monitor.wait();
    expect(outcome).toEqual({
      status: 'failed',
      error: 'Command exited immediately with code 127',
    });
  });

  it('detects exit marker split across multiple data chunks', async () => {
    const monitor = new RecipeCommandStartup();
    const marker = monitor.wrap('cmd').match(/CLANKER_RECIPE_[a-f0-9]+_/)?.[0] ?? '';
    expect(marker).toBeTruthy();

    const splitIndex = Math.floor(marker.length / 2);
    monitor.onData(`prefix data ${marker.slice(0, splitIndex)}`);
    monitor.onData(`${marker.slice(splitIndex)}1\n`);
    const outcome = await monitor.wait();
    expect(outcome).toEqual({
      status: 'failed',
      error: 'Command exited immediately with code 1',
    });
  });

  it('resolves failed if shell exits before completion', async () => {
    const monitor = new RecipeCommandStartup();
    monitor.onExit(137);
    const outcome = await monitor.wait();
    expect(outcome).toEqual({
      status: 'failed',
      error: 'Shell exited before command startup completed (code 137)',
    });
  });

  it('transitions to started after the startup window if still running', async () => {
    vi.useFakeTimers();
    const monitor = new RecipeCommandStartup();
    // Calling wait() first schedules the 6000ms ready timeout; onReady() replaces it with 3000ms
    const waitPromise = monitor.wait();
    monitor.onReady();

    vi.advanceTimersByTime(3000);
    const outcome = await waitPromise;
    expect(outcome).toEqual({ status: 'started' });
  });

  it('times out if onReady is never called within the ready timeout', async () => {
    vi.useFakeTimers();
    const monitor = new RecipeCommandStartup();

    const waitPromise = monitor.wait();
    vi.advanceTimersByTime(6000);
    const outcome = await waitPromise;
    expect(outcome).toEqual({
      status: 'failed',
      error: 'Terminal did not become ready to run the command',
    });
  });

  it('supports multiple concurrent waiters and immediate resolution once settled', async () => {
    const monitor = new RecipeCommandStartup();
    const marker = monitor.wrap('cmd').match(/CLANKER_RECIPE_[a-f0-9]+_/)?.[0] ?? '';
    const wait1 = monitor.wait();
    const wait2 = monitor.wait();

    monitor.onData(`${marker}0\n`);
    const [res1, res2] = await Promise.all([wait1, wait2]);
    expect(res1).toEqual({ status: 'success' });
    expect(res2).toEqual({ status: 'success' });

    // Subsequent wait resolves immediately
    expect(await monitor.wait()).toEqual({ status: 'success' });
  });

  it('preserves established outcome against subsequent onReady, onData, and onExit events', async () => {
    vi.useFakeTimers();
    const monitor = new RecipeCommandStartup();
    const marker = monitor.wrap('cmd').match(/CLANKER_RECIPE_[a-f0-9]+_/)?.[0] ?? '';

    monitor.onData(`${marker}0\n`);
    monitor.onReady();
    monitor.onData(`${marker}1\n`);
    monitor.onExit(1);
    vi.advanceTimersByTime(10000);

    expect(await monitor.wait()).toEqual({ status: 'success' });
  });
});

describe.skipIf(process.platform === 'win32')('recipe command startup through the PTY', () => {
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
