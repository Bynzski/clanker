import { localAttention, hookNodeExecutable, interpreterPath } from '../localAttention';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Native Codex lifecycle hooks. Legacy `notify` is deliberately unused: it can report
 * hidden auxiliary completions and carries no root/subagent distinction. */
export const CODEX_HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'SubagentStop', 'Interrupt', 'SessionEnd'] as const;

/** Provider-owned meaning of native hook events (fields per the Codex hooks source).
 * - root identity `session_id`; turn identity `turn_id`; child scope: `SubagentStop` or `agent_id`.
 * - Settled: root `Stop`. User cancel: root `Interrupt` (`turn_interrupted`, never a completion).
 * - Input wait: `PermissionRequest` has `turn_id`, `tool_name`, `tool_input` and NO `tool_use_id`,
 *   while `PreToolUse` and `PostToolUse` carry `tool_use_id`. The interpreter correlates them in
 *   the bridge store, keeping only bounded derived data (tool_use_ids and a 16-hex fingerprint of
 *   tool_name + canonical tool_input; the input itself is never stored, sent or logged):
 *     PreToolUse        -> remember {tool_use_id, fingerprint}
 *     PermissionRequest -> a wait on every remembered, unfinished call with the same fingerprint
 *                          (identical parallel calls form one group); no match = an unresolvable
 *                          wait, which fails closed until the turn ends
 *     PostToolUse       -> mark the call done; a wait resolves only when ALL its calls are done
 *   The broker sees one `input_requested` for the first wait and one `input_resolved` once no wait
 *   remains, so an unrelated tool finishing cannot clear a real wait. A call the user denies runs
 *   no PostToolUse, so its wait lasts until Stop or Interrupt. More than 16 live waits put the
 *   state in overflow: nothing resolves until the turn ends (live waits are never dropped).
 *   The bridge serializes each read/interpret/write transaction per terminal. */
export const INTERPRETER = `import { createHash } from 'node:crypto';
const text = (value) => typeof value === 'string' && value ? value : undefined;
const canonical = (value) => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const fingerprint = (input) => createHash('sha256').update(String(input.tool_name) + '\\0' + canonical(input.tool_input ?? null)).digest('hex').slice(0, 16);
// Bounds. calls (32) and done (64) hold completed-call bookkeeping: dropping the oldest can only
// leave a wait unmatched or unresolved, which fails closed (Needs Input until the turn ends).
// waits (16) hold live human waits and are NEVER trimmed: past the cap the state goes to
// 'overflow', where no individual PostToolUse may resolve anything until the turn ends.
const MAX_WAITS = 16;
const keep = (list, limit) => list.slice(-limit);
export default function interpret(input, hook, store) {
  const sessionId = text(input.session_id);
  const turnId = text(input.turn_id);
  const scope = hook === 'SubagentStop' || input.agent_id ? 'child' : 'root';
  const event = (type, fields) => ({ event: { type, scope, sessionId, nativeEvent: hook, ...fields } });
  if (scope === 'child') {
    // Child activity is reported only so the broker can record why it was ignored; it never touches state.
    const mapped = { SubagentStop: 'turn_completed', PermissionRequest: 'input_requested', PostToolUse: 'input_resolved' }[hook];
    return mapped ? event(mapped, { turnId, inputId: 'w0' }) : null;
  }
  const stored = store.read();
  const current = turnId !== undefined && stored.turn === turnId;
  const state = current ? stored : { turn: turnId, calls: [], done: [], waits: [], seq: stored.seq ?? 0 };
  const save = () => { if (current || hook === 'UserPromptSubmit') store.write(state); };
  const reset = () => store.write({ turn: undefined, calls: [], done: [], waits: [], seq: state.seq });
  switch (hook) {
    case 'UserPromptSubmit':
      save();
      return event('turn_started', { turnId });
    case 'PreToolUse':
      if (!current || !text(input.tool_use_id)) return null;
      state.calls = keep([...state.calls, { id: input.tool_use_id, fp: fingerprint(input) }], 32);
      save();
      return null;
    case 'PermissionRequest': {
      if (!current) return event('input_requested', { turnId, inputId: 'w0' });
      const fp = fingerprint(input);
      const ids = state.calls.filter((call) => call.fp === fp && !state.done.includes(call.id)).map((call) => call.id);
      const first = state.waits.length === 0 && !state.overflow;
      if (state.waits.length >= MAX_WAITS) state.overflow = true;
      else state.waits = [...state.waits, { ids }];
      if (first) state.input = 'w' + (state.seq += 1);
      save();
      return first ? event('input_requested', { turnId, inputId: state.input }) : null;
    }
    case 'PostToolUse': {
      const id = text(input.tool_use_id);
      if (!current || !id) return null;
      const had = state.waits.length > 0;
      state.done = keep([...state.done, id], 64);
      state.waits = state.waits.filter((wait) => wait.ids.length === 0 || !wait.ids.every((call) => state.done.includes(call)));
      const resolved = had && state.waits.length === 0 && !state.overflow;
      const inputId = state.input;
      if (resolved) state.input = undefined;
      save();
      return resolved ? event('input_resolved', { turnId, inputId }) : null;
    }
    case 'Stop':
      if (current) reset();
      return event('turn_completed', { turnId });
    case 'Interrupt':
      if (current) reset();
      return event('turn_interrupted', { turnId });
    case 'SessionEnd':
      reset();
      return event('session_ended');
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
    return ['-c', `hooks.${name}=[{hooks=[{type="command",command=${JSON.stringify(hookCommand)},timeout=3}]}]`];
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
