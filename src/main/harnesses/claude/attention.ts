import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention, hookNodeExecutable, interpreterPath } from '../localAttention';

export const CLAUDE_HOOK_EVENTS = ['UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'PermissionDenied', 'Stop', 'SessionEnd'] as const;

/** Provider-owned meaning of Claude hooks (hook input fields per the Claude Code hooks reference):
 * - root identity: `session_id`; child scope: presence of `agent_id` (subagent hooks carry it);
 * - turn identity: `prompt_id` (UUID of the prompt being processed, Claude Code >= 2.1.196);
 *   an event without one cannot be correlated and is not reported;
 * - input wait: `PermissionRequest`, identified by `tool_use_id`; resolved only by the same
 *   `tool_use_id` finishing (`PostToolUse`, `PostToolUseFailure`) or being denied (`PermissionDenied`);
 * - settled: root `Stop` while `background_tasks` and `session_crons` are empty.
 * `Notification` is deliberately unused: its payload has no turn or request identity, so it
 * cannot prove a root input wait. */
export const INTERPRETER = `const busy = (value) => Array.isArray(value) ? value.length > 0
  : typeof value === 'number' ? value > 0
  : value && typeof value === 'object' ? Object.keys(value).length > 0 : value === true;
const text = (value) => typeof value === 'string' && value ? value : undefined;
export default function interpret(input, hook) {
  const sessionId = text(input.session_id);
  const turnId = text(input.prompt_id);
  const scope = input.agent_id ? 'child' : 'root';
  const inputId = text(input.tool_use_id);
  const event = (type, fields) => ({ event: { type, scope, sessionId, nativeEvent: hook, ...fields } });
  switch (hook) {
    case 'UserPromptSubmit': return event('turn_started', { turnId });
    case 'PermissionRequest': return inputId ? event('input_requested', { turnId, inputId }) : null;
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionDenied': return inputId ? event('input_resolved', { turnId, inputId }) : null;
    case 'Stop':
      return busy(input.background_tasks) || busy(input.session_crons) ? null : event('turn_completed', { turnId });
    case 'SessionEnd': return event('session_ended');
    default: return null;
  }
}
`;

export function claudeAttentionSettings(command: string, platform: NodeJS.Platform, interpreter: string): {
  hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string; args: string[]; timeout: number }> }>>;
} {
  const nodeCommand = hookNodeExecutable(platform);
  const hooks = Object.fromEntries(CLAUDE_HOOK_EVENTS.map((name) => [
    name, [{ hooks: [{ type: 'command', command: nodeCommand, args: [command, interpreter, name], timeout: 2 }] }],
  ]));
  return { hooks };
}


export const local = localAttention(({ args, files: adapterFiles }) => {
    if (args.some((arg) => arg === '--bare' || arg === '--safe-mode' || arg.startsWith('--settings'))) return null;
    return { args: [...args, '--settings', path.join(adapterFiles.resourceRoot ?? path.dirname(adapterFiles.command), 'claude-settings.json')], env: {} };

});

export function prepareResources(files: AttentionAdapterFiles): void {
  fs.writeFileSync(path.join(files.resourceRoot ?? path.dirname(files.command), 'claude-settings.json'), JSON.stringify(claudeAttentionSettings(files.command, process.platform, interpreterPath(files))), { mode: 0o600 });
}
