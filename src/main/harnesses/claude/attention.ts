import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention, hookNodeExecutable, interpreterPath } from '../localAttention';

export const CLAUDE_HOOK_EVENTS = ['UserPromptSubmit', 'PermissionRequest', 'PostToolBatch', 'Stop', 'StopFailure', 'SessionEnd'] as const;

/** Provider-owned meaning of Claude hooks (fields per the Claude Code hooks reference):
 * - root identity `session_id`; turn identity `prompt_id` (Claude Code >= 2.1.196); child scope:
 *   presence of `agent_id` (hooks also run inside subagents). Events without `prompt_id` are not
 *   reported.
 * - Input wait: `PermissionRequest` has `tool_name`/`tool_input` but NO `tool_use_id`, so no exact
 *   native request identity exists. The wait is turn-level state: the interpreter records in the
 *   bridge store that this `prompt_id` has an outstanding permission wait (a boolean; tool input
 *   never leaves the hook) and reports the constant `inputId` 'permission'.
 * - Resolution: `PostToolBatch`, which fires once after every call in the parallel batch has
 *   resolved. A per-tool `PostToolUse` is not subscribed, so an unrelated parallel tool finishing
 *   can never clear a wait. Cost: after an approval the pane stays Needs Input until the batch
 *   ends, and a denied call resolves with its batch.
 * - Settled: root `Stop` while `background_tasks` and `session_crons` are empty, or `StopFailure`
 *   (the turn ended on an API error: the foreground is settled, not necessarily successful; the
 *   error is never forwarded). Claude has no user-interrupt hook, so an interrupted turn stays
 *   Running until the next prompt.
 * `Notification` is unused: no turn or request identity. */
export const INTERPRETER = `const busy = (value) => Array.isArray(value) ? value.length > 0
  : typeof value === 'number' ? value > 0
  : value && typeof value === 'object' ? Object.keys(value).length > 0 : value === true;
const text = (value) => typeof value === 'string' && value ? value : undefined;
export default function interpret(input, hook, store) {
  const sessionId = text(input.session_id);
  const turnId = text(input.prompt_id);
  const scope = input.agent_id ? 'child' : 'root';
  const event = (type, fields) => ({ event: { type, scope, sessionId, nativeEvent: hook, ...fields } });
  if (scope === 'child') {
    // Child activity is reported only so the broker can record why it was ignored; it never touches state.
    const mapped = { PermissionRequest: 'input_requested', PostToolBatch: 'input_resolved', StopFailure: 'turn_completed' }[hook];
    return mapped ? event(mapped, { turnId, inputId: 'permission' }) : null;
  }
  const state = store.read();
  const current = turnId !== undefined && state.turn === turnId;
  const settle = () => { store.write({ turn: turnId, pending: false }); return event('turn_completed', { turnId }); };
  switch (hook) {
    case 'UserPromptSubmit':
      store.write({ turn: turnId, pending: false });
      return event('turn_started', { turnId });
    case 'PermissionRequest':
      if (!current) return event('input_requested', { turnId, inputId: 'permission' });
      if (state.pending) return null;
      store.write({ turn: turnId, pending: true });
      return event('input_requested', { turnId, inputId: 'permission' });
    case 'PostToolBatch':
      if (!current || !state.pending) return null;
      store.write({ turn: turnId, pending: false });
      return event('input_resolved', { turnId, inputId: 'permission' });
    case 'Stop':
      return busy(input.background_tasks) || busy(input.session_crons) ? null : settle();
    case 'StopFailure':
      return settle();
    case 'SessionEnd':
      store.write({});
      return event('session_ended');
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
