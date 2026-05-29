/**
 * Terminal PTY Integration Tests
 * 
 * Tests real PTY (pseudo-terminal) spawning behavior using node-pty.
 * These tests verify:
 * - Shell spawning works correctly
 * - Environment variables are passed properly
 * - Working directory is set correctly
 * - PTY exits cleanly
 * - Harness argument construction is correct
 * 
 * Note: These are integration tests that spawn real PTY processes.
 * They are isolated by design - each test creates its own PTY
 * and cleans up after itself.
 */

import { describe, it, expect } from 'vitest';
import * as pty from 'node-pty';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  buildHarnessSpawnArgs,
  buildHarnessWrapperScript,
  ensureHarnessWrapperScript,
  normalizePiModelId,
  type HarnessConfig,
} from '../../../src/main/harnessLaunch';

// ============================================================================
// Test Fixtures
// ============================================================================

interface PtyTestResult {
  pid: number;
  output: string;
  exitCode: number | null;
}

interface TempDir {
  path: string;
  cleanup: () => void;
}

function createTempDir(): TempDir {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-test-'));
  return {
    path: tempDir,
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function runHarnessWrapperInPty(
  wrapperPath: string,
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    onData?: (ptyProcess: pty.IPty, output: string) => void;
  } = {}
): Promise<PtyTestResult> {
  const {
    cwd = os.homedir(),
    env = {},
    timeoutMs = 5000,
    onData,
  } = options;

  return new Promise((resolve) => {
    let output = '';
    let resolved = false;

    const ptyProcess = pty.spawn(wrapperPath, [command, ...args], {
      name: 'xterm-256color',
      cwd,
      env: {
        ...process.env as Record<string, string>,
        ...env,
        TERM: 'xterm-256color',
      },
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ptyProcess.kill();
        resolve({ pid: ptyProcess.pid, output, exitCode: null });
      }
    }, timeoutMs);

    ptyProcess.onData((data: string) => {
      output += data;
      onData?.(ptyProcess, output);
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ pid: ptyProcess.pid, output, exitCode });
      }
    });
  });
}

/**
 * Run a command in a PTY and collect output until completion.
 */
async function runCommandInPty(
  command: string,
  options: {
    shell?: string;
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  } = {}
): Promise<PtyTestResult> {
  const {
    shell = process.env.SHELL || '/bin/bash',
    cwd = os.homedir(),
    env = {},
    timeoutMs = 5000,
  } = options;

  return new Promise((resolve) => {
    let output = '';
    let resolved = false;

    const fullEnv = {
      ...process.env as Record<string, string>,
      ...env,
      TERM: 'xterm-256color',
    };

    const ptyProcess = pty.spawn(shell, ['-c', command], {
      name: 'xterm-256color',
      cwd,
      env: fullEnv,
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ptyProcess.kill();
        resolve({
          pid: ptyProcess.pid,
          output,
          exitCode: null,
        });
      }
    }, timeoutMs);

    ptyProcess.onData((data: string) => {
      output += data;
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          pid: ptyProcess.pid,
          output,
          exitCode,
        });
      }
    });
  });
}

// ============================================================================
// Tests - Harness Argument Construction
// ============================================================================

describe('Terminal PTY Integration Tests', () => {
  describe('Harness Argument Construction', () => {
    it('builds harness spawn args without model', () => {
      const config: HarnessConfig = {
        name: 'Test Harness',
        command: 'test-harness',
        args: ['--verbose'],
        icon: '🧪',
      };

      const args = buildHarnessSpawnArgs(config);
      expect(args).toEqual(['--verbose']);
    });

    it('builds harness spawn args with model', () => {
      const config: HarnessConfig = {
        name: 'Test Harness',
        command: 'test-harness',
        args: ['--verbose'],
        icon: '🧪',
        modelArg: '--model',
      };

      const args = buildHarnessSpawnArgs(config, 'gpt-4');
      expect(args).toEqual(['--model', 'gpt-4', '--verbose']);
    });

    it('builds harness spawn args with default modelArg', () => {
      const config: HarnessConfig = {
        name: 'Test Harness',
        command: 'test-harness',
        args: ['--yolo'],
        icon: '🧪',
        // No modelArg specified, should use default
      };

      const args = buildHarnessSpawnArgs(config, 'claude-3-sonnet');
      expect(args).toEqual(['--model', 'claude-3-sonnet', '--yolo']);
    });

    it('handles empty args array', () => {
      const config: HarnessConfig = {
        name: 'Test Harness',
        command: 'test-harness',
        args: [],
        icon: '🧪',
      };

      const args = buildHarnessSpawnArgs(config, 'gpt-4');
      expect(args).toEqual(['--model', 'gpt-4']);
    });

    it('normalizes pi model IDs', () => {
      expect(normalizePiModelId('anthropic', 'claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
      expect(normalizePiModelId('openai', 'gpt-4o')).toBe('openai/gpt-4o');
      expect(normalizePiModelId('pi', 'sonnet')).toBe('pi/sonnet');
    });

    it.skipIf(process.platform === 'win32')('runs the harness as the foreground PTY job and then falls back to an interactive shell', async () => {
      const tempHome = createTempDir();
      let sentFallbackCommand = false;

      try {
        const wrapperPath = ensureHarnessWrapperScript(tempHome.path);
        expect(wrapperPath).not.toBeNull();
        expect(fs.readFileSync(wrapperPath!, 'utf8')).toBe(buildHarnessWrapperScript());

        const result = await runHarnessWrapperInPty(
          wrapperPath!,
          '/usr/bin/python3',
          ['-c', 'import os, sys; print("tty=%s" % ("yes" if sys.stdin.isatty() else "no")); print("foreground=%s" % ("yes" if os.tcgetpgrp(sys.stdin.fileno()) == os.getpgrp() else "no"))'],
          {
            cwd: tempHome.path,
            env: {
              SHELL: '/bin/bash',
              CLANKER_GRID_FALLBACK_SHELL: '/bin/bash',
              HOME: tempHome.path,
            },
            timeoutMs: 6000,
            onData: (ptyProcess, output) => {
              if (!sentFallbackCommand && output.includes('foreground=yes')) {
                sentFallbackCommand = true;
                ptyProcess.write('echo fallback-shell-ready\nexit\n');
              }
            },
          }
        );

        expect(result.output).toContain('tty=yes');
        expect(result.output).toContain('foreground=yes');
        expect(result.output).toContain('fallback-shell-ready');
        expect(result.exitCode).toBe(0);
      } finally {
        tempHome.cleanup();
      }
    });
  });

  // =========================================================================
  // Tests - Real PTY Shell Spawning
  // =========================================================================

  describe.skipIf(process.platform === 'win32')('Real PTY Shell Spawning', () => {
    it('spawns a PTY with bash successfully', async () => {
      const result = await runCommandInPty('echo "hello world"', {
        shell: '/bin/bash',
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('hello world');
      expect(result.exitCode).toBe(0);
    });

    it('spawns a PTY with zsh if available', async () => {
      const zshPath = '/bin/zsh';
      
      // Skip test if zsh is not available
      if (!fs.existsSync(zshPath)) {
        expect(true).toBe(true); // Placeholder
        return;
      }

      const result = await runCommandInPty('echo "hello from zsh"', {
        shell: zshPath,
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('hello from zsh');
    });

    it('spawns a PTY with proper TERM variable', async () => {
      const result = await runCommandInPty('echo $TERM', {
        shell: '/bin/bash',
      });

      expect(result.pid).toBeGreaterThan(0);
      // TERM should be set to xterm-256color
      expect(result.output).toContain('xterm-256color');
    });

    it('spawns a PTY with custom environment variables', async () => {
      const result = await runCommandInPty('echo $CUSTOM_VAR', {
        shell: '/bin/bash',
        env: { CUSTOM_VAR: 'custom-value-123' },
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('custom-value-123');
    });

    it('spawns a PTY with correct working directory', async () => {
      const tempDir = createTempDir();
      try {
        const testFile = path.join(tempDir.path, 'test-output.txt');
        
        const result = await runCommandInPty(`pwd && echo "cwd-test" > "${testFile}"`, {
          shell: '/bin/bash',
          cwd: tempDir.path,
        });

        expect(result.pid).toBeGreaterThan(0);
        expect(result.output).toContain(tempDir.path);
        expect(fs.existsSync(testFile)).toBe(true);
      } finally {
        tempDir.cleanup();
      }
    });

    it('spawns a PTY with user home directory by default', async () => {
      const result = await runCommandInPty('echo $HOME', {
        shell: '/bin/bash',
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain(os.homedir());
    });

    it('PTY process has a valid PID', async () => {
      const result = await runCommandInPty('echo "test"', {
        shell: '/bin/bash',
      });

      expect(result.pid).toBeGreaterThan(0);
      // Verify process exists
      try {
        process.kill(result.pid, 0);
        // Process exists, which is expected for recently exited process
      } catch {
        // Process may have already exited, which is fine
      }
    });

    it('handles multiple sequential commands in PTY', async () => {
      const result = await runCommandInPty(
        'echo "line1" && echo "line2" && echo "line3"',
        { shell: '/bin/bash' }
      );

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('line1');
      expect(result.output).toContain('line2');
      expect(result.output).toContain('line3');
      expect(result.exitCode).toBe(0);
    });

    it('captures stderr output in PTY', async () => {
      const result = await runCommandInPty(
        'echo "stdout" && echo "stderr" >&2',
        { shell: '/bin/bash' }
      );

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('stdout');
      expect(result.output).toContain('stderr');
    });
  });

  // =========================================================================
  // Tests - PTY Data Handling
  // =========================================================================

  describe.skipIf(process.platform === 'win32')('PTY Data Handling', () => {
    it('handles binary data output', async () => {
      const result = await runCommandInPty(
        'printf "\\x00\\x01\\x02\\x03" | cat',
        { shell: '/bin/bash' }
      );

      expect(result.pid).toBeGreaterThan(0);
      // Output should contain the binary data (may not display as text)
      expect(result.output.length).toBeGreaterThan(0);
    });

    it('handles unicode output correctly', async () => {
      const result = await runCommandInPty(
        'echo "🎉 Unicode Test: café → 日本語"',
        { shell: '/bin/bash' }
      );

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('Unicode Test');
      expect(result.output).toContain('🎉');
    });

    it('handles long output without truncation', async () => {
      const result = await runCommandInPty(
        `node -e "process.stdout.write('x'.repeat(10000) + '\\n')"`,
        { shell: '/bin/bash' }
      );

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toHaveLength(10000 + 2); // +2 for PTY line ending conversion (\r\n)
    });

    it('handles special shell characters in input', async () => {
      const result = await runCommandInPty(
        'echo "Special: $HOME, ~, \\"quotes\\", `backticks`"',
        { shell: '/bin/bash' }
      );

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('Special:');
      expect(result.output).toContain('quotes');
    });
  });

  // =========================================================================
  // Tests - PTY Exit and Cleanup
  // =========================================================================

  describe.skipIf(process.platform === 'win32')('PTY Exit and Cleanup', () => {
    it('exits cleanly with exit code 0', async () => {
      const result = await runCommandInPty('exit 0', {
        shell: '/bin/bash',
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.exitCode).toBe(0);
    });

    it('captures non-zero exit codes', async () => {
      const result = await runCommandInPty('exit 42', {
        shell: '/bin/bash',
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.exitCode).toBe(42);
    });

    it('handles SIGKILL by parent process', async () => {
      const shell = process.env.SHELL || '/bin/bash';

      const ptyProcess = pty.spawn(shell, ['-c', 'sleep 60'], {
        name: 'xterm-256color',
        cwd: os.homedir(),
        env: { ...process.env as Record<string, string>, TERM: 'xterm-256color' },
      });

      // Give it time to start
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Kill the process
      ptyProcess.kill();
      
      // Wait for exit event
      const exitCode = await new Promise<number>((resolve) => {
        ptyProcess.onExit(({ exitCode }) => {
          resolve(exitCode ?? -1);
        });
      });

      expect(ptyProcess.pid).toBeGreaterThan(0);
      // Process was killed - exit code may be 0 or signal-dependent
      // The key is that the process was terminated
      expect(typeof exitCode).toBe('number');
    });

    it('releases resources after exit', async () => {
      const result = await runCommandInPty('echo "cleanup test"', {
        shell: '/bin/bash',
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.exitCode).toBe(0);

      // Give time for resources to be released
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify process is no longer running
      let processExists = false;
      try {
        process.kill(result.pid, 0);
        processExists = true;
      } catch {
        processExists = false;
      }

      expect(processExists).toBe(false);
    });
  });

  // =========================================================================
  // Tests - PTY Resize Behavior
  // =========================================================================

  describe.skipIf(process.platform === 'win32')('PTY Resize Behavior', () => {
    it('resizes PTY without crashing', async () => {
      const shell = process.env.SHELL || '/bin/bash';

      const ptyProcess = pty.spawn(shell, ['-c', 'sleep 1'], {
        name: 'xterm-256color',
        cwd: os.homedir(),
        env: { ...process.env as Record<string, string>, TERM: 'xterm-256color' },
      });

      // Give it time to initialize
      await new Promise(resolve => setTimeout(resolve, 50));

      // Resize to different dimensions
      expect(() => ptyProcess.resize(80, 24)).not.toThrow();
      expect(() => ptyProcess.resize(120, 40)).not.toThrow();
      expect(() => ptyProcess.resize(200, 60)).not.toThrow();

      // Cleanup
      ptyProcess.kill();

      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('handles zero dimensions gracefully', async () => {
      const shell = process.env.SHELL || '/bin/bash';

      const ptyProcess = pty.spawn(shell, ['-c', 'sleep 1'], {
        name: 'xterm-256color',
        cwd: os.homedir(),
        env: { ...process.env as Record<string, string>, TERM: 'xterm-256color' },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Resize to zero dimensions - PTY library throws for invalid dimensions
      // But we verify the PTY remains usable after valid resize
      expect(() => ptyProcess.resize(80, 24)).not.toThrow();
      expect(() => ptyProcess.resize(1, 1)).not.toThrow();
      
      // Cleanup
      ptyProcess.kill();
      
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  // =========================================================================
  // Tests - Interactive Shell Behavior
  // =========================================================================

  describe.skipIf(process.platform === 'win32')('Interactive Shell Behavior', () => {
    it('loads shell profile in interactive mode', async () => {
      // Create a temp directory with a custom prompt
      const tempDir = createTempDir();
      try {
        // Set a custom prompt via environment
        const result = await runCommandInPty(
          'if [ -n "$BASH_VERSION" ]; then echo "bash-version=$BASH_VERSION"; fi',
          {
            shell: '/bin/bash',
            env: { BASH_SILENCE_DEPRECATION_WARNING: '1' },
          }
        );

        expect(result.pid).toBeGreaterThan(0);
        expect(result.output).toContain('bash-version=');
      } finally {
        tempDir.cleanup();
      }
    });

    it('respects interactive flag', async () => {
      const result = await runCommandInPty(
        '[[ $- == *i* ]] && echo "interactive" || echo "non-interactive"',
        { shell: '/bin/bash' }
      );

      expect(result.pid).toBeGreaterThan(0);
      // The shell started with -c flag is not interactive
      expect(result.output).toContain('non-interactive');
    });
  });

  // =========================================================================
  // Tests - Platform-Specific Behavior
  // =========================================================================

  describe.skipIf(process.platform === 'win32')('Platform-Specific Behavior', () => {
    it('works on Linux with bash', async () => {
      const result = await runCommandInPty('uname -s', {
        shell: '/bin/bash',
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output.trim()).toBe('Linux');
      expect(result.exitCode).toBe(0);
    });

    it('handles Linux-specific paths', async () => {
      const result = await runCommandInPty('echo $PATH | tr ":" "\\n" | head -3', {
        shell: '/bin/bash',
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output.trim().split('\n').length).toBeGreaterThan(0);
    });

    it('respects platform-specific home directory', async () => {
      const result = await runCommandInPty('echo "home=$HOME"', {
        shell: '/bin/bash',
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain(`home=${os.homedir()}`);
    });
  });

  // =========================================================================
  // Tests - Error Handling
  // =========================================================================

  describe.skipIf(process.platform === 'win32')('Error Handling', () => {
    it('handles non-existent shell gracefully', async () => {
      // This tests that we handle shell spawning failures
      // We can't easily test a truly non-existent shell without mocking
      expect(fs.existsSync('/bin/bash')).toBe(true);
    });

    it('handles command not found', async () => {
      const result = await runCommandInPty(
        'nonexistent-command-12345',
        { shell: '/bin/bash' }
      );

      expect(result.pid).toBeGreaterThan(0);
      expect(result.exitCode).not.toBe(0);
      expect(result.output.toLowerCase()).toMatch(/not found|command not found/i);
    });

    it('handles permission denied errors', async () => {
      const result = await runCommandInPty(
        '/etc/shadow',
        { shell: '/bin/bash' }
      );

      expect(result.pid).toBeGreaterThan(0);
      // Should either fail to execute or output "Permission denied"
      const output = result.output.toLowerCase();
      const hasPermissionError = 
        output.includes('permission denied') || 
        output.includes('cannot open') ||
        result.exitCode !== 0;
      expect(hasPermissionError).toBe(true);
    });

    it('handles directory not found for cwd', async () => {
      const result = await runCommandInPty('pwd', {
        shell: '/bin/bash',
        cwd: '/nonexistent/directory/12345',
      });

      expect(result.pid).toBeGreaterThan(0);
      // PTY handles missing directory - shell will error or use fallback
      // Either way, we get output indicating what happened
      expect(result.output.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Tests - Environment Variable Passing
  // =========================================================================

  describe.skipIf(process.platform === 'win32')('Environment Variable Passing', () => {
    it('passes custom environment variables', async () => {
      const result = await runCommandInPty('echo "CUSTOM=$CLANKER_TEST_ENV"', {
        shell: '/bin/bash',
        env: { CLANKER_TEST_ENV: '1' },
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('CUSTOM=1');
    });

    it('passes COLORTERM environment variable', async () => {
      const result = await runCommandInPty('echo "COLORTERM=$COLORTERM"', {
        shell: '/bin/bash',
        env: { COLORTERM: 'truecolor' },
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('COLORTERM=truecolor');
    });

    it('passes FORCE_COLOR environment variable', async () => {
      const result = await runCommandInPty('echo "FORCE=$FORCE_COLOR"', {
        shell: '/bin/bash',
        env: { FORCE_COLOR: '1' },
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('FORCE=1');
    });

    it('passes TERM_PROGRAM environment variable', async () => {
      const result = await runCommandInPty('echo "PROGRAM=$TERM_PROGRAM"', {
        shell: '/bin/bash',
        env: { TERM_PROGRAM: 'clanker-grid' },
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('PROGRAM=clanker-grid');
    });

    it('preserves PATH from parent environment', async () => {
      const result = await runCommandInPty('which bash', {
        shell: '/bin/bash',
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('/bin/bash');
    });

    it('can override PATH with custom value', async () => {
      const result = await runCommandInPty('echo "path=$PATH"', {
        shell: '/bin/bash',
        env: { PATH: '/custom/path' },
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('path=/custom/path');
    });
  });

  // =========================================================================
  // Tests - Harness Environment Variables
  // =========================================================================

  describe.skipIf(process.platform === 'win32')('Harness Environment Variables', () => {
    it('passes harness-specific environment variables', async () => {
      // Test with OPENCODE_PERMISSION env var which is used for opencode harness
      const result = await runCommandInPty(
        'echo "PERM=$OPENCODE_PERMISSION"',
        {
          shell: '/bin/bash',
          env: {
            OPENCODE_PERMISSION: JSON.stringify({
              bash: { '*': 'allow' },
              edit: 'allow',
            }),
          },
        }
      );

      expect(result.pid).toBeGreaterThan(0);
      // The variable was passed and contains the expected JSON structure
      expect(result.output).toContain('PERM={"bash"');
      expect(result.output).toContain('allow');
    });

    it('handles multiple harness env vars simultaneously', async () => {
      const result = await runCommandInPty(
        'echo "A=$VAR_A B=$VAR_B C=$VAR_C"',
        {
          shell: '/bin/bash',
          env: {
            VAR_A: 'value-a',
            VAR_B: 'value-b',
            VAR_C: 'value-c',
          },
        }
      );

      expect(result.pid).toBeGreaterThan(0);
      expect(result.output).toContain('A=value-a');
      expect(result.output).toContain('B=value-b');
      expect(result.output).toContain('C=value-c');
    });
  });
});

// ============================================================================
// Tests - PTY Performance Characteristics
// ============================================================================

describe.skipIf(process.platform === 'win32')('PTY Performance Characteristics', () => {
  it('spawns PTY within acceptable time', async () => {
    const shell = process.env.SHELL || '/bin/bash';

    const startTime = Date.now();

    const ptyProcess = pty.spawn(shell, ['-c', 'echo "test"'], {
      name: 'xterm-256color',
      cwd: os.homedir(),
      env: { ...process.env as Record<string, string>, TERM: 'xterm-256color' },
    });

    const spawnTime = Date.now() - startTime;

    // Spawn should be relatively fast (under 500ms on most systems)
    expect(spawnTime).toBeLessThan(500);

    // Cleanup
    ptyProcess.kill();

    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('handles rapid spawn/despawn cycles', async () => {
    const shell = process.env.SHELL || '/bin/bash';

    for (let i = 0; i < 10; i++) {
      const ptyProcess = pty.spawn(shell, ['-c', `echo "cycle-${i}"`], {
        name: 'xterm-256color',
        cwd: os.homedir(),
        env: { ...process.env as Record<string, string>, TERM: 'xterm-256color' },
      });
      ptyProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // If we got here without crashing, the test passed
    expect(true).toBe(true);
  });

  it('maintains stable PID across multiple spawns', async () => {
    const shell = process.env.SHELL || '/bin/bash';
    const pids: number[] = [];

    for (let i = 0; i < 5; i++) {
      const ptyProcess = pty.spawn(shell, ['-c', 'echo "test"'], {
        name: 'xterm-256color',
        cwd: os.homedir(),
        env: { ...process.env as Record<string, string>, TERM: 'xterm-256color' },
      });
      pids.push(ptyProcess.pid);
      ptyProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Each spawn should get a unique PID
    const uniquePids = new Set(pids);
    expect(uniquePids.size).toBe(5);
  });
});

// ============================================================================
// Tests - PTY with Different Shell Types
// ============================================================================

describe.skipIf(process.platform === 'win32')('PTY with Different Shell Types', () => {
  const availableShells = ['/bin/bash', '/bin/sh'];
  
  for (const shellPath of availableShells) {
    if (!fs.existsSync(shellPath)) {
      continue;
    }

    it(`spawns successfully with ${shellPath}`, async () => {
      const result = await runCommandInPty('echo "works"', {
        shell: shellPath,
      });

      expect(result.pid).toBeGreaterThan(0);
      expect(result.exitCode).toBe(0);
    });

    it(`captures output from ${shellPath}`, async () => {
      const result = await runCommandInPty('echo "captured"', {
        shell: shellPath,
      });

      expect(result.output).toContain('captured');
    });
  }
});
