import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { validateLocal } from '../../../src/main/harnesses/pi/invocation';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })); });
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
