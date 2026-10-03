import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const homedir = () => process.env.CLANKER_TEST_HOME ?? actual.homedir();
  return { ...actual, homedir, default: { ...actual, homedir } };
});
vi.mock('../../../../src/main/harnesses/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/main/harnesses/registry')>();
  // Only the two account-capable parsers: other providers would shell out to their CLIs.
  return { ...actual, getHarnessProviders: () => [actual.getHarnessProvider('codex'), actual.getHarnessProvider('claude')] };
});

import { discoverCodexSessions, defaultCodexHome } from '../../../../src/main/harnesses/codex/sessions';
import { discoverClaudeSessions, defaultClaudeConfigDir, encodeClaudeProjectDir } from '../../../../src/main/harnesses/claude/sessions';
import { clearSessionCache, clearSessionCacheForWorkspace, discoverSessionsDetailed, getSessionCacheSize } from '../../../../src/main/sessionHistory';
import { addAccount, createHarness, fakeCapability, tempRoot, type Harness } from './accountFixtures';

const CODEX_ID = (n: number) => `0199aaaa-bbbb-cccc-dddd-${n.toString().padStart(12, '0')}`;

function writeCodexSession(home: string, id: string, cwd: string, title: string) {
  const dir = path.join(home, 'sessions', '2026', '01', '02');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `rollout-2026-01-02T00-00-00-${id}.jsonl`), `${JSON.stringify({ type: 'session_meta', payload: { id, cwd, model: 'gpt-x', model_provider: 'openai' } })}\n`);
  fs.appendFileSync(path.join(home, 'session_index.jsonl'), `${JSON.stringify({ id, thread_name: title, updated_at: '2026-01-02T00:00:00Z' })}\n`);
}
function writeClaudeSession(configDir: string, id: string, cwd: string, title: string) {
  const dir = path.join(configDir, 'projects', encodeClaudeProjectDir(cwd));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), [
    JSON.stringify({ type: 'user', cwd, timestamp: '2026-01-02T00:00:00Z', message: { content: title } }),
    JSON.stringify({ type: 'assistant', cwd, message: { model: 'claude-x', content: 'ok' } }),
  ].join('\n') + '\n');
}

let base: string;
let workspace: string;
let h: Harness;
beforeEach(() => {
  base = tempRoot('clanker-sessions-');
  workspace = path.join(base, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  process.env.CLANKER_TEST_HOME = path.join(base, 'home');
  fs.mkdirSync(process.env.CLANKER_TEST_HOME, { recursive: true });
  clearSessionCache();
  h = createHarness({ capabilities: {
    codex: fakeCapability('CODEX_HOME', { discoverSessions: vi.fn((ws: string, home: string) => discoverCodexSessions(ws, home)) }),
    claude: fakeCapability('CLAUDE_CONFIG_DIR', { discoverSessions: vi.fn((ws: string, home: string) => discoverClaudeSessions(ws, home)) }),
  } });
});
afterEach(() => {
  delete process.env.CLANKER_TEST_HOME;
  clearSessionCache();
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(h.root, { recursive: true, force: true });
});
const homeOf = (harness: 'codex' | 'claude', id: string) => h.homes.resolve(harness, id);

describe('one parser, many roots', () => {
  it('defaults still point at the native provider homes', () => {
    expect(defaultCodexHome()).toBe(path.join(os.homedir(), '.codex'));
    expect(defaultClaudeConfigDir()).toBe(path.join(os.homedir(), '.claude'));
  });

  it('Codex: the same parser discovers native, managed A and managed B roots independently', async () => {
    const [nativeHome, a, b] = ['native', 'a', 'b'].map((name) => path.join(base, name));
    writeCodexSession(nativeHome, CODEX_ID(1), workspace, 'native one');
    writeCodexSession(a, CODEX_ID(2), workspace, 'account A');
    writeCodexSession(b, CODEX_ID(3), workspace, 'account B');
    expect((await discoverCodexSessions(workspace, nativeHome)).map((s) => s.title)).toEqual(['native one']);
    expect((await discoverCodexSessions(workspace, a)).map((s) => s.title)).toEqual(['account A']);
    expect((await discoverCodexSessions(workspace, b)).map((s) => s.title)).toEqual(['account B']);
  });

  it('Claude: likewise for CLAUDE_CONFIG_DIR roots', async () => {
    const [nativeDir, a, b] = ['native', 'a', 'b'].map((name) => path.join(base, name));
    writeClaudeSession(nativeDir, 'native-1', workspace, 'native one');
    writeClaudeSession(a, 'a-1', workspace, 'account A');
    writeClaudeSession(b, 'b-1', workspace, 'account B');
    expect((await discoverClaudeSessions(workspace, nativeDir)).map((s) => s.id)).toEqual(['native-1']);
    expect((await discoverClaudeSessions(workspace, a)).map((s) => s.id)).toEqual(['a-1']);
    expect((await discoverClaudeSessions(workspace, b)).map((s) => s.id)).toEqual(['b-1']);
  });
});

describe('aggregation and provenance', () => {
  it('finds default and managed sessions, each managed one carrying only an opaque account ID', async () => {
    writeCodexSession(path.join(process.env.CLANKER_TEST_HOME!, '.codex'), CODEX_ID(1), workspace, 'native codex');
    writeClaudeSession(path.join(process.env.CLANKER_TEST_HOME!, '.claude'), 'native-claude', workspace, 'native claude');
    const codex = await addAccount(h, 'codex', 'Work');
    const claude = await addAccount(h, 'claude', 'Personal');
    writeCodexSession(homeOf('codex', codex.id), CODEX_ID(2), workspace, 'managed codex');
    writeClaudeSession(homeOf('claude', claude.id), 'managed-claude', workspace, 'managed claude');

    const { sessions, harnessStatus } = await discoverSessionsDetailed(workspace, { managed: h.service.discoverySource('local') });
    expect(harnessStatus).toEqual({ codex: { status: 'success' }, claude: { status: 'success' } });
    const byTitle = Object.fromEntries(sessions.map((s) => [s.title, s]));
    expect(Object.keys(byTitle).sort()).toEqual(['managed claude', 'managed codex', 'native claude', 'native codex']);
    expect(byTitle['native codex']).not.toHaveProperty('accountId');
    expect(byTitle['native claude']).not.toHaveProperty('accountId');
    expect(byTitle['managed codex'].accountId).toBe(codex.id);
    expect(byTitle['managed claude'].accountId).toBe(claude.id);
    expect(JSON.stringify(sessions)).not.toContain(h.root); // no managed path in session data
  });

  it('default-only discovery needs no managed source and is unchanged', async () => {
    writeCodexSession(path.join(process.env.CLANKER_TEST_HOME!, '.codex'), CODEX_ID(1), workspace, 'native codex');
    expect(h.service.discoverySource('local')).toBeUndefined();
    const { sessions } = await discoverSessionsDetailed(workspace);
    expect(sessions.map((s) => s.title)).toEqual(['native codex']);
    expect(sessions[0]).not.toHaveProperty('accountId');
  });

  it('a failing managed account marks only its harness, never hides the rest, and is not cached', async () => {
    writeClaudeSession(path.join(process.env.CLANKER_TEST_HOME!, '.claude'), 'native-claude', workspace, 'native claude');
    const codex = await addAccount(h, 'codex', 'Work');
    h.capabilities.codex.discoverSessions.mockRejectedValueOnce(new Error('EACCES /secret/path'));
    const first = await discoverSessionsDetailed(workspace, { managed: h.service.discoverySource('local') });
    expect(first.harnessStatus.codex?.status).toBe('error');
    expect(JSON.stringify(first.harnessStatus)).not.toContain('/secret/path');
    expect(first.sessions.map((s) => s.title)).toContain('native claude');
    expect(getSessionCacheSize()).toBe(0);
    const second = await discoverSessionsDetailed(workspace, { managed: h.service.discoverySource('local') });
    expect(second.harnessStatus.codex?.status).toBe('success');
    expect(codex.id).toBeTruthy();
  });
});

describe('cache identity', () => {
  it('serves the cache while the account set is stable and invalidates when accounts are added, reconnected or removed', async () => {
    const codex = await addAccount(h, 'codex', 'Work');
    const calls = () => h.capabilities.codex.discoverSessions.mock.calls.length;
    const run = () => discoverSessionsDetailed(workspace, { managed: h.service.discoverySource('local') });
    await run();
    const afterFirst = calls();
    await run();
    expect(calls()).toBe(afterFirst); // cached

    writeCodexSession(homeOf('codex', codex.id), CODEX_ID(9), workspace, 'new session');
    expect((await run()).sessions).toHaveLength(0); // still the stale cached view until the set changes

    const second = await addAccount(h, 'codex', 'Second');
    const afterAdd = await run();
    expect(calls()).toBeGreaterThan(afterFirst);
    expect(afterAdd.sessions.map((s) => s.accountId)).toEqual([codex.id]);
    expect(second.id).not.toBe(codex.id);

    const beforeReconnect = calls();
    const flow = h.service.reconnect('local', 'codex', codex.id);
    await vi.waitFor(() => expect(h.authEvents.some((e) => (e as { flowId: string }).flowId === flow.flowId && (e as { state: { status: string } }).state.status === 'connected')).toBe(true));
    await run();
    expect(calls()).toBeGreaterThan(beforeReconnect);

    await h.service.remove('local', 'codex', codex.id);
    const afterRemove = await run();
    expect(afterRemove.sessions.some((s) => s.accountId === codex.id)).toBe(false); // removed account's history disappears
  });

  it('keeps default-only caching keyed by workspace path alone', async () => {
    writeCodexSession(path.join(process.env.CLANKER_TEST_HOME!, '.codex'), CODEX_ID(1), workspace, 'native');
    await discoverSessionsDetailed(workspace);
    expect(getSessionCacheSize()).toBe(1);
    await discoverSessionsDetailed(workspace, {});
    await discoverSessionsDetailed(workspace, { managed: { cacheKey: 'accounts:1', targets: [] } });
    expect(getSessionCacheSize()).toBe(1);
    clearSessionCacheForWorkspace(workspace);
    expect(getSessionCacheSize()).toBe(0);
  });

  it('clearing a workspace drops every account-scoped entry for it', async () => {
    await addAccount(h, 'codex', 'Work');
    await discoverSessionsDetailed(workspace, { managed: h.service.discoverySource('local') });
    await discoverSessionsDetailed(workspace);
    expect(getSessionCacheSize()).toBe(2);
    clearSessionCacheForWorkspace(workspace);
    expect(getSessionCacheSize()).toBe(0);
  });
});
