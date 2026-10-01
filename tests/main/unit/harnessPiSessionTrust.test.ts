import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { validateLocal } from '../../../src/main/harnesses/pi/invocation';

const streams = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => { streams.read(...args); return actual.createReadStream(...args); } };
});
const roots: string[] = [];
afterEach(() => { streams.read.mockClear(); vi.unstubAllEnvs(); roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-pi-trust-'));
  roots.push(root);
  const store = path.join(root, 'configured-sessions');
  fs.mkdirSync(store);
  vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', store);
  const file = path.join(store, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'session', id: 'trusted', cwd: root, timestamp: '2026-01-01' }) + '\n');
  const session = { harness: 'pi' as const, id: 'trusted', title: 'renderer title', cwd: root, timestamp: 0, filePath: file };
  return { root, store, file, session, context: { workspacePath: root } };
}
it('resolves trusted identity and metadata in a configured flat store', async () => {
  const { session, context, file } = fixture();
  expect(await validateLocal(session, context)).toMatchObject({ id: 'trusted', title: 'Pi session', filePath: file });
  expect(await validateLocal({ ...session, filePath: undefined }, context)).toMatchObject({ filePath: file });
});
it('rejects renderer paths outside the store and traversal aliases', async () => {
  const { root, session, context, store } = fixture();
  await expect(validateLocal({ ...session, filePath: path.join(root, 'outside.jsonl') }, context)).rejects.toMatchObject({ kind: 'not-configured' });
  await expect(validateLocal({ ...session, filePath: `${store}/../configured-sessions/session.jsonl` }, context)).rejects.toMatchObject({ kind: 'not-configured' });
});
it('rejects symbolic session files', async () => {
  const { root, file, session, context } = fixture();
  const outside = path.join(root, 'outside.jsonl');
  fs.renameSync(file, outside); fs.symlinkSync(outside, file);
  await expect(validateLocal(session, context)).rejects.toMatchObject({ kind: 'not-configured' });
});
it('rejects missing and ambiguous session identities', async () => {
  const { session, context, file, store } = fixture();
  await expect(validateLocal({ ...session, id: 'missing' }, context)).rejects.toMatchObject({ kind: 'not-configured' });
  fs.copyFileSync(file, path.join(store, 'duplicate.jsonl'));
  await expect(validateLocal(session, context)).rejects.toMatchObject({ kind: 'not-configured' });
  fs.rmSync(file); fs.rmSync(path.join(store, 'duplicate.jsonl'));
  await expect(validateLocal(session, context)).rejects.toMatchObject({ kind: 'not-configured' });
});
it('honors trusted explicit session directory before environment configuration', async () => {
  const { store, session, context } = fixture();
  vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', '/missing');
  expect(await validateLocal(session, { ...context, userFlags: `--session-dir=${store}` })).toMatchObject({ filePath: session.filePath });
});

it('rejects session metadata with an escaping cwd traversal or symlink', async () => {
  const { root, file, session, context } = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-pi-outside-'));
  roots.push(outside);
  fs.writeFileSync(file, JSON.stringify({ type: 'session', id: 'trusted', cwd: `${root}/../${path.basename(outside)}` }) + '\n');
  await expect(validateLocal(session, context)).rejects.toMatchObject({ kind: 'not-configured' });
  const link = path.join(root, 'cwd-link'); fs.symlinkSync(outside, link, 'dir');
  fs.writeFileSync(file, JSON.stringify({ type: 'session', id: 'trusted', cwd: link }) + '\n');
  await expect(validateLocal(session, context)).rejects.toMatchObject({ kind: 'not-configured' });
});

it('reads unrelated large transcripts only as bounded headers and fully parses just the selected session', async () => {
  const { root, store, file, session, context } = fixture();
  const unrelated = path.join(store, 'unrelated.jsonl');
  fs.writeFileSync(unrelated, JSON.stringify({ type: 'session', id: 'unrelated', cwd: root }) + '\n'
    + (JSON.stringify({ type: 'message', message: { role: 'user', content: 'x'.repeat(1000) } }) + '\n').repeat(2048));
  fs.appendFileSync(file, JSON.stringify({ type: 'model_change', modelId: 'trusted-model', provider: 'trusted-provider' }) + '\n'
    + JSON.stringify({ type: 'message', message: { role: 'user', content: 'Trusted title' } }) + '\n');
  const trusted = await validateLocal({ ...session, modelId: 'forged', provider: 'forged', title: 'forged', cwd: '/untrusted' }, context);
  expect(trusted).toMatchObject({ cwd: root, filePath: file, modelId: 'trusted-model', provider: 'trusted-provider', title: 'Trusted title' });
  const calls = streams.read.mock.calls as Array<[string, { highWaterMark?: number }]>;
  expect(calls.filter(([filename]) => filename === unrelated)).toEqual([[unrelated, expect.objectContaining({ highWaterMark: 8192 })]]);
  expect(calls.filter(([filename, options]) => filename === file && options.highWaterMark === undefined)).toHaveLength(1);
});

it('looks up configured agent roots with encoded cwd subdirectories and rejects stale renderer paths', async () => {
  const { root, file, session, context } = fixture();
  const agent = path.join(root, 'custom-agent');
  const directory = path.join(agent, 'sessions', '--workspace--'); fs.mkdirSync(directory, { recursive: true });
  const selected = path.join(directory, 'session.jsonl'); fs.renameSync(file, selected);
  vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', ''); vi.stubEnv('PI_CODING_AGENT_DIR', agent);
  await expect(validateLocal(session, context)).rejects.toMatchObject({ kind: 'not-configured' });
  expect(await validateLocal({ ...session, filePath: selected }, context)).toMatchObject({ filePath: selected });
});

it('accepts the separate stored --session-dir argument form', async () => {
  const { store, session, context } = fixture(); vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', '/missing');
  expect(await validateLocal(session, { ...context, userFlags: `--session-dir ${store}` })).toMatchObject({ filePath: session.filePath });
});
