import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface HarnessConfig {
  command: string;
  args: string[];
  name: string;
  icon: string;
  env?: Record<string, string>;
  modelArg?: string;
}

const HARNESS_WRAPPER_DIRNAME = '.clanker-grid';
const HARNESS_WRAPPER_FILENAME = 'harness-wrapper.sh';

/**
 * On Windows, harness binaries run directly without a wrapper script.
 * The POSIX shell wrapper handles PATH prepend (~/.local/bin) and fallback
 * shell exec, neither of which applies to Windows/PowerShell.
 */
export const WINDOWS_SKIP_WRAPPER = process.platform === 'win32';

/**
 * Resolve a harness command to a spawnable form.
 *
 * On Linux/macOS, the wrapper script handles PATH prepend and fallback shell.
 * On Windows, npm-installed CLI tools are `.cmd` wrappers that `node-pty`
 * cannot resolve directly — we wrap in `cmd.exe /c` so the command processor
 * handles `.cmd`/`.exe`/`.bat` extension resolution via PATHEXT.
 */
export function resolveHarnessSpawn(
  command: string,
  args: string[],
  wrapperPath: string | null
): { spawnCmd: string; spawnArgs: string[] } {
  if (wrapperPath) {
    // Linux/macOS: use the POSIX wrapper script
    return { spawnCmd: wrapperPath, spawnArgs: [command, ...args] };
  }
  if (process.platform === 'win32') {
    // Windows: wrap in cmd.exe /c so .cmd/.exe/.bat extensions resolve
    return { spawnCmd: 'cmd.exe', spawnArgs: ['/c', command, ...args] };
  }
  // Fallback (shouldn't reach here — wrapperPath is always set on POSIX)
  return { spawnCmd: command, spawnArgs: args };
}

export function buildHarnessSpawnArgs(
  config: HarnessConfig,
  model?: string,
  userFlags?: string
): string[] {
  const args = [...config.args];

  if (userFlags && userFlags.trim()) {
    args.push(...userFlags.trim().split(/\s+/));
  }

  if (model) {
    const modelArg = config.modelArg ?? '--model';
    args.unshift(model);
    args.unshift(modelArg);
  }

  return args;
}

export function getHarnessWrapperScriptPath(homeDir = os.homedir()): string {
  return path.join(homeDir, HARNESS_WRAPPER_DIRNAME, HARNESS_WRAPPER_FILENAME);
}

export function buildHarnessWrapperScript(): string {
  return `#!/usr/bin/env sh
set -eu

# Add ~/.local/bin to PATH for user-installed CLI tools (e.g., Claude, pi)
LOCAL_BIN="$HOME/.local/bin"
case ":$PATH:" in
  *":$LOCAL_BIN:"*) ;;
  *) PATH="$LOCAL_BIN:$PATH" ;;
esac

if [ "$#" -eq 0 ]; then
  echo "[clanker-grid] harness wrapper requires a command" >&2
  exit 1
fi

fallback_shell="\${SHELL:-/bin/bash}"
if [ -n "\${CLANKER_GRID_FALLBACK_SHELL:-}" ]; then
  fallback_shell="$CLANKER_GRID_FALLBACK_SHELL"
fi
if [ ! -x "$fallback_shell" ]; then
  fallback_shell="/bin/bash"
fi

# Run the harness in the foreground so it stays the active PTY job.
# This preserves normal TTY semantics for interactive CLIs and TUIs.
set +e
"$@"
exit_code=$?
set -e

# Preserve the existing product behavior: after the harness exits,
# replace the wrapper with an interactive shell so the terminal stays usable.
exec "$fallback_shell" -i
`;
}

/**
 * Ensure the harness wrapper script exists on disk and is up to date.
 * Returns the wrapper script path on Linux/macOS, or `null` on Windows
 * where harnesses are invoked directly without a wrapper.
 */
export function ensureHarnessWrapperScript(homeDir = os.homedir()): string | null {
  if (WINDOWS_SKIP_WRAPPER) {
    return null;
  }

  const wrapperPath = getHarnessWrapperScriptPath(homeDir);
  const wrapperDir = path.dirname(wrapperPath);
  const wrapperScript = buildHarnessWrapperScript();

  fs.mkdirSync(wrapperDir, { recursive: true });

  const existing = fs.existsSync(wrapperPath)
    ? fs.readFileSync(wrapperPath, 'utf8')
    : null;

  if (existing !== wrapperScript) {
    fs.writeFileSync(wrapperPath, wrapperScript, { encoding: 'utf8', mode: 0o700 });
  }

  fs.chmodSync(wrapperPath, 0o700);

  return wrapperPath;
}

export function normalizePiModelId(provider: string, model: string): string {
  return `${provider}/${model}`;
}
