import { afterEach, describe, expect, it } from 'vitest';
import { AgentAttentionBroker, type AttentionDiagnostic } from '../../../src/main/agentAttentionBroker';
import type { FallbackEvidence, StructuredAuthority } from '../../../src/main/attentionAuthority';
import { attentionRecorder } from '../../_helpers/attentionChanges';

const brokers: AgentAttentionBroker[] = [];
afterEach(() => {
  for (const broker of brokers) broker.close();
  brokers.length = 0;
});

type Options = { authority?: StructuredAuthority; transport?: 'remote' | 'local' };
function rig(options: Options = {}) {
  const recorder = attentionRecorder();
  const diagnostics: AttentionDiagnostic[] = [];
  let clock = 1000;
  const broker = new AgentAttentionBroker(recorder.onChange, (d) => diagnostics.push(d), () => (clock += 10));
  brokers.push(broker);
  const token = broker.registerRemote('t', 'codex', { authority: options.authority });
  const send = (event: string, fields: Record<string, unknown> = {}) => {
    broker.receiveRemote('t', JSON.stringify({ version: 1, token, harness: 'codex', event, scope: 'root', sessionId: 'S', ...fields }));
    return diagnostics[diagnostics.length - 1]?.decision;
  };
  const snap = () => broker.snapshot('t')!;
  return { broker, recorder, diagnostics, send, snap, token };
}

describe('canonical snapshot lifecycle', () => {
  it('starts unverified: registration and unbound idle are not Done', () => {
    const { snap, recorder, send } = rig();
    expect(snap()).toMatchObject({ terminalId: 't', sessionId: null, runtime: { status: 'unverified', turnId: null, startedAt: null }, pendingRequest: null, lastCompletion: null, lastOutcome: null });
    // A session boundary on a fresh terminal proves nothing and changes nothing.
    expect(send('session_ended')).toBe('accepted');
    expect(snap().lastCompletion).toBeNull();
    expect(snap().lastOutcome).toBeNull();
    expect(recorder.changes).toHaveLength(0);
  });

  it('walks start -> request -> resolve -> completion with independent facts', () => {
    const { snap, send } = rig();
    send('turn_started', { turnId: 'T1' });
    expect(snap()).toMatchObject({ sessionId: 'S', runtime: { status: 'running', turnId: 'T1', startedAt: 1010 } });
    send('input_requested', { turnId: 'T1', inputId: 'w1', requestKind: 'approval' });
    // A pending request is its own fact; the turn is still running underneath it.
    expect(snap()).toMatchObject({ runtime: { status: 'running' }, pendingRequest: { id: 'w1', turnId: 'T1', kind: 'approval', evidence: 'structured' } });
    send('input_resolved', { turnId: 'T1', inputId: 'w1' });
    expect(snap().pendingRequest).toBeNull();
    send('turn_completed', { turnId: 'T1' });
    expect(snap()).toMatchObject({
      runtime: { status: 'idle', turnId: null, startedAt: null },
      lastCompletion: { turnId: 'T1', revision: snap().revision }, lastOutcome: { kind: 'completed', turnId: 'T1' },
    });
  });

  it('does not fabricate an input/approval classification', () => {
    const { snap, send } = rig();
    send('turn_started', { turnId: 'T1' });
    send('input_requested', { turnId: 'T1', inputId: 'w1' });
    expect(snap().pendingRequest?.kind).toBeNull();
  });

  it('enters starting on a Clanker submission and lets the native start attach the turn', () => {
    const { broker, snap, send, recorder } = rig();
    send('turn_started', { turnId: 'T1' });
    send('turn_completed', { turnId: 'T1' });
    broker.markSubmitted('t');
    expect(snap().runtime).toMatchObject({ status: 'starting', turnId: null });
    expect(send('turn_completed', { turnId: 'T2' })).toBe('ignored-stale');
    send('turn_started', { turnId: 'T2' });
    expect(snap().runtime).toMatchObject({ status: 'running', turnId: 'T2' });
    expect(recorder.labels).toEqual(['turn_started', 'turn_completed', 'turn_started', 'turn_bound']);
    // A duplicate native start for the same turn changes nothing.
    const before = snap().revision;
    send('turn_started', { turnId: 'T2' });
    expect(snap().revision).toBe(before);
  });

  it('keeps handoff semantics on the canonical state', () => {
    const { broker, send } = rig();
    expect(broker.handoffState('t')).toBe('unverified');
    send('turn_started', { turnId: 'T1' });
    expect(broker.canHandoff('t')).toBe(false);
    send('input_requested', { turnId: 'T1', inputId: 'w' });
    expect(broker.handoffState('t')).toBe('needs_input');
    send('input_resolved', { turnId: 'T1', inputId: 'w' });
    send('turn_completed', { turnId: 'T1' });
    expect(broker.handoffState('t')).toBe('ready');
    send('turn_started', { turnId: 'T2' });
    send('turn_interrupted', { turnId: 'T2' });
    expect(broker.handoffState('t')).toBe('unverified');
  });
});

describe('completion provenance', () => {
  it('changes lastCompletion only on an accepted foreground completion', () => {
    const { snap, send } = rig();
    send('turn_started', { turnId: 'T1' });
    send('turn_started', { turnId: 'T1' });
    send('turn_completed', { turnId: 'T1', scope: 'child' });
    send('turn_completed', { turnId: 'T0' });
    send('turn_completed', { turnId: 'T1', sessionId: 'other' });
    expect(snap().lastCompletion).toBeNull();
    send('turn_interrupted', { turnId: 'T1' });
    expect(snap().lastCompletion).toBeNull();
    send('turn_started', { turnId: 'T2' });
    send('turn_failed', { turnId: 'T2' });
    expect(snap().lastCompletion).toBeNull();
    send('session_ended');
    expect(snap().lastCompletion).toBeNull();
  });

  it('does not let turn A\'s completion resurface after turn B is interrupted or fails', () => {
    for (const outcome of ['turn_interrupted', 'turn_failed'] as const) {
      const { snap, send } = rig();
      send('turn_started', { turnId: 'A' });
      send('turn_completed', { turnId: 'A' });
      const completion = snap().lastCompletion;
      send('turn_started', { turnId: 'B' });
      // Historical completion survives new work; presentation precedence hides it.
      expect(snap().lastCompletion).toEqual(completion);
      send(outcome, { turnId: 'B' });
      expect(snap().lastCompletion).toEqual(completion);
      expect(snap().lastOutcome).toMatchObject({ kind: outcome === 'turn_failed' ? 'failed' : 'interrupted', turnId: 'B' });
      expect(snap().lastOutcome!.revision).not.toBe(completion!.revision);
    }
  });

  it('supersedes a completion at a session boundary without erasing it', () => {
    const { snap, send } = rig();
    send('turn_started', { turnId: 'A' });
    send('turn_completed', { turnId: 'A' });
    send('session_ended');
    expect(snap().lastCompletion).not.toBeNull();
    expect(snap().lastOutcome?.kind).toBe('session_ended');
    expect(snap().runtime.status).toBe('unverified');
  });
});

describe('explicit failure', () => {
  it('becomes Failed with no completion, retires the turn and its wait', () => {
    const { snap, send } = rig();
    send('turn_started', { turnId: 'T1' });
    send('input_requested', { turnId: 'T1', inputId: 'w' });
    expect(send('turn_failed', { turnId: 'T1', scope: 'child' })).toBe('ignored-child');
    expect(send('turn_failed', { turnId: 'T1' })).toBe('accepted');
    expect(snap()).toMatchObject({ runtime: { status: 'failed', turnId: null }, pendingRequest: null, lastCompletion: null, lastOutcome: { kind: 'failed' } });
    expect(send('turn_completed', { turnId: 'T1' })).toBe('ignored-stale');
    expect(send('turn_started', { turnId: 'T2' })).toBe('accepted');
    expect(snap().runtime.status).toBe('running');
  });
});

describe('revision rules', () => {
  it('advances monotonically only for accepted semantic mutations', () => {
    const { snap, send, recorder } = rig();
    const revisions: number[] = [snap().revision];
    const step = (event: string, fields: Record<string, unknown> = {}) => { send(event, fields); revisions.push(snap().revision); };
    step('turn_started', { turnId: 'T1' });
    step('turn_started', { turnId: 'T1' }); // duplicate
    step('input_requested', { turnId: 'T1', inputId: 'w' });
    step('input_requested', { turnId: 'T1', inputId: 'w' }); // duplicate request
    step('input_resolved', { turnId: 'T1', inputId: 'other' }); // mismatched id
    step('input_resolved', { turnId: 'T1', inputId: 'w' });
    step('turn_completed', { turnId: 'T1', scope: 'child' }); // child
    step('turn_completed', { turnId: 'T1', sessionId: 'X' }); // wrong session
    step('turn_completed', { turnId: 'T1' });
    step('turn_completed', { turnId: 'T1' }); // duplicate completion
    expect(revisions).toEqual([1, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5]);
    expect(recorder.revisions()).toEqual([2, 3, 4, 5]);
  });

  it('bumps for session continuation and boundary, not for repeated boundaries', () => {
    const { snap, send } = rig();
    send('turn_started', { turnId: 'T1' });
    const started = snap().revision;
    send('session_continued', { sessionId: 'S2', continuesSessionId: 'S' });
    expect(snap()).toMatchObject({ sessionId: 'S2', revision: started + 1 });
    send('session_continued', { sessionId: 'S2', continuesSessionId: 'S' }); // stale continuation
    expect(snap().revision).toBe(started + 1);
    send('session_ended', { sessionId: 'S2' });
    const ended = snap().revision;
    expect(ended).toBe(started + 2);
    send('session_ended', { sessionId: 'S2' });
    expect(snap().revision).toBe(ended);
  });

  it('never lowers the revision when a terminal registration is replaced', () => {
    const { broker, snap, send, recorder } = rig();
    send('turn_started', { turnId: 'T1' });
    send('turn_completed', { turnId: 'T1' });
    const before = snap().revision;
    broker.registerRemote('t', 'codex');
    const replaced = recorder.changes[recorder.changes.length - 1];
    expect(replaced).toEqual({ terminalId: 't', revision: before + 1, snapshot: null });
    expect(broker.snapshot('t')!.revision).toBeGreaterThan(replaced.revision);
  });

  it('returns copy-safe snapshots', () => {
    const { broker, send, snap } = rig();
    send('turn_started', { turnId: 'T1' });
    const copy = snap();
    copy.runtime.status = 'failed';
    copy.revision = 99;
    expect(broker.snapshot('t')).toMatchObject({ runtime: { status: 'running' }, revision: 2 });
    expect(broker.snapshots().map((s) => s.terminalId)).toEqual(['t']);
    expect(broker.snapshot('missing')).toBeNull();
  });
});

describe('retirement tombstones', () => {
  it('retires on agent exit with a revisioned tombstone and removes it from hydration', () => {
    const { broker, send, recorder, snap } = rig();
    send('turn_started', { turnId: 'T1' });
    const live = snap().revision;
    send('agent_exited', { scope: undefined, sessionId: undefined });
    const tombstone = recorder.changes[recorder.changes.length - 1];
    expect(tombstone).toEqual({ terminalId: 't', revision: live + 1, snapshot: null });
    expect(broker.snapshots()).toEqual([]);
    expect(broker.snapshot('t')).toBeNull();
  });

  it('emits a tombstone for an external release and stays silent when nothing was registered', () => {
    const { broker, recorder, snap } = rig();
    const rev = snap().revision;
    broker.release('t');
    broker.release('t');
    broker.release('never');
    expect(recorder.changes).toEqual([{ terminalId: 't', revision: rev + 1, snapshot: null }]);
  });

  it('ignores late events after retirement', () => {
    const { send, broker, recorder } = rig();
    send('turn_started', { turnId: 'T1' });
    send('agent_exited');
    const count = recorder.changes.length;
    send('turn_completed', { turnId: 'T1' });
    expect(recorder.changes).toHaveLength(count);
    expect(broker.snapshot('t')).toBeNull();
  });
});

describe('late events after interruption', () => {
  it('cannot revive an interrupted turn', () => {
    const { snap, send } = rig();
    send('turn_started', { turnId: 'T1' });
    send('turn_interrupted', { turnId: 'T1' });
    const rev = snap().revision;
    expect(send('turn_completed', { turnId: 'T1' })).toBe('ignored-stale');
    expect(send('input_requested', { turnId: 'T1', inputId: 'w' })).toBe('ignored-stale');
    expect(send('turn_started', { turnId: 'T1' })).toBe('ignored-stale');
    expect(snap()).toMatchObject({ revision: rev, runtime: { status: 'idle' }, lastCompletion: null });
  });
});

describe('local and remote parity', () => {
  it('produces equivalent canonical snapshots for the same semantic sequence', async () => {
    const run = async (transport: 'local' | 'remote') => {
      const recorder = attentionRecorder();
      const broker = new AgentAttentionBroker(recorder.onChange, () => undefined, () => 5);
      brokers.push(broker);
      const token = transport === 'remote' ? broker.registerRemote('t', 'codex')
        : (await broker.register('t', 'codex')).CLANKER_ATTENTION_TOKEN;
      for (const [event, extra] of [['turn_started', { turnId: 'T' }], ['input_requested', { turnId: 'T', inputId: 'w', requestKind: 'approval' }],
        ['input_resolved', { turnId: 'T', inputId: 'w' }], ['turn_completed', { turnId: 'T' }]] as const) {
        const raw = JSON.stringify({ version: 1, token, harness: 'codex', event, scope: 'root', sessionId: 'S', ...extra });
        if (transport === 'remote') broker.receiveRemote('t', raw); else broker.receive(raw);
      }
      return recorder.changes;
    };
    expect(await run('local')).toEqual(await run('remote'));
  });
});

describe('source authority and fallback arbitration', () => {
  const fallback = (broker: AgentAttentionBroker, evidence: FallbackEvidence) => broker.receiveFallback('t', evidence);

  it('suppresses all fallback evidence under full structured authority', () => {
    const { broker, send, snap, diagnostics } = rig({ authority: 'full' });
    send('turn_started', { turnId: 'T1' });
    const rev = snap().revision;
    fallback(broker, 'visible_blocker');
    expect(snap()).toMatchObject({ revision: rev, pendingRequest: null });
    expect(diagnostics[diagnostics.length - 1]?.decision).toBe('fallback-suppressed:full-authority');
    expect(broker.explain('t')).toMatchObject({ suppressedFallbackReason: 'full-authority', source: { authority: 'full' } });
  });

  it('lets partial authority raise a blocker only inside a proven active turn', () => {
    const { broker, send, snap } = rig({ authority: 'partial' });
    fallback(broker, 'visible_blocker');
    expect(snap().pendingRequest).toBeNull();
    expect(broker.explain('t')?.suppressedFallbackReason).toBe('no-active-turn');
    send('turn_started', { turnId: 'T1' });
    fallback(broker, 'visible_blocker');
    expect(snap().pendingRequest).toMatchObject({ evidence: 'fallback', kind: null, id: null, turnId: 'T1' });
    expect(broker.explain('t')).toMatchObject({ effective: 'needs_input', source: { effectiveEvidence: 'fallback' } });
    // Weaker evidence can be retired by weaker evidence, and a structured request replaces it.
    fallback(broker, 'visible_working');
    expect(snap().pendingRequest).toBeNull();
    fallback(broker, 'visible_blocker');
    send('input_requested', { turnId: 'T1', inputId: 'w' });
    expect(snap().pendingRequest).toMatchObject({ evidence: 'structured', id: 'w' });
  });

  it('never lets a weak fallback clear or replace a structured wait', () => {
    const { broker, send, snap } = rig({ authority: 'partial' });
    send('turn_started', { turnId: 'T1' });
    send('input_requested', { turnId: 'T1', inputId: 'w' });
    const rev = snap().revision;
    fallback(broker, 'visible_working');
    fallback(broker, 'visible_blocker');
    fallback(broker, 'visible_idle');
    expect(snap()).toMatchObject({ revision: rev, pendingRequest: { evidence: 'structured', id: 'w' } });
  });

  it('cannot manufacture a completion, a turn or Working from ambiguous screens', () => {
    const { broker, send, snap } = rig({ authority: 'partial' });
    send('turn_started', { turnId: 'T1' });
    fallback(broker, 'visible_idle');
    expect(snap()).toMatchObject({ runtime: { status: 'running' }, lastCompletion: null });
    expect(broker.explain('t')?.suppressedFallbackReason).toBe('ambiguous-idle');
    send('turn_completed', { turnId: 'T1' });
    const rev = snap().revision;
    fallback(broker, 'visible_working');
    fallback(broker, 'visible_blocker');
    expect(snap()).toMatchObject({ revision: rev, runtime: { status: 'idle' } });
  });

  it('explains the latest accepted and rejected structured evidence without payloads', () => {
    const { broker, send } = rig();
    send('turn_started', { turnId: 'T1', nativeEvent: 'UserPromptSubmit' });
    send('turn_completed', { turnId: 'T0', nativeEvent: 'Stop' });
    const explained = broker.explain('t')!;
    expect(explained).toMatchObject({
      harness: 'codex', transport: 'remote', effective: 'working',
      lastAccepted: { semantic: 'turn_started', nativeEvent: 'UserPromptSubmit', revision: 2 },
      lastRejected: { semantic: 'turn_completed', nativeEvent: 'Stop', decision: 'ignored-stale' },
    });
    expect(broker.explain('missing')).toBeNull();
  });
});
