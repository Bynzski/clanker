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

describe('multiple correlated pending requests', () => {
  const start = () => {
    const r = rig();
    r.send('turn_started', { turnId: 'T' });
    return r;
  };
  const ask = (r: ReturnType<typeof rig>, inputId?: string, extra: Record<string, unknown> = {}) =>
    r.send('input_requested', { turnId: 'T', ...(inputId ? { inputId } : {}), ...extra });
  const resolve = (r: ReturnType<typeof rig>, inputId?: string, extra: Record<string, unknown> = {}) =>
    r.send('input_resolved', { turnId: 'T', ...(inputId ? { inputId } : {}), ...extra });

  it('keeps Needs Input until every distinct request has resolved', () => {
    const r = start();
    ask(r, 'A');
    ask(r, 'B');
    expect(r.snap().pendingRequest?.id).toBe('A');
    expect(resolve(r, 'A')).toBe('accepted');
    expect(r.snap().pendingRequest).toMatchObject({ id: 'B' });
    expect(r.broker.handoffState('t')).toBe('needs_input');
    expect(resolve(r, 'B')).toBe('accepted');
    expect(r.snap().pendingRequest).toBeNull();
    expect(r.broker.handoffState('t')).toBe('running');
  });

  it('resolving in the other order also leaves the remaining request pending', () => {
    const r = start();
    ask(r, 'A');
    ask(r, 'B');
    resolve(r, 'B');
    expect(r.snap().pendingRequest?.id).toBe('A');
    resolve(r, 'A');
    expect(r.snap().pendingRequest).toBeNull();
  });

  it('treats an exact duplicate request id as a no-op without bumping the revision', () => {
    const r = start();
    ask(r, 'A');
    const rev = r.snap().revision;
    expect(ask(r, 'A')).toBe('accepted');
    expect(r.snap().revision).toBe(rev);
    resolve(r, 'A');
    expect(r.snap().pendingRequest).toBeNull();
  });

  it('ignores mismatched, id-less and stale resolutions while requests are outstanding', () => {
    const r = start();
    ask(r, 'A');
    ask(r, 'B');
    const rev = r.snap().revision;
    expect(resolve(r, 'C')).toBe('ignored-stale');
    expect(resolve(r)).toBe('ignored-stale');
    expect(resolve(r, 'A', { sessionId: 'other' })).toBe('rejected-mismatch');
    expect(resolve(r, 'A', { scope: 'child' })).toBe('ignored-child');
    expect(ask(r, 'C', { scope: 'child' })).toBe('ignored-child');
    expect(r.snap().revision).toBe(rev);
    expect(r.broker.handoffState('t')).toBe('needs_input');
  });

  it('keeps an id-less wait fail-closed: only an id-less resolution or the turn boundary clears it', () => {
    const r = start();
    ask(r);
    ask(r, 'A');
    resolve(r, 'A');
    expect(r.snap().pendingRequest).toMatchObject({ id: null });
    expect(resolve(r, 'unrelated')).toBe('ignored-stale');
    expect(r.broker.handoffState('t')).toBe('needs_input');
    resolve(r);
    expect(r.snap().pendingRequest).toBeNull();
  });

  it.each([['turn_completed'], ['turn_interrupted'], ['turn_failed']])('%s clears every outstanding request', (boundary) => {
    const r = start();
    ask(r, 'A');
    ask(r, 'B');
    r.send(boundary, { turnId: 'T' });
    expect(r.snap().pendingRequest).toBeNull();
    expect(resolve(r, 'A')).toBe('ignored-stale');
  });

  it('a new turn drops requests that belonged to the previous turn', () => {
    const r = start();
    ask(r, 'A');
    r.send('turn_started', { turnId: 'T2' });
    expect(r.snap().pendingRequest).toBeNull();
  });

  it('carries the request kind of each wait and bumps the revision once per distinct change', () => {
    const r = start();
    ask(r, 'perm', { requestKind: 'approval' });
    const afterFirst = r.snap().revision;
    ask(r, 'question', { requestKind: 'input' });
    expect(r.snap().revision).toBe(afterFirst + 1);
    expect(r.snap().pendingRequest?.kind).toBe('approval');
    resolve(r, 'perm');
    expect(r.snap().pendingRequest).toMatchObject({ id: 'question', kind: 'input' });
  });

  it('a structured request replaces a fallback wait, and a structured resolution retires only fallback when nothing matches', () => {
    const r = rig({ authority: 'partial' });
    r.send('turn_started', { turnId: 'T' });
    r.broker.receiveFallback('t', 'visible_blocker');
    r.send('input_requested', { turnId: 'T', inputId: 'A' });
    expect(r.snap().pendingRequest).toMatchObject({ evidence: 'structured', id: 'A' });
    r.send('input_resolved', { turnId: 'T', inputId: 'A' });
    r.broker.receiveFallback('t', 'visible_blocker');
    expect(r.snap().pendingRequest?.evidence).toBe('fallback');
    r.send('input_resolved', { turnId: 'T', inputId: 'Z' });
    expect(r.snap().pendingRequest).toBeNull();
  });

  it('OpenCode semantics: per-request permission and question ids resolve independently', async () => {
    const recorder = attentionRecorder();
    const broker = new AgentAttentionBroker(recorder.onChange, () => undefined);
    brokers.push(broker);
    const token = broker.registerRemote('t', 'opencode');
    const send = (event: string, fields: Record<string, unknown> = {}) =>
      broker.receiveRemote('t', JSON.stringify({ version: 1, token, harness: 'opencode', event, scope: 'root', sessionId: 'S', turnId: '1', ...fields }));
    send('turn_started');
    send('input_requested', { inputId: 'perm-1', requestKind: 'approval' });
    send('input_requested', { inputId: 'q-1', requestKind: 'input' });
    send('input_resolved', { inputId: 'perm-1' });
    expect(broker.snapshot('t')?.pendingRequest).toMatchObject({ id: 'q-1', kind: 'input' });
    send('input_resolved', { inputId: 'q-1' });
    expect(broker.snapshot('t')?.pendingRequest).toBeNull();
  });
});


describe('provisional native settlement', () => {
  it.each([false, true])('preserves correlation without claiming work, input or completion (wait=%s)', (wait) => {
    const { broker, send, snap } = rig();
    send('turn_started', { turnId: 'T' });
    if (wait) send('input_requested', { turnId: 'T', inputId: 'approval', requestKind: 'approval' });
    send('turn_provisional', { turnId: 'T' });
    expect(snap()).toMatchObject({ runtime: { status: 'provisional', turnId: 'T' }, lastCompletion: null, lastOutcome: null });
    if (wait) expect(snap().pendingRequest).toMatchObject({ id: 'approval', resolutionUnknown: true });
    expect(broker.explain('t')?.effective).toBe('provisional');
    expect(broker.handoffState('t')).toBe('provisional');
    expect(broker.canHandoff('t')).toBe(false);
    broker.markSubmitted('t');
    expect(snap().runtime.status).toBe('provisional');
    send('turn_started', { turnId: 'next' });
    expect(snap()).toMatchObject({ runtime: { status: 'running', turnId: 'next' }, pendingRequest: null });
    const revision = snap().revision;
    expect(send('turn_provisional', { turnId: 'T' })).toBe('ignored-stale');
    expect(send('turn_provisional', { turnId: 'next', sessionId: 'foreign' })).toBe('rejected-mismatch');
    expect(snap().revision).toBe(revision);
  });

  it.each(['turn_interrupted', 'turn_failed', 'session_ended', 'turn_completed'])('accepts a later proven %s after provisional stop', event => {
    const { send, snap } = rig();
    send('turn_started', { turnId: 'T' });
    send('input_requested', { turnId: 'T', inputId: 'approval' });
    send('turn_provisional', { turnId: 'T' });
    send(event, { turnId: 'T' });
    expect(snap().pendingRequest).toBeNull();
    expect(snap().lastCompletion !== null).toBe(event === 'turn_completed');
    expect(snap().runtime.status).not.toBe('provisional');
  });

  it('a new native request restores only its own actionable evidence after provisional stop', () => {
    const { send, snap, broker } = rig();
    send('turn_started', { turnId: 'T' });
    send('input_requested', { turnId: 'T', inputId: 'old' });
    send('turn_provisional', { turnId: 'T' });
    send('input_requested', { turnId: 'T', inputId: 'new' });
    expect(broker.handoffState('t')).toBe('needs_input');
    expect(snap().pendingRequest).toMatchObject({ id: 'new' });
    send('input_resolved', { turnId: 'T', inputId: 'new' });
    expect(broker.handoffState('t')).toBe('running');
    expect(snap().pendingRequest).toMatchObject({ id: 'old', resolutionUnknown: true });
  });
});


it('requires the exact prior root and root scope for an explicit replacement', () => {
  const { send, snap } = rig();
  send('turn_started', { turnId: 'T' });
  send('turn_provisional', { turnId: 'T' });
  expect(send('session_replaced', { sessionId: 'next' })).toBe('rejected-ambiguous');
  expect(send('session_replaced', { sessionId: 'next', previousSessionId: 'foreign' })).toBe('rejected-mismatch');
  expect(send('session_replaced', { sessionId: 'next', previousSessionId: 'S', scope: 'child' })).toBe('ignored-child');
  expect(snap().sessionId).toBe('S');
  expect(send('session_replaced', { sessionId: 'next', previousSessionId: 'S' })).toBe('accepted');
  expect(snap()).toMatchObject({ sessionId: 'next', runtime: { status: 'unverified', turnId: null }, lastCompletion: null, lastOutcome: { kind: 'session_ended' } });
  expect(send('session_replaced', { sessionId: 'other', previousSessionId: 'S' })).toBe('rejected-mismatch');
});
