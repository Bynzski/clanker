import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';
import { OBSERVER } from '../../../src/main/harnesses/attentionSources';
import { ATTENTION_ACK_PREFIX } from '../../../src/shared/attentionProtocol';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { deriveAttention } from '../../../src/renderer/lib/agentAttentionPresentation';

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).reverse().forEach((dispose) => dispose());
  useAgentAttentionStore.setState({ byTerminalId: {}, revisionByTerminalId: {}, seenByTerminalId: {} });
});

function send(port: number, raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let response = '';
    const socket = net.createConnection(port, '127.0.0.1', () => socket.end(raw));
    socket.on('data', (chunk) => { response += chunk.toString('utf8'); });
    socket.on('error', reject);
    socket.on('close', () => resolve(response));
  });
}

function observer(env: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-ack-'));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'observer.mjs'), OBSERVER);
  fs.writeFileSync(path.join(dir, 'run.mjs'), `import { emit } from './observer.mjs';
const [event, fields, detailed] = JSON.parse(process.argv[2]);
console.log(JSON.stringify(await emit(event, fields, detailed)));`);
  return (event: string, fields: object, detailed = true) => new Promise<unknown>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(dir, 'run.mjs'), JSON.stringify([event, fields, detailed])], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(`Observer exited ${code}`)); return; }
      try { resolve(JSON.parse(output)); } catch (error) { reject(error); }
    });
  });
}

describe('local attention delivery contract', () => {
  it('projects real observer/socket/broker snapshots into the renderer store through repeated turns and retirement', async () => {
    // The callback is the IPC snapshot payload boundary. This exercises the real observer and
    // socket with real store/presentation, but does not claim to launch Electron or a native CLI.
    const broker = new AgentAttentionBroker((change) => useAgentAttentionStore.getState().applyChange(change, false), () => undefined);
    cleanup.push(() => broker.close());
    const env = await broker.register('t', 'codex');
    const emit = observer(env);
    const root = { scope: 'root', sessionId: 's', turnId: 'one' };
    const view = () => {
      const store = useAgentAttentionStore.getState();
      return deriveAttention(store.byTerminalId.t, store.seenByTerminalId.t)?.display ?? null;
    };
    expect(await emit('turn_started', root)).toBe('accepted-changed');
    expect(view()).toBe('running');
    const first = broker.snapshot('t')!;
    expect(await emit('turn_started', root)).toBe('accepted-idempotent');
    expect(broker.snapshot('t')?.revision).toBe(first.revision);
    expect(await emit('turn_started', { ...root, sessionId: 'wrong' })).toBe('rejected-mismatch');
    expect(await emit('turn_started', { scope: 'root' })).toBe('rejected-ambiguous');
    expect(await emit('turn_completed', { ...root, scope: 'child' })).toBe('ignored-child');
    expect(view()).toBe('running');
    expect(await emit('turn_completed', root)).toBe('accepted-changed');
    expect(view()).toBe('turn_complete');
    useAgentAttentionStore.getState().acknowledge('t');
    expect(view()).toBe(null);
    expect(await emit('turn_started', { ...root, turnId: 'two' })).toBe('accepted-changed');
    expect(view()).toBe('running');
    expect(await emit('turn_completed', root)).toBe('ignored-stale');
    expect(await emit('session_continued', { scope: 'root', sessionId: 'next', continuesSessionId: 's' })).toBe('accepted-changed');
    expect(await emit('turn_completed', { ...root, sessionId: 'next', turnId: 'two' })).toBe('accepted-changed');
    expect(view()).toBe('turn_complete');
    expect(await emit('agent_exited', {})).toBe('accepted-changed');
    expect(view()).toBe(null);
    useAgentAttentionStore.getState().hydrate([first], () => false);
    expect(view()).toBe(null);
    expect(await emit('turn_started', root)).toBe('rejected-auth');
  });

  it('returns bounded truthful ACKs for invalid/auth/transport failures and never echoes input', async () => {
    const broker = new AgentAttentionBroker(() => undefined, () => undefined);
    cleanup.push(() => broker.close());
    const env = await broker.register('t', 'codex');
    const port = Number(env.CLANKER_ATTENTION_PORT);
    const base = { version: 1, token: env.CLANKER_ATTENTION_TOKEN, harness: 'codex', event: 'turn_started', scope: 'root', sessionId: 's', turnId: 't' };
    for (const raw of ['{', JSON.stringify({ ...base, prompt: 'SECRET' }), JSON.stringify({ ...base, turnId: 123 })]) {
      expect(await send(port, raw)).toBe(`${ATTENTION_ACK_PREFIX}rejected-invalid\n`);
    }
    expect(await send(port, JSON.stringify({ ...base, token: 'SECRET' }))).toBe(`${ATTENTION_ACK_PREFIX}rejected-auth\n`);
    const remote = broker.registerRemote('remote', 'codex');
    expect(await send(port, JSON.stringify({ ...base, token: remote }))).toBe(`${ATTENTION_ACK_PREFIX}rejected-transport\n`);
    expect(await send(port, 'x'.repeat(2049))).toBe('');
  });

  it('bounds total ACK time even if a peer keeps trickling bytes', async () => {
    const server = net.createServer({ allowHalfOpen: true }, (socket) => {
      socket.on('error', () => undefined);
      socket.resume();
      const interval = setInterval(() => socket.write('x'), 100);
      socket.on('close', () => clearInterval(interval));
    });
    cleanup.push(() => { server.close(); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as net.AddressInfo;
    const emit = observer({ CLANKER_ATTENTION_PORT: String(address.port), CLANKER_ATTENTION_TOKEN: 'test', CLANKER_ATTENTION_HARNESS: 'codex' });
    const started = Date.now();
    expect(await emit('turn_started', {})).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it.each([
    ['split ACK', [`${ATTENTION_ACK_PREFIX}accepted-`, 'changed\n'], 'accepted-changed'],
    ['old unconditional ACK', ['ok'], false],
    ['unknown verdict', [`${ATTENTION_ACK_PREFIX}accepted-anything\n`], false],
    ['trailing data', [`${ATTENTION_ACK_PREFIX}accepted-changed\nSECRET`], false],
    ['truncated ACK', [`${ATTENTION_ACK_PREFIX}accepted-changed`], false],
    ['oversized ACK', ['x'.repeat(97)], false],
  ])('handles %s fail closed', async (_name, chunks, expected) => {
    const server = net.createServer({ allowHalfOpen: true }, (socket) => {
      socket.on('error', () => undefined);
      socket.resume();
      socket.on('end', async () => {
        for (const chunk of chunks) {
          if (socket.destroyed) return;
          socket.write(chunk);
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        socket.end();
      });
    });
    cleanup.push(() => { server.close(); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as net.AddressInfo;
    const emit = observer({ CLANKER_ATTENTION_PORT: String(address.port), CLANKER_ATTENTION_TOKEN: 'test', CLANKER_ATTENTION_HARNESS: 'codex' });
    expect(await emit('turn_started', {})).toBe(expected);
    expect(await emit('turn_started', {}, false)).toBe(expected === 'accepted-changed');
  });
});
