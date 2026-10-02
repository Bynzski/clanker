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

/** Conflicts with the user's own hook configuration degrade to unavailable, never to a merge. */
export function codexHooksConflict(configToml: string, hooksJson: string): boolean {
  const events = CODEX_HOOK_EVENTS.join('|');
  return /^\s*\[hooks\]/m.test(configToml)
    || new RegExp(`^\\s*\\[\\[?hooks\\.(?:${events})\\b`, 'm').test(configToml)
    || new RegExp(`"(?:${events})"`).test(hooksJson);
}

export function codexHookOverrides(command: string, interpreter: string, platform: NodeJS.Platform): string[] {
  return CODEX_HOOK_EVENTS.flatMap((name) => {
    const hookCommand = `${hookNodeExecutable(platform)} "${command}" "${interpreter}" ${name}`;
    return ['-c', `hooks.${name}=[{hooks=[{type="command",command=${JSON.stringify(hookCommand)},timeout=2}]}]`];
  });
}

export const local = localAttention(({ args, env, files: adapterFiles, platform }) => {
    const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const read = (name: string) => { try { return fs.readFileSync(path.join(home, name), 'utf8'); } catch { return ''; } };
    if (codexHooksConflict(read('config.toml'), read('hooks.json'))
      || args.some((arg) => /(?:^|\.)hooks[.=]/.test(arg) || arg === '-p' || arg === '--profile')) return null;
    const configArgs = codexHookOverrides(adapterFiles.command, interpreterPath(adapterFiles), platform);
    const subcommandIndex = args.findIndex((arg) => arg === 'resume' || arg === 'fork');
    return { args: subcommandIndex < 0
      ? [...configArgs, ...args]
      : [...args.slice(0, subcommandIndex), ...configArgs, ...args.slice(subcommandIndex)], env: {} };

});
