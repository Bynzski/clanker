import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { moveOpenCodeConversation } from '../../../src/main/harnesses/opencode/rehome';

// A stand-in `opencode serve` (a node script) that records what it was asked, so the transient-server
// protocol is checked without the real CLI: loopback, Basic auth with a fresh password, the documented body.
let dir: string;
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function fakeOpenCode(moveStatus: number): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-move-'));
  const script = path.join(dir, 'opencode.js');
  fs.writeFileSync(script, `#!/usr/bin/env node
const http = require('node:http'); const fs = require('node:fs');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
const host = args[args.indexOf('--hostname') + 1];
const expected = 'Basic ' + Buffer.from('opencode:' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
http.createServer((req, res) => {
  if (req.headers.authorization !== expected) { res.statusCode = 401; return res.end(); }
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method === 'POST') fs.writeFileSync(${JSON.stringify(path.join(dir, 'request.json'))}, JSON.stringify({ url: req.url, body: JSON.parse(body), host, cwd: process.cwd() }));
    res.statusCode = req.method === 'POST' ? ${moveStatus} : 200; res.end('{}');
  });
}).listen(port, host);
process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(path.join(dir, 'killed'))}, '1'); process.exit(0); });
`, { mode: 0o755 });
  return script;
}

describe('moveOpenCodeConversation', () => {
  it('asks the native move-session of a loopback, password-protected transient server, then stops it', async () => {
    const script = fakeOpenCode(204);
    const target = fs.realpathSync(dir);
    await moveOpenCodeConversation({ sessionId: 'ses_abc', directory: target, env: process.env }, script);
    const request = JSON.parse(fs.readFileSync(path.join(dir, 'request.json'), 'utf8'));
    expect(request).toEqual({ url: '/experimental/control-plane/move-session', body: { sessionID: 'ses_abc', destination: { directory: target } }, host: '127.0.0.1', cwd: target });
    expect(request.body).not.toHaveProperty('moveChanges'); // no file is transferred
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fs.existsSync(path.join(dir, 'killed'))).toBe(true);
  });

  it('rejects when OpenCode refuses, and still stops the server', async () => {
    const script = fakeOpenCode(400);
    await expect(moveOpenCodeConversation({ sessionId: 'ses_abc', directory: fs.realpathSync(dir), env: process.env }, script)).rejects.toThrow(/HTTP 400/);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fs.existsSync(path.join(dir, 'killed'))).toBe(true);
  });

  it('rejects when the CLI cannot be started', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-move-'));
    await expect(moveOpenCodeConversation({ sessionId: 'ses_abc', directory: dir, env: process.env }, path.join(dir, 'missing'))).rejects.toThrow();
  });
});
