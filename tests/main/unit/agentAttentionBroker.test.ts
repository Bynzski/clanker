import { afterEach, describe, expect, it, vi } from 'vitest';
import * as net from 'node:net';
import { AgentAttentionBroker, type AttentionDiagnostic } from '../../../src/main/agentAttentionBroker';
import { attentionRecorder } from '../../_helpers/attentionChanges';

const brokers: AgentAttentionBroker[] = [];
afterEach(() => {
  for (const broker of brokers) broker.close();
  brokers.length = 0;
});

function setup(options?: { rootSessionId?: string; sessionModel?: 'process' | 'shared' }) {
  const recorder = attentionRecorder();
  const updates = recorder.changes;
  const diagnostics: AttentionDiagnostic[] = [];
  const broker = new AgentAttentionBroker(recorder.onChange, (diagnostic) => diagnostics.push(diagnostic));
  brokers.push(broker);
  const token = broker.registerRemote('term-a', 'codex', options);
  const send = (event: string, fields: Record<string, unknown> = {}) => {
    broker.receiveRemote('term-a', JSON.stringify({ version: 1, token, harness: 'codex', event, scope: 'root', ...fields }));
    return diagnostics[diagnostics.length - 1]?.decision;
  };
  return { broker, updates, labels: recorder.labels, recorder, diagnostics, send, token };
}

describe('AgentAttentionBroker transport and authentication', () => {
  it('binds a minimal local hook event to its registered terminal over loopback', async () => {
    const onUpdate = vi.fn();
    const broker = new AgentAttentionBroker(onUpdate, () => undefined);
    brokers.push(broker);
    const first = await broker.register('term-a', 'claude');
    const second = await broker.register('term-b', 'pi');
    const send = (env: Record<string, string>, payload: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(Number(env.CLANKER_ATTENTION_PORT), '127.0.0.1', () => socket.end(JSON.stringify({
        version: 1, token: env.CLANKER_ATTENTION_TOKEN, harness: payload.harness, ...payload.fields as object,
      })));
      socket.on('data', () => undefined);
      socket.on('close', () => resolve());
      socket.on('error', reject);
    });
    expect(broker.handoffState('term-a')).toBe('unverified');
    await send(first, { harness: 'claude', fields: { event: 'turn_started', scope: 'root', sessionId: 'session-a', turnId: 'turn-1' } });
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ terminalId: 'term-a', snapshot: expect.objectContaining({ runtime: expect.objectContaining({ status: 'running', turnId: 'turn-1' }) }) })));
    expect(second.CLANKER_ATTENTION_TOKEN).not.toBe(first.CLANKER_ATTENTION_TOKEN);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(broker.handoffState('term-a')).toBe('running');
    expect(broker.canHandoff('term-a')).toBe(false);
  });

  it('rejects cross-terminal, malformed, oversized and sensitive events', async () => {
    const { broker, updates, token } = setup();
    const base = { version: 1, token, harness: 'codex', event: 'turn_started', scope: 'root', sessionId: 'session-a', turnId: 'turn-1' };
    for (const bad of [
      { ...base, token: 'wrong' }, { ...base, harness: 'pi' }, { ...base, sessionId: 123 }, { ...base, event: 'write_terminal' },
      { ...base, prompt: 'x'.repeat(3000) }, { ...base, prompt: 'secret' }, { ...base, scope: 'admin' }, { ...base, nativeEvent: 'bad event!' },
      { ...base, inputId: '' },
    ]) broker.receiveRemote('term-a', JSON.stringify(bad));
    broker.receiveRemote('term-other', JSON.stringify(base));
    broker.receive(JSON.stringify(base));
    expect(updates).toEqual([]);
    broker.receiveRemote('term-a', JSON.stringify(base));
    expect(updates).toHaveLength(1);
  });

  it('publishes identity but never prompts, tool payloads or credentials', () => {
    const { send, updates, token } = setup();
    send('turn_started', { sessionId: 'session-a', turnId: 'turn-1' });
    expect(updates[0].snapshot).toMatchObject({ sessionId: 'session-a', runtime: { turnId: 'turn-1' } });
    expect(JSON.stringify(updates)).not.toContain(token);
  });
});

describe('AgentAttentionBroker root-session and turn correlation', () => {
  it('ignores completions from another session, a child, and a stale turn; settles the current root turn', () => {
    const { broker, send, labels } = setup();
    expect(send('turn_started', { sessionId: 'session-a', turnId: 'turn-1' })).toBe('accepted');
    expect(send('turn_completed', { sessionId: 'session-b', turnId: 'turn-1' })).toBe('rejected-mismatch');
    expect(send('turn_completed', { sessionId: 'session-a', turnId: 'turn-1', scope: 'child' })).toBe('ignored-child');
    expect(broker.isReady('term-a')).toBe(false);
    expect(send('turn_completed', { sessionId: 'session-a', turnId: 'turn-0' })).toBe('ignored-stale');
    expect(broker.handoffState('term-a')).toBe('running');
    expect(send('turn_completed', { sessionId: 'session-a', turnId: 'turn-1' })).toBe('accepted');
    expect(broker.isReady('term-a')).toBe(true);
    expect(labels).toEqual(['turn_started', 'turn_completed']);
  });

  it('does not let a completion establish the root or settle without a live turn', () => {
    const { broker, send, updates } = setup();
    expect(send('turn_completed', { sessionId: 'session-a', turnId: 'turn-1' })).toBe('rejected-ambiguous');
    expect(send('input_requested', { sessionId: 'session-a', turnId: 'turn-1' })).toBe('rejected-ambiguous');
    expect(updates).toEqual([]);
    expect(send('turn_started', { sessionId: 'session-a', turnId: 'turn-1' })).toBe('accepted');
    expect(send('turn_completed', { sessionId: 'session-a', turnId: 'turn-1' })).toBe('accepted');
    // A repeated completion has no foreground turn left to settle.
    expect(send('turn_completed', { sessionId: 'session-a', turnId: 'turn-1' })).toBe('ignored-stale');
    expect(broker.handoffState('term-a')).toBe('ready');
  });

  it('fails closed on unknown subjects and on events that cannot be tied to one foreground turn', () => {
    const { broker, send, updates, token } = setup();
    const raw = (fields: Record<string, unknown>) => broker.receiveRemote('term-a', JSON.stringify({ version: 1, token, harness: 'codex', ...fields }));
    raw({ event: 'turn_started', sessionId: 'session-a', turnId: 'turn-1' }); // no scope
    expect(send('turn_started', {})).toBe('rejected-ambiguous');
    expect(send('turn_started', { sessionId: 'session-a' })).toBe('rejected-ambiguous'); // no turn identity
    expect(updates).toEqual([]);
    send('turn_started', { sessionId: 'session-a', turnId: 'turn-1' });
    raw({ event: 'turn_completed', sessionId: 'session-a', turnId: 'turn-1' });
    expect(send('turn_completed', { sessionId: 'session-a' })).toBe('rejected-ambiguous');
    expect(broker.isReady('term-a')).toBe(false);
  });

  it('rejects a child subject even when the turn looks current', () => {
    const { broker, send } = setup();
    send('turn_started', { sessionId: 'session-a', turnId: 'turn-1' });
    expect(send('turn_completed', { sessionId: 'session-a', turnId: 'turn-1', scope: 'child' })).toBe('ignored-child');
    expect(send('turn_started', { sessionId: 'session-c', turnId: 'turn-9', scope: 'child' })).toBe('ignored-child');
    expect(broker.handoffState('term-a')).toBe('running');
  });

  it('never lets a late completion from turn A settle turn B, with provider-owned epochs and no native IDs', () => {
    // Adapters for harnesses without turn IDs emit an opaque per-turn epoch as turnId.
    const { broker, send } = setup();
    send('turn_started', { sessionId: 's', turnId: 'epoch-1' });
    send('turn_started', { sessionId: 's', turnId: 'epoch-2' }); // B starts while A's completion is still in flight
    expect(send('turn_completed', { sessionId: 's', turnId: 'epoch-1' })).toBe('ignored-stale');
    expect(broker.handoffState('term-a')).toBe('running');
    expect(send('turn_started', { sessionId: 's', turnId: 'epoch-1' })).toBe('ignored-stale'); // a retired turn cannot restart
    expect(send('turn_completed', { sessionId: 's', turnId: 'epoch-2' })).toBe('accepted');
    expect(send('turn_completed', { sessionId: 's', turnId: 'epoch-1' })).toBe('ignored-stale');
    expect(broker.isReady('term-a')).toBe(true);
  });

  it('prevents the previous turn from settling a Clanker-submitted turn until the native start names it', () => {
    const { broker, send } = setup();
    send('turn_started', { sessionId: 'session-a', turnId: 'turn-1' });
    send('turn_completed', { sessionId: 'session-a', turnId: 'turn-1' });
    broker.markSubmitted('term-a');
    expect(send('turn_completed', { sessionId: 'session-a', turnId: 'turn-1' })).toBe('ignored-stale');
    // Nothing can settle the submitted turn before the native start identifies it.
    expect(send('turn_completed', { sessionId: 'session-a', turnId: 'turn-2' })).toBe('ignored-stale');
    expect(broker.handoffState('term-a')).toBe('running');
    expect(send('turn_started', { sessionId: 'session-a', turnId: 'turn-2' })).toBe('accepted');
    expect(send('turn_completed', { sessionId: 'session-a', turnId: 'turn-2' })).toBe('accepted');
    expect(broker.isReady('term-a')).toBe(true);
  });

  it('handles input only for the root, only while a wait is outstanding, and only for the matching wait', () => {
    const { broker, send } = setup();
    send('turn_started', { sessionId: 'session-a', turnId: 'turn-1' });
    expect(send('input_requested', { sessionId: 'session-b', turnId: 'turn-1' })).toBe('rejected-mismatch');
    expect(send('input_resolved', { sessionId: 'session-a', turnId: 'turn-1' })).toBe('ignored-stale');
    expect(broker.handoffState('term-a')).toBe('running');
    expect(send('input_requested', { sessionId: 'session-a', turnId: 'turn-1', inputId: 'Bash' })).toBe('accepted');
    expect(broker.handoffState('term-a')).toBe('needs_input');
    expect(send('input_resolved', { sessionId: 'session-a', turnId: 'turn-1', inputId: 'Read' })).toBe('ignored-stale');
    expect(send('input_resolved', { sessionId: 'session-a', turnId: 'turn-1' })).toBe('ignored-stale');
    expect(send('input_resolved', { sessionId: 'session-a', turnId: 'turn-0', inputId: 'Bash' })).toBe('ignored-stale');
    expect(send('input_resolved', { sessionId: 'session-b', turnId: 'turn-1', inputId: 'Bash' })).toBe('rejected-mismatch');
    expect(broker.handoffState('term-a')).toBe('needs_input');
    expect(send('input_resolved', { sessionId: 'session-a', turnId: 'turn-1', inputId: 'Bash' })).toBe('accepted');
    expect(broker.handoffState('term-a')).toBe('running');
    // A stale resolution after the wait ended cannot do anything.
    expect(send('input_resolved', { sessionId: 'session-a', turnId: 'turn-1', inputId: 'Bash' })).toBe('ignored-stale');
  });

  it('keeps Needs Input through repeated start events and clears it on completion', () => {
    const { broker, send, labels } = setup();
    send('turn_started', { sessionId: 'session-a', turnId: 'turn-1' });
    send('input_requested', { sessionId: 'session-a', turnId: 'turn-1', inputId: 'Bash' });
    expect(send('turn_started', { sessionId: 'session-a', turnId: 'turn-1' })).toBe('accepted');
    expect(broker.handoffState('term-a')).toBe('needs_input');
    send('turn_completed', { sessionId: 'session-a', turnId: 'turn-1' });
    expect(broker.handoffState('term-a')).toBe('ready');
    expect(labels).toEqual(['turn_started', 'input_requested', 'turn_completed']);
  });
});

describe('AgentAttentionBroker turn interruption', () => {
  it('retires the active turn and wait without a completion, keeps the root, and allows a new turn', () => {
    const { broker, send, labels } = setup();
    send('turn_started', { sessionId: 'A', turnId: 'T1' });
    send('input_requested', { sessionId: 'A', turnId: 'T1', inputId: 'w1' });
    expect(send('turn_interrupted', { sessionId: 'B', turnId: 'T1' })).toBe('rejected-mismatch');
    expect(send('turn_interrupted', { sessionId: 'A', turnId: 'T0' })).toBe('ignored-stale');
    expect(send('turn_interrupted', { sessionId: 'A', turnId: 'T1', scope: 'child' })).toBe('ignored-child');
    expect(broker.handoffState('term-a')).toBe('needs_input');
    expect(send('turn_interrupted', { sessionId: 'A', turnId: 'T1' })).toBe('accepted');
    expect(broker.isReady('term-a')).toBe(false);
    expect(broker.canHandoff('term-a')).toBe(true);
    expect(send('turn_completed', { sessionId: 'A', turnId: 'T1' })).toBe('ignored-stale');
    expect(send('input_resolved', { sessionId: 'A', turnId: 'T1', inputId: 'w1' })).toBe('ignored-stale');
    expect(send('turn_started', { sessionId: 'A', turnId: 'T2' })).toBe('accepted');
    expect(labels).toEqual(['turn_started', 'input_requested', 'turn_interrupted', 'turn_started']);
  });
});

describe('AgentAttentionBroker session continuation', () => {
  it('moves the bound root to a continuation session without changing foreground state', () => {
    const { broker, send, labels } = setup();
    send('turn_started', { sessionId: 'A', turnId: 'T1' });
    expect(send('session_continued', { sessionId: 'B', continuesSessionId: 'A' })).toBe('accepted');
    expect(broker.handoffState('term-a')).toBe('running');
    expect(send('turn_completed', { sessionId: 'A', turnId: 'T1' })).toBe('rejected-mismatch');
    expect(send('turn_completed', { sessionId: 'B', turnId: 'T1' })).toBe('accepted');
    expect(labels).toEqual(['turn_started', 'session_continued', 'turn_completed']);
  });

  it('only accepts a continuation of the currently bound root', () => {
    const { send, broker } = setup();
    expect(send('session_continued', { sessionId: 'B', continuesSessionId: 'A' })).toBe('rejected-ambiguous');
    send('turn_started', { sessionId: 'A', turnId: 'T1' });
    expect(send('session_continued', { sessionId: 'C', continuesSessionId: 'other' })).toBe('rejected-mismatch');
    expect(send('session_continued', { sessionId: 'C' })).toBe('rejected-ambiguous');
    expect(send('session_continued', { sessionId: 'C', continuesSessionId: 'A', scope: 'child' })).toBe('ignored-child');
    expect(send('turn_completed', { sessionId: 'C', turnId: 'T1' })).toBe('rejected-mismatch');
    expect(broker.handoffState('term-a')).toBe('running');
  });

  it('is not a session boundary: the registration keeps its turn and handoff state', () => {
    const { broker, send } = setup();
    send('turn_started', { sessionId: 'A', turnId: 'T1' });
    send('session_continued', { sessionId: 'B', continuesSessionId: 'A' });
    expect(broker.canHandoff('term-a')).toBe(false);
    expect(send('session_ended', { sessionId: 'B' })).toBe('accepted');
    expect(broker.handoffState('term-a')).toBe('unverified');
  });
});

describe('AgentAttentionBroker session boundary versus agent exit', () => {
  it('clears the root on a native boundary, keeps the registration, and lets a new root bind', () => {
    const { broker, send, labels } = setup();
    send('turn_started', { sessionId: 'session-a', turnId: 'turn-1' });
    expect(send('session_ended', { sessionId: 'session-b' })).toBe('rejected-mismatch');
    expect(send('session_ended', { sessionId: 'session-a', scope: 'child' })).toBe('ignored-child');
    expect(send('session_ended', { sessionId: 'session-a' })).toBe('accepted');
    expect(broker.handoffState('term-a')).toBe('unverified');
    expect(broker.canHandoff('term-a')).toBe(true);
    // Late events from the ended session cannot touch the next one.
    expect(send('turn_completed', { sessionId: 'session-a', turnId: 'turn-1' })).toBe('rejected-ambiguous');
    expect(send('turn_started', { sessionId: 'session-b', turnId: 'turn-9' })).toBe('accepted');
    expect(send('turn_completed', { sessionId: 'session-a', turnId: 'turn-1' })).toBe('rejected-mismatch');
    expect(send('turn_completed', { sessionId: 'session-b', turnId: 'turn-9' })).toBe('accepted');
    expect(labels).toEqual(['turn_started', 'session_ended', 'turn_started', 'turn_completed']);
  });

  it('retires the registration when the harness exits to the fallback shell', async () => {
    const recorder = attentionRecorder();
    const updates = recorder.changes;
    const broker = new AgentAttentionBroker(recorder.onChange, () => undefined);
    brokers.push(broker);
    const env = await broker.register('term-a', 'codex');
    expect(broker.handoffState('term-a')).toBe('unverified');
    broker.markSubmitted('term-a');
    expect(broker.canHandoff('term-a')).toBe(true);
    const exited = { version: 1, token: env.CLANKER_ATTENTION_TOKEN, harness: 'codex', event: 'agent_exited' };
    broker.receive(JSON.stringify(exited));
    expect(broker.canHandoff('term-a')).toBe(false);
    expect(broker.handoffState('term-a')).toBe('unavailable');
    expect(updates).toEqual([{ terminalId: 'term-a', revision: 2, snapshot: null }]);
    // The credentials died with the agent: nothing can re-arm the fallback shell.
    broker.receive(JSON.stringify({ ...exited, event: 'turn_started', scope: 'root', sessionId: 's' }));
    expect(updates).toHaveLength(1);
  });

  it('keeps a live agent eligible for handoff without optional turn hooks, and PTY release is final', () => {
    const { broker, send, diagnostics } = setup();
    expect(broker.canHandoff('term-a')).toBe(true);
    send('turn_started', { sessionId: 'session-a', turnId: 'turn-1' });
    send('turn_completed', { sessionId: 'session-a', turnId: 'turn-1' });
    expect(broker.canHandoff('term-a')).toBe(true);
    broker.release('term-a');
    expect(broker.handoffState('term-a')).toBe('unavailable');
    send('turn_started', { sessionId: 'session-a', turnId: 'turn-1' });
    expect(diagnostics).toHaveLength(2);
  });

  it('retires a re-registered terminal credential', () => {
    const { broker, token, updates } = setup();
    broker.registerRemote('term-a', 'codex');
    broker.receiveRemote('term-a', JSON.stringify({ version: 1, token, harness: 'codex', event: 'turn_started', scope: 'root', sessionId: 's', turnId: 't' }));
    // Only the replacement's tombstone was published: the old credential changed nothing.
    expect(updates).toEqual([{ terminalId: 'term-a', revision: 2, snapshot: null }]);
    expect(broker.handoffState('term-a')).toBe('unverified');
    expect(broker.snapshot('term-a')?.revision).toBe(3);
  });
});

describe('AgentAttentionBroker trusted resume identity', () => {
  it('only binds an authenticated explicit root session start and preserves a running turn on duplicates', () => {
    const { broker, send, updates } = setup();
    expect(send('session_started', { sessionId: 'child', scope: 'child' })).toBe('ignored-child');
    expect(send('session_started', { sessionId: 'ambiguous', scope: undefined })).toBe('rejected-ambiguous');
    expect(send('session_started')).toBe('rejected-ambiguous');
    expect(broker.snapshot('term-a')?.sessionId).toBeNull();
    expect(send('session_started', { sessionId: 'root' })).toBe('accepted');
    expect(broker.snapshot('term-a')).toMatchObject({ sessionId: 'root', runtime: { status: 'unverified' }, lastCompletion: null });
    send('turn_started', { sessionId: 'root', turnId: 'turn' });
    send('input_requested', { sessionId: 'root', turnId: 'turn', inputId: 'approval' });
    const before = broker.snapshot('term-a');
    const count = updates.length;
    expect(send('session_started', { sessionId: 'root' })).toBe('accepted');
    expect(send('session_started', { sessionId: 'other' })).toBe('rejected-mismatch');
    expect(broker.snapshot('term-a')).toEqual(before);
    expect(updates).toHaveLength(count);
    expect(broker.handoffState('term-a')).toBe('needs_input');
  });

  it('seeds the validated root, which binds the resumed session without waiting for its first event', () => {
    const { broker, send } = setup({ rootSessionId: 'resumed' });
    expect(broker.snapshot('term-a')?.sessionId).toBe('resumed');
    expect(send('turn_started', { sessionId: 'resumed', turnId: 'turn-1' })).toBe('accepted');
    expect(broker.handoffState('term-a')).toBe('running');
  });

  it('starts unbound when no trusted identity is supplied (fresh launch or fork)', () => {
    const { send } = setup();
    expect(send('turn_started', { sessionId: 'new-session', turnId: 'turn-1' })).toBe('accepted');
  });

  it('drops the seeded identity at a session boundary', () => {
    const { send } = setup({ rootSessionId: 'resumed' });
    send('turn_started', { sessionId: 'resumed', turnId: 'turn-1' });
    send('session_ended', { sessionId: 'resumed' });
    expect(send('turn_started', { sessionId: 'other', turnId: 'turn-1' })).toBe('accepted');
  });
});

describe('AgentAttentionBroker diagnostics', () => {
  it('reports bounded, safe decision metadata only', () => {
    const { send, diagnostics } = setup();
    send('turn_started', { sessionId: 's'.repeat(128), turnId: 't'.repeat(100), nativeEvent: 'UserPromptSubmit' });
    expect(diagnostics[0]).toEqual({
      harness: 'codex', terminalId: 'term-a', nativeEvent: 'UserPromptSubmit', sessionId: 's'.repeat(64), turnId: 't'.repeat(64),
      semantic: 'turn_started', decision: 'accepted', verdict: 'accepted-changed', revision: 2, status: 'running',
    });
    expect(Object.keys(diagnostics[0])).not.toContain('token');
  });
});

describe('AgentAttentionBroker agent location', () => {
  const location = (broker: AgentAttentionBroker) => broker.snapshot('term-a')?.location ?? null;

  it('starts without a location and records the root agent\'s reported directory with the lifecycle change it came with', () => {
    const { broker, send, labels } = setup();
    expect(location(broker)).toBeNull();
    expect(send('turn_started', { sessionId: 'root', turnId: 't1', cwd: '/srv/repo-worktrees/wt-1' })).toBe('accepted');
    expect(location(broker)).toEqual({ path: '/srv/repo-worktrees/wt-1', checkoutContextId: null });
    // One authoritative change carried both facts.
    expect(labels).toEqual(['turn_started']);
  });

  it('follows a move as its own revision and does not advance the revision for an unchanged report', () => {
    const { broker, send, recorder } = setup();
    send('turn_started', { sessionId: 'root', turnId: 't1', cwd: '/srv/repo-worktrees/wt-1' });
    const before = recorder.revisions().length;
    expect(send('location_changed', { sessionId: 'root', cwd: '/srv/repo' })).toBe('accepted');
    expect(location(broker)).toEqual({ path: '/srv/repo', checkoutContextId: null });
    expect(broker.handoffState('term-a')).toBe('running');
    expect(recorder.revisions().length).toBe(before + 1);
    send('location_changed', { sessionId: 'root', cwd: '/srv/repo/' });
    send('turn_completed', { sessionId: 'root', turnId: 't1', cwd: '/srv/repo' });
    expect(recorder.revisions().length).toBe(before + 2);
    expect(location(broker)).toEqual({ path: '/srv/repo', checkoutContextId: null });
  });

  it('never lets a delayed retired-turn report overwrite newer location evidence', () => {
    const { broker, send } = setup();
    send('turn_started', { sessionId: 'root', turnId: 't1', cwd: '/srv/a' });
    send('turn_completed', { sessionId: 'root', turnId: 't1', cwd: '/srv/a' });
    expect(send('turn_completed', { sessionId: 'root', turnId: 't1', cwd: '/srv/b' })).toBe('ignored-stale');
    expect(location(broker)).toEqual({ path: '/srv/a', checkoutContextId: null });
  });

  it.each(['session_replaced', 'session_continued'])('publishes %s with its new-session location atomically', (event) => {
    const { broker, send, updates } = setup();
    send('turn_started', { sessionId: 'old', turnId: 't1', cwd: '/srv/old' });
    const before = updates.length;
    expect(send(event, { sessionId: 'new', previousSessionId: 'old', continuesSessionId: 'old', cwd: '/srv/new' })).toBe('accepted');
    expect(updates.slice(before)).toHaveLength(1);
    expect(updates[updates.length - 1]?.snapshot).toMatchObject({ sessionId: 'new', location: { path: '/srv/new' }, locationProvenance: { state: 'current', sessionId: 'new' } });
    expect(broker.locationObservation('term-a')).toMatchObject({ sessionId: 'new', state: 'current' });
    expect(send('location_changed', { sessionId: 'old', cwd: '/srv/old' })).toBe('rejected-mismatch');
    expect(location(broker)?.path).toBe('/srv/new');
  });

  it('publishes authenticated provenance across a session boundary and same-path re-report without making historical evidence current implicitly', () => {
    const { broker, send, updates } = setup();
    send('session_started', { sessionId: 'old', cwd: '/srv/a' });
    expect(broker.snapshot('term-a')?.locationProvenance).toEqual({ state: 'current', sessionId: 'old' });
    send('session_replaced', { sessionId: 'new', previousSessionId: 'old' });
    expect(broker.snapshot('term-a')?.locationProvenance).toEqual({ state: 'last-reported', sessionId: 'old' });
    const before = updates.length;
    expect(send('location_changed', { sessionId: 'new', cwd: '/srv/a' })).toBe('accepted');
    expect(updates.slice(before)).toHaveLength(1);
    expect(broker.snapshot('term-a')?.locationProvenance).toEqual({ state: 'current', sessionId: 'new' });
    send('location_changed', { sessionId: 'old', cwd: '/srv/elsewhere' });
    expect(updates.slice(before)).toHaveLength(1);
  });

  it('does not acquire location evidence from an ambiguous completion or refresh it from stale delivery', () => {
    const { broker, send } = setup();
    expect(send('turn_completed', { sessionId: 'root', turnId: 't1', cwd: '/srv/b' })).toBe('rejected-ambiguous');
    expect(broker.locationObservation('term-a')).toBeNull();
    send('turn_started', { sessionId: 'root', turnId: 't1', cwd: '/srv/a' });
    const observation = broker.locationObservation('term-a');
    send('turn_completed', { sessionId: 'root', turnId: 'wrong', cwd: '/srv/b' });
    expect(broker.locationObservation('term-a')).toEqual(observation);
  });

  it('tracks repeat-report freshness in main without duplicate renderer publications', () => {
    let now = 100;
    const changes = vi.fn();
    const broker = new AgentAttentionBroker(changes, () => undefined, () => now);
    brokers.push(broker);
    const token = broker.registerRemote('t', 'pi');
    const send = (event: string, fields: object = {}) => broker.receiveRemote('t', JSON.stringify({ version: 1, token, harness: 'pi', scope: 'root', sessionId: 's', event, ...fields }));
    send('session_started', { cwd: '/srv/a' });
    expect(broker.locationObservation('t')).toMatchObject({ lastReportedAt: 100, state: 'current' });
    now = 200;
    send('location_changed', { cwd: '/srv/a' });
    expect(changes).toHaveBeenCalledTimes(1);
    expect(broker.locationObservation('t')).toMatchObject({ lastReportedAt: 200, state: 'current' });
    send('session_ended');
    expect(broker.locationObservation('t')).toMatchObject({ lastReportedAt: 200, state: 'last-reported' });
    send('agent_exited');
    expect(broker.locationObservation('t')).toBeNull();
  });

  it('never takes a location from a child, another session, or an event without a session', () => {
    const { broker, send, updates } = setup({ rootSessionId: 'root' });
    expect(send('location_changed', { sessionId: 'root', scope: 'child', cwd: '/srv/child' })).toBe('ignored-child');
    expect(send('location_changed', { sessionId: 'other', cwd: '/srv/other' })).toBe('rejected-mismatch');
    expect(send('location_changed', { cwd: '/srv/none' })).toBe('rejected-ambiguous');
    expect(send('location_changed', { sessionId: 'root' })).toBe('rejected-ambiguous');
    expect(location(broker)).toBeNull();
    expect(updates).toEqual([]);
  });

  it('rejects an event whose location is not an absolute directory', () => {
    const { broker, send, updates } = setup();
    for (const cwd of ['relative', '', 5, '/a\nb']) send('turn_started', { sessionId: 'root', turnId: 't1', cwd });
    expect(updates).toEqual([]);
    expect(location(broker)).toBeNull();
  });

  it('publishes the checkout context main resolves for the reporting terminal, and rejects what it cannot resolve', () => {
    const calls: unknown[][] = [];
    const broker = new AgentAttentionBroker(() => undefined, () => undefined, Date.now, {
      resolveLocation: (terminalId, transport, cwd) => {
        calls.push([terminalId, transport, cwd]);
        return cwd === '/srv/repo' ? { path: '/srv/repo', checkoutContextId: 'ws::main' } : null;
      },
    });
    brokers.push(broker);
    const token = broker.registerRemote('term-a', 'claude');
    const send = (cwd: string) => broker.receiveRemote('term-a', JSON.stringify({ version: 1, token, harness: 'claude', event: 'turn_started', scope: 'root', sessionId: 'root', turnId: 't1', cwd }));
    send('/elsewhere');
    expect(broker.snapshot('term-a')?.runtime.status).toBe('unverified');
    send('/srv/repo');
    expect(broker.snapshot('term-a')?.location).toEqual({ path: '/srv/repo', checkoutContextId: 'ws::main' });
    expect(calls).toEqual([['term-a', 'remote', '/elsewhere'], ['term-a', 'remote', '/srv/repo']]);
  });

  it('keeps the location across a native session boundary and drops it with the agent on exit', () => {
    const { broker, send } = setup();
    send('turn_started', { sessionId: 'root', turnId: 't1', cwd: '/srv/repo' });
    send('session_ended', { sessionId: 'root', cwd: '/srv/repo' });
    expect(location(broker)).toEqual({ path: '/srv/repo', checkoutContextId: null });
    expect(send('location_changed', { sessionId: 'next', cwd: '/srv/repo/sub' })).toBe('accepted');
    expect(location(broker)).toEqual({ path: '/srv/repo/sub', checkoutContextId: null });
    send('agent_exited');
    expect(broker.snapshot('term-a')).toBeNull();
  });
});

describe('AgentAttentionBroker lost lifecycle source', () => {
  it('gives up the open turn and its waits when the provider can no longer deliver, and recovers on the next real turn', () => {
    const { broker, send, recorder } = setup();
    send('turn_started', { sessionId: 'root', turnId: 't1', cwd: '/srv/wt' });
    send('input_requested', { sessionId: 'root', turnId: 't1', inputId: 'w1' });
    const revisions = recorder.revisions().length;

    expect(broker.markLifecycleLost('term-a')).toBe(true);
    expect(broker.snapshot('term-a')).toMatchObject({ runtime: { status: 'unverified', turnId: null }, pendingRequest: null, location: { path: '/srv/wt' }, locationProvenance: { state: 'unavailable', sessionId: 'root' } });
    expect(broker.locationObservation('term-a')?.state).toBe('unavailable');
    expect(recorder.revisions().length).toBe(revisions + 1);
    // The abandoned turn can never settle anything later.
    expect(send('turn_completed', { sessionId: 'root', turnId: 't1' })).toBe('ignored-stale');
    // Once hooks run again (for example after the agent moved somewhere that exists), a new turn works.
    expect(send('turn_started', { sessionId: 'root', turnId: 't2', cwd: '/srv/main' })).toBe('accepted');
    expect(broker.handoffState('term-a')).toBe('running');
    expect(broker.snapshot('term-a')?.locationProvenance).toEqual({ state: 'current', sessionId: 'root' });
  });

  it('changes nothing for an agent with no open turn or wait, or an unknown terminal', () => {
    const { broker, send, recorder } = setup();
    send('turn_started', { sessionId: 'root', turnId: 't1' });
    send('turn_completed', { sessionId: 'root', turnId: 't1' });
    const revisions = recorder.revisions().length;
    expect(broker.markLifecycleLost('term-a')).toBe(false);
    expect(broker.markLifecycleLost('nobody')).toBe(false);
    expect(recorder.revisions().length).toBe(revisions);
    expect(broker.handoffState('term-a')).toBe('ready');
  });
});

describe('AgentAttentionBroker session ownership', () => {
  it('recovers a process-scoped root after a lost session boundary and publishes the boundary as its own fact', () => {
    const { broker, send, updates } = setup({ sessionModel: 'process' });
    send('turn_started', { sessionId: 'A', turnId: 'T1' });
    send('turn_completed', { sessionId: 'A', turnId: 'T1' });
    const before = updates.length;
    expect(send('turn_started', { sessionId: 'B', turnId: 'T1' })).toBe('accepted');
    const published = updates.slice(before).map((update) => update.snapshot);
    expect(published[0]).toMatchObject({ sessionId: 'B', runtime: { status: 'unverified' }, lastOutcome: { kind: 'session_ended' } });
    expect(published[published.length - 1]).toMatchObject({ sessionId: 'B', runtime: { status: 'running', turnId: 'T1' } });
    // The replaced root's late events change nothing; its old turn IDs no longer collide.
    expect(send('turn_completed', { sessionId: 'A', turnId: 'T1' })).toBe('rejected-mismatch');
    expect(broker.handoffState('term-a')).toBe('running');
    expect(send('turn_completed', { sessionId: 'B', turnId: 'T1' })).toBe('accepted');
    expect(broker.handoffState('term-a')).toBe('ready');
  });

  it('never lets another session take a shared terminal during execution, a wait, or provisional Stop', () => {
    const { broker, send } = setup();
    send('turn_started', { sessionId: 'A', turnId: 'T1' });
    expect(send('session_started', { sessionId: 'B' })).toBe('rejected-mismatch');
    send('input_requested', { sessionId: 'A', turnId: 'T1', inputId: 'w' });
    expect(send('turn_started', { sessionId: 'B', turnId: 'X' })).toBe('rejected-mismatch');
    expect(broker.snapshot('term-a')?.sessionId).toBe('A');
    send('turn_provisional', { sessionId: 'A', turnId: 'T1' });
    // Non-actionable history is not proof that another root was selected.
    expect(send('session_started', { sessionId: 'B' })).toBe('rejected-mismatch');
    expect(send('turn_started', { sessionId: 'B', turnId: 'X' })).toBe('rejected-mismatch');
    expect(broker.snapshot('term-a')).toMatchObject({ sessionId: 'A', runtime: { status: 'provisional' } });
  });

  it('always follows the newest session for one-session-per-process providers, even after a lost settle', () => {
    const { broker, send } = setup({ sessionModel: 'process' });
    send('turn_started', { sessionId: 'A', turnId: 'i1.1' });
    // Invalid starts and non-starts cannot replace even a process-scoped root.
    expect(send('turn_started', { sessionId: 'B' })).toBe('rejected-ambiguous');
    expect(send('turn_completed', { sessionId: 'B', turnId: 'i2.1' })).toBe('rejected-mismatch');
    expect(broker.snapshot('term-a')?.sessionId).toBe('A');
    // The settle was lost; Pi then replaced the session (its old runtime is gone).
    expect(send('session_started', { sessionId: 'B' })).toBe('accepted');
    expect(send('turn_started', { sessionId: 'B', turnId: 'i2.1' })).toBe('accepted');
    expect(broker.snapshot('term-a')).toMatchObject({ sessionId: 'B', runtime: { status: 'running', turnId: 'i2.1' } });
  });

  it('protects a seeded shared root even after it reports; only a proven replacement changes it', () => {
    const { broker, send } = setup({ rootSessionId: 'resumed' });
    expect(send('turn_started', { sessionId: 'auxiliary', turnId: 'x' })).toBe('rejected-mismatch');
    expect(send('session_started', { sessionId: 'resumed' })).toBe('accepted');
    expect(send('session_started', { sessionId: 'next' })).toBe('rejected-mismatch');
    expect(send('session_replaced', { sessionId: 'next', previousSessionId: 'wrong' })).toBe('rejected-mismatch');
    expect(send('session_replaced', { sessionId: 'next', previousSessionId: 'resumed' })).toBe('accepted');
    expect(send('turn_started', { sessionId: 'next', turnId: 'n1' })).toBe('accepted');
    expect(broker.snapshot('term-a')?.sessionId).toBe('next');
  });

  it('rejects the idle A → background B takeover and continues tracking A after rejected reports', () => {
    const { broker, send, updates } = setup();
    send('turn_started', { sessionId: 'A', turnId: 'T1' });
    send('turn_completed', { sessionId: 'A', turnId: 'T1' });
    const before = updates.length;
    for (const event of ['session_started', 'turn_started', 'turn_completed']) {
      expect(send(event, { sessionId: 'B', turnId: 'B1' })).toBe('rejected-mismatch');
    }
    expect(updates).toHaveLength(before);
    expect(broker.snapshot('term-a')?.sessionId).toBe('A');
    expect(send('turn_started', { sessionId: 'A', turnId: 'T2' })).toBe('accepted');
    expect(send('turn_completed', { sessionId: 'A', turnId: 'T1' })).toBe('ignored-stale');
    expect(broker.handoffState('term-a')).toBe('running');
    expect(send('turn_completed', { sessionId: 'A', turnId: 'T2' })).toBe('accepted');
  });

  it('does not allow cached readiness after identity rejection; the bound root can restore it', () => {
    const { broker, send } = setup();
    broker.setCapability('term-a', { requested: true, attachment: 'prepared' });
    send('turn_started', { sessionId: 'A', turnId: 'T1' });
    send('turn_completed', { sessionId: 'A', turnId: 'T1' });
    expect(broker.canHandoff('term-a')).toBe(true);
    send('session_started', { sessionId: 'B' });
    send('turn_started', { sessionId: 'B', turnId: 'B1' });
    expect(broker.handoffState('term-a')).toBe('unavailable');
    expect(broker.canHandoff('term-a')).toBe(false);
    send('turn_started', { sessionId: 'A', turnId: 'T2' });
    expect(broker.handoffState('term-a')).toBe('running');
    send('turn_completed', { sessionId: 'A', turnId: 'T2' });
    expect(broker.canHandoff('term-a')).toBe(true);
  });

  it('does not guess a selected shared session after an incorrect first root report', () => {
    const { broker, send } = setup();
    send('session_started', { sessionId: 'incorrect' });
    expect(send('turn_started', { sessionId: 'selected', turnId: 'T1' })).toBe('rejected-mismatch');
    // Recovery needs provider-proven identity, not another most-recent report.
    expect(send('session_replaced', { sessionId: 'selected', previousSessionId: 'incorrect' })).toBe('accepted');
    expect(send('turn_started', { sessionId: 'selected', turnId: 'T1' })).toBe('accepted');
    expect(broker.handoffState('term-a')).toBe('running');
  });
});

describe('AgentAttentionBroker stop presentation and trace', () => {
  it('refuses a pending handoff at Stop without retiring the turn, and accepts subsequent native activity', () => {
    const { broker, send, updates } = setup();
    send('turn_started', { sessionId: 'A', turnId: 'T1' });
    send('turn_provisional', { sessionId: 'A', turnId: 'T1' });
    const stopped = broker.snapshot('term-a');
    const before = updates.length;
    expect(broker.canHandoff('term-a')).toBe(false);
    broker.markSubmitted('term-a'); // Even a stale caller cannot retire a provisional turn.
    expect(broker.snapshot('term-a')).toEqual(stopped);
    expect(updates).toHaveLength(before);
    expect(send('turn_activity', { sessionId: 'A', turnId: 'T1' })).toBe('accepted');
    expect(broker.handoffState('term-a')).toBe('running');
    expect(send('turn_started', { sessionId: 'A', turnId: 'T2' })).toBe('accepted');
    expect(send('turn_completed', { sessionId: 'A', turnId: 'T1' })).toBe('ignored-stale');
    expect(send('turn_completed', { sessionId: 'A', turnId: 'T2' })).toBe('accepted');
    expect(broker.canHandoff('term-a')).toBe(true);
  });

  it('keeps the stop revision stable across unrelated revisions while stopped', () => {
    const { broker, send } = setup();
    send('turn_started', { sessionId: 'A', turnId: 'T1' });
    send('turn_provisional', { sessionId: 'A', turnId: 'T1' });
    const stopped = broker.snapshot('term-a')!;
    expect(stopped.runtime.stopRevision).toBe(stopped.revision);
    broker.setCapability('term-a', { requested: true, attachment: 'prepared' });
    expect(broker.snapshot('term-a')!.revision).toBeGreaterThan(stopped.revision);
    expect(broker.snapshot('term-a')!.runtime.stopRevision).toBe(stopped.revision);
    send('turn_activity', { sessionId: 'A', turnId: 'T1' });
    expect(broker.snapshot('term-a')!.runtime).not.toHaveProperty('stopRevision');
  });

  it('records a bounded, content-free trace that survives release', () => {
    const { broker, send } = setup();
    send('turn_started', { sessionId: 'SECRET-SESSION', turnId: 'SECRET-TURN' });
    send('turn_completed', { sessionId: 'other', turnId: 'x' });
    broker.release('term-a');
    const trace = broker.trace('term-a');
    expect(trace.map((entry) => entry.semantic)).toEqual(['registered', 'turn_started', 'turn_completed', 'released']);
    expect(trace.map((entry) => entry.verdict)).toEqual([undefined, 'accepted-changed', 'rejected-mismatch', undefined]);
    expect(JSON.stringify(trace)).not.toMatch(/SECRET/);
    for (let i = 0; i < 100; i++) send('turn_started', { sessionId: 'x', turnId: String(i) });
    expect(broker.trace('term-a').length).toBeLessThanOrEqual(64);
  });
});
