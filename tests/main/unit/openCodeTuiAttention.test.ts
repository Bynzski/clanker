import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';
import { SOURCE_V2 } from '../../../src/main/harnesses/opencode/attention';
import { SOURCE } from '../../../src/main/harnesses/opencode/attentionTui';
import { isOpenCodeTuiInvocation } from '../../../src/main/harnesses/opencode/privateServer';
import { OBSERVER_FIELDS } from '../../../src/main/harnesses/attentionSources';

interface NativeEvent { type: string; data: Record<string, unknown> }
interface Info { id: string; parentID?: string; location?: { directory: string } }
interface Wire { event: string; [key: string]: unknown }
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllEnvs(); });

async function fixture(seed?: string) {
  vi.stubEnv('CLANKER_ATTENTION_SESSION_ID', seed ?? '');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-oc-tui-unit-'));
  const broker = new AgentAttentionBroker(() => {}, () => {});
  const token = broker.registerRemote('term', 'opencode', { rootSessionId: seed });
  const modules = ['v2-plugin', 'v2-tui-plugin'];
  for (const name of modules) fs.mkdirSync(path.join(root, name));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, 'observer.mjs'), `${OBSERVER_FIELDS}\nexport const wires=[]; export async function emit(event, fields) { wires.push(envelope(event,fields)); return true; }`);
  // Replace only the external Solid scheduler; execute the actual generated client/core source.
  fs.writeFileSync(path.join(root, 'solid.mjs'), 'const effects=[]; export function createEffect(fn){effects.push(fn);fn();} export function flush(){effects.forEach(fn=>fn());}');
  fs.writeFileSync(path.join(root, 'v2-plugin/index.js'), SOURCE_V2);
  fs.writeFileSync(path.join(root, 'v2-tui-plugin/tui.js'), SOURCE.replace("from 'solid-js'", "from '../solid.mjs'"));
  const load = (file: string) => import(/* @vite-ignore */ pathToFileURL(path.join(root, file)).href);
  const plugin = await load('v2-tui-plugin/tui.js');
  const observer = await load('observer.mjs') as { wires: Wire[] };
  const solid = await load('solid.mjs') as { flush(): void };
  const sessions = new Map<string, Info>([
    ['a', { id: 'a', location: { directory: '/repo' } }],
    ['b', { id: 'b', location: { directory: '/repo/linked' } }],
    ['child', { id: 'child', parentID: 'a' }],
  ]);
  let lookup = async (id: string) => sessions.get(id);
  let route: { type: string; sessionID?: string } = { type: 'home' };
  let listener: ((event: { details: NativeEvent }) => void) | undefined;
  const ctx = {
    location: { directory: '/repo' },
    client: { session: { get: ({ sessionID }: { sessionID: string }) => lookup(sessionID) } },
    ui: { router: { current: () => route } },
    data: { session: { get: (id: string) => sessions.get(id) },
      listen: (callback: typeof listener) => { listener = callback; return () => { listener = undefined; }; } },
  };
  let dispose = plugin.default.setup(ctx) as () => void;
  cleanups.push(() => { dispose(); broker.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const emitted: Wire[] = [];
  const flush = async () => {
    for (let index = 0; index < 20; index++) await new Promise(resolve => setTimeout(resolve, 0));
    const wires = observer.wires.splice(0);
    emitted.push(...wires);
    wires.forEach(wire => broker.receiveRemote('term', JSON.stringify({ version: 1, token, harness: 'opencode', ...wire })));
    return wires;
  };
  const select = async (id?: string) => { route = id ? { type: 'session', sessionID: id } : { type: 'home' }; solid.flush(); return flush(); };
  const send = async (type: string, sessionID: string, extra: Record<string, unknown> = {}) => {
    listener?.({ details: { type, data: { sessionID, ...extra } } });
    return flush();
  };
  return { broker, select, send, sessions, flush, emitted, dispose: () => dispose(),
    restart: () => { dispose(); dispose = plugin.default.setup(ctx) as () => void; },
    routeWithoutEffect: (id: string) => { route = { type: 'session', sessionID: id }; },
    setLookup: (read: (id: string) => Promise<Info | undefined>) => { lookup = read; },
    raw: (type: string, sessionID: string) => listener?.({ details: { type, data: { sessionID } } }) };
}

describe('OpenCode native TUI selection', () => {
  it('replaces a bound root only on native selection; unrelated roots cannot take it', async () => {
    const f = await fixture();
    await f.select('a');
    await f.send('session.execution.started', 'a');
    await f.send('permission.asked', 'a', { id: 'p1' });
    expect(f.broker.snapshot('term')?.pendingRequest?.id).toBe('p1');
    expect(await f.send('session.execution.started', 'b')).toEqual([]);
    expect(f.broker.snapshot('term')?.sessionId).toBe('a');
    const boundary = await f.select('b');
    expect(boundary[0]).toMatchObject({ event: 'session_replaced', previousSessionId: 'a', sessionId: 'b', nativeEvent: 'tui.session.selected' });
    expect(f.broker.snapshot('term')).toMatchObject({ sessionId: 'b', runtime: { status: 'running' }, pendingRequest: null, lastCompletion: null });
    expect(await f.send('session.execution.succeeded', 'a')).toEqual([]);
    expect(f.broker.snapshot('term')?.runtime.status).toBe('running');
    await f.send('session.execution.succeeded', 'b');
    expect(f.broker.snapshot('term')?.lastOutcome?.kind).toBe('completed');
  });

  it('recovers a fast first turn that arrives before native route metadata', async () => {
    const f = await fixture();
    f.sessions.delete('a');
    await f.select('a'); // Native route is selected; root metadata has not arrived yet.
    await f.send('session.created', 'a', { location: { directory: '/repo' } });
    await f.send('session.execution.started', 'a');
    await f.send('session.execution.succeeded', 'a');
    expect(f.broker.snapshot('term')?.sessionId).toBeNull();
    f.sessions.set('a', { id: 'a', location: { directory: '/repo' } });
    await f.select('a');
    expect(f.broker.snapshot('term')).toMatchObject({ sessionId: 'a', runtime: { status: 'idle' }, lastOutcome: { kind: 'completed' } });
  });

  it('does not announce completed auxiliary history on its first selection', async () => {
    const f = await fixture();
    await f.send('session.execution.started', 'b');
    await f.send('session.execution.succeeded', 'b');
    expect((await f.select('b')).map(wire => wire.event)).toEqual(['session_started']);
    expect(f.broker.snapshot('term')).toMatchObject({ sessionId: 'b', runtime: { status: 'unverified' }, lastCompletion: null });
  });

  it('does not reannounce completed history on return, but restores an active native wait', async () => {
    const f = await fixture();
    await f.select('a');
    await f.send('session.execution.started', 'a');
    await f.send('session.execution.succeeded', 'a');
    const completion = f.broker.snapshot('term')?.lastCompletion;
    await f.select('b');
    const returning = await f.select('a');
    expect(returning.map(wire => wire.event)).toEqual(['session_replaced']);
    expect(f.broker.snapshot('term')).toMatchObject({ sessionId: 'a', runtime: { status: 'unverified' }, lastCompletion: completion, lastOutcome: { kind: 'session_ended' } });
    await f.send('session.execution.started', 'a');
    await f.send('permission.asked', 'a', { id: 'p2' });
    await f.select('b');
    await f.select('a');
    expect(f.broker.snapshot('term')).toMatchObject({ sessionId: 'a', pendingRequest: { id: 'p2' }, runtime: { status: 'running' } });
    await f.send('permission.replied', 'a', { requestID: 'p2' });
    expect(f.broker.snapshot('term')?.pendingRequest).toBeNull();
  });

  it('never selects children, unknown metadata or home as a new root', async () => {
    const f = await fixture();
    await f.select('a');
    await f.send('session.execution.started', 'a');
    for (const id of ['child', 'unknown', undefined]) expect(await f.select(id)).toEqual([]);
    expect(await f.send('session.execution.started', 'child')).toEqual([]);
    expect(await f.send('session.execution.succeeded', 'unknown')).toEqual([]);
    expect(f.broker.snapshot('term')).toMatchObject({ sessionId: 'a', runtime: { status: 'running' } });
  });

  it.each([{ destination: 'child' }, { destination: undefined }])('keeps the bound root live during native child/home navigation ($destination)', async ({ destination }) => {
    const f = await fixture();
    await f.select('a');
    await f.send('session.execution.started', 'a');
    expect(await f.select(destination)).toEqual([]);
    expect(await f.send('session.execution.started', 'b')).toEqual([]);
    await f.send('session.execution.succeeded', 'a');
    expect(f.broker.snapshot('term')).toMatchObject({ sessionId: 'a', lastOutcome: { kind: 'completed' } });
  });

  it('keeps event and selection order through rapid A to B to A changes', async () => {
    const f = await fixture();
    await f.select('a');
    f.raw('session.execution.started', 'a');
    const toB = f.select('b');
    f.raw('session.execution.succeeded', 'a');
    const toA = f.select('a');
    await Promise.all([toB, toA]);
    expect(f.broker.snapshot('term')).toMatchObject({ sessionId: 'a', runtime: { status: 'unverified' }, lastCompletion: null });
    await f.send('session.execution.started', 'a');
    await f.send('session.execution.succeeded', 'a');
    expect(f.broker.snapshot('term')?.lastOutcome?.kind).toBe('completed');
  });

  it('does not publish an old completion when a native route change precedes the reactive callback', async () => {
    const f = await fixture();
    await f.select('a');
    await f.send('session.execution.started', 'a');
    f.routeWithoutEffect('b');
    expect(await f.send('session.execution.succeeded', 'a')).toEqual([]);
    expect(f.broker.snapshot('term')?.lastCompletion).toBeNull();
    await f.select('b');
    expect(f.broker.snapshot('term')).toMatchObject({ sessionId: 'b', runtime: { status: 'unverified' }, lastCompletion: null });
  });

  it('respects a seeded resume and can bind a new root after native deletion', async () => {
    const f = await fixture('a');
    expect((await f.select('a'))[0]).toMatchObject({ event: 'session_started', sessionId: 'a' });
    await f.send('session.execution.started', 'a');
    await f.send('session.deleted', 'a');
    expect(f.broker.snapshot('term')?.sessionId).toBeNull();
    expect((await f.select('b'))[0]).toMatchObject({ event: 'session_started', sessionId: 'b' });
    expect(f.broker.snapshot('term')?.sessionId).toBe('b');
  });

  it('advances background epochs without publishing their completion or reviving it on return', async () => {
    const f = await fixture();
    await f.select('a');
    await f.send('session.execution.started', 'a');
    const oldTurn = f.broker.snapshot('term')?.runtime.turnId;
    await f.select('b');
    await f.send('session.execution.started', 'b');
    expect(await f.send('session.execution.succeeded', 'a')).toEqual([]);
    expect(await f.send('permission.replied', 'a', { requestID: 'late' })).toEqual([]);
    await f.select('a');
    expect(f.broker.snapshot('term')?.runtime.status).toBe('unverified');
    await f.send('session.execution.started', 'a');
    expect(f.broker.snapshot('term')?.runtime.turnId).not.toBe(oldTurn);
    await f.send('session.execution.succeeded', 'a');
    expect(f.broker.snapshot('term')?.lastOutcome?.kind).toBe('completed');
  });

  it('waits for authenticated native metadata rather than selecting a missing root', async () => {
    const f = await fixture();
    await f.select('later');
    await f.send('session.execution.started', 'later');
    expect(f.broker.snapshot('term')?.sessionId).toBeNull();
    f.sessions.set('later', { id: 'later', location: { directory: '/repo' } });
    await f.select('later');
    expect(f.broker.snapshot('term')).toMatchObject({ sessionId: 'later', runtime: { status: 'running' } });
  });

  it('does not publish an in-flight lookup after disposal', async () => {
    const f = await fixture();
    let resolve!: (info: Info) => void;
    let started = false;
    f.setLookup(() => { started = true; return new Promise<Info>(done => { resolve = done; }); });
    await f.select('a');
    f.raw('session.execution.started', 'a');
    await vi.waitFor(() => expect(started).toBe(true));
    f.dispose();
    resolve({ id: 'a' });
    expect(await f.flush()).toEqual([]);
    expect(f.broker.snapshot('term')?.runtime.status).toBe('unverified');
  });

  it('compacts resolved waits so a long active turn can be selected again', async () => {
    const f = await fixture();
    await f.select('a');
    await f.send('session.execution.started', 'a');
    await f.select('b');
    for (let index = 0; index < 40; index++) {
      await f.send('permission.asked', 'a', { id: `p${index}` });
      await f.send('permission.replied', 'a', { requestID: `p${index}` });
    }
    await f.select('a');
    expect(f.broker.snapshot('term')).toMatchObject({ sessionId: 'a', runtime: { status: 'running' }, pendingRequest: null });
  });

  it('uses fresh turn identity when a TUI plugin reload reuses its imported core module', async () => {
    const f = await fixture();
    await f.select('a');
    await f.send('session.execution.started', 'a');
    await f.send('session.execution.succeeded', 'a');
    const old = f.broker.snapshot('term')?.lastCompletion?.turnId;
    f.restart();
    await f.flush();
    await f.send('session.execution.started', 'a');
    expect(f.broker.snapshot('term')?.runtime.status).toBe('running');
    expect(f.broker.snapshot('term')?.runtime.turnId).not.toBe(old);
    await f.send('session.execution.succeeded', 'a');
    expect(f.broker.snapshot('term')?.lastOutcome?.kind).toBe('completed');
  });

  it('drops queued work on disposal', async () => {
    const f = await fixture();
    await f.select('a');
    f.raw('session.execution.started', 'a');
    f.dispose();
    expect(await f.flush()).toEqual([]);
    expect(f.broker.snapshot('term')?.runtime.status).toBe('unverified');
  });
});

describe('OpenCode client-selection injection scope', () => {
  it.each([[], ['--standalone'], ['--session', 'ses_fixture'], ['--session=ses_fixture'], ['-c'], ['--auto', '--prompt', 'fixture'], ['--log-level', 'debug', '--print-logs']].map(args => ({ args })))('accepts verified TUI argv $args', ({ args }) => {
    expect(isOpenCodeTuiInvocation(args)).toBe(true);
  });
  it.each([['run', 'fixture'], ['serve'], ['acp'], ['session', 'list'], ['/repo'], ['--help'], ['--unknown'], ['--session'], ['--session='], ['--session', '--auto']].map(args => ({ args })))('keeps other argv server-only $args', ({ args }) => {
    expect(isOpenCodeTuiInvocation(args)).toBe(false);
  });
});
