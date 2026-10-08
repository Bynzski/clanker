import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildCommitDiffContext } from '../../../src/main/aiCommitContext';

const directories: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clanker-commit-context-'));
  directories.push(root);
  return root;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const untracked = (name: string) => ({ path: name, status: 'untracked' as const, staged: false });

it('includes bounded untracked text without changing the index', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'new.ts'), 'export const greeting = "hello";');
  expect(await buildCommitDiffContext(root, 'tracked patch', [untracked('new.ts')])).toContain('export const greeting');
});
it('marks binary, oversized, and unavailable files explicitly', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'binary'), Buffer.from([1, 0, 2]));
  await writeFile(path.join(root, 'large'), 'x'.repeat(20_000));
  const output = await buildCommitDiffContext(root, '', [untracked('binary'), untracked('large'), untracked('gone')]);
  expect(output).toContain('[Binary file]');
  expect(output).toContain('[File truncated]');
  expect(output).toContain('[Unavailable or outside checkout]');
  expect(Buffer.byteLength(output)).toBeLessThan(41 * 1024);
});
it('does not expose external paths or symlink targets', async () => {
  const root = await fixture();
  const outside = await fixture();
  const secret = path.join(outside, 'secret');
  await writeFile(secret, 'private secret');
  if (process.platform !== 'win32') await symlink(secret, path.join(root, 'linked'));
  const output = await buildCommitDiffContext(root, '', [untracked(secret), untracked('../secret'), untracked('linked')]);
  expect(output).not.toContain('private secret');
});
it('bounds tracked patches and additional untracked content', async () => {
  const root = await fixture();
  const output = await buildCommitDiffContext(root, 'x'.repeat(100_000), [untracked('new')]);
  expect(output).toContain('[Tracked patch truncated]');
  expect(output).toContain('[Additional untracked content omitted]');
  expect(Buffer.byteLength(output)).toBeLessThan(41 * 1024);
});
