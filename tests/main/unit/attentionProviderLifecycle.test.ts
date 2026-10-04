import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentAttentionBroker, type AttentionDiagnostic } from '../../../src/main/agentAttentionBroker';
import { CLAUDE_HOOK_EVENTS } from '../../../src/main/harnesses/claude/attention';
import { OBSERVER_FIELDS } from '../../../src/main/harnesses/attentionSources';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import { createRemoteAttentionFilter } from '../../../src/main/remote/remoteAttentionTransport';
import { HERMES_REMOTE_ATTENTION_PLUGIN } from '../../../src/main/harnesses/hermes/remoteAttention';
import { SOURCE as PI } from '../../../src/main/harnesses/pi/attention';
import { SOURCE as OMP } from '../../../src/main/harnesses/omp/attention';
import { SOURCE as OPENCODE } from '../../../src/main/harnesses/opencode/attention';
import { attentionRecorder } from '../../_helpers/attentionChanges';

/** Provider-native lifecycle fixtures run through the real provider interpreter or plugin source
 * and the real broker. Nothing here calls a model or an installed harness.
 *
 * Payloads mirror the native hook contracts (see each section for which fields prove root
 * identity, turn identity, child scope and foreground-settled state). Do not add convenience
 * fields a real hook does not send. */
const dirs: string[] = [];
const brokers: AgentAttentionBroker[] = [];
afterEach(() => {
  dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  brokers.splice(0).forEach((broker) => broker.close());
});

interface Wire { event: string; [key: string]: unknown }
function rig(harness: string, rootSessionId?: string) {
  const recorder = attentionRecorder();
  const updates = recorder.changes;
  const decisions: AttentionDiagnostic['decision'][] = [];
  const broker = new AgentAttentionBroker(recorder.onChange, (diagnostic) => decisions.push(diagnostic.decision));
  brokers.push(broker);
  const token = broker.registerRemote('term', harness, { rootSessionId });
  const feed = (wire: Wire | null | undefined) => {
    if (wire) broker.receiveRemote('term', JSON.stringify({ version: 1, token, harness, ...wire }));
  };
  return { broker, updates, decisions, feed, state: () => broker.handoffState('term'), updatesOf: () => recorder.labels };
}

async function importSource(source: string, location = 'source.mjs') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-lifecycle-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'observer.mjs'), `${OBSERVER_FIELDS}\nexport const emitted = globalThis.__emitted ??= [];\nexport async function emit(event, fields) { emitted.push(envelope(event, fields)); return true; }\n`);
  fs.mkdirSync(path.dirname(path.join(dir, location)), { recursive: true });
  fs.writeFileSync(path.join(dir, location), source);
  return import(/* @vite-ignore */ `${pathToFileURL(path.join(dir, location)).href}?${Math.random()}`);
}
function drain(): Wire[] {
  const emitted = (globalThis as { __emitted?: Wire[] }).__emitted ?? [];
  return emitted.splice(0);
}

/** A hook-command provider: stdin payload + hook name -> canonical wire event. `store` is the
 * bridge's per-terminal state, backed here by an in-memory object. */
async function interpreter(harness: 'codex' | 'claude' | 'agy') {
  const module = await importSource(getHarnessProvider(harness).attention.interpreter!);
  let stored: Record<string, unknown> = {};
  const store = { read: () => structuredClone(stored), write: (value: Record<string, unknown>) => { stored = structuredClone(value); } };
  return (hook: string, input: Record<string, unknown>): Wire | null => {
    const result = module.default(input, hook, store);
    if (!result?.event) return null;
    const { type, ...fields } = result.event;
    return { event: type, ...fields };
  };
}

describe('Codex lifecycle', () => {
  // Native hook fields (Codex hooks source): root identity `session_id`; turn identity `turn_id`;
  // child scope: `SubagentStop` or `agent_id`; settled: root `Stop`; user cancel: root `Interrupt`.
  // `PreToolUse`/`PostToolUse` carry `tool_use_id`; `PermissionRequest` carries `turn_id`,
  // `tool_name`, `tool_input` and NO `tool_use_id`. Permission correlation is Clanker-derived
  // (see the interpreter): PreToolUse ids + a fingerprint of tool_name/tool_input.
  it('stays Running through hidden, child and subagent completions until the root Stop', async () => {
    const hook = await interpreter('codex');
    const { feed, state, decisions } = rig('codex');
    feed(hook('UserPromptSubmit', { session_id: 'root', turn_id: 't1', prompt: 'private' }));
    expect(state()).toBe('running');
    // The #68 reproduction: title/auxiliary threads and subagents complete while the TUI still works.
    feed(hook('Stop', { session_id: 'hidden-title-thread', turn_id: 'aux-1' }));
    feed(hook('SubagentStop', { session_id: 'root', turn_id: 't1', agent_id: 'worker-1' }));
    feed(hook('SubagentStop', { session_id: 'root', turn_id: 't1', agent_id: 'worker-2' }));
    feed(hook('Stop', { session_id: 'root', turn_id: 'previous-turn' }));
    expect(state()).toBe('running');
    expect(decisions).toEqual(['accepted', 'rejected-mismatch', 'ignored-child', 'ignored-child', 'ignored-stale']);
    feed(hook('Stop', { session_id: 'root', turn_id: 't1' }));
    expect(state()).toBe('ready');
  });

  const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });
  const pre = (id: string, tool: object, turn = 't1') => ({ session_id: 'root', turn_id: turn, tool_use_id: id, ...tool });
  const ask = (tool: object, turn = 't1') => ({ session_id: 'root', turn_id: turn, ...tool }); // no tool_use_id
  const post = (id: string, tool: object, turn = 't1') => ({ session_id: 'root', turn_id: turn, tool_use_id: id, tool_response: 'PRIVATE', ...tool });

  it('keeps Needs Input when an unrelated Bash call finishes, and resolves when the waiting call does', async () => {
    const hook = await interpreter('codex');
    const { feed, state } = rig('codex');
    feed(hook('UserPromptSubmit', { session_id: 'root', turn_id: 't1' }));
    hook('PreToolUse', pre('call-a', bash('rm -rf build')));
    hook('PreToolUse', pre('call-b', bash('ls')));
    feed(hook('PermissionRequest', ask(bash('rm -rf build'))));
    expect(state()).toBe('needs_input');
    feed(hook('PostToolUse', post('call-b', bash('ls'))));
    expect(state()).toBe('needs_input');
    feed(hook('PostToolUse', post('call-a', bash('rm -rf build'))));
    expect(state()).toBe('running');
  });
  it('does not let parallel identical calls resolve each other: the group resolves when every call is done', async () => {
    const hook = await interpreter('codex');
    const { feed, state } = rig('codex');
    feed(hook('UserPromptSubmit', { session_id: 'root', turn_id: 't1' }));
    hook('PreToolUse', pre('call-a', bash('make test')));
    hook('PreToolUse', pre('call-b', bash('make test')));
    feed(hook('PermissionRequest', ask(bash('make test'))));
    feed(hook('PostToolUse', post('call-a', bash('make test'))));
    expect(state()).toBe('needs_input');
    feed(hook('PostToolUse', post('call-b', bash('make test'))));
    expect(state()).toBe('running');
  });
  it('tracks several outstanding waits and resolves only after the last one', async () => {
    const hook = await interpreter('codex');
    const { feed, state, updatesOf } = rig('codex');
    feed(hook('UserPromptSubmit', { session_id: 'root', turn_id: 't1' }));
    hook('PreToolUse', pre('call-a', bash('one')));
    hook('PreToolUse', pre('call-b', bash('two')));
    feed(hook('PermissionRequest', ask(bash('one'))));
    expect(hook('PermissionRequest', ask(bash('two')))).toBeNull(); // the first wait stays authoritative
    feed(hook('PostToolUse', post('call-a', bash('one'))));
    expect(state()).toBe('needs_input');
    feed(hook('PostToolUse', post('call-b', bash('two'))));
    expect(state()).toBe('running');
    expect(updatesOf()).toEqual(['turn_started', 'input_requested', 'input_resolved']);
  });
  it('fails closed when a permission request cannot be matched to a started call', async () => {
    const hook = await interpreter('codex');
    const { feed, state } = rig('codex');
    feed(hook('UserPromptSubmit', { session_id: 'root', turn_id: 't1' }));
    hook('PreToolUse', pre('call-a', bash('one')));
    feed(hook('PermissionRequest', ask(bash('something else'))));
    feed(hook('PostToolUse', post('call-a', bash('one'))));
    expect(state()).toBe('needs_input'); // not cleared by an unrelated finish
    feed(hook('Stop', { session_id: 'root', turn_id: 't1' }));
    expect(state()).toBe('ready');
  });
  describe('wait capacity', () => {
    const CAPACITY = 16;
    async function overflowed() {
      const hook = await interpreter('codex');
      const harness = rig('codex');
      harness.feed(hook('UserPromptSubmit', { session_id: 'root', turn_id: 't1' }));
      const ids = Array.from({ length: CAPACITY + 1 }, (_, index) => `call-${index}`);
      ids.forEach((id) => hook('PreToolUse', pre(id, bash(`command-${id}`))));
      ids.forEach((id) => harness.feed(hook('PermissionRequest', ask(bash(`command-${id}`)))));
      return { hook, ids, ...harness };
    }
    it('never drops a live wait: beyond capacity nothing resolves from individual completions', async () => {
      const { hook, ids, feed, state } = await overflowed();
      expect(state()).toBe('needs_input');
      // Every retained call (the oldest 16 waits) completes, and so does the overflowed one.
      for (const id of ids) feed(hook('PostToolUse', post(id, bash(`command-${id}`))));
      expect(state()).toBe('needs_input');
    });
    it.each([
      ['Stop', 'ready'], ['Interrupt', 'unverified'], ['SessionEnd', 'unverified'],
    ])('clears overflow on %s', async (name, expected) => {
      const { hook, feed, state } = await overflowed();
      feed(hook(name, { session_id: 'root', turn_id: 't1' }));
      expect(state()).toBe(expected);
    });
    it('clears overflow for a new foreground turn', async () => {
      const { hook, feed, state } = await overflowed();
      feed(hook('Stop', { session_id: 'root', turn_id: 't1' }));
      feed(hook('UserPromptSubmit', { session_id: 'root', turn_id: 't2' }));
      hook('PreToolUse', pre('next', bash('one'), 't2'));
      feed(hook('PermissionRequest', ask(bash('one'), 't2')));
      expect(state()).toBe('needs_input');
      feed(hook('PostToolUse', post('next', bash('one'), 't2')));
      expect(state()).toBe('running');
    });
  });
  it('never stores or sends tool input or responses', async () => {
    const module = await importSource(getHarnessProvider('codex').attention.interpreter!);
    const written: string[] = [];
    let stored: Record<string, unknown> = {};
    const store = { read: () => structuredClone(stored), write: (value: Record<string, unknown>) => { stored = structuredClone(value); written.push(JSON.stringify(value)); } };
    const outputs = [
      module.default({ session_id: 'root', turn_id: 't1' }, 'UserPromptSubmit', store),
      module.default(pre('call-a', bash('SECRET-COMMAND')), 'PreToolUse', store),
      module.default(ask(bash('SECRET-COMMAND')), 'PermissionRequest', store),
      module.default(post('call-a', bash('SECRET-COMMAND')), 'PostToolUse', store),
    ];
    expect(JSON.stringify(outputs) + written.join('')).not.toMatch(/SECRET-COMMAND|PRIVATE/);
  });
  it('ignores permission events from a stale turn and subagents', async () => {
    const hook = await interpreter('codex');
    const { feed, state, decisions } = rig('codex');
    feed(hook('UserPromptSubmit', { session_id: 'root', turn_id: 't1' }));
    feed(hook('Stop', { session_id: 'root', turn_id: 't1' }));
    feed(hook('UserPromptSubmit', { session_id: 'root', turn_id: 't2' }));
    feed(hook('PermissionRequest', ask(bash('old'), 't1')));
    expect(decisions[decisions.length - 1]).toBe('ignored-stale');
    feed(hook('PermissionRequest', { ...ask(bash('child')), agent_id: 'worker' }));
    expect(decisions[decisions.length - 1]).toBe('ignored-child');
    expect(state()).toBe('running');
  });
  it('treats a user Interrupt as neither Ready nor Running, keeps the root, and allows a new turn', async () => {
    const hook = await interpreter('codex');
    const { feed, state, updatesOf } = rig('codex');
    feed(hook('UserPromptSubmit', { session_id: 'root', turn_id: 't1' }));
    hook('PreToolUse', pre('call-a', bash('one')));
    feed(hook('PermissionRequest', ask(bash('one'))));
    feed(hook('Interrupt', { session_id: 'root', turn_id: 't0' })); // stale
    expect(state()).toBe('needs_input');
    feed(hook('Interrupt', { session_id: 'root', turn_id: 't1' }));
    expect(state()).toBe('unverified');
    feed(hook('Stop', { session_id: 'root', turn_id: 't1' })); // cannot settle a cancelled turn
    expect(state()).toBe('unverified');
    feed(hook('UserPromptSubmit', { session_id: 'root', turn_id: 't2' }));
    expect(state()).toBe('running');
    expect(updatesOf()).toEqual(['turn_started', 'input_requested', 'turn_interrupted', 'turn_started']);
  });
  it('ignores legacy notify payloads and unrelated native events', async () => {
    const hook = await interpreter('codex');
    expect(hook('PostCompact', { session_id: 'root' })).toBeNull();
    expect(hook('', { type: 'agent-turn-complete', 'thread-id': 'root' })).toBeNull();
  });
  it('rebinds after SessionEnd and rejects late events from the old session', async () => {
    const hook = await interpreter('codex');
    const { feed, state } = rig('codex', 'resumed');
    feed(hook('UserPromptSubmit', { session_id: 'hidden', turn_id: 'x' }));
    expect(state()).toBe('unverified');
    feed(hook('UserPromptSubmit', { session_id: 'resumed', turn_id: 't1' }));
    feed(hook('SessionEnd', { session_id: 'resumed' }));
    feed(hook('UserPromptSubmit', { session_id: 'next', turn_id: 't1' }));
    feed(hook('Stop', { session_id: 'resumed', turn_id: 't1' }));
    expect(state()).toBe('running');
    feed(hook('Stop', { session_id: 'next', turn_id: 't1' }));
    expect(state()).toBe('ready');
  });
});

describe('Claude lifecycle', () => {
  // Native hook fields (Claude Code hooks reference): root identity `session_id`; turn identity
  // `prompt_id` (common field); child scope: `agent_id`; PermissionRequest has `tool_name` and
  // `tool_input` but NO `tool_use_id`; PostToolUse has `tool_use_id`; PostToolBatch has `tool_calls`
  // (the resolved batch); settled: root `Stop` (regardless of `background_tasks`/`session_crons`), or
  // `StopFailure` (`error`, `error_details`, `last_assistant_message`). The permission wait is
  // Clanker-derived turn-level state (inputId 'permission'), resolved only by PostToolBatch.
  const common = { session_id: 'root', prompt_id: 'prompt-1', transcript_path: '/t.jsonl', cwd: '/w', permission_mode: 'default' };
  const request = (extra: object = {}) => ({ ...common, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'SECRET' }, ...extra });
  const batch = (extra: object = {}) => ({ ...common, hook_event_name: 'PostToolBatch', tool_calls: [{ tool_name: 'Bash', tool_input: { command: 'SECRET' }, tool_use_id: 'toolu_1', tool_response: 'SECRET' }], ...extra });

  it('ignores child events; a root Stop settles even while background work (a dev server, a cron) is running', async () => {
    const hook = await interpreter('claude');
    const { feed, state, decisions } = rig('claude');
    feed(hook('UserPromptSubmit', { ...common, hook_event_name: 'UserPromptSubmit', prompt: 'private' }));
    const child = { agent_id: 'agent-1', agent_type: 'Explore' };
    feed(hook('PermissionRequest', request(child)));
    feed(hook('PostToolBatch', batch(child)));
    feed(hook('StopFailure', { ...common, ...child, error: 'rate_limit' }));
    expect(state()).toBe('running');
    expect(decisions.slice(1)).toEqual(['ignored-child', 'ignored-child', 'ignored-child']);
    // Claude has returned control to the user; a long-lived background task must not hold the turn open.
    feed(hook('Stop', { ...common, background_tasks: [{ id: 'bg', type: 'shell', status: 'running' }], session_crons: [{ id: 'cron' }] }));
    expect(state()).toBe('ready');
  });
  it('a clean root Stop settles', async () => {
    const hook = await interpreter('claude');
    const { feed, state } = rig('claude');
    feed(hook('UserPromptSubmit', { ...common, hook_event_name: 'UserPromptSubmit' }));
    feed(hook('Stop', { ...common, background_tasks: [], session_crons: [], stop_reason: 'end_turn' }));
    expect(state()).toBe('ready');
  });
  it('enters Needs Input on the real PermissionRequest shape, survives unrelated tool completions, and resolves with the batch', async () => {
    const hook = await interpreter('claude');
    const { feed, state } = rig('claude');
    feed(hook('UserPromptSubmit', common));
    expect(request()).not.toHaveProperty('tool_use_id');
    feed(hook('PermissionRequest', request()));
    expect(state()).toBe('needs_input');
    // An unrelated parallel tool finishing fires PostToolUse, which is not subscribed.
    expect(CLAUDE_HOOK_EVENTS).not.toContain('PostToolUse');
    expect(hook('PostToolUse', { ...common, tool_name: 'Read', tool_use_id: 'toolu_other' })).toBeNull();
    expect(state()).toBe('needs_input');
    feed(hook('PostToolBatch', batch()));
    expect(state()).toBe('running');
  });
  it('only resolves a wait that exists, and only for the current prompt', async () => {
    const hook = await interpreter('claude');
    const { feed, state, decisions } = rig('claude');
    feed(hook('UserPromptSubmit', common));
    expect(hook('PostToolBatch', batch())).toBeNull(); // no outstanding wait
    feed(hook('PermissionRequest', request()));
    expect(hook('PermissionRequest', request())).toBeNull(); // duplicate request: still one wait
    expect(hook('PostToolBatch', batch({ prompt_id: 'prompt-0' }))).toBeNull(); // stale prompt: dropped by the adapter
    expect(decisions[decisions.length - 1]).toBe('accepted');
    expect(state()).toBe('needs_input');
    feed(hook('PostToolBatch', batch()));
    expect(state()).toBe('running');
  });
  it('fails on StopFailure for the current prompt and ignores a stale one', async () => {
    const hook = await interpreter('claude');
    const { feed, state, decisions, broker, updatesOf } = rig('claude');
    feed(hook('UserPromptSubmit', { ...common, prompt_id: 'p1' }));
    feed(hook('StopFailure', { ...common, prompt_id: 'p0', error: 'rate_limit', error_details: 'PRIVATE', last_assistant_message: 'API Error' }));
    expect(state()).toBe('running');
    expect(decisions[decisions.length - 1]).toBe('ignored-stale');
    const failure = hook('StopFailure', { ...common, prompt_id: 'p1', error: 'overloaded', error_details: 'PRIVATE' });
    expect(JSON.stringify(failure)).not.toContain('PRIVATE');
    feed(failure);
    // StopFailure is explicit failure evidence: Failed, never a completion or a Ready handoff.
    expect(broker.snapshot('term')).toMatchObject({ runtime: { status: 'failed' }, lastCompletion: null, lastOutcome: { kind: 'failed', turnId: 'p1' } });
    expect(state()).toBe('unverified');
    expect(updatesOf()).toEqual(['turn_started', 'turn_failed']);
  });
  it('keeps a Stop a completion while StopFailure never creates one', async () => {
    const hook = await interpreter('claude');
    const { feed, broker } = rig('claude');
    feed(hook('UserPromptSubmit', { ...common, prompt_id: 'p1' }));
    feed(hook('Stop', { ...common, prompt_id: 'p1' }));
    const completion = broker.snapshot('term')!.lastCompletion;
    expect(completion).toMatchObject({ turnId: 'p1' });
    feed(hook('UserPromptSubmit', { ...common, prompt_id: 'p2' }));
    feed(hook('StopFailure', { ...common, prompt_id: 'p2', error: 'rate_limit' }));
    expect(broker.snapshot('term')).toMatchObject({ runtime: { status: 'failed' }, lastCompletion: completion, lastOutcome: { kind: 'failed' } });
  });
  it('clears a pending wait when the turn settles, so the next prompt starts clean', async () => {
    const hook = await interpreter('claude');
    const { feed, state, broker } = rig('claude');
    feed(hook('UserPromptSubmit', { ...common, prompt_id: 'p1' }));
    feed(hook('PermissionRequest', request({ prompt_id: 'p1' })));
    feed(hook('StopFailure', { ...common, prompt_id: 'p1', error: 'unknown' }));
    expect(broker.snapshot('term')).toMatchObject({ runtime: { status: 'failed' }, pendingRequest: null });
    feed(hook('UserPromptSubmit', { ...common, prompt_id: 'p2' }));
    expect(hook('PostToolBatch', batch({ prompt_id: 'p2' }))).toBeNull();
    feed(hook('PermissionRequest', request({ prompt_id: 'p2' })));
    expect(state()).toBe('needs_input');
  });
  it('never forwards tool input or responses', async () => {
    const hook = await interpreter('claude');
    expect(JSON.stringify([hook('PermissionRequest', request()), hook('PostToolBatch', batch())])).not.toContain('SECRET');
  });
  it('does not treat notifications as a root input wait, and drops events with no prompt identity', async () => {
    const hook = await interpreter('claude');
    const { feed, state } = rig('claude');
    feed(hook('UserPromptSubmit', common));
    expect(hook('Notification', { ...common, notification_type: 'agent_needs_input', message: 'x' })).toBeNull();
    expect(hook('Notification', { ...common, notification_type: 'permission_prompt' })).toBeNull();
    expect(CLAUDE_HOOK_EVENTS).not.toContain('Notification');
    // Without prompt_id the event cannot be tied to a turn: the broker fails closed.
    feed(hook('Stop', { ...common, prompt_id: undefined }));
    expect(state()).toBe('running');
  });
  it('rejects a stale Stop from an earlier prompt and settles only the current one', async () => {
    const hook = await interpreter('claude');
    const { feed, state, decisions } = rig('claude');
    feed(hook('UserPromptSubmit', { ...common, prompt_id: 'p1' }));
    feed(hook('Stop', { ...common, prompt_id: 'p1' }));
    feed(hook('UserPromptSubmit', { ...common, prompt_id: 'p2' }));
    feed(hook('Stop', { ...common, prompt_id: 'p1' }));
    expect(state()).toBe('running');
    expect(decisions[decisions.length - 1]).toBe('ignored-stale');
    feed(hook('Stop', { ...common, prompt_id: 'p2' }));
    expect(state()).toBe('ready');
  });
  it('rebinds on SessionEnd (clear) without losing attention', async () => {
    const hook = await interpreter('claude');
    const { feed, state, broker } = rig('claude');
    feed(hook('UserPromptSubmit', { ...common, session_id: 'one', prompt_id: 'p1' }));
    feed(hook('SessionEnd', { ...common, session_id: 'one', reason: 'clear' }));
    expect(broker.canHandoff('term')).toBe(true);
    feed(hook('UserPromptSubmit', { ...common, session_id: 'two', prompt_id: 'p2' }));
    feed(hook('Stop', { ...common, session_id: 'two', prompt_id: 'p2' }));
    expect(state()).toBe('ready');
  });

  // Location: every hook carries `cwd` (Claude's tracked working directory, which moves with a
  // Bash `cd` while the process itself never changes directory). `CwdChanged` carries `old_cwd` and
  // `new_cwd` (and `cwd` already equal to `new_cwd`); captured from Claude Code 2.1.289.
  it('subscribes to CwdChanged and follows the root agent out of a worktree it removed', async () => {
    expect(CLAUDE_HOOK_EVENTS).toContain('CwdChanged');
    const hook = await interpreter('claude');
    const { feed, state, broker } = rig('claude');
    const worktree = '/home/u/repo-worktrees/wt-1';
    feed(hook('UserPromptSubmit', { ...common, cwd: worktree, hook_event_name: 'UserPromptSubmit' }));
    expect(broker.snapshot('term')?.location).toEqual({ path: worktree, checkoutContextId: null });

    // `cd /home/u/repo && git worktree remove ...` in one Bash call.
    feed(hook('CwdChanged', { ...common, cwd: '/home/u/repo', hook_event_name: 'CwdChanged', old_cwd: worktree, new_cwd: '/home/u/repo' }));
    expect(broker.snapshot('term')?.location).toEqual({ path: '/home/u/repo', checkoutContextId: null });
    expect(state()).toBe('running');

    feed(hook('Stop', { ...common, cwd: '/home/u/repo', hook_event_name: 'Stop' }));
    expect(state()).toBe('ready');
    expect(broker.snapshot('term')?.location).toEqual({ path: '/home/u/repo', checkoutContextId: null });
  });
  it('ignores a subagent changing directory and never reports location from mid-turn tool hooks', async () => {
    const hook = await interpreter('claude');
    const { feed, broker } = rig('claude');
    feed(hook('UserPromptSubmit', { ...common, cwd: '/home/u/repo' }));
    expect(hook('CwdChanged', { ...common, agent_id: 'agent-1', cwd: '/tmp', old_cwd: '/home/u/repo', new_cwd: '/tmp' })).toBeNull();
    feed(hook('PermissionRequest', request({ cwd: '/elsewhere' })));
    expect(hook('PermissionRequest', request({ cwd: '/elsewhere' }))).toBeNull();
    expect(broker.snapshot('term')?.location).toEqual({ path: '/home/u/repo', checkoutContextId: null });
  });
});

describe('Agy lifecycle', () => {
  // Native hook fields: root identity `conversationId` (the first conversation to start binds);
  // no turn ID, so the interpreter's epoch (kept in the bridge store) is the turn identity;
  // settled: `Stop` with `fullyIdle === true`.
  it('binds the root conversation, keeps Running for fullyIdle=false, and ignores other conversations', async () => {
    const hook = await interpreter('agy');
    const { feed, state, decisions } = rig('agy');
    feed(hook('PreInvocation', { conversationId: 'root', invocationNum: 0, initialNumSteps: 0 }));
    feed(hook('PreInvocation', { conversationId: 'sub', invocationNum: 0, initialNumSteps: 0 }));
    expect(hook('Stop', { conversationId: 'sub', fullyIdle: true, executionNum: 1, terminationReason: 'model_stop' })).toBeNull();
    expect(hook('Stop', { conversationId: 'root', fullyIdle: false, executionNum: 1 })).toBeNull();
    expect(hook('Stop', { conversationId: 'root' })).toBeNull();
    expect(state()).toBe('running');
    expect(decisions).toEqual(['accepted', 'rejected-mismatch']);
    feed(hook('Stop', { conversationId: 'root', fullyIdle: true, executionNum: 1 }));
    expect(state()).toBe('ready');
  });
  it('gives each foreground turn its own epoch so a late Stop cannot settle the next turn', async () => {
    const hook = await interpreter('agy');
    const { feed, state, decisions } = rig('agy');
    feed(hook('PreInvocation', { conversationId: 'root', invocationNum: 0 }));
    const lateStop = hook('Stop', { conversationId: 'root', fullyIdle: true });
    expect(lateStop?.turnId).toBe('1');
    feed(lateStop);
    feed(hook('PreInvocation', { conversationId: 'root', invocationNum: 0 }));
    expect(state()).toBe('running');
    feed(lateStop); // the first turn's Stop delivered again after the second turn started
    expect(state()).toBe('running');
    expect(decisions[decisions.length - 1]).toBe('ignored-stale');
    feed(hook('Stop', { conversationId: 'root', fullyIdle: true }));
    expect(state()).toBe('ready');
  });
  it('maps interaction tools to a matching input wait', async () => {
    const hook = await interpreter('agy');
    const { feed, state } = rig('agy');
    feed(hook('PreInvocation', { conversationId: 'root', invocationNum: 0 }));
    feed(hook('PreToolUse', { conversationId: 'root', toolCall: { name: 'ask_permission' } }));
    expect(state()).toBe('needs_input');
    feed(hook('PostToolUse', { conversationId: 'root', toolCall: { name: 'ask_question' } }));
    expect(state()).toBe('needs_input');
    feed(hook('PostToolUse', { conversationId: 'root', toolCall: { name: 'ask_permission' } }));
    expect(state()).toBe('running');
  });
});

describe('Pi lifecycle', () => {
  // Extension events: root identity `ctx.sessionManager.getSessionId()`; settled: `agent_settled`
  // (nothing queued, retrying or compacting). Pi exposes no turn ID: the extension owns an epoch.
  async function load() {
    const pi = await importSource(PI);
    const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
    pi.default({ on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers[name] = handler; } });
    return handlers;
  }
  const ctx = { sessionManager: { getSessionId: () => 'root' } };
  it('completes on agent_settled only, never on lower-level end events', async () => {
    const handlers = await load();
    expect(Object.keys(handlers).sort()).toEqual(['agent_settled', 'agent_start', 'session_shutdown']);
    const { feed, state } = rig('pi');
    drain();
    await handlers.agent_start({}, ctx);
    drain().forEach(feed);
    expect(state()).toBe('running');
    await handlers.agent_settled({}, ctx);
    drain().forEach(feed);
    expect(state()).toBe('ready');
    await handlers.agent_start({}, ctx);
    await handlers.session_shutdown({}, ctx);
    drain().forEach(feed);
    expect(state()).toBe('unverified');
  });
  it('numbers foreground turns so a late settle of turn 1 cannot close turn 2', async () => {
    const handlers = await load();
    const { feed, state, decisions } = rig('pi');
    drain();
    await handlers.agent_start({}, ctx);
    await handlers.agent_settled({}, ctx);
    const settledOne = drain();
    expect(settledOne.map((wire) => wire.turnId)).toEqual(['1', '1']);
    settledOne.forEach(feed);
    await handlers.agent_start({}, ctx);
    drain().forEach(feed);
    expect(state()).toBe('running');
    feed(settledOne[1]); // the first turn's completion arrives late
    expect(state()).toBe('running');
    expect(decisions[decisions.length - 1]).toBe('ignored-stale');
    await handlers.agent_settled({}, ctx);
    const settledTwo = drain();
    expect(settledTwo[0].turnId).toBe('2');
    settledTwo.forEach(feed);
    expect(state()).toBe('ready');
  });
  it('does not emit a completion when no foreground turn is open', async () => {
    const handlers = await load();
    drain();
    await handlers.agent_settled({}, ctx);
    expect(drain()).toEqual([]);
  });
});

describe('Oh My Pi lifecycle', () => {
  // Extension events: root identity `ctx.sessionManager.getSessionId()`; child scope:
  // `ctx.agent.kind === 'sub'` (hooks are rebound to subagent sessions); settled: main `session_stop`.
  it('ignores agent_end and subagent sessions; only the main session_stop settles', async () => {
    const omp = await importSource(OMP);
    const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
    omp.default({ on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers[name] = handler; } });
    expect(handlers.agent_end).toBeUndefined();
    const main = { sessionManager: { getSessionId: () => 'main' }, agent: { kind: 'main', id: 'a1', name: 'main', depth: 0 } };
    const sub = { sessionManager: { getSessionId: () => 'task-1' }, agent: { kind: 'sub', id: 'a2', name: 'explore', depth: 1, parentId: 'a1' } };
    const unknown = { sessionManager: { getSessionId: () => 'mystery' } };
    const { feed, state, decisions } = rig('omp');
    const run = async (name: string, ctx: unknown) => { drain(); await handlers[name]({}, ctx); drain().forEach(feed); };
    await run('agent_start', unknown);
    expect(state()).toBe('unverified');
    await run('agent_start', main);
    await run('agent_start', sub);
    await run('session_stop', sub);
    await run('session_shutdown', sub);
    expect(state()).toBe('running');
    await run('session_stop', main);
    expect(state()).toBe('ready');
    expect(decisions).toEqual(['rejected-ambiguous', 'accepted', 'ignored-child', 'ignored-child', 'ignored-child', 'accepted']);
  });
  it('does not complete twice or without an open main turn', async () => {
    const omp = await importSource(OMP);
    const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
    omp.default({ on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers[name] = handler; } });
    const main = { sessionManager: { getSessionId: () => 'main' }, agent: { kind: 'main' } };
    drain();
    await handlers.session_stop({}, main);
    expect(drain()).toEqual([]);
    await handlers.agent_start({}, main);
    await handlers.session_stop({}, main);
    await handlers.session_stop({}, main);
    expect(drain().map((wire) => wire.event)).toEqual(['turn_started', 'turn_completed']);
  });
});

describe('OpenCode lifecycle', () => {
  // Plugin events: root identity from `client.session.get` parentage (no `parentID` = top-level) or
  // the trusted resumed ID; child scope: has `parentID`; settled: `session.status` idle of the root.
  // OpenCode exposes no turn ID: the plugin owns an epoch per root session.
  const sessions: Record<string, { id: string; parentID?: string }> = {
    root: { id: 'root' }, 'child-1': { id: 'child-1', parentID: 'root' }, 'child-2': { id: 'child-2', parentID: 'root' },
  };
  const client = { session: { get: async ({ path: { id } }: { path: { id: string } }) => ({ data: sessions[id] }) } };
  async function plugin(trusted?: string) {
    if (trusted) process.env.CLANKER_ATTENTION_SESSION_ID = trusted; else delete process.env.CLANKER_ATTENTION_SESSION_ID;
    const module = await importSource(OPENCODE, 'plugins/source.mjs');
    delete process.env.CLANKER_ATTENTION_SESSION_ID;
    const instance = await module.ClankerAttention({ client });
    return async (type: string, properties: Record<string, unknown>) => { await instance.event({ event: { type, properties } }); };
  }
  const status = (sessionID: string, type: string) => ['session.status', { sessionID, status: { type } }] as const;

  it('keeps Running through child busy/idle and completes on verified-root idle', async () => {
    const send = await plugin();
    const { feed, state, decisions } = rig('opencode');
    drain();
    const step = async (...args: Parameters<typeof send>) => { await send(...args); drain().forEach(feed); };
    await step(...status('child-1', 'busy'));   // a child cannot bind as the root
    expect(state()).toBe('unverified');
    await step(...status('root', 'busy'));
    await step(...status('child-1', 'idle'));
    await step('session.idle', { sessionID: 'child-2' });
    await step(...status('child-1', 'busy'));
    await step(...status('child-1', 'idle'));
    expect(state()).toBe('running');
    expect(decisions.filter((decision) => decision === 'ignored-child')).toHaveLength(5);
    await step(...status('root', 'idle'));
    expect(state()).toBe('ready');
    await step('session.idle', { sessionID: 'root' }); // legacy duplicate is absorbed by the closed epoch
    expect(state()).toBe('ready');
  });
  it('never infers a root from the first event: unknown parentage is not reported', async () => {
    const send = await plugin();
    drain();
    await send('session.status', { sessionID: 'mystery', status: { type: 'busy' } });
    expect(drain()).toEqual([]);
  });
  it('numbers root turns so a late idle of turn 1 cannot settle turn 2', async () => {
    const send = await plugin();
    const { feed, state, decisions } = rig('opencode');
    drain();
    await send(...status('root', 'busy'));
    await send(...status('root', 'idle'));
    const first = drain();
    expect(first.map((wire) => wire.turnId)).toEqual(['1', '1']);
    first.forEach(feed);
    await send(...status('root', 'busy'));
    drain().forEach(feed);
    feed(first[1]);
    expect(state()).toBe('running');
    expect(decisions[decisions.length - 1]).toBe('ignored-stale');
  });
  it('uses the trusted resumed ID without a metadata lookup, and the broker rejects any other root', async () => {
    const send = await plugin('resumed');
    const { feed, state } = rig('opencode', 'resumed');
    drain();
    await send(...status('resumed', 'busy'));
    drain().forEach(feed);
    expect(state()).toBe('running');
    await send('session.status', { sessionID: 'root', status: { type: 'idle' } });
    drain().forEach(feed);
    expect(state()).toBe('running');
  });
  it('maps permission and question requests to a matching wait', async () => {
    const send = await plugin();
    const { feed, state } = rig('opencode');
    drain();
    const step = async (...args: Parameters<typeof send>) => { await send(...args); drain().forEach(feed); };
    await step(...status('root', 'busy'));
    await step('permission.asked', { sessionID: 'root', id: 'perm-1' });
    expect(state()).toBe('needs_input');
    await step('permission.replied', { sessionID: 'root', requestID: 'other' });
    expect(state()).toBe('needs_input');
    await step('permission.replied', { sessionID: 'root', requestID: 'perm-1' });
    expect(state()).toBe('running');
    await step('question.asked', { sessionID: 'child-1', id: 'q-1' });
    expect(state()).toBe('running');
  });
});

// The plugin runs on a POSIX SSH host and the replay needs a pty.
describe.skipIf(process.platform === 'win32')('Hermes lifecycle (SSH observer plugin)', () => {
  // Real hook kwargs (hermes-agent source): pre_llm_call(session_id, task_id, turn_id, user_message,
  // conversation_history, is_first_turn, model, platform, parent_session_id, sender_id);
  // post_llm_call(session_id, task_id, turn_id, user_message, assistant_response,
  // conversation_history, model, platform) -- NO parent_session_id; approval hooks(command,
  // description, pattern_key, pattern_keys, session_key, surface, turn_id, tool_call_id[, choice]).
  // turn_id is `<session at turn start>:<task>:<uuid>`. Root identity: pre_llm_call with an empty
  // parent_session_id; child scope: non-empty parent_session_id, then matched by turn/session.
  const CAPTURE = `import os, pty, sys
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
out = b''
while True:
    try:
        chunk = os.read(fd, 65536)
    except OSError:
        break
    if not chunk:
        break
    out += chunk
sys.stdout.buffer.write(out)
`;
  const SESSIONS = `
import sqlite3
database = sqlite3.connect(os.path.join(os.environ['HOME'], '.hermes', 'state.db'))
database.execute('CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_session_id TEXT, end_reason TEXT)')
`;

  /** Runs the plugin with scripted hook calls and replays its frames through the real broker. */
  function replay(steps: string, options: { rootSessionId?: string; sessions?: Array<[string, string | null, string | null]> } = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-hermes-home-'));
    dirs.push(home);
    fs.mkdirSync(path.join(home, '.hermes'));
    const token = 'b'.repeat(64);
    const rows = (options.sessions ?? []).map(([id, parent, reason]) => `database.execute('INSERT INTO sessions VALUES (?, ?, ?)', (${JSON.stringify(id)}, ${parent === null ? 'None' : JSON.stringify(parent)}, ${reason === null ? 'None' : JSON.stringify(reason)}))`).join('\n');
    const script = `${HERMES_REMOTE_ATTENTION_PLUGIN}
class Context:
    def __init__(self):
        self.hooks = {}
    def register_hook(self, name, callback):
        self.hooks[name] = callback
ctx = Context()
register(ctx)
def fire(name, **kwargs):
    ctx.hooks[name](**kwargs)
${options.sessions ? `${SESSIONS}\n${rows}\ndatabase.commit()\ndatabase.close()` : ''}
${steps}
`;
    const stdout = execFileSync('python3', ['-c', CAPTURE, 'python3', '-c', script], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, HOME: home, HERMES_HOME: '', CLANKER_REMOTE_ATTENTION_TOKEN: token, CLANKER_REMOTE_ATTENTION_HARNESS: 'hermes' },
    });
    const broker = new AgentAttentionBroker(() => undefined, () => undefined);
    brokers.push(broker);
    const registered = broker.registerRemote('term', 'hermes', { rootSessionId: options.rootSessionId });
    const trace: string[] = [];
    const frames: Wire[] = [];
    createRemoteAttentionFilter((raw) => {
      const wire = JSON.parse(raw) as Wire;
      frames.push(wire);
      broker.receiveRemote('term', JSON.stringify({ ...wire, token: registered }));
      trace.push(`${wire.event}:${broker.handoffState('term')}`);
    })(stdout);
    return { trace, frames, stdout, broker };
  }
  const llm = (session: string, turn: string, parent = '') => `fire('pre_llm_call', session_id='${session}', task_id='task', turn_id='${turn}', user_message='PRIVATE', conversation_history=[], is_first_turn=True, model='m', platform='tui', parent_session_id='${parent}', sender_id='')`;
  const done = (session: string, turn: string) => `fire('post_llm_call', session_id='${session}', task_id='task', turn_id='${turn}', user_message='PRIVATE', assistant_response='PRIVATE', conversation_history=[], model='m', platform='tui')`;
  const approval = (hook: string, turn: string, surface: string, call: string, extra = '') => `fire('${hook}', command='PRIVATE', description='d', pattern_key='pk', pattern_keys=['pk'], session_key='key', surface='${surface}', turn_id='${turn}', tool_call_id='${call}'${extra})`;

  it('stays Running while a child finishes, and settles when the root turn completes', () => {
    const { trace, stdout } = replay([
      llm('root', 'root:task:aaa'),
      llm('child', 'child:task:bbb', 'root'),
      done('child', 'child:task:bbb'),
      'print("child-done")',
      done('root', 'root:task:aaa'),
    ].join('\n'));
    expect(trace).toEqual(['turn_started:running', 'turn_completed:running', 'turn_completed:ready']);
    expect(stdout).not.toContain('PRIVATE');
  });
  it('fails closed on completion of a turn it never saw start, and on an unrelated session', () => {
    const { trace } = replay([
      llm('root', 'root:task:aaa'),
      done('root', 'ghost:task:zzz'),
      llm('stranger', 'stranger:task:ccc'),
      done('stranger', 'stranger:task:ccc'),
    ].join('\n'));
    expect(trace).toEqual(['turn_started:running']);
  });
  it('treats compression rotation mid-turn as a continuation, not a wrong session', () => {
    const { trace, frames } = replay([
      llm('A', 'A:task:t1'),
      done('B', 'A:task:t1'),
    ].join('\n'));
    expect(trace).toEqual(['turn_started:running', 'session_continued:running', 'turn_completed:ready']);
    expect(frames[1]).toMatchObject({ sessionId: 'B', continuesSessionId: 'A', scope: 'root' });
    expect(frames.map((frame) => frame.event)).not.toContain('session_ended');
  });
  it('proves a rotation between turns (for example /compress) from the recorded compression lineage', () => {
    const { trace } = replay([
      llm('A', 'A:task:t1'),
      done('A', 'A:task:t1'),
      llm('B', 'B:task:t2'),
      done('B', 'B:task:t2'),
    ].join('\n'), { sessions: [['A', null, 'compression'], ['B', 'A', null]] });
    expect(trace).toEqual(['turn_started:running', 'turn_completed:ready', 'session_continued:ready', 'turn_started:running', 'turn_completed:ready']);
  });
  it('does not accept a delegation child, or an unrelated session, as a continuation', () => {
    const { trace } = replay([
      llm('A', 'A:task:t1'),
      done('A', 'A:task:t1'),
      llm('C', 'C:task:t2'),
      done('C', 'C:task:t2'),
    ].join('\n'), { sessions: [['A', null, 'delegated'], ['C', 'A', null]] });
    expect(trace).toEqual(['turn_started:running', 'turn_completed:ready']);
  });
  it('rejects a stale completion from an earlier turn at the broker', () => {
    const { trace, broker } = replay([
      llm('root', 'root:task:t1'),
      llm('root', 'root:task:t2'),
      done('root', 'root:task:t1'),
    ].join('\n'));
    expect(trace).toEqual(['turn_started:running', 'turn_started:running', 'turn_completed:running']);
    expect(broker.handoffState('term')).toBe('running');
  });
  it('enters Needs Input for a human approval and resolves the matching response', () => {
    const { trace, frames } = replay([
      llm('root', 'root:task:t1'),
      approval('pre_approval_request', 'root:task:t1', 'cli', 'call_1'),
      approval('post_approval_response', 'root:task:t1', 'cli', 'call_other', ", choice='once'"),
      approval('post_approval_response', 'root:task:t1', 'cli', 'call_1', ", choice='once'"),
      done('root', 'root:task:t1'),
    ].join('\n'));
    expect(trace).toEqual(['turn_started:running', 'input_requested:needs_input', 'input_resolved:needs_input', 'input_resolved:running', 'turn_completed:ready']);
    expect(frames[1]).toMatchObject({ inputId: 'call_1', turnId: 'root:task:t1', sessionId: 'root' });
  });
  it('never enters Needs Input for a smart approval, a child approval, or an unknown turn', () => {
    const { trace } = replay([
      llm('root', 'root:task:t1'),
      llm('child', 'child:task:c1', 'root'),
      approval('pre_approval_request', 'root:task:t1', 'smart', 'call_s'),
      approval('post_approval_response', 'root:task:t1', 'smart', 'call_s', ", choice='smart_approve'"),
      approval('pre_approval_request', 'child:task:c1', 'cli', 'call_c'),
      approval('pre_approval_request', 'ghost:task:g1', 'cli', 'call_g'),
    ].join('\n'));
    expect(trace).toEqual(['turn_started:running', 'input_requested:running']);
  });
  it('treats session finalize as a boundary, then lets a new root bind in the same process', () => {
    const { trace } = replay([
      llm('A', 'A:task:t1'),
      "fire('on_session_finalize', session_id='A', platform='tui')",
      llm('B', 'B:task:t2'),
      done('B', 'B:task:t2'),
    ].join('\n'));
    expect(trace).toEqual(['turn_started:running', 'session_ended:unverified', 'turn_started:running', 'turn_completed:ready']);
  });
  it('ignores a finalize for an unrelated session', () => {
    const { trace } = replay([llm('A', 'A:task:t1'), "fire('on_session_finalize', session_id='other', platform='tui')"].join('\n'));
    expect(trace).toEqual(['turn_started:running']);
  });
});
