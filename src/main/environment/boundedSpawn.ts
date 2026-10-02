import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Launch plan for the bounded (non-interactive) command executor. Unlike the
 * interactive PTY launcher this never routes argv through `cmd.exe /c <args>`
 * for ordinary executables, so argument boundaries and metacharacters keep
 * their meaning. It never uses `shell: true`.
 */
export interface BoundedSpawnPlan {
  file: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export interface BoundedSpawnOptions {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  fileExists?: (file: string) => boolean;
}

export class UnsafeBatchArgumentError extends Error {}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const BATCH_EXTENSION = /\.(?:cmd|bat)$/i;
const CMD_META = /[()%!^"<>&|;, ]/g;

function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

/** Resolves a bare command name through PATH and PATHEXT (Windows semantics). */
export function resolveWindowsExecutable(command: string, options: BoundedSpawnOptions): string | null {
  const win = path.win32;
  const exists = options.fileExists ?? ((file) => { try { return fs.statSync(file).isFile(); } catch { return false; } });
  const extensions = (envValue(options.env, 'PATHEXT') || DEFAULT_PATHEXT).split(';').map((ext) => ext.trim()).filter(Boolean);
  const hasKnownExtension = extensions.some((ext) => command.toLowerCase().endsWith(ext.toLowerCase()));
  const names = hasKnownExtension ? [command] : extensions.map((ext) => `${command}${ext}`);
  for (const dir of (envValue(options.env, 'PATH') ?? '').split(';').filter(Boolean)) {
    for (const name of names) {
      const candidate = win.join(dir.replace(/^"|"$/g, ''), name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/** Quotes one argument for a `cmd.exe /d /s /c "..."` line (cross-spawn rules). */
function escapeBatchArgument(arg: string): string {
  let escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  escaped = `"${escaped}"`;
  // A batch shim re-parses its command line, so metacharacters are escaped twice.
  escaped = escaped.replace(CMD_META, '^$&');
  return escaped.replace(CMD_META, '^$&');
}

/**
 * Returns null when the executable cannot be found. `.exe`/`.com` launch
 * directly with Node's own argv quoting. `.cmd`/`.bat` must go through
 * cmd.exe (Node refuses to spawn them directly); arguments are escaped, and
 * arguments that cmd.exe cannot carry safely (`%`, CR/LF) are rejected with
 * UnsafeBatchArgumentError rather than risk expansion or injection.
 */
export function planBoundedSpawn(command: string, args: string[], options: BoundedSpawnOptions): BoundedSpawnPlan | null {
  if (options.platform !== 'win32') return { file: command, args };
  const resolved = resolveWindowsExecutable(command, options);
  if (!resolved) return null;
  if (!BATCH_EXTENSION.test(resolved)) return { file: resolved, args };
  if ([resolved, ...args].some((arg) => /[%\r\n]/.test(arg))) throw new UnsafeBatchArgumentError('Argument cannot be passed safely to a .cmd/.bat file');
  const comspec = envValue(options.env, 'COMSPEC') || 'cmd.exe';
  const line = [`"${resolved}"`, ...args.map(escapeBatchArgument)].join(' ');
  return { file: comspec, args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
}
