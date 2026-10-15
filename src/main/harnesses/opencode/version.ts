import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prependUserCliBinsToPath } from '../../platformShell';

/**
 * OpenCode 2.x replaced the plugin contract (`{ id, setup(ctx) }` with `ctx.event.subscribe`) and runs
 * plugins in a shared background service (`opencode serve --service`) that never sees a launch's
 * environment, so attention must know which major version a launch will run. Measured: 2.0.26 prints
 * `opencode v2.0.26`; a bare `1.2.3` is accepted too.
 *
 * The probe runs the resolved executable directly (no shell) with a short timeout, and is cached by the
 * executable's real path and modification time so an in-place upgrade is noticed. POSIX only: Windows
 * installs are npm `.cmd` shims, which this does not execute, and report `null` (the 1.x behavior).
 */
const cache = new Map<string, number | null>();
const PROBE_TIMEOUT_MS = 3000;

export function parseOpenCodeMajorVersion(output: string): number | null {
  const match = /^(?:opencode\s+)?v?(\d{1,4})\.\d{1,6}\.\d{1,6}/i.exec(output.trim());
  return match ? Number(match[1]) : null;
}

function resolveOnPath(command: string, pathValue: string | undefined): string | null {
  for (const directory of (pathValue ?? '').split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not here; keep looking.
    }
  }
  return null;
}

export function openCodeMajorVersion(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform,
  run: (file: string) => string = (file) => execFileSync(file, ['--version'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] })): number | null {
  if (platform === 'win32') return null;
  // The same user-level bins the harness wrapper adds, so a desktop launch resolves what the PTY will run.
  const executable = resolveOnPath('opencode', prependUserCliBinsToPath(env.PATH ?? ''));
  if (!executable) return null;
  let key: string;
  try {
    const real = fs.realpathSync(executable);
    key = `${real}:${fs.statSync(real).mtimeMs}`;
  } catch {
    return null;
  }
  if (cache.has(key)) return cache.get(key)!;
  let major: number | null;
  try {
    major = parseOpenCodeMajorVersion(run(executable));
  } catch {
    // An unrunnable or slow binary reports unknown for this launch only (the 1.x attention contract),
    // and is probed again next time rather than pinning a transient failure.
    return null;
  }
  if (cache.size >= 16) cache.delete(cache.keys().next().value!);
  cache.set(key, major);
  return major;
}

export function clearOpenCodeVersionCacheForTests(): void {
  cache.clear();
}
