import { OBSERVER_FIELDS } from '../harnesses/attentionSources';

/** Lifecycle-only OSC frames travel on the existing SSH PTY, never a listener or forward. */
export const REMOTE_ATTENTION_PREFIX = '\x1b]777;clanker-attention;';
const MAX_FRAME_LENGTH = 4096;

export function createRemoteAttentionFilter(receive: (json: string) => void): (data: string) => string {
  let pending = '';
  return (data) => {
    pending += data;
    let output = '';
    while (pending) {
      const start = pending.indexOf(REMOTE_ATTENTION_PREFIX);
      if (start < 0) {
        let suffix = Math.min(pending.length, REMOTE_ATTENTION_PREFIX.length - 1);
        while (suffix && !REMOTE_ATTENTION_PREFIX.startsWith(pending.slice(-suffix))) suffix--;
        output += pending.slice(0, pending.length - suffix);
        pending = suffix ? pending.slice(-suffix) : '';
        break;
      }
      output += pending.slice(0, start);
      pending = pending.slice(start);
      const end = pending.indexOf('\x07', REMOTE_ATTENTION_PREFIX.length);
      if (end < 0 && pending.length <= MAX_FRAME_LENGTH) break;
      if (end < 0) {
        // A malformed unterminated frame must not hold terminal output indefinitely.
        output += pending;
        pending = '';
        break;
      }
      const encoded = pending.slice(REMOTE_ATTENTION_PREFIX.length, end);
      if (end <= MAX_FRAME_LENGTH && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        const raw = Buffer.from(encoded, 'base64');
        if (raw.length <= 2048 && raw.toString('base64') === encoded) receive(raw.toString('utf8'));
      }
      pending = pending.slice(end + 1);
    }
    return output;
  };
}

export const REMOTE_ATTENTION_OBSERVER = `import fs from 'node:fs';
${OBSERVER_FIELDS}
export async function emit(event, fields) {
  const token = process.env.CLANKER_REMOTE_ATTENTION_TOKEN;
  const harness = process.env.CLANKER_REMOTE_ATTENTION_HARNESS;
  if (!token || !harness) return false;
  const payload = JSON.stringify({version: 1, token, harness, ...envelope(event, fields)});
  if (Buffer.byteLength(payload) > 2048) return false;
  let fd;
  try {
    fd = fs.openSync('/dev/tty', fs.constants.O_WRONLY | fs.constants.O_NOCTTY | fs.constants.O_NONBLOCK);
    fs.writeSync(fd, '\\x1b]777;clanker-attention;' + Buffer.from(payload).toString('base64') + '\\x07');
    return true;
  } catch { return false; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
`;
