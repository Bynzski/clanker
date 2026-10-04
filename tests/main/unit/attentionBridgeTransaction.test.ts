import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { attentionRecorder } from '../../_helpers/attentionChanges';
import { AgentAttentionBroker, type AttentionDiagnostic } from '../../../src/main/agentAttentionBroker';
import { COMMAND, OBSERVER } from '../../../src/main/harnesses/attentionSources';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';

/** Real `command.mjs` processes against one terminal's state, with the real broker and loopback
 * transport. No model call and no installed harness. */
const dirs: string[] = [];
const brokers: AgentAttentionBroker[] = [];
afterEach(() => {
  brokers.splice(0).forEach((broker) => broker.close());
  dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

const SLEEP = `const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);`;

async function bridge(extraFiles: Record<string, string> = {}, observer = OBSERVER) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-bridge-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'observer.mjs'), observer);
  fs.writeFileSync(path.join(dir, 'command.mjs'), COMMAND);
  fs.writeFileSync(path.join(dir, 'codex.mjs'), getHarnessProvider('codex').attention.interpreter!);
  // Holds every PermissionRequest transaction open after its read, so two processes overlap
  // between read and write unless the bridge serializes them.
  fs.writeFileSync(path.join(dir, 'slow.mjs'), `import inner from './codex.mjs';
${SLEEP}
export default (input, hook, store) => inner(input, hook, {
  read() { const value = store.read(); if (hook === 'PermissionRequest') sleep(250); return value; },
  write: (value) => store.write(value),
});
`);
  // Generic interpreter: reads state, then reports the canonical event named by the payload.
  fs.writeFileSync(path.join(dir, 'echo.mjs'), `export default (input, hook, store) => { store.read(); return { event: { type: input.type, scope: 'root', sessionId: 's', turnId: 't1' } }; };\n`);
  for (const [name, content] of Object.entries(extraFiles)) fs.writeFileSync(path.join(dir, name), content);
  const recorder = attentionRecorder();
  const updates = recorder.labels;
  const diagnostics: AttentionDiagnostic[] = [];
  const broker = new AgentAttentionBroker(recorder.onChange, (diagnostic) => diagnostics.push(diagnostic));
  brokers.push(broker);
  const env = await broker.register('term', 'codex');
  const stateBase = path.join(dir, '.clanker-state-' + createHash('sha256').update(env.CLANKER_ATTENTION_TOKEN).digest('hex').slice(0, 16));
  const run = (interpreter: string, hook: string, input: object) => new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(dir, 'command.mjs'), path.join(dir, interpreter), hook], {
      env: { ...process.env, ...env }, stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.stdin.end(JSON.stringify(input));
    child.once('error', reject);
    child.once('close', resolve);
  });
  const waitForState = async (ready: (value: { waits: unknown[] }) => boolean) => {
    for (let attempt = 0; attempt < 400; attempt++) {
      try { if (ready(JSON.parse(fs.readFileSync(`${stateBase}.json`, 'utf8')))) return; } catch { /* not written yet */ }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('state never reached the expected shape');
  };
  const state = () => JSON.parse(fs.readFileSync(`${stateBase}.json`, 'utf8')) as { waits: Array<{ ids: string[] }>; calls: unknown[] };
  return { dir, broker, updates, diagnostics, run, state, stateBase, waitForState };
}

const turn = { session_id: 's', turn_id: 't1' };
const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });

describe('attention bridge state transactions', () => {
  it('keeps both waits when two PermissionRequest hook processes overlap', async () => {
    const { run, state, broker, updates } = await bridge();
    await run('codex.mjs', 'UserPromptSubmit', turn);
    await run('codex.mjs', 'PreToolUse', { ...turn, tool_use_id: 'a', ...bash('SECRET-A') });
    await run('codex.mjs', 'PreToolUse', { ...turn, tool_use_id: 'b', ...bash('SECRET-B') });
    const started = Date.now();
    expect(await Promise.all([
      run('slow.mjs', 'PermissionRequest', { ...turn, ...bash('SECRET-A') }),
      run('slow.mjs', 'PermissionRequest', { ...turn, ...bash('SECRET-B') }),
    ])).toEqual([0, 0]);
    // Both waits survive, and the 250ms transactions ran one after the other, not together.
    expect(state().waits.map((wait) => wait.ids).sort()).toEqual([['a'], ['b']]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
    expect(broker.handoffState('term')).toBe('needs_input');
    await run('codex.mjs', 'PostToolUse', { ...turn, tool_use_id: 'b', ...bash('SECRET-B'), tool_response: 'SECRET' });
    expect(broker.handoffState('term')).toBe('needs_input');
    await run('codex.mjs', 'PostToolUse', { ...turn, tool_use_id: 'a', ...bash('SECRET-A'), tool_response: 'SECRET' });
    expect(broker.handoffState('term')).toBe('running');
    expect(updates).toEqual(['turn_started', 'input_requested', 'input_resolved']);
  });

  it('serializes many simultaneous PreToolUse transactions without losing any call', async () => {
    const { run, state } = await bridge();
    await run('codex.mjs', 'UserPromptSubmit', turn);
    const ids = Array.from({ length: 8 }, (_, index) => `call-${index}`);
    await Promise.all(ids.map((id) => run('codex.mjs', 'PreToolUse', { ...turn, tool_use_id: id, ...bash(id) })));
    expect(state().calls).toHaveLength(8);
  });

  it('leaves no lock, temporary or poison artifacts after normal transactions', async () => {
    const { run, dir } = await bridge();
    await run('codex.mjs', 'UserPromptSubmit', turn);
    await run('codex.mjs', 'PreToolUse', { ...turn, tool_use_id: 'a', ...bash('x') });
    expect(fs.readdirSync(dir).filter((name) => name.startsWith('.clanker-state-')).map((name) => name.replace(/[0-9a-f]{16}/, 'H'))).toEqual(['.clanker-state-H.json']);
  });

  it('replaces a lock whose holder is dead and proceeds', async () => {
    const { run, stateBase, updates } = await bridge();
    fs.mkdirSync(`${stateBase}.json.lock`);
    fs.writeFileSync(path.join(`${stateBase}.json.lock`, 'owner'), '2147483646:deadbeef');
    expect(await run('echo.mjs', 'x', { type: 'turn_started' })).toBe(0);
    expect(updates).toEqual(['turn_started']);
    expect(fs.existsSync(`${stateBase}.json.lock`)).toBe(false);
  });

  it('fails closed when a live holder keeps the lock: bounded wait, poison, no input_resolved until a turn boundary', async () => {
    const { run, stateBase, updates, diagnostics } = await bridge();
    expect(await run('echo.mjs', 'x', { type: 'turn_started' })).toBe(0);
    fs.mkdirSync(`${stateBase}.json.lock`);
    fs.writeFileSync(path.join(`${stateBase}.json.lock`, 'owner'), `${process.pid}:live`); // this test process is alive
    const started = Date.now();
    expect(await run('echo.mjs', 'x', { type: 'input_requested' })).toBe(0); // evidence of a wait is still delivered
    expect(Date.now() - started).toBeLessThan(5000);
    expect(fs.existsSync(`${stateBase}.poison`)).toBe(true);
    fs.rmSync(`${stateBase}.json.lock`, { recursive: true });
    expect(await run('echo.mjs', 'x', { type: 'input_resolved' })).toBe(0);
    expect(updates).toEqual(['turn_started', 'input_requested']);
    expect(diagnostics.map((diagnostic) => diagnostic.semantic)).toEqual(['turn_started', 'input_requested']);
    expect(await run('echo.mjs', 'x', { type: 'turn_completed' })).toBe(0);
    expect(fs.existsSync(`${stateBase}.poison`)).toBe(false);
    expect(updates).toEqual(['turn_started', 'input_requested', 'turn_completed']);
  }, 15000);

  it('treats corrupt or oversized state as a failed transaction', async () => {
    const { run, stateBase, updates } = await bridge();
    await run('echo.mjs', 'x', { type: 'turn_started' });
    fs.writeFileSync(`${stateBase}.json`, '{not json');
    await run('echo.mjs', 'x', { type: 'input_requested' });
    expect(fs.existsSync(`${stateBase}.poison`)).toBe(true);
    await run('echo.mjs', 'x', { type: 'input_resolved' });
    expect(updates).toEqual(['turn_started', 'input_requested']);
    await run('echo.mjs', 'x', { type: 'turn_interrupted' });
    // A failed transaction cannot clear the poison; a later healthy boundary does.
    fs.rmSync(`${stateBase}.json`);
    await run('echo.mjs', 'x', { type: 'turn_started' });
    expect(fs.existsSync(`${stateBase}.poison`)).toBe(false);
  });

  it('treats an unwritable state as a failed transaction', async () => {
    const { run, stateBase, updates } = await bridge({
      'big.mjs': `export default (input, hook, store) => { store.read(); store.write({ blob: 'x'.repeat(40000) }); return { event: { type: input.type, scope: 'root', sessionId: 's', turnId: 't1' } }; };\n`,
    });
    await run('echo.mjs', 'x', { type: 'turn_started' });
    await run('big.mjs', 'x', { type: 'input_requested' });
    expect(fs.existsSync(`${stateBase}.poison`)).toBe(true);
    await run('echo.mjs', 'x', { type: 'input_resolved' });
    expect(updates).toEqual(['turn_started', 'input_requested']);
  });

  // A delivery that is slow for one event must not let the next transaction's event overtake it.
  const slowFor = (event: string) => OBSERVER.replace('export async function emit(event, fields) {',
    `export async function emit(event, fields) {\n  if (event === ${JSON.stringify(event)}) await new Promise((resolve) => setTimeout(resolve, 350));`);

  it('delivers input_requested before the input_resolved derived from its state, even when delivery is slow', async () => {
    const { run, updates, broker, waitForState } = await bridge({}, slowFor('input_requested'));
    await run('codex.mjs', 'UserPromptSubmit', turn);
    await run('codex.mjs', 'PreToolUse', { ...turn, tool_use_id: 'a', ...bash('SECRET-A') });
    const request = run('codex.mjs', 'PermissionRequest', { ...turn, ...bash('SECRET-A') });
    // Start the resolving hook once the permission state exists but its event is still in flight.
    await waitForState((state) => state.waits.length === 1);
    const resolve = run('codex.mjs', 'PostToolUse', { ...turn, tool_use_id: 'a', ...bash('SECRET-A'), tool_response: 'SECRET' });
    expect(await Promise.all([request, resolve])).toEqual([0, 0]);
    expect(updates).toEqual(['turn_started', 'input_requested', 'input_resolved']);
    expect(broker.handoffState('term')).toBe('running');
  });

  it('delivers turn_started before the turn_completed that follows it', async () => {
    const { run, updates, broker, waitForState } = await bridge({}, slowFor('turn_started'));
    const start = run('codex.mjs', 'UserPromptSubmit', turn);
    await waitForState(() => true);
    const stop = run('codex.mjs', 'Stop', turn);
    expect(await Promise.all([start, stop])).toEqual([0, 0]);
    expect(updates).toEqual(['turn_started', 'turn_completed']);
    expect(broker.handoffState('term')).toBe('ready');
  });

  it.each([
    ['returns false', 'return false;'],
    ['throws', "throw new Error('transport down');"],
  ])('treats a delivery that %s as a failed transaction: poison, no later resolution, no lock left', async (_name, failure) => {
    const observer = OBSERVER.replace('export async function emit(event, fields) {',
      `export async function emit(event, fields) {\n  if (event === 'input_requested') { ${failure} }`);
    const { run, updates, broker, stateBase, dir } = await bridge({}, observer);
    await run('codex.mjs', 'UserPromptSubmit', turn);
    await run('codex.mjs', 'PreToolUse', { ...turn, tool_use_id: 'a', ...bash('x') });
    await run('codex.mjs', 'PermissionRequest', { ...turn, ...bash('x') });
    expect(fs.existsSync(`${stateBase}.poison`)).toBe(true);
    expect(fs.readdirSync(dir).some((name) => name.endsWith('.lock'))).toBe(false);
    await run('codex.mjs', 'PostToolUse', { ...turn, tool_use_id: 'a', ...bash('x'), tool_response: 'r' });
    expect(updates).toEqual(['turn_started']); // the broker never saw the wait, and nothing resolved later
    expect(broker.handoffState('term')).toBe('running');
    await run('codex.mjs', 'Stop', turn);
    expect(fs.existsSync(`${stateBase}.poison`)).toBe(false);
    expect(updates).toEqual(['turn_started', 'turn_completed']);
  });

  it('does not poison the transaction when only a location report fails to deliver', async () => {
    // A location carries no bridge state, so losing one must never hold back a later resolution.
    const observer = OBSERVER.replace('export async function emit(event, fields) {',
      `export async function emit(event, fields) {\n  if (event === 'location_changed') return false;`);
    const { run, stateBase } = await bridge({
      'move.mjs': `export default (input, hook, store) => { store.read(); return { event: { type: 'location_changed', scope: 'root', sessionId: 's', cwd: '/srv/repo' } }; };\n`,
    }, observer);
    await run('move.mjs', 'CwdChanged', {});
    expect(fs.existsSync(`${stateBase}.poison`)).toBe(false);
  });
});
