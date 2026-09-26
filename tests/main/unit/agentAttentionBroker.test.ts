import { afterEach, describe, expect, it, vi } from 'vitest';
import * as net from 'node:net';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';

const brokers: AgentAttentionBroker[] = [];
afterEach(() => {
  for (const broker of brokers) broker.close();
  brokers.length = 0;
});

describe('AgentAttentionBroker', () => {
  it('keeps a live agent eligible without optional turn hooks, then retires it on fallback', async () => {
    const broker = new AgentAttentionBroker(vi.fn());
    brokers.push(broker);
    const env = await broker.register('term-a', 'codex');
    expect(broker.handoffState('term-a')).toBe('unverified');
    broker.markSubmitted('term-a');
    expect(broker.canHandoff('term-a')).toBe(true);
    broker.receive(JSON.stringify({ version: 1, token: env.CLANKER_ATTENTION_TOKEN, harness: 'codex', event: 'session_ended' }));
    expect(broker.canHandoff('term-a')).toBe(false);
  });

  it('binds a minimal hook event to its registered terminal', async () => {
    const onUpdate = vi.fn();
    const broker = new AgentAttentionBroker(onUpdate);
    brokers.push(broker);
    const first = await broker.register('term-a', 'claude');
    const second = await broker.register('term-b', 'pi');
    expect(broker.handoffState('term-a')).toBe('unverified');
    expect(broker.canHandoff('term-a')).toBe(true);
    const payload = JSON.stringify({ version: 1, token: first.CLANKER_ATTENTION_TOKEN, harness: 'claude', event: 'input_requested', sessionId: 'session-a' });
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(Number(first.CLANKER_ATTENTION_PORT), '127.0.0.1', () => socket.end(payload));
      socket.on('data', () => undefined);
      socket.on('close', () => resolve());
      socket.on('error', reject);
    });
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith({
      terminalId: 'term-a', event: 'input_requested', sessionId: 'session-a',
    }));
    expect(second.CLANKER_ATTENTION_TOKEN).not.toBe(first.CLANKER_ATTENTION_TOKEN);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(broker.handoffState('term-a')).toBe('needs_input');
    expect(broker.canHandoff('term-a')).toBe(false);
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
    expect(broker.isReady('term-a')).toBe(true);
    expect(broker.handoffState('term-a')).toBe('ready');
    broker.markSubmitted('term-a');
    expect(broker.isReady('term-a')).toBe(false);
    expect(broker.handoffState('term-a')).toBe('running');
    expect(onUpdate).toHaveBeenLastCalledWith({ terminalId: 'term-a', event: 'turn_started' });
    broker.receive(JSON.stringify({ ...base, sessionId: 'session-b' }));
    expect(broker.isReady('term-a')).toBe(true);
    expect(onUpdate).toHaveBeenLastCalledWith({
      terminalId: 'term-a', event: 'turn_completed', sessionId: 'session-b',
    });
    broker.receive(JSON.stringify({ ...base, event: 'session_ended', sessionId: 'session-b' }));
    expect(broker.isReady('term-a')).toBe(false);
    expect(broker.handoffState('term-a')).toBe('unavailable');
    broker.release('term-a');
    expect(broker.isReady('term-a')).toBe(false);
    broker.receive(JSON.stringify(base));
    expect(onUpdate).toHaveBeenCalledTimes(4);
  });
});
