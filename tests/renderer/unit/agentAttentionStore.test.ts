import { beforeEach, describe, expect, it } from 'vitest';
import { attentionCounts, useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { deriveAttention } from '../../../src/renderer/lib/agentAttentionPresentation';
import { nextAttentionTarget } from '../../../src/renderer/lib/agentAttentionNavigation';
import type { WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';
import { change, EMPTY_ATTENTION, snapshot, tombstone } from '../../_helpers/attentionSnapshots';

const store = () => useAgentAttentionStore.getState();
const view = (id: string) => deriveAttention(store().byTerminalId[id], store().seenByTerminalId[id]);
beforeEach(() => useAgentAttentionStore.setState(EMPTY_ATTENTION));

describe('deriveAttention (pure projection of canonical facts)', () => {
  it('ranks pending request, then active work, then failure, then unseen completion', () => {
    expect(deriveAttention(undefined, undefined)).toBeNull();
    expect(deriveAttention(snapshot('t', 'unverified'), undefined)).toBeNull();
    expect(deriveAttention(snapshot('t', 'idle'), undefined)).toBeNull();
    expect(deriveAttention(snapshot('t', 'starting'), undefined)).toEqual({ display: 'running', unseen: false });
    expect(deriveAttention(snapshot('t', 'running'), undefined)).toEqual({ display: 'running', unseen: false });
    expect(deriveAttention(snapshot('t', 'needs_input', 5), undefined)).toEqual({ display: 'needs_input', unseen: true });
    expect(deriveAttention(snapshot('t', 'approval', 5), undefined)).toEqual({ display: 'needs_input', unseen: true });
    expect(deriveAttention(snapshot('t', 'failed', 5), undefined)).toEqual({ display: 'failed', unseen: false });
    expect(deriveAttention(snapshot('t', 'completed', 5), undefined)).toEqual({ display: 'turn_complete', unseen: true });
    // A request outranks the running turn it belongs to; running outranks an older completion.
    const waiting = snapshot('t', 'needs_input', 7, { lastCompletion: { turnId: 'A', revision: 3, completedAt: 1 } });
    expect(deriveAttention(waiting, undefined)?.display).toBe('needs_input');
    const working = snapshot('t', 'running', 8, { lastCompletion: { turnId: 'A', revision: 3, completedAt: 1 } });
    expect(deriveAttention(working, { completion: 0, request: 0 })?.display).toBe('running');
  });

  it('never shows an older completion as Done after a newer interrupt, failure or session end', () => {
    const history = { lastCompletion: { turnId: 'A', revision: 3, completedAt: 1 } };
    expect(deriveAttention(snapshot('t', 'interrupted', 9, history), undefined)).toBeNull();
    expect(deriveAttention(snapshot('t', 'failed', 9, history), undefined)?.display).toBe('failed');
    expect(deriveAttention(snapshot('t', 'unverified', 9, { ...history, lastOutcome: { kind: 'session_ended', turnId: null, revision: 9, at: 2 } }), undefined)).toBeNull();
  });

  it('hides an acknowledged completion and shows the next one as unseen again', () => {
    expect(deriveAttention(snapshot('t', 'completed', 4), { completion: 4, request: 0 })).toBeNull();
    expect(deriveAttention(snapshot('t', 'completed', 6), { completion: 4, request: 0 })).toEqual({ display: 'turn_complete', unseen: true });
  });
});

describe('snapshot cache revision merge', () => {
  it('accepts newer and equal revisions idempotently and rejects older ones', () => {
    store().applyChange(change(snapshot('a', 'running', 5)), false);
    store().applyChange(change(snapshot('a', 'completed', 4)), false);
    expect(store().byTerminalId.a.runtime.status).toBe('running');
    const before = store().byTerminalId.a;
    store().applyChange(change(snapshot('a', 'running', 5)), false);
    expect(store().byTerminalId.a.revision).toBe(5);
    expect(store().byTerminalId.a).toEqual(before);
    store().applyChange(change(snapshot('a', 'completed', 6)), false);
    expect(store().byTerminalId.a.runtime.status).toBe('idle');
  });

  it('subscribe-then-hydrate: a pushed revision 12 is never overwritten by a hydrated revision 11', () => {
    store().applyChange(change(snapshot('a', 'needs_input', 12)), false);
    store().hydrate([snapshot('a', 'running', 11), snapshot('b', 'running', 3)], () => false);
    expect(store().byTerminalId.a.revision).toBe(12);
    expect(view('a')?.display).toBe('needs_input');
    expect(view('b')?.display).toBe('running');
  });

  it('hydration restores Running, Needs Input and an unseen completion', () => {
    store().hydrate([snapshot('r', 'running', 2), snapshot('n', 'needs_input', 3), snapshot('c', 'completed', 4)], () => false);
    expect(view('r')).toEqual({ display: 'running', unseen: false });
    expect(view('n')).toEqual({ display: 'needs_input', unseen: true });
    expect(view('c')).toEqual({ display: 'turn_complete', unseen: true });
  });

  it('a tombstone retires the agent and blocks stale or hydrated resurrection', () => {
    store().applyChange(change(snapshot('a', 'running', 5)), false);
    store().applyChange(tombstone('a', 6), false);
    expect(store().byTerminalId.a).toBeUndefined();
    store().applyChange(change(snapshot('a', 'running', 5)), false); // stale in-flight push
    store().hydrate([snapshot('a', 'running', 6)], () => false); // equal-revision hydration
    expect(store().byTerminalId.a).toBeUndefined();
    store().applyChange(change(snapshot('a', 'running', 6)), false); // equal-revision push
    expect(store().byTerminalId.a).toBeUndefined();
    expect(store().revisionByTerminalId.a).toBe(6);
    // A genuinely newer registration may reappear.
    store().applyChange(change(snapshot('a', 'idle', 8)), false);
    expect(store().byTerminalId.a.revision).toBe(8);
  });

  it('a tombstone dominates a live snapshot at the same revision, in any arrival order', () => {
    store().applyChange(change(snapshot('a', 'running', 5)), false);
    store().applyChange(tombstone('a', 6), false);
    store().applyChange(change(snapshot('a', 'running', 6)), false);
    expect(store().byTerminalId.a).toBeUndefined();
    // Tombstone arriving at the revision of the cached live snapshot retires it.
    store().applyChange(change(snapshot('b', 'running', 4)), false);
    store().applyChange(tombstone('b', 4), false);
    expect(store().byTerminalId.b).toBeUndefined();
  });

  it('redelivery of the same live revision is idempotent and never replaced by a conflicting payload', () => {
    store().applyChange(change(snapshot('a', 'running', 5)), false);
    const cached = store().byTerminalId.a;
    store().applyChange(change(snapshot('a', 'needs_input', 5)), false);
    expect(store().byTerminalId.a).toBe(cached);
  });

  it('local retirement cannot be undone by a same-revision late push', () => {
    store().applyChange(change(snapshot('a', 'running', 5)), false);
    store().retire('a');
    store().applyChange(change(snapshot('a', 'running', 5)), false);
    store().hydrate([snapshot('a', 'running', 5)], () => false);
    expect(store().byTerminalId.a).toBeUndefined();
    // The broker's own tombstone and any genuinely newer registration still apply.
    store().applyChange(tombstone('a', 6), false);
    store().applyChange(change(snapshot('a', 'idle', 7)), false);
    expect(store().byTerminalId.a.revision).toBe(7);
  });

  it('local retirement keeps the revision floor so a late snapshot cannot resurrect it', () => {
    store().applyChange(change(snapshot('a', 'running', 5)), false);
    store().retire('a');
    store().applyChange(change(snapshot('a', 'running', 4)), false);
    expect(store().byTerminalId.a).toBeUndefined();
    expect(store().revisionByTerminalId.a).toBe(5);
  });

  it('leaves other terminals untouched by a retirement', () => {
    store().hydrate([snapshot('a', 'running', 2), snapshot('b', 'running', 2)], () => false);
    store().applyChange(tombstone('a', 3), false);
    expect(Object.keys(store().byTerminalId)).toEqual(['b']);
  });
});

describe('hydration reconciliation', () => {
  it('retires a cached agent absent from the hydration set when nothing newer arrived', () => {
    store().applyChange(change(snapshot('a', 'running', 4)), false);
    store().applyChange(change(snapshot('b', 'running', 2)), false);
    const baseline = store().baseline();
    store().hydrate([snapshot('b', 'running', 2)], () => false, baseline);
    expect(store().byTerminalId.a).toBeUndefined();
    expect(store().byTerminalId.b).toBeDefined();
    store().applyChange(change(snapshot('a', 'running', 4)), false); // cannot come back
    expect(store().byTerminalId.a).toBeUndefined();
  });

  it('keeps an agent whose snapshot advanced after the baseline, even if the response omits it', () => {
    store().applyChange(change(snapshot('a', 'running', 4)), false);
    const baseline = store().baseline();
    store().applyChange(change(snapshot('a', 'needs_input', 5)), false);
    store().hydrate([], () => false, baseline);
    expect(store().byTerminalId.a.revision).toBe(5);
  });

  it('keeps an agent registered after the baseline and never erases a newer snapshot with an older response', () => {
    const baseline = store().baseline();
    store().applyChange(change(snapshot('new', 'running', 9)), false);
    store().hydrate([snapshot('other', 'running', 1)], () => false, baseline);
    expect(store().byTerminalId.new.revision).toBe(9);
    store().applyChange(change(snapshot('x', 'completed', 8)), false);
    store().hydrate([snapshot('x', 'running', 7)], () => false, baseline);
    expect(store().byTerminalId.x.revision).toBe(8);
  });

  it('a tombstone received during the hydration window survives a response that still lists the agent', () => {
    store().applyChange(change(snapshot('a', 'running', 4)), false);
    const baseline = store().baseline();
    store().applyChange(tombstone('a', 5), false);
    store().hydrate([snapshot('a', 'running', 4)], () => false, baseline);
    expect(store().byTerminalId.a).toBeUndefined();
  });

  it('without a baseline, absence retires nothing', () => {
    store().applyChange(change(snapshot('a', 'running', 4)), false);
    store().hydrate([], () => false);
    expect(store().byTerminalId.a).toBeDefined();
  });
});

describe('UI acknowledgement watermarks', () => {
  it('acknowledging a completion does not touch the lifecycle and only covers that revision', () => {
    store().applyChange(change(snapshot('a', 'completed', 4)), false);
    expect(view('a')?.unseen).toBe(true);
    const before = store().byTerminalId.a;
    store().acknowledge('a');
    expect(view('a')).toBeNull();
    expect(store().byTerminalId.a).toBe(before);
    // New work, then a later completion, is unseen again.
    store().applyChange(change(snapshot('a', 'running', 5)), false);
    expect(view('a')?.display).toBe('running');
    store().applyChange(change(snapshot('a', 'completed', 6)), false);
    expect(view('a')).toEqual({ display: 'turn_complete', unseen: true });
  });

  it('a completion that lands while the pane is already foreground is seen immediately', () => {
    store().applyChange(change(snapshot('a', 'running', 2)), true);
    store().applyChange(change(snapshot('a', 'completed', 3)), true);
    expect(view('a')).toBeNull();
    store().applyChange(change(snapshot('a', 'needs_input', 4)), true);
    expect(view('a')).toEqual({ display: 'needs_input', unseen: false });
    // Foreground acknowledgement does not leak into later background completions.
    store().applyChange(change(snapshot('a', 'completed', 5)), false);
    expect(view('a')?.unseen).toBe(true);
  });

  it('a background completion stays visible until acknowledged, per terminal', () => {
    store().hydrate([snapshot('a', 'completed', 2), snapshot('b', 'completed', 2)], () => false);
    store().acknowledge('a');
    expect(view('a')).toBeNull();
    expect(view('b')?.display).toBe('turn_complete');
    store().acknowledge('missing');
  });

  it('acknowledges Needs Input without resolving it', () => {
    store().applyChange(change(snapshot('a', 'needs_input', 4)), false);
    store().acknowledge('a');
    expect(view('a')).toEqual({ display: 'needs_input', unseen: false });
  });

  it('counts only unseen needs-input and completions, so Needs Input outranks Done in navigation', () => {
    store().hydrate([snapshot('a', 'needs_input', 2), snapshot('b', 'completed', 3), snapshot('c', 'running', 1), snapshot('d', 'failed', 4)], () => false);
    const { byTerminalId, seenByTerminalId } = store();
    expect(attentionCounts(['a', 'b', 'c', 'd'], byTerminalId, seenByTerminalId)).toEqual({ needsInput: 1, completed: 1 });
    const workspace = { id: 'w', terminals: ['b', 'a', 'c', 'd'].map((id) => ({ id })), panes: ['b', 'a', 'c', 'd'].map((id) => ({ id: `p-${id}`, terminalId: id })) } as WorkspaceTab;
    expect(nextAttentionTarget([workspace], byTerminalId, seenByTerminalId, 'c')).toEqual({ workspaceId: 'w', terminalId: 'a' });
    store().acknowledge('a');
    const next = store();
    expect(nextAttentionTarget([workspace], next.byTerminalId, next.seenByTerminalId, 'c')).toEqual({ workspaceId: 'w', terminalId: 'b' });
    store().acknowledge('b');
    const done = store();
    expect(nextAttentionTarget([workspace], done.byTerminalId, done.seenByTerminalId, 'c')).toBeNull();
  });
});


describe('provisional settlement hydration and background presentation', () => {
  it('hydrates uncertainty without Done, actionable input, navigation or aggregate alerts', () => {
    const pendingRequest = { ...snapshot('t', 'approval', 2).pendingRequest!, resolutionUnknown: true as const };
    store().hydrate([snapshot('t', 'provisional', 3, { pendingRequest })], () => false);
    expect(view('t')).toMatchObject({ display: 'provisional', unseen: false });
    expect(view('t')?.description).toContain('request resolution');
    const workspace = { id: 'w', terminals: [{ id: 't' }], panes: [{ id: 'p', terminalId: 't' }] } as WorkspaceTab;
    expect(nextAttentionTarget([workspace], store().byTerminalId, store().seenByTerminalId, null)).toBeNull();
    expect(attentionCounts(['t'], store().byTerminalId, store().seenByTerminalId)).toEqual({ needsInput: 0, completed: 0 });
    store().applyChange(change(snapshot('t', 'running', 2)), false);
    expect(view('t')?.display).toBe('provisional');
    store().acknowledge('t');
    expect(view('t')?.display).toBe('provisional');
    store().applyChange(change(snapshot('t', 'running', 4)), false);
    expect(view('t')?.display).toBe('running');
    store().applyChange(change(snapshot('t', 'completed', 5)), false);
    expect(view('t')).toEqual({ display: 'turn_complete', unseen: true });
  });
});
