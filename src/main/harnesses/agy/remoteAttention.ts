import type { HarnessRemoteAttention } from '../types';
import { agyAttentionPlugin } from './attentionPlugin';

const REMOTE_COMMAND = '$CLANKER_REMOTE_ATTENTION_COMMAND';
// The launch root holds the interpreter beside the command bridge.
const REMOTE_INTERPRETER = '$(dirname "$CLANKER_REMOTE_ATTENTION_COMMAND")/interpreter.mjs';

/** The persistent plugin must be inert for ordinary host launches, including ask tools. */
function guardHooks(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.command === 'string') {
    record.command = `if [ -n "$CLANKER_REMOTE_ATTENTION_TOKEN" ] && [ "$CLANKER_REMOTE_ATTENTION_HARNESS" = agy ] && [ -n "$CLANKER_REMOTE_ATTENTION_COMMAND" ] && [ -r "$CLANKER_REMOTE_ATTENTION_COMMAND" ]; then ${record.command}; else printf '{}\\n'; fi`;
  }
  Object.values(record).forEach(guardHooks);
}

/** Previously installed owned hook payloads (before interpreters), upgraded only on exact match. */
export function legacyHooks(guarded: boolean): string {
  const hook = (name: string) => `node "${REMOTE_COMMAND}" ${name}`;
  const tools = 'ask_question|ask_permission|notify_user';
  const hooks = { 'clanker-attention': {
    PreInvocation: [{ type: 'command', command: hook('PreInvocation'), timeout: 10 }],
    PostInvocation: [{ type: 'command', command: hook('PostInvocation'), timeout: 10 }],
    PreToolUse: [{ matcher: tools, hooks: [{ type: 'command', command: hook('PreToolUse'), timeout: 10 }] }],
    PostToolUse: [{ matcher: tools, hooks: [{ type: 'command', command: hook('PostToolUse'), timeout: 10 }] }],
    Stop: [{ type: 'command', command: hook('Stop'), timeout: 10 }],
  } };
  if (guarded) guardHooks(hooks);
  return JSON.stringify(hooks);
}

function plugin() {
  const agy = agyAttentionPlugin(REMOTE_COMMAND, REMOTE_INTERPRETER, 'linux');
  agy.pluginJson.name = 'clanker-grid-remote-attention';
  guardHooks(agy.hooksJson);
  return { parts: ['.gemini', 'config', 'plugins', 'clanker-grid-remote-attention'],
    files: { 'plugin.json': JSON.stringify(agy.pluginJson), 'hooks.json': JSON.stringify(agy.hooksJson) },
    upgradeFile: 'hooks.json', legacyFiles: [legacyHooks(false), legacyHooks(true)] };
}
export const remote: HarnessRemoteAttention = {
  requiresNode: true,
  validate: ``,
  configure: ``,
  plugin,
};
