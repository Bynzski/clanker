import { afterEach, describe, expect, it } from 'vitest';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';
import { AttentionTelemetry, setAttentionTelemetry } from '../../../src/main/attentionTelemetry';

describe('retired attention credentials are diagnostic only', () => {
  it('classifies exact late remote credentials without accepting them, expires them and refuses mismatched hosts/harnesses', () => {
    let now = 100;
    const changes: unknown[] = [];
    const broker = new AgentAttentionBroker(change => changes.push(change), () => undefined, () => now);
    const token = broker.registerRemote('term-a', 'pi');
    const raw = (harness = 'pi') => JSON.stringify({ version: 1, token, harness, event: 'turn_started', scope: 'root', sessionId: 'secret-session', turnId: 'secret-turn' });
    broker.receiveRemote('term-a', raw());
    broker.release('term-a');
    expect(broker.trace('term-a').some(entry => entry.semantic === 'release-without-settlement')).toBe(true);
    const count = changes.length;
    expect(broker.receiveRemote('term-a', raw())).toBe('rejected-auth');
    expect(broker.trace('term-a').slice(-1)[0]?.semantic).toBe('late-retired-delivery');
    const traceLength = broker.trace('term-a').length;
    expect(broker.receiveRemote('other', raw())).toBe('rejected-auth');
    expect(broker.receiveRemote('term-a', raw('codex'))).toBe('rejected-auth');
    expect(broker.receive(raw())).toBe('rejected-auth');
    expect(broker.trace('term-a')).toHaveLength(traceLength);
    now += 60001;
    broker.receiveRemote('term-a', raw());
    expect(broker.trace('term-a')).toHaveLength(traceLength);
    expect(changes).toHaveLength(count);
    expect(JSON.stringify(broker.trace('term-a'))).not.toMatch(new RegExp(`${token}|secret-session|secret-turn`));
    broker.close();
  });

  it('does not flag a settled turn as a release without settlement', () => {
    const broker = new AgentAttentionBroker(() => undefined, () => undefined);
    const token = broker.registerRemote('term-a', 'pi');
    for (const event of ['turn_started', 'turn_completed']) broker.receiveRemote('term-a', JSON.stringify({ version: 1, token, harness: 'pi', event, scope: 'root', sessionId: 'session', turnId: 'turn' }));
    broker.release('term-a');
    expect(broker.trace('term-a').some(entry => entry.semantic === 'release-without-settlement')).toBe(false);
    broker.close();
  });

  afterEach(() => setAttentionTelemetry(null));

  // Field evidence (0.12.0-dev.f7602b0): 84 of 92 auth rejections could not be assigned to any terminal.
  it('attributes every credential rejection without recording the credential or content', async () => {
    let now = 1_000;
    const records: Record<string, unknown>[] = [];
    setAttentionTelemetry(new AttentionTelemetry({ append: (record: Record<string, unknown>) => records.push(record) } as never, () => [], () => now));
    const broker = new AgentAttentionBroker(() => undefined, () => undefined, () => now);
    const live = (await broker.register('term-live', 'claude')).CLANKER_ATTENTION_TOKEN;
    const retired = (await broker.register('term-old', 'pi')).CLANKER_ATTENTION_TOKEN;
    broker.release('term-old');
    const send = (token: string, harness: string) => broker.receive(JSON.stringify({ version: 1, token, harness, event: 'turn_started', nativeEvent: 'agent_start', scope: 'root', sessionId: 'secret-session' }));
    now += 3 * 60 * 60_000;
    expect(send(retired, 'pi')).toBe('rejected-auth');
    expect(send(live, 'agy')).toBe('rejected-auth');
    expect(send('f'.repeat(64), 'Not A Harness')).toBe('rejected-auth');
    const rejections = records.filter((record) => record.kind === 'transport-rejection');
    expect(rejections.map(({ attribution, terminalId, harness, reportedHarness, event, nativeEvent, retiredForMs }) =>
      ({ attribution, terminalId, harness, reportedHarness, event, nativeEvent, retiredForMs }))).toEqual([
      { attribution: 'retired-credential', terminalId: 'term-old', harness: 'pi', reportedHarness: 'pi', event: 'turn_started', nativeEvent: 'agent_start', retiredForMs: 3 * 60 * 60_000 },
      { attribution: 'harness-mismatch', terminalId: 'term-live', harness: 'claude', reportedHarness: 'agy', event: 'turn_started', nativeEvent: 'agent_start', retiredForMs: undefined },
      { attribution: 'unknown-credential', terminalId: undefined, harness: undefined, reportedHarness: undefined, event: 'turn_started', nativeEvent: 'agent_start', retiredForMs: undefined },
    ]);
    expect(records.find((record) => record.kind === 'broker' && record.semantic === 'registered' && record.terminalId === 'term-live')?.harness).toBe('claude');
    expect(JSON.stringify(records)).not.toMatch(new RegExp(`${live}|${retired}|secret-session`));
    broker.close();
  });
});
