export const OBSERVER = `import net from 'node:net';
export async function emit(event, sessionId, turnId) {
  const port = Number(process.env.CLANKER_ATTENTION_PORT);
  const token = process.env.CLANKER_ATTENTION_TOKEN;
  const harness = process.env.CLANKER_ATTENTION_HARNESS;
  if (!token || !harness || !Number.isInteger(port) || port < 1) return false;
  const payload = JSON.stringify({ version: 1, token, harness, event,
    ...(typeof sessionId === 'string' ? { sessionId: sessionId.slice(0, 128) } : {}),
    ...(typeof turnId === 'string' ? { turnId: turnId.slice(0, 128) } : {}) });
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => socket.end(payload));
    let acknowledged = false;
    socket.on('data', (chunk) => { if (chunk.toString('utf8') === 'ok') acknowledged = true; });
    socket.setTimeout(500, () => socket.destroy());
    socket.on('error', () => resolve(false));
    socket.on('close', () => resolve(acknowledged));
  });
}
`;

export const COMMAND = `import { emit } from './observer.mjs';
if (process.argv[2] === '--ended') {
  process.exit(await emit('session_ended') ? 0 : 1);
}
let input = {};
const agyHook = process.argv[2] && process.argv[2] !== '--ended' && !process.argv[2].startsWith('{')
  ? process.argv[2]
  : null;
try {
  if (process.argv[2] && !agyHook) input = JSON.parse(process.argv[2].slice(0, 65536));
  else {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 65536) break;
      chunks.push(chunk);
    }
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
} catch { /* malformed hook input is ignored */ }
const hook = agyHook || input.hook_event_name;
const notification = input.notification_type;
const toolName = input.toolCall?.name;
const isAskTool = toolName === 'ask_question' || toolName === 'ask_permission' || toolName === 'notify_user';
const event = input.type === 'agent-turn-complete' || hook === 'Stop' ? 'turn_completed'
  : hook === 'UserPromptSubmit' || (agyHook === 'PreInvocation' && input.invocationNum === 0) ? 'turn_started'
  : (hook === 'Notification' && (notification === 'permission_prompt' || notification === 'agent_needs_input')) || (agyHook === 'PreToolUse' && isAskTool) ? 'input_requested'
  : (hook === 'PostToolUse' && (!agyHook || isAskTool)) ? 'input_resolved'
  : hook === 'SessionEnd' ? 'session_ended'
  : null;
const sessionId = input.conversationId || input.sessionId || input.session_id || input['thread-id'];
const turnId = input.turn_id || input['turn-id'];
if (event) await emit(event, sessionId, turnId);
if (agyHook === 'PreToolUse' && isAskTool) {
  process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\\n');
} else {
  process.stdout.write('{}\\n');
}
`;
