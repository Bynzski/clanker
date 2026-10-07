import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HarnessSession } from '../../../src/shared/types/session';
import type { SessionCheckoutPlan } from '../../../src/main/sessionWorktrees';
import { successfulSessionDiscovery } from '../../_helpers/sessionDiscovery';

const { discover } = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock('../../../src/main/sessionHistory', () => ({ discoverSessionsDetailed: discover }));
import { rediscoverDefaultLocalSession } from '../../../src/main/localSessionSelection';
import { sessionPathOps } from '../../../src/main/sessionWorktrees';
import { toPosixPath } from '../../../src/shared/pathNormalize';

let root: string;
let workspacePath: string;
const session = (extra: Partial<HarnessSession> = {}): HarnessSession => ({
  id: 'native-1', harness: 'codex', title: 'native', timestamp: 1, cwd: workspacePath, ...extra,
});
const select = (plan: SessionCheckoutPlan | null = null) => rediscoverDefaultLocalSession({
  selection: { harness: 'codex', id: 'native-1' }, workspacePath, plan,
});
const planFor = (roots: string[]): SessionCheckoutPlan => {
  const ops = sessionPathOps('local');
  return { environmentId: 'local', workspacePath, mainPath: workspacePath, container: null,
    roots: roots.map((path) => ({ path, branch: 'task', exists: true, kind: 'registered' })),
    localBranches: new Set(), canonical: ops.canonical, ops };
};
beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-native-selection-')));
  workspacePath = toPosixPath(path.join(root, 'app with spaces'));
  fs.mkdirSync(workspacePath);
  discover.mockReset().mockResolvedValue(successfulSessionDiscovery([session()]));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('default-account native selection evidence', () => {
  it('forces freshness, excludes managed sources and drops history-only checkout claims', async () => {
    const native = session({ checkout: { branch: 'presentation', path: '/not-authority', exists: true } });
    discover.mockResolvedValue(successfulSessionDiscovery([native]));
    const found = await select();
    expect(discover).toHaveBeenCalledExactlyOnceWith(path.normalize(workspacePath), { forceRefresh: true });
    expect(found).not.toHaveProperty('checkout');
    expect(native).toHaveProperty('checkout'); // discovery's cached/provider object was not mutated
  });

  it('allows equivalent duplicate launch evidence with different titles/timestamps/default-account spelling', async () => {
    discover.mockResolvedValue(successfulSessionDiscovery([session(), session({ title: 'new title', timestamp: 9, accountId: 'default' })]));
    expect(await select()).toMatchObject({ id: 'native-1', cwd: workspacePath });
  });

  it.each(['cwd', 'filePath', 'modelId', 'provider'] as const)('rejects conflicting %s rather than choosing the first duplicate', async (field) => {
    const a = session({ filePath: `${workspacePath}/session.jsonl`, modelId: 'a', provider: 'openai' });
    const b = { ...a, [field]: field === 'cwd' || field === 'filePath' ? `${workspacePath}/other` : 'b' };
    discover.mockResolvedValue(successfulSessionDiscovery([a, b]));
    await expect(select()).rejects.toThrow('Conflicting or invalid native session metadata');
  });

  it('finds conflicts across checkout scans before presentation dedup can hide them', async () => {
    const tree = toPosixPath(path.join(root, 'sibling'));
    fs.mkdirSync(tree);
    discover.mockImplementation(async (scope: string) => successfulSessionDiscovery([
      session({ cwd: scope === path.normalize(workspacePath) ? workspacePath : tree }),
    ]));
    await expect(select(planFor([tree]))).rejects.toThrow('Conflicting');
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('uses the existing one-scan fallback for many checkout scopes', async () => {
    const roots = Array.from({ length: 14 }, (_, index) => toPosixPath(path.join(root, `tree-${index}`)));
    await select(planFor(roots));
    expect(discover).toHaveBeenCalledExactlyOnceWith('', { forceRefresh: true });
  });

  it('does not fall back to a managed account or another harness with an identical native ID', async () => {
    discover.mockResolvedValue(successfulSessionDiscovery([
      session({ accountId: 'acct_other' }), session({ harness: 'claude' }), session({ id: 'other-native' }),
    ]));
    await expect(select()).rejects.toThrow('Session was not found');
  });

  it('does not let another provider failure or malformed row block the verified selected provider', async () => {
    const found = successfulSessionDiscovery([session(), { ...session(), harness: 'pi', cwd: null } as unknown as HarnessSession]);
    found.harnessStatus.pi = { status: 'error', error: 'private path/token' };
    discover.mockResolvedValue(found);
    expect(await select()).toMatchObject({ harness: 'codex' });
  });

  it.each(['failed', 'missing'] as const)('fails closed on %s selected-provider discovery evidence without exposing internals', async (kind) => {
    const found = successfulSessionDiscovery([session()]);
    if (kind === 'failed') found.harnessStatus.codex = { status: 'error', error: 'secret path/token' };
    else delete found.harnessStatus.codex;
    discover.mockResolvedValue(found);
    await expect(select()).rejects.toThrow('Session history could not be verified');
    await expect(select()).rejects.not.toThrow('secret');
  });

  it('does not accept a candidate from a partial checkout scan if another scope failed', async () => {
    discover.mockImplementation(async (scope: string) => {
      if (scope !== path.normalize(workspacePath)) throw new Error('secret');
      return successfulSessionDiscovery([session()]);
    });
    await expect(select(planFor([`${workspacePath}-worktree`]))).rejects.toThrow('Session history could not be verified');
  });

  it.each([
    { cwd: '' }, { cwd: 'relative' }, { cwd: 'bad\npath' }, { filePath: 'relative.jsonl' },
    { filePath: null }, { modelId: {} }, { provider: 42 },
  ])('rejects malformed launch metadata %j', async (fields) => {
    discover.mockResolvedValue(successfulSessionDiscovery([{ ...session(), ...fields } as unknown as HarnessSession]));
    await expect(select()).rejects.toThrow('Conflicting or invalid native session metadata');
  });

  it.skipIf(process.platform === 'win32')('canonicalizes native cwd and file aliases, rather than confusing equivalent evidence or trusting lexical containment', async () => {
    const actual = path.join(root, 'outside');
    const alias = path.join(workspacePath, 'alias');
    fs.mkdirSync(actual);
    fs.symlinkSync(actual, alias);
    const file = path.join(actual, 'native.jsonl');
    fs.writeFileSync(file, '{}');
    discover.mockResolvedValue(successfulSessionDiscovery([
      session({ cwd: alias, filePath: path.join(alias, 'native.jsonl') }), session({ cwd: actual, filePath: file }),
    ]));
    expect((await select()).cwd).toBe(actual); // IPC must route this OUTSIDE, not authorize the alias
  });
});
