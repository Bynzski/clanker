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

export function ensureHarnessWrapperScript(homeDir = os.homedir()): string {
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
