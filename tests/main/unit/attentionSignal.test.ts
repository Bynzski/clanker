import { afterEach, describe, expect, it } from 'vitest';
import { deriveAttention } from '../../../src/renderer/lib/agentAttentionPresentation';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';
import type { AgentAttentionChange } from '../../../src/shared/types/agentAttention';

const brokers: AgentAttentionBroker[] = [];
afterEach(() => brokers.splice(0).forEach((broker) => broker.close()));
function fixture() {
  const changes: AgentAttentionChange[] = [];
  const broker = new AgentAttentionBroker((change) => changes.push(change), () => undefined);
  brokers.push(broker);
  const token = broker.registerRemote('t', 'codex', { capability: { requested: true, attachment: 'prepared' } });
  const send = (event: string, fields: object = {}) => broker.receiveRemote('t', JSON.stringify({ version: 1, token, harness: 'codex', event, scope: 'root', sessionId: 'SECRET-SESSION', turnId: 'one', ...fields }));
  return { broker, changes, send };
}

describe('broker native signal health (no lifecycle inference)', () => {
  it('keeps preparation unverified until a native event is accepted; duplicate receipt is visible without revision churn', () => {
    const { broker, send, changes } = fixture();
    expect(broker.signalDiagnostics('t')).toMatchObject({ received: 0, signal: { health: 'unverified' } });
    expect(send('turn_started', { nativeEvent: 'UserPromptSubmit' })).toBe('accepted-changed');
    expect(changes[changes.length - 1]?.snapshot?.signal?.health).toBe('observed');
    const revision = broker.snapshot('t')!.revision;
    expect(send('turn_started')).toBe('accepted-idempotent');
    expect(broker.snapshot('t')!.revision).toBe(revision);
    expect(broker.explain('t')?.delivery).toMatchObject({ received: 2, verdicts: { 'accepted-changed': 1, 'accepted-idempotent': 1 } });
    expect(JSON.stringify(broker.signalDiagnostics('t'))).not.toMatch(/SECRET|token|sessionId|turnId|path/);
  });

  it('explains rejected native identity without changing the active root/turn, then recovers on accepted evidence', () => {
    const { broker, send } = fixture();
    send('turn_started');
    expect(send('turn_started', { sessionId: 'other' })).toBe('rejected-mismatch');
    expect(broker.snapshot('t')).toMatchObject({ sessionId: 'SECRET-SESSION', runtime: { status: 'running', turnId: 'one' }, signal: { health: 'degraded', reason: 'identity-rejected' } });
    expect(broker.signalDiagnostics('t')?.lastVerdict).toBe('rejected-mismatch');
    send('turn_started', { turnId: 'two' });
    expect(broker.snapshot('t')?.signal).toEqual({ requested: true, attachment: 'prepared', health: 'observed' });
  });

  it('observer diagnostics cannot bind a session, change location, create a turn or complete it', () => {
    const { broker, send } = fixture();
    send('observer_diagnostic', { diagnostic: 'input-oversized', cwd: '/private/dir' });
    expect(broker.snapshot('t')).toMatchObject({ sessionId: null, location: null, runtime: { status: 'unverified' }, lastCompletion: null, signal: { health: 'degraded', reason: 'input-oversized' } });
    expect(broker.signalDiagnostics('t')?.hooks['input-oversized']).toBe(1);
    expect(send('observer_diagnostic', { diagnostic: 'PRIVATE ERROR' })).toBe('rejected-invalid');
  });

  it('counts authenticated invalid envelopes without interpreting them or retaining their content', () => {
    const { broker, send } = fixture();
    send('turn_started');
    expect(send('turn_completed', { extra: 'PRIVATE CONTENT' })).toBe('rejected-invalid');
    expect(broker.snapshot('t')).toMatchObject({ runtime: { status: 'running', turnId: 'one' }, lastCompletion: null, signal: { health: 'degraded', reason: 'envelope-invalid' } });
    expect(broker.signalDiagnostics('t')).toMatchObject({ received: 2, verdicts: { 'rejected-invalid': 1 } });
    const revision = broker.snapshot('t')!.revision;
    expect(send('unknown')).toBe('rejected-invalid');
    expect(broker.snapshot('t')!.revision).toBe(revision);
    expect(JSON.stringify(broker.signalDiagnostics('t'))).not.toContain('PRIVATE');
    expect(broker.receiveRemote('t', '{invalid')).toBe('rejected-invalid');
    expect(broker.signalDiagnostics('t')!.received).toBe(3);
  });

  it('keeps confirmed human waits and active work visible alongside degraded health and recovers on a fresh native boundary', () => {
    const { broker, send } = fixture();
    send('turn_started');
    send('input_requested', { inputId: 'approval', requestKind: 'approval' });
    send('turn_completed', { sessionId: 'unrelated' });
    expect(deriveAttention(broker.snapshot('t')!, undefined)).toMatchObject({ display: 'needs_input', signalWarning: 'Native attention degraded: identity-rejected' });
    send('input_resolved', { inputId: 'approval' });
    expect(deriveAttention(broker.snapshot('t')!, undefined)).toMatchObject({ display: 'running', signalWarning: 'Native attention degraded: identity-rejected' });
    send('turn_started', { turnId: 'two' });
    expect(deriveAttention(broker.snapshot('t')!, undefined)).toEqual({ display: 'running', unseen: false });
    send('turn_completed', { turnId: 'two' });
    const snapshot = broker.snapshot('t')!;
    expect(deriveAttention(snapshot, undefined)?.display).toBe('turn_complete');
    expect(deriveAttention(snapshot, { completion: snapshot.lastCompletion!.revision, request: 0 })).toBeNull();
    expect(deriveAttention(undefined, undefined, { requested: true, attachment: 'unavailable', reason: 'unsupported' })?.display).toBe('signal_unavailable');
  });

  it('only concrete directory loss marks health lost, and a later native turn recovers', () => {
    const { broker, send } = fixture();
    send('turn_started');
    expect(broker.markLifecycleLost('t')).toBe(true);
    expect(broker.snapshot('t')?.signal).toMatchObject({ health: 'lost', reason: 'directory-removed' });
    send('turn_started', { turnId: 'two' });
    expect(broker.snapshot('t')?.signal?.health).toBe('observed');
  });
});
