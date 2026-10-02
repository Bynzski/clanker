/** Shared observer helpers. Providers own the meaning of native events; shared
 * code only bounds and forwards the sanitized canonical envelope. */
export const OBSERVER_FIELDS = `const IDENTIFIERS = ['sessionId', 'turnId', 'inputId'];
function envelope(event, fields) {
  const extra = {};
  for (const key of IDENTIFIERS) {
    if (typeof fields?.[key] === 'string' && fields[key]) extra[key] = fields[key].slice(0, 128);
  }
  if (fields?.scope === 'root' || fields?.scope === 'child') extra.scope = fields.scope;
  if (typeof fields?.nativeEvent === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(fields.nativeEvent)) extra.nativeEvent = fields.nativeEvent;
  return { event, ...extra };
}
`;

export const OBSERVER = `import net from 'node:net';
${OBSERVER_FIELDS}
export async function emit(event, fields) {
  const port = Number(process.env.CLANKER_ATTENTION_PORT);
  const token = process.env.CLANKER_ATTENTION_TOKEN;
  const harness = process.env.CLANKER_ATTENTION_HARNESS;
  if (!token || !harness || !Number.isInteger(port) || port < 1) return false;
  const payload = JSON.stringify({ version: 1, token, harness, ...envelope(event, fields) });
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

/** Generic hook bridge. The interpreter receives `(input, hook, store)`;
 * `store` is a tiny per-terminal JSON state for epoch bookkeeping.
 * `command.mjs --ended` reports that the harness process
 * exited. Otherwise argv[2] is the provider-owned interpreter module, which maps
 * the native hook payload to a canonical lifecycle event (or nothing). */
export const COMMAND = `import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { emit } from './observer.mjs';
if (process.argv[2] === '--ended') {
  process.exit(await emit('agent_exited') ? 0 : 1);
}
let input = {};
try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 65536) break;
    chunks.push(chunk);
  }
  input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch { /* malformed hook input is ignored */ }
// Hook commands are separate short-lived processes. Interpreters that need a foreground-turn
// epoch keep it in a private per-terminal file beside this bridge (removed with the launch root).
const token = process.env.CLANKER_ATTENTION_TOKEN || process.env.CLANKER_REMOTE_ATTENTION_TOKEN || '';
const statePath = path.join(path.dirname(process.argv[1]), '.clanker-state-' + createHash('sha256').update(token).digest('hex').slice(0, 16) + '.json');
const store = {
  read() {
    try {
      const value = JSON.parse(fs.readFileSync(statePath, 'utf8').slice(0, 4096));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  },
  write(value) {
    try {
      const text = JSON.stringify(value);
      if (text.length <= 4096) fs.writeFileSync(statePath, text, { mode: 0o600 });
    } catch { /* an unwritable store fails closed: later events lack a live turn */ }
  },
};
let result = null;
try {
  const interpreter = await import(pathToFileURL(process.argv[2]).href);
  result = interpreter.default(input, process.argv[3], store);
} catch { /* an unreadable interpreter emits nothing */ }
if (result?.event) {
  const { type, ...fields } = result.event;
  await emit(type, fields);
}
process.stdout.write(JSON.stringify(result?.output ?? {}) + '\\n');
`;
