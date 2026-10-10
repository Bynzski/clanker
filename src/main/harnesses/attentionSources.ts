import { HOOK_DIAGNOSTICS, MAX_NATIVE_HOOK_BYTES } from '../../shared/types/attentionSignal';
import { ATTENTION_ACK_PREFIX, ATTENTION_VERDICTS, MAX_ATTENTION_ACK_BYTES } from '../../shared/attentionProtocol';
import { MAX_AGENT_LOCATION_BYTES } from '../agentLocation';

/** Shared observer helpers. Providers own the meaning of native events; shared
 * code only bounds and forwards the sanitized canonical envelope. A reported working directory
 * (`cwd`) that is not bounded and printable is dropped on its own: the lifecycle event still goes. */
export const OBSERVER_FIELDS = `const IDENTIFIERS = ['sessionId', 'turnId', 'inputId', 'continuesSessionId', 'previousSessionId'];
function envelope(event, fields) {
  const extra = {};
  for (const key of IDENTIFIERS) {
    if (typeof fields?.[key] === 'string' && fields[key]) extra[key] = fields[key].slice(0, 128);
  }
  if (${JSON.stringify(HOOK_DIAGNOSTICS)}.includes(fields?.diagnostic)) extra.diagnostic = fields.diagnostic;
  if (fields?.scope === 'root' || fields?.scope === 'child') extra.scope = fields.scope;
  if (fields?.requestKind === 'input' || fields?.requestKind === 'approval') extra.requestKind = fields.requestKind;
  if (typeof fields?.nativeEvent === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(fields.nativeEvent)) extra.nativeEvent = fields.nativeEvent;
  if (typeof fields?.cwd === 'string' && fields.cwd && Buffer.byteLength(fields.cwd) <= ${MAX_AGENT_LOCATION_BYTES} && !/[\\u0000-\\u001f\\u007f]/.test(fields.cwd)) extra.cwd = fields.cwd;
  return { event, ...extra };
}
`;

/** emit keeps the provider-facing boolean API; the serialized command requests a detailed
 * verdict so ignored events neither poison state nor count as an accepted recovery boundary.
 * Old/unframed ACKs fail closed. TCP chunk boundaries have no protocol meaning. */
export const OBSERVER = `import net from 'node:net';
${OBSERVER_FIELDS}
export async function emit(event, fields, detailed = false) {
  const port = Number(process.env.CLANKER_ATTENTION_PORT);
  const token = process.env.CLANKER_ATTENTION_TOKEN;
  const harness = process.env.CLANKER_ATTENTION_HARNESS;
  if (!token || !harness || !Number.isInteger(port) || port < 1 || port > 65535) return false;
  const payload = JSON.stringify({ version: 1, token, harness, ...envelope(event, fields) });
  const verdict = await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => socket.end(payload));
    let response = '';
    let ended = false;
    let invalid = false;
    const deadline = setTimeout(() => socket.destroy(), 500);
    socket.on('data', (chunk) => {
      if (Buffer.byteLength(response) + chunk.length > ${MAX_ATTENTION_ACK_BYTES}) { invalid = true; socket.destroy(); return; }
      response += chunk.toString('utf8');
    });
    socket.on('end', () => { ended = true; });
    socket.on('error', () => resolve(false));
    socket.on('close', () => {
      clearTimeout(deadline);
      const prefix = ${JSON.stringify(ATTENTION_ACK_PREFIX)};
      const value = response.slice(prefix.length, -1);
      resolve(!invalid && ended && response.startsWith(prefix) && response.endsWith('\\n') && ${JSON.stringify(ATTENTION_VERDICTS)}.includes(value) ? value : false);
    });
  });
  return detailed ? verdict : verdict === 'accepted-changed' || verdict === 'accepted-idempotent';
}
`;

/** Generic hook bridge. `command.mjs --ended` reports that the harness process exited. Otherwise
 * argv[2] is the provider-owned interpreter module, which maps the native hook payload to a
 * canonical lifecycle event (or nothing) and may keep bounded per-terminal state.
 *
 * Every hook is its own short-lived process, so the bridge runs the whole transaction
 * (read -> interpret -> write -> DELIVER the resulting event) under an exclusive per-terminal
 * lock. Delivery is inside the critical path on purpose: an event derived from state this hook
 * produced can then never be overtaken by a later hook's event, so the broker observes
 * transitions in state order. The lock is an atomically created directory (portable, no flock)
 * holding a pid:nonce owner record, released in a finally; a holder that is dead or older than the
 * bound is stale and is replaced only if its record is unchanged. Waiting is bounded and is
 * synchronization only; elapsed time never decides agent state. Delivery itself is bounded
 * (loopback ack timeout, non-blocking tty write), and the lock wait plus delivery fit inside the
 * 3 s hook timeouts Clanker configures.
 *
 * Fail closed: if the transaction cannot be established (lock, unreadable/corrupt/oversized or
 * unwritable state) the interpreter runs against empty state, a private poison marker is set, and
 * no input_resolved is delivered until a turn boundary (start, completion, interrupt, session end)
 * is delivered. A failed delivery counts as a failed transaction (the broker may not have seen the
 * transition). Evidence of a possible human wait is never discarded in favour of Running. */
export const COMMAND = `import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { emit } from './observer.mjs';
if (process.argv[2] === '--ended') {
  process.exit(await emit('agent_exited') ? 0 : 1);
}
// Read a complete bounded JSON object. Never interpret a prefix, even if it is valid JSON.
// Total intake deadline + lock wait + one delivery remain below the configured 3 s timeout.
let intakeFailure;
const input = await new Promise((resolve) => {
  let chunks = [];
  let size = 0;
  let finished = false;
  const deadline = setTimeout(() => finish('input-timeout'), 500);
  function finish(failure) {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    process.stdin.removeAllListeners('data');
    process.stdin.removeAllListeners('end');
    process.stdin.removeAllListeners('error');
    if (failure) {
      intakeFailure = failure;
      chunks = [];
      process.stdin.destroy();
      resolve(null);
      return;
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      chunks = [];
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
      resolve(value);
    } catch { intakeFailure = 'input-malformed'; chunks = []; resolve(null); }
  }
  process.stdin.on('data', (chunk) => {
    size += chunk.length;
    if (size > ${MAX_NATIVE_HOOK_BYTES}) { finish('input-oversized'); return; }
    chunks.push(chunk);
  });
  process.stdin.on('end', () => finish());
  process.stdin.on('error', () => finish('input-malformed'));
});

const STATE_LIMIT = 32768;
const LOCK_WAIT_MS = 1200;
const LOCK_STALE_MS = 10000;
const token = process.env.CLANKER_ATTENTION_TOKEN || process.env.CLANKER_REMOTE_ATTENTION_TOKEN || '';
const base = path.join(path.dirname(process.argv[1]), '.clanker-state-' + createHash('sha256').update(token).digest('hex').slice(0, 16));
const statePath = base + '.json';
const lockPath = statePath + '.lock';
const poisonPath = base + '.poison';
const nonce = process.pid + ':' + randomBytes(8).toString('hex');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const owner = () => { try { return fs.readFileSync(path.join(lockPath, 'owner'), 'utf8'); } catch { return null; } };
function staleOwner() {
  const record = owner();
  let age = 0;
  try { age = Date.now() - fs.statSync(lockPath).mtimeMs; } catch { return null; }
  const pid = Number((record ?? '').split(':')[0]);
  return record === null ? (age > LOCK_STALE_MS ? '' : null) : (!Number.isInteger(pid) || !alive(pid) || age > LOCK_STALE_MS ? record : null);
}
async function acquire() {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      fs.writeFileSync(path.join(lockPath, 'owner'), nonce, { mode: 0o600 });
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') return false;
    }
    const stale = staleOwner();
    // Replace a dead/expired holder only if its record is unchanged, by an atomic rename.
    if (stale !== null && owner() === (stale === '' ? null : stale)) {
      try { fs.renameSync(lockPath, lockPath + '.stale-' + nonce.replace(':', '-')); } catch { /* another waiter won */ }
      try { fs.unlinkSync(path.join(lockPath + '.stale-' + nonce.replace(':', '-'), 'owner')); } catch { /* absent */ }
      try { fs.rmdirSync(lockPath + '.stale-' + nonce.replace(':', '-')); } catch { /* absent */ }
      continue;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 10)));
  }
}
function release() {
  if (owner() !== nonce) return;
  try { fs.unlinkSync(path.join(lockPath, 'owner')); } catch { /* already gone */ }
  try { fs.rmdirSync(lockPath); } catch { /* already gone */ }
}

let failed = Boolean(intakeFailure);
const store = {
  read() {
    try {
      const text = fs.readFileSync(statePath, 'utf8');
      if (text.length > STATE_LIMIT) throw new Error('oversized');
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
      return value;
    } catch (error) {
      if (error.code !== 'ENOENT') { failed = true; diagnostic = 'state-unreadable'; }
      return {};
    }
  },
  write(value) {
    const temporary = statePath + '.' + process.pid + '.tmp';
    try {
      const text = JSON.stringify(value);
      if (text.length > STATE_LIMIT) throw new Error('oversized');
      fs.writeFileSync(temporary, text, { mode: 0o600 });
      // Windows refuses to replace a file another process (an indexer, a reader) briefly holds open.
      for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(temporary, statePath); break; } catch (error) {
          if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      }
      return true;
    } catch {
      failed = true;
      diagnostic = 'state-unwritable';
      try { fs.unlinkSync(temporary); } catch { /* not created */ }
      return false;
    }
  },
};
const degraded = { read: () => ({}), write: () => false };

let result = null;
let interpreter = null;
let diagnostic = intakeFailure;
if (!diagnostic) {
  try { interpreter = await import(pathToFileURL(process.argv[2]).href); } catch { diagnostic = 'interpreter-unavailable'; failed = true; }
}
const boundary = ['turn_started', 'turn_completed', 'turn_interrupted', 'turn_failed', 'session_ended', 'session_replaced'];
if (interpreter || diagnostic) {
  const locked = await acquire();
  if (!locked) { failed = true; diagnostic ??= 'lock-unavailable'; }
  try {
    // One critical path per terminal: the state transition AND delivery of its event happen
    // under the lock, so an event derived from state this hook produced can never overtake it.
    // Delivery is bounded (loopback ack timeout / non-blocking tty write).
    if (interpreter) {
      try { result = interpreter.default(input, process.argv[3], locked ? store : degraded); } catch { diagnostic = 'interpreter-failed'; failed = true; }
    }
    const poisoned = fs.existsSync(poisonPath);
    let event = result?.event;
    if (event?.type === 'input_resolved' && (failed || poisoned)) { event = undefined; diagnostic = 'resolution-suppressed'; }
    if (!event) event = { type: 'observer_diagnostic', diagnostic: diagnostic ?? 'no-event', nativeEvent: process.argv[3] };
    if (event) {
      const { type, ...fields } = event;
      if (diagnostic) fields.diagnostic = diagnostic;
      let delivered = false;
      try { delivered = await emit(type, fields, true); } catch { /* counts as undelivered */ }
      // The broker may not have seen this transition: stay conservative until a boundary lands.
      // A location report carries no bridge state, so losing one is not a failed transaction.
      // Remote OSC has no ACK: true still means a successful local tty write only.
      const accepted = delivered === true || delivered === 'accepted-changed' || delivered === 'accepted-idempotent';
      const ignored = delivered === 'ignored-child' || delivered === 'ignored-stale';
      if (!accepted && !ignored && type !== 'location_changed') failed = true;
      else if (accepted && boundary.includes(type) && !failed) { try { fs.unlinkSync(poisonPath); } catch { /* none set */ } }
    }
    if (failed && !poisoned) { try { fs.writeFileSync(poisonPath, '', { flag: 'wx', mode: 0o600 }); } catch { /* best effort */ } }
  } finally {
    if (locked) release();
  }
}
process.stdout.write(JSON.stringify(result?.output ?? {}) + '\\n');
`;
