import { describe, expect, it } from 'vitest';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';

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
});
