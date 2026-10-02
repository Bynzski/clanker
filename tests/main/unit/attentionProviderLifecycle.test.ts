import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentAttentionBroker, type AttentionDecision } from '../../../src/main/agentAttentionBroker';
import { OBSERVER_FIELDS } from '../../../src/main/harnesses/attentionSources';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import { createRemoteAttentionFilter } from '../../../src/main/remote/remoteAttentionTransport';
import { HERMES_REMOTE_ATTENTION_PLUGIN } from '../../../src/main/harnesses/hermes/remoteAttention';
import { SOURCE as PI } from '../../../src/main/harnesses/pi/attention';
import { SOURCE as OMP } from '../../../src/main/harnesses/omp/attention';
import { SOURCE as OPENCODE } from '../../../src/main/harnesses/opencode/attention';
import type { AgentAttentionUpdate } from '../../../src/shared/types/agentAttention';

/** Provider-native lifecycle fixtures run through the real provider interpreter or plugin source
 * and the real broker. Nothing here calls a model or an installed harness. */
const dirs: string[] = [];
const brokers: AgentAttentionBroker[] = [];
afterEach(() => {
  dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  brokers.splice(0).forEach((broker) => broker.close());
});

interface Wire { event: string; [key: string]: unknown }
function rig(harness: string, rootSessionId?: string) {
  const updates: AgentAttentionUpdate[] = [];
  const decisions: AttentionDecision[] = [];
  const broker = new AgentAttentionBroker((update) => updates.push(update), (diagnostic) => decisions.push(diagnostic.decision));
  brokers.push(broker);
  const token = broker.registerRemote('term', harness, { rootSessionId });
  const feed = (wire: Wire | null | undefined) => {
    if (wire) broker.receiveRemote('term', JSON.stringify({ version: 1, token, harness, ...wire }));
  };
  return { broker, updates, decisions, feed, state: () => broker.handoffState('term') };
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

/** A hook-command provider: stdin payload + hook name -> canonical wire event. */
async function interpreter(harness: 'codex' | 'claude' | 'agy') {
  const module = await importSource(getHarnessProvider(harness).attention.interpreter!);
  return (hook: string, input: Record<string, unknown>): Wire | null => module.default(input, hook)?.event
    ? (({ type, ...fields }) => ({ event: type, ...fields }))(module.default(input, hook).event) : null;
}

describe('Codex lifecycle', () => {
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
    feed(hook('PostToolUse', { session_id: 'root', turn_id: 't1', tool_name: 'Bash' }));
    expect(state()).toBe('running');
    feed(hook('Stop', { session_id: 'root', turn_id: 't1' }));
    expect(state()).toBe('ready');
  });
  it('treats PermissionRequest as input and only the matching tool completion as resolution', async () => {
    const hook = await interpreter('codex');
    const { feed, state } = rig('codex');
    feed(hook('UserPromptSubmit', { session_id: 'root', turn_id: 't1' }));
    feed(hook('PermissionRequest', { session_id: 'root', turn_id: 't1', tool_name: 'apply_patch' }));
    expect(state()).toBe('needs_input');
    feed(hook('PostToolUse', { session_id: 'root', turn_id: 't1', tool_name: 'Bash' }));
    expect(state()).toBe('needs_input');
    feed(hook('PostToolUse', { session_id: 'root', turn_id: 't1', tool_name: 'apply_patch' }));
    expect(state()).toBe('running');
  });
  it('ignores legacy notify payloads and unrelated native events', async () => {
    const hook = await interpreter('codex');
    expect(hook('PreToolUse', { session_id: 'root' })).toBeNull();
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
  it('ignores child events and background-active Stop; a clean root Stop settles', async () => {
    const hook = await interpreter('claude');
    const { feed, state, decisions } = rig('claude');
    feed(hook('UserPromptSubmit', { session_id: 'root' }));
    feed(hook('PostToolUse', { session_id: 'root', agent_id: 'sub-1', tool_name: 'Read' }));
    feed(hook('PermissionRequest', { session_id: 'root', agent_id: 'sub-1', tool_name: 'Bash' }));
    expect(state()).toBe('running');
    expect(decisions.slice(1)).toEqual(['ignored-child', 'ignored-child']);
    expect(hook('Stop', { session_id: 'root', background_tasks: [{ id: 'bg' }] })).toBeNull();
    expect(hook('Stop', { session_id: 'root', session_crons: [{ id: 'cron' }] })).toBeNull();
    feed(hook('Stop', { session_id: 'root', background_tasks: [], session_crons: [] }));
    expect(state()).toBe('ready');
  });
  it('enters Needs Input from PermissionRequest and is not cleared by an unrelated PostToolUse', async () => {
    const hook = await interpreter('claude');
    const { feed, state } = rig('claude');
    feed(hook('UserPromptSubmit', { session_id: 'root' }));
    feed(hook('PostToolUse', { session_id: 'root', tool_name: 'Read' }));
    expect(state()).toBe('running');
    feed(hook('PermissionRequest', { session_id: 'root', tool_name: 'Bash' }));
    expect(state()).toBe('needs_input');
    feed(hook('PostToolUse', { session_id: 'root', tool_name: 'Read' }));
    expect(state()).toBe('needs_input');
    feed(hook('PostToolUse', { session_id: 'root', tool_name: 'Bash' }));
    expect(state()).toBe('running');
    feed(hook('Notification', { session_id: 'root', notification_type: 'agent_needs_input' }));
    expect(state()).toBe('needs_input');
    feed(hook('Notification', { session_id: 'root', notification_type: 'idle_prompt' }));
    feed(hook('Stop', { session_id: 'root' }));
    expect(state()).toBe('ready');
  });
  it('rebinds on SessionEnd (clear) without losing attention', async () => {
    const hook = await interpreter('claude');
    const { feed, state, broker } = rig('claude');
    feed(hook('UserPromptSubmit', { session_id: 'one' }));
    feed(hook('SessionEnd', { session_id: 'one' }));
    expect(broker.canHandoff('term')).toBe(true);
    feed(hook('UserPromptSubmit', { session_id: 'two' }));
    feed(hook('Stop', { session_id: 'two' }));
    expect(state()).toBe('ready');
  });
});

describe('Agy lifecycle', () => {
  it('binds the root conversation, keeps Running for fullyIdle=false, and rejects other conversations', async () => {
    const hook = await interpreter('agy');
    const { feed, state, decisions } = rig('agy');
    feed(hook('PreInvocation', { conversationId: 'root', invocationNum: 0 }));
    feed(hook('PreInvocation', { conversationId: 'sub', invocationNum: 0 }));
    feed(hook('Stop', { conversationId: 'sub', fullyIdle: true }));
    expect(hook('Stop', { conversationId: 'root', fullyIdle: false })).toBeNull();
    expect(hook('Stop', { conversationId: 'root' })).toBeNull();
    expect(state()).toBe('running');
    expect(decisions).toEqual(['accepted', 'rejected-mismatch', 'rejected-mismatch']);
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
  it('completes on agent_settled only, never on lower-level end events', async () => {
    const pi = await importSource(PI);
    const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
    pi.default({ on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers[name] = handler; } });
    expect(Object.keys(handlers).sort()).toEqual(['agent_settled', 'agent_start', 'session_shutdown']);
    const { feed, state } = rig('pi');
    const ctx = { sessionManager: { getSessionId: () => 'root' } };
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
});

describe('Oh My Pi lifecycle', () => {
  it('ignores agent_end and subagent sessions; only the main session_stop settles', async () => {
    const omp = await importSource(OMP);
    const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
    omp.default({ on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers[name] = handler; } });
    expect(handlers.agent_end).toBeUndefined();
    const main = { sessionManager: { getSessionId: () => 'main' }, agent: { kind: 'main' } };
    const sub = { sessionManager: { getSessionId: () => 'task-1' }, agent: { kind: 'sub' } };
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
});

describe('OpenCode lifecycle', () => {
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
    await step('session.idle', { sessionID: 'root' }); // legacy duplicate cannot re-settle
    expect(state()).toBe('ready');
  });
  it('never infers a root from the first event: unknown parentage is not reported', async () => {
    const send = await plugin();
    drain();
    await send('session.status', { sessionID: 'mystery', status: { type: 'busy' } });
    expect(drain()).toEqual([]);
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

describe('Hermes lifecycle (SSH observer)', () => {
  it('ignores child completion and smart approvals; human approval and root completion count', () => {
    const script = `${HERMES_REMOTE_ATTENTION_PLUGIN}
class Context:
    def __init__(self):
        self.hooks = {}
    def register_hook(self, name, callback):
        self.hooks[name] = callback
ctx = Context()
register(ctx)
for name, kwargs in [
    ('pre_llm_call', dict(session_id='root')),
    ('pre_llm_call', dict(session_id='child', parent_session_id='root')),
    ('pre_approval_request', dict(session_id='root', surface='smart')),
    ('post_approval_response', dict(session_id='root', surface='smart')),
    ('pre_approval_request', dict(session_id='root', surface='cli')),
    ('post_approval_response', dict(session_id='root', surface='cli')),
    ('post_llm_call', dict(session_id='child', parent_session_id='root')),
    ('post_llm_call', dict(session_id='root')),
]:
    ctx.hooks[name](**kwargs)
`;
    const capture = `import os, pty, sys
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
    const token = 'b'.repeat(64);
    const stdout = execFileSync('python3', ['-c', capture, 'python3', '-c', script], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, CLANKER_REMOTE_ATTENTION_TOKEN: token, CLANKER_REMOTE_ATTENTION_HARNESS: 'hermes' },
    });
    const updates: AgentAttentionUpdate[] = [];
    const broker = new AgentAttentionBroker((update) => updates.push(update), () => undefined);
    brokers.push(broker);
    const registered = broker.registerRemote('term', 'hermes');
    const trace: string[] = [];
    // Replay each frame in order, noting the lifecycle after every one.
    createRemoteAttentionFilter((raw) => {
      broker.receiveRemote('term', JSON.stringify({ ...JSON.parse(raw), token: registered }));
      trace.push(`${JSON.parse(raw).event}:${broker.handoffState('term')}`);
    })(stdout);
    expect(trace).toEqual([
      'turn_started:running', 'turn_started:running', // the child start is ignored by the broker
      'input_requested:needs_input', 'input_resolved:running',
      'turn_completed:running', // the child's post_llm_call cannot settle the root
      'turn_completed:ready',
    ]);
  });
});
