import { describe, expect, it, afterEach } from 'vitest';
import { openLocalHarnessSession } from '../../../src/main/environment/localCommandExecutor';
import type { HarnessCommandSession } from '../../../src/main/harnesses/commandExecution';

const opened: HarnessCommandSession[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((session) => session.dispose())); });

const open = async (script: string, extra: { timeoutMs?: number; maxOutputBytes?: number } = {}, signal?: AbortSignal) => {
  const session = await openLocalHarnessSession({ command: 'node', args: ['-e', script], ...extra }, signal);
  opened.push(session);
  return session;
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function reaped(pid: number): Promise<boolean> {
  for (let i = 0; i < 60; i++) { if (!alive(pid)) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
}
const pidScript = 'console.log(process.pid);';

describe('local bounded session', () => {
  it('opens, writes, reads, closes input and waits for a clean exit', async () => {
    const session = await open('process.stdin.setEncoding("utf8");let b="";process.stdin.on("data",d=>{b+=d});process.stdin.on("end",()=>{console.log("got:"+b.trim());process.exit(0)})');
    await session.writeLine('hello');
    await session.closeInput();
    expect(await session.readLine()).toBe('got:hello');
    expect(await session.readLine()).toBeNull();
    expect(await session.wait()).toEqual({ stderr: '', exitCode: 0 });
  });

  it('supports a stateful request/response protocol where the consumer matches ids and ignores notifications', async () => {
    // Deterministic, network-free stand-in for a handshake-style line protocol.
    const server = `
      const rl = require('readline').createInterface({ input: process.stdin });
      const out = (o) => console.log(JSON.stringify(o));
      rl.on('line', (line) => {
        const m = JSON.parse(line);
        if (m.method === 'hello') { out({ note: 'warming up' }); out({ id: m.id, result: { ok: 1 } }); }
        else if (m.method === 'ready') { /* notification: no reply */ }
        else if (m.method === 'read') { out({ note: 'busy' }); out({ id: 99, result: 'unrelated' }); out({ id: m.id, result: { value: 42 } }); }
      });
      rl.on('close', () => process.exit(0));
    `;
    const session = await open(server);
    const waitForId = async (id: number) => {
      for (;;) {
        const line = await session.readLine();
        if (line === null) throw new Error('eof');
        const message = JSON.parse(line);
        if (message.id === id) return message;
      }
    };
    await session.writeLine(JSON.stringify({ id: 1, method: 'hello' }));
    expect((await waitForId(1)).result).toEqual({ ok: 1 });
    await session.writeLine(JSON.stringify({ method: 'ready' }));
    await session.writeLine(JSON.stringify({ id: 2, method: 'read' }));
    expect((await waitForId(2)).result).toEqual({ value: 42 });
    await session.closeInput();
    expect(await session.wait()).toMatchObject({ exitCode: 0 });
  });

  it('assembles lines from partial chunks, CRLF/LF, several lines per chunk and split UTF-8', async () => {
    const session = await open(`
      const w = (s) => process.stdout.write(s);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      (async () => {
        w('par'); await sleep(40); w('tial'); await sleep(40); w(' line\\n');
        w('one\\r\\ntwo\\nthree\\r\\n');
        const bytes = Buffer.from('€\\n');
        w(bytes.subarray(0, 1)); await sleep(40); w(bytes.subarray(1, 2)); await sleep(40); w(bytes.subarray(2));
        w('last-without-newline');
      })();
    `);
    const lines: Array<string | null> = [];
    for (let i = 0; i < 7; i++) lines.push(await session.readLine());
    expect(lines).toEqual(['partial line', 'one', 'two', 'three', '€', 'last-without-newline', null]);
  });

  it('retains a non-zero exit as a result and reports early exit as EOF', async () => {
    const session = await open('console.error("bye");process.exit(3)');
    expect(await session.readLine()).toBeNull();
    expect(await session.wait()).toEqual({ stderr: 'bye\n', exitCode: 3 });
  });

  it('fails with output-limit on cumulative stdout, cumulative stderr and an unterminated oversized line', async () => {
    const stdout = await open('const l="x".repeat(300);for(let i=0;i<10;i++)console.log(l);setTimeout(()=>{},3000)', { maxOutputBytes: 1000 });
    await expect((async () => { for (;;) if ((await stdout.readLine()) === null) return; })()).rejects.toMatchObject({ kind: 'output-limit' });
    const stderr = await open('const l="x".repeat(300);for(let i=0;i<10;i++)console.error(l);setTimeout(()=>{},3000)', { maxOutputBytes: 1000 });
    await expect(stderr.wait()).rejects.toMatchObject({ kind: 'output-limit' });
    const longLine = await open('process.stdout.write("y".repeat(5000));setTimeout(()=>{},3000)', { maxOutputBytes: 1000 });
    await expect(longLine.readLine()).rejects.toMatchObject({ kind: 'output-limit' });
  });

  it('bounds incremental input and then refuses further use', async () => {
    const session = await open('process.stdin.resume();setTimeout(()=>{},3000)');
    const line = 'a'.repeat(40 * 1024);
    await session.writeLine(line);
    await expect(session.writeLine(line)).rejects.toMatchObject({ kind: 'input-limit' });
    await expect(session.writeLine('x')).rejects.toMatchObject({ kind: 'input-limit' });
    await expect(session.wait()).rejects.toMatchObject({ kind: 'input-limit' });
  });

  it('rejects invalid lines, initial stdin, and writes after closeInput', async () => {
    const session = await open('process.stdin.resume();setTimeout(()=>process.exit(0),500)');
    await expect(session.writeLine('a\nb')).rejects.toMatchObject({ kind: 'command-failed' });
    await expect(session.writeLine('a\rb')).rejects.toMatchObject({ kind: 'command-failed' });
    await session.closeInput();
    await session.closeInput(); // idempotent
    await expect(session.writeLine('late')).rejects.toMatchObject({ kind: 'command-failed' });
    await expect(openLocalHarnessSession({ command: 'node', args: [], stdin: 'x' })).rejects.toMatchObject({ kind: 'command-failed' });
  });

  it('times out and reaps the process', async () => {
    const session = await open(`${pidScript}setTimeout(()=>{},10000)`, { timeoutMs: 300 });
    const pid = Number(await session.readLine());
    await expect(session.readLine()).rejects.toMatchObject({ kind: 'timeout' });
    await expect(session.wait()).rejects.toMatchObject({ kind: 'timeout' });
    await session.dispose();
    expect(await reaped(pid)).toBe(true);
  });

  it('is cancelled by the abort signal, before open and while waiting, and reaps', async () => {
    const early = new AbortController(); early.abort();
    await expect(openLocalHarnessSession({ command: 'node', args: ['-e', ''] }, early.signal)).rejects.toMatchObject({ kind: 'aborted' });

    const controller = new AbortController();
    const session = await open(`${pidScript}setTimeout(()=>{},10000)`, {}, controller.signal);
    const pid = Number(await session.readLine());
    const pending = session.readLine();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    await session.dispose();
    expect(await reaped(pid)).toBe(true);
  });

  it('dispose terminates, reaps, is idempotent, and later calls fail', async () => {
    const session = await open(`${pidScript}setTimeout(()=>{},10000)`);
    const pid = Number(await session.readLine());
    await Promise.all([session.dispose(), session.dispose()]);
    await session.dispose();
    expect(await reaped(pid)).toBe(true);
    await expect(session.writeLine('x')).rejects.toBeDefined();
    await expect(session.readLine()).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('dispose after a clean exit is a no-op', async () => {
    const session = await open('process.exit(0)');
    await session.wait();
    await session.dispose();
    await session.dispose();
  });

  it('reports a missing binary at open', async () => {
    await expect(openLocalHarnessSession({ command: 'clanker-no-such-binary-xyz' })).rejects.toMatchObject({ kind: 'binary-unavailable' });
  });

  it('never leaks attention credentials to the child', async () => {
    process.env.CLANKER_ATTENTION_TOKEN = 'desktop-secret';
    try {
      const session = await open('console.log(String(process.env.CLANKER_ATTENTION_TOKEN))');
      expect(await session.readLine()).toBe('undefined');
      await expect(openLocalHarnessSession({ command: 'node', env: { CLANKER_ATTENTION_TOKEN: 'x' } })).rejects.toMatchObject({ kind: 'command-failed' });
    } finally { delete process.env.CLANKER_ATTENTION_TOKEN; }
  });
});
