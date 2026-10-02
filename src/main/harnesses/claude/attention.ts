import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention, hookNodeExecutable, interpreterPath } from '../localAttention';

export const CLAUDE_HOOK_EVENTS = ['UserPromptSubmit', 'PermissionRequest', 'Stop', 'PostToolUse', 'Notification', 'SessionEnd'] as const;

/** Provider-owned meaning of Claude hooks. Child (`agent_id`) events cannot affect the
 * root, `PermissionRequest` is the direct input wait, and `Stop` settles only when
 * provider-reported background work and session crons are idle. */
export const INTERPRETER = `const busy = (value) => Array.isArray(value) ? value.length > 0
  : typeof value === 'number' ? value > 0
  : value && typeof value === 'object' ? Object.keys(value).length > 0 : value === true;
export default function interpret(input, hook) {
  const sessionId = typeof input.session_id === 'string' ? input.session_id : undefined;
  const scope = input.agent_id ? 'child' : 'root';
  const toolName = typeof input.tool_name === 'string' ? input.tool_name : undefined;
  const event = (type, fields) => ({ event: { type, scope, sessionId, nativeEvent: hook, ...fields } });
  switch (hook) {
    case 'UserPromptSubmit': return event('turn_started');
    case 'PermissionRequest': return event('input_requested', { inputId: toolName });
    case 'Notification':
      return input.notification_type === 'agent_needs_input' ? event('input_requested') : null;
    case 'PostToolUse': return event('input_resolved', { inputId: toolName });
    case 'Stop':
      return busy(input.background_tasks) || busy(input.session_crons) ? null : event('turn_completed');
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
