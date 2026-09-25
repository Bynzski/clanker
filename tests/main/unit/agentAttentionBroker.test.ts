import { afterEach, describe, expect, it, vi } from 'vitest';
import * as net from 'node:net';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';

const brokers: AgentAttentionBroker[] = [];
afterEach(() => {
  for (const broker of brokers) broker.close();
  brokers.length = 0;
});

describe('AgentAttentionBroker', () => {
  it('binds a minimal hook event to its registered terminal', async () => {
    const onUpdate = vi.fn();
    const broker = new AgentAttentionBroker(onUpdate);
    brokers.push(broker);
    const first = await broker.register('term-a', 'claude');
    const second = await broker.register('term-b', 'pi');
    const payload = JSON.stringify({ version: 1, token: first.CLANKER_ATTENTION_TOKEN, harness: 'claude', event: 'input_requested', sessionId: 'session-a' });
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(Number(first.CLANKER_ATTENTION_PORT), '127.0.0.1', () => socket.end(payload));
      socket.on('close', () => resolve());
      socket.on('error', reject);
    });
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith({
      terminalId: 'term-a', event: 'input_requested', sessionId: 'session-a',
    }));
    expect(second.CLANKER_ATTENTION_TOKEN).not.toBe(first.CLANKER_ATTENTION_TOKEN);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-terminal, malformed, sensitive, and stale events', async () => {
    const onUpdate = vi.fn();
    const broker = new AgentAttentionBroker(onUpdate);
    brokers.push(broker);
    const env = await broker.register('term-a', 'codex');
    const base = { version: 1, token: env.CLANKER_ATTENTION_TOKEN, harness: 'codex', event: 'turn_completed', sessionId: 'session-a' };
    broker.receive(JSON.stringify({ ...base, token: 'wrong' }));
    broker.receive(JSON.stringify({ ...base, harness: 'pi' }));
    broker.receive(JSON.stringify({ ...base, sessionId: 123 }));
    broker.receive(JSON.stringify({ ...base, event: 'write_terminal' }));
    broker.receive(JSON.stringify({ ...base, prompt: 'x'.repeat(3000) }));
    broker.receive(JSON.stringify({ ...base, prompt: 'secret' }));
    expect(onUpdate).not.toHaveBeenCalled();
    broker.receive(JSON.stringify(base));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    broker.receive(JSON.stringify({ ...base, sessionId: 'session-b' }));
    expect(onUpdate).toHaveBeenLastCalledWith({
      terminalId: 'term-a', event: 'turn_completed', sessionId: 'session-b',
    });
    broker.release('term-a');
    broker.receive(JSON.stringify(base));
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });
});
