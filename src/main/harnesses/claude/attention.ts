import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AttentionAdapterFiles } from '../types';
import { localAttention, hookNodeExecutable, interpreterPath } from '../localAttention';

export const CLAUDE_HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolBatch', 'Stop', 'StopFailure', 'SessionEnd', 'CwdChanged'] as const;

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
 * - Settlement: root `Stop` is only a candidate; another Stop hook may continue the turn.
 *   A later root PreToolUse with the same prompt_id proves resumed activity (not a new turn).
 *   PostToolBatch alone may resolve an old batch, so does not restore Running.
 *   No documented post-decision hook proves settlement. Report that limitation, never Done.
 *   `StopFailure` is explicit failure evidence and becomes `turn_failed`, never a completion;
 *   the error is never forwarded. Neither background task counts nor crons prove settlement.
 *   Claude has no user-interrupt hook, so an interrupted turn stays Running until the next prompt.
 * `Notification` is unused: no turn or request identity.
 * - Location: every hook carries `cwd`, Claude's tracked working directory, which a Bash `cd` moves
 *   while the process itself never changes directory (an agent can leave, and even remove, the
 *   worktree it was launched in). `CwdChanged` (`old_cwd`/`new_cwd`) reports each move as
 *   `location_changed`; the turn boundaries (`UserPromptSubmit`, `StopFailure`, `SessionEnd`)
 *   carry `cwd` too, so a reordered move is corrected at the latest when the turn ends. Mid-turn tool
 *   hooks never carry it, and a subagent (`agent_id`) never moves the root agent's location. */
export const INTERPRETER = `const text = (value) => typeof value === 'string' && value ? value : undefined;
export default function interpret(input, hook, store) {
  const sessionId = text(input.session_id);
  const turnId = text(input.prompt_id);
  const scope = input.agent_id ? 'child' : 'root';
  const event = (type, fields) => ({ event: { type, scope, sessionId, nativeEvent: hook, ...fields } });
  const cwd = scope === 'root' ? text(input.cwd) : undefined;
  if (scope === 'child') {
    // Child activity is reported only so the broker can record why it was ignored; it never touches state.
    const mapped = { PermissionRequest: 'input_requested', PostToolBatch: 'input_resolved', StopFailure: 'turn_failed' }[hook];
    return mapped ? event(mapped, { turnId, inputId: 'permission' }) : null;
  }
  if (hook === 'CwdChanged') {
    const moved = text(input.new_cwd) ?? cwd;
    return moved ? event('location_changed', { cwd: moved }) : null;
  }
  const state = store.read();
  const sameSession = !state.session || state.session === sessionId;
  const current = sameSession && turnId !== undefined && state.turn === turnId;
  const settle = (type) => { if (current) store.write({ session: sessionId, turn: turnId, pending: false }); return event(type, { turnId, cwd }); };
  switch (hook) {
    case 'UserPromptSubmit':
      store.write({ session: sessionId, turn: turnId, pending: false });
      return event('turn_started', { turnId, cwd });
    case 'PreToolUse':
      if (!current || !turnId || !text(input.tool_name)) return null;
      if (input.tool_name !== 'AskUserQuestion') {
        // Root prompt identity proves activity in the SAME turn after a candidate Stop.
        // Keep the superseded wait marker until a batch/request boundary resolves it.
        if (!state.provisional) return null;
        return event('turn_activity', { turnId });
      }
      // AskUserQuestion is intrinsically interactive and may need no permission approval.
      // Its enclosing batch is the native resolution boundary, just like an approval wait.
      if (state.pending && !state.provisional) return null;
      store.write({ session: sessionId, turn: turnId, pending: true });
      return event('input_requested', { turnId, inputId: 'permission', requestKind: 'input' });
    case 'PermissionRequest':
      if (!current) return event('input_requested', { turnId, inputId: 'permission', requestKind: 'approval' });
      if (state.pending && !state.provisional) return null;
      store.write({ session: sessionId, turn: turnId, pending: true });
      return event('input_requested', { turnId, inputId: 'permission', requestKind: 'approval' });
    case 'PostToolBatch':
      if (!current || !state.pending) return null;
      store.write({ ...state, pending: false });
      return event('input_resolved', { turnId, inputId: 'permission' });
    case 'Stop':
      // Every Stop hook sees a candidate BEFORE other hooks may block/continue it.
      // Publish uncertainty, keeping correlation without claiming work or actionable input.
      if (!current) return null;
      store.write({ ...state, provisional: true });
      return event('turn_provisional', { turnId });
    case 'StopFailure':
      return settle('turn_failed');
    case 'SessionEnd':
      if (!sameSession) return null;
      store.write({});
      return event('session_ended', { cwd });
    default: return null;
  }
}
`;

export function claudeAttentionSettings(command: string, platform: NodeJS.Platform, interpreter: string): {
  hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string; args: string[]; timeout: number }> }>>;
} {
  const nodeCommand = hookNodeExecutable(platform);
  const hooks = Object.fromEntries(CLAUDE_HOOK_EVENTS.map((name) => [
    name, [{ hooks: [{ type: 'command', command: nodeCommand, args: [command, interpreter, name], timeout: 3 }] }],
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
