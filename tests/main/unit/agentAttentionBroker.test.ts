import { afterEach, describe, expect, it, vi } from 'vitest';
import * as net from 'node:net';
import { AgentAttentionBroker, type AttentionDiagnostic } from '../../../src/main/agentAttentionBroker';
import { attentionRecorder } from '../../_helpers/attentionChanges';

const brokers: AgentAttentionBroker[] = [];
afterEach(() => {
  for (const broker of brokers) broker.close();
  brokers.length = 0;
});

function setup(options?: { rootSessionId?: string }) {
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
    expect(send('turn_started', { sessionId: 'B', turnId: 'T2' })).toBe('rejected-mismatch'); // root stays bound
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
  it('seeds the validated root so other sessions cannot bind first', () => {
    const { broker, send } = setup({ rootSessionId: 'resumed' });
    expect(send('turn_started', { sessionId: 'hidden-title-thread', turnId: 'turn-1' })).toBe('rejected-mismatch');
    expect(broker.handoffState('term-a')).toBe('unverified');
    expect(send('turn_started', { sessionId: 'resumed', turnId: 'turn-1' })).toBe('accepted');
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
      semantic: 'turn_started', decision: 'accepted', revision: 2, status: 'running',
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

  it('records a location even when the event cannot change foreground state', () => {
    const { broker, send } = setup();
    send('turn_started', { sessionId: 'root', turnId: 't1', cwd: '/srv/a' });
    send('turn_completed', { sessionId: 'root', turnId: 't1', cwd: '/srv/a' });
    expect(send('turn_completed', { sessionId: 'root', turnId: 't1', cwd: '/srv/b' })).toBe('ignored-stale');
    expect(location(broker)).toEqual({ path: '/srv/b', checkoutContextId: null });
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
    expect(broker.snapshot('term-a')).toMatchObject({ runtime: { status: 'unverified', turnId: null }, pendingRequest: null, location: { path: '/srv/wt' } });
    expect(recorder.revisions().length).toBe(revisions + 1);
    // The abandoned turn can never settle anything later.
    expect(send('turn_completed', { sessionId: 'root', turnId: 't1' })).toBe('ignored-stale');
    // Once hooks run again (for example after the agent moved somewhere that exists), a new turn works.
    expect(send('turn_started', { sessionId: 'root', turnId: 't2', cwd: '/srv/main' })).toBe('accepted');
    expect(broker.handoffState('term-a')).toBe('running');
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
