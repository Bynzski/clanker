import { app } from 'electron';
import { execFile } from 'child_process';
import { resolveHarnessSpawn } from '../harnessLaunch';
import { prependUserCliBinsToPath } from '../platformShell';

export function runCommandOutput(
  command: string,
  args: string[],
  timeoutMs = 6000,
  extraEnv?: Record<string, string>,
  cwd?: string
): Promise<string> {
  const { spawnCmd, spawnArgs } = resolveHarnessSpawn(command, args, null);

  return new Promise((resolve, reject) => {
    execFile(spawnCmd, spawnArgs, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      cwd,
      env: {
        ...process.env,
        PATH: prependUserCliBinsToPath(process.env.PATH ?? '', app.getPath('home')),
        ...extraEnv,
      } as { [key: string]: string },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
        return;
      }

      resolve(String(stdout ?? '') || String(stderr ?? ''));
    });
  });
}
