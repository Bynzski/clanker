import { localAttention, hookNodeExecutable, interpreterPath } from '../localAttention';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Native Codex lifecycle hooks. Legacy `notify` is deliberately unused: it can report
 * hidden auxiliary completions and carries no root/subagent distinction. */
export const CODEX_HOOK_EVENTS = ['UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'Stop', 'SubagentStop', 'SessionEnd'] as const;

/** Provider-owned meaning of native hook events. Root `Stop` settles the turn;
 * `SubagentStop` is reported as child scope and can never settle the pane. */
export const INTERPRETER = `export default function interpret(input, hook) {
  const sessionId = typeof input.session_id === 'string' ? input.session_id : undefined;
  const turnId = typeof input.turn_id === 'string' ? input.turn_id : undefined;
  const scope = hook === 'SubagentStop' || input.agent_id ? 'child' : 'root';
  const toolName = typeof input.tool_name === 'string' ? input.tool_name : undefined;
  const event = (type, fields) => ({ event: { type, scope, sessionId, nativeEvent: hook, ...fields } });
  switch (hook) {
    case 'UserPromptSubmit': return event('turn_started', { turnId });
    case 'PermissionRequest': return event('input_requested', { turnId, inputId: toolName });
    case 'PostToolUse': return event('input_resolved', { turnId, inputId: toolName });
    case 'Stop':
    case 'SubagentStop': return event('turn_completed', { turnId });
    case 'SessionEnd': return event('session_ended');
    default: return null;
  }
}
`;

/** A `-c`/`--config` key path that touches hooks or the active profile: the user owns it. */
export const CODEX_OWNED_CONFIG_KEY = /(?:^|\.)\s*(?:hooks\s*\.|(?:hooks|profile)\s*=)/;

/** Command-line forms Codex accepts (`-c k=v`, `-ck=v`, `--config k=v`, `--config=k=v`, `-p x`,
 * `-px`, `--profile x`, `--profile=x`). Remote preparation mirrors this parser in Python. */
export function codexArgsConflict(args: string[]): boolean {
  const overrides: string[] = [];
  args.forEach((arg, index) => {
    if ((arg === '-c' || arg === '--config') && index + 1 < args.length) overrides.push(args[index + 1]);
    else if (arg.startsWith('--config=')) overrides.push(arg.slice('--config='.length));
    else if (arg.startsWith('-c') && !arg.startsWith('--') && arg !== '-c') overrides.push(arg.slice(2));
  });
  const profile = args.some((arg) => arg === '-p' || arg === '--profile' || arg.startsWith('--profile=')
    || (arg.startsWith('-p') && !arg.startsWith('--')));
  return profile || overrides.some((value) => CODEX_OWNED_CONFIG_KEY.test(value));
}

/** Conflicts with the user's own hook or profile configuration degrade to unavailable, never to a merge. */
export function codexHooksConflict(configToml: string, hooksJson: string): boolean {
  const events = CODEX_HOOK_EVENTS.join('|');
  return /^\s*\[hooks\]/m.test(configToml)
    || /^\s*profile\s*=/m.test(configToml)
    || new RegExp(`^\\s*\\[\\[?hooks\\.(?:${events})\\b`, 'm').test(configToml)
    || new RegExp(`"(?:${events})"`).test(hooksJson);
}

/** Codex runs non-managed hooks only after the user reviews them, keyed by the hook definition.
 * A command text containing this launch's temp paths would change every launch and never stay
 * trusted, so POSIX hooks name the launch resources through the environment instead, which
 * keeps the definition stable. (Windows `cmd /C` does not expand `$VAR`, so it embeds paths.) */
export const CODEX_STABLE_HOOK_COMMAND = (name: string, prefix = 'CLANKER_ATTENTION') =>
  `node "$${prefix}_COMMAND" "$${prefix}_INTERPRETER" ${name}`;

export function codexHookOverrides(command: string, interpreter: string, platform: NodeJS.Platform): string[] {
  return CODEX_HOOK_EVENTS.flatMap((name) => {
    const hookCommand = platform === 'win32'
      ? `${hookNodeExecutable(platform)} "${command}" "${interpreter}" ${name}`
      : CODEX_STABLE_HOOK_COMMAND(name);
    return ['-c', `hooks.${name}=[{hooks=[{type="command",command=${JSON.stringify(hookCommand)},timeout=2}]}]`];
  });
}

export const local = localAttention(({ args, env, files: adapterFiles, platform }) => {
    const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const read = (name: string) => { try { return fs.readFileSync(path.join(home, name), 'utf8'); } catch { return ''; } };
    if (codexHooksConflict(read('config.toml'), read('hooks.json'))
      || codexArgsConflict(args)) return null;
    const interpreter = interpreterPath(adapterFiles);
    const configArgs = codexHookOverrides(adapterFiles.command, interpreter, platform);
    const subcommandIndex = args.findIndex((arg) => arg === 'resume' || arg === 'fork');
    const launchEnv: Record<string, string> = platform === 'win32' ? {} : { CLANKER_ATTENTION_INTERPRETER: interpreter };
    return { args: subcommandIndex < 0
      ? [...configArgs, ...args]
      : [...args.slice(0, subcommandIndex), ...configArgs, ...args.slice(subcommandIndex)],
      env: launchEnv };

});
