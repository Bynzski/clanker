import { vi } from 'vitest';

/**
 * Mock for child_process.execFile.
 *
 * Usage:
 *   import { mockExecFile } from '../setup/childProcess';
 *   mockExecFile({
 *     'git status --porcelain': { stdout: 'M  file.ts', stderr: '' },
 *   });
 */
export function mockExecFile(
  responses: Record<string, { stdout?: string; stderr?: string; exitCode?: number }>,
  defaultResponse?: { stdout: string; stderr: string }
) {
  const execFileMock = vi.fn((cmd: string, args: string[], options: unknown, callback?: (...args: unknown[]) => void) => {
    // Handle overloaded signatures: execFile(cmd, args, options, callback) or execFile(cmd, args, callback)
    let cb = callback ?? (() => {});
    if (typeof options === 'function') {
      cb = options as (...args: unknown[]) => void;
    }

    const fullCommand = `${cmd} ${args.join(' ')}`;

    // Try exact match first, then prefix match
    let response = responses[fullCommand];
    if (!response) {
      for (const key of Object.keys(responses)) {
        if (fullCommand.startsWith(key) || fullCommand.includes(key)) {
          response = responses[key];
          break;
        }
      }
    }

    if (!response) {
      if (defaultResponse) {
        setImmediate(() => cb(null, defaultResponse.stdout, defaultResponse.stderr));
        return;
      }
      const err = new Error(`Command not found: ${fullCommand}`) as Error & { stderr?: string };
      err.stderr = `Unknown command: ${fullCommand}`;
      setImmediate(() => cb(err, '', ''));
      return;
    }

    if (response.exitCode && response.exitCode !== 0) {
      const err = new Error(`Command failed: ${fullCommand}`) as Error & {
        code?: number;
        stderr?: string;
        stdout?: string;
      };
      err.code = response.exitCode;
      err.stderr = response.stderr ?? '';
      err.stdout = response.stdout ?? '';
      setImmediate(() => cb(err, response.stdout ?? '', response.stderr ?? ''));
      return;
    }

    setImmediate(() => cb(null, response.stdout ?? '', response.stderr ?? ''));
  });

  return execFileMock;
}
