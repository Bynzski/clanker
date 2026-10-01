import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import { encodeClaudeProjectDir } from '../../../src/main/harnesses/claude/sessions';
import { discoverAgySessions } from '../../../src/main/harnesses/agy/sessions';
import { classifyHarnessFailure } from '../../../src/main/harnesses/types';

const state = vi.hoisted(() => ({ home: '', output: '[]', calls: [] as string[][] }));
vi.mock('os', async (importOriginal) => ({ ...(await importOriginal<typeof import('os')>()), homedir: () => state.home }));
vi.mock('child_process', () => ({ execFile: (_command: string, args: string[], _options: unknown, callback: (error: null, output: string, stderr: string) => void) => {
  state.calls.push(args); callback(null, state.output, '');
} }));
let root: string;
let workspace: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-session-provider-'));
  state.home = path.join(root, 'home'); workspace = path.join(root, 'workspace');
  fs.mkdirSync(state.home); fs.mkdirSync(workspace);
  state.output = '[]'; state.calls = [];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function fixture(id: string, relative: string) {
  const destination = path.join(state.home, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const data = fs.readFileSync(path.resolve('tests/fixtures/harnesses', `${id}.jsonl`), 'utf8');
  // Replace a JSON string, preserving Windows separators.
  fs.writeFileSync(destination, data.split('"$WORKSPACE"').join(JSON.stringify(workspace)));
  return destination;
}

describe('local provider session fixtures', () => {
  it('reads Codex JSONL without an index and preserves its user-message fallback', async () => {
    fixture('codex', '.codex/sessions/rollout-11111111-1111-1111-1111-111111111111.jsonl');
    expect(await getHarnessProvider('codex').sessions.discover(workspace)).toEqual([
      expect.objectContaining({ id: '11111111-1111-1111-1111-111111111111', title: 'Codex fixture title', cwd: workspace, modelId: 'codex-model' }),
    ]);
  });
  it('parses Claude project and assistant metadata', async () => {
    fixture('claude', `.claude/projects/${encodeClaudeProjectDir(workspace)}/claude-fixture.jsonl`);
    expect(await getHarnessProvider('claude').sessions.discover(workspace)).toEqual([
      expect.objectContaining({ id: 'claude-fixture', title: 'Claude fixture title', cwd: workspace, modelId: 'claude-model', provider: 'anthropic' }),
    ]);
  });
  it('keeps Pi conventional-root and first-line behavior despite directory overrides', async () => {
    vi.stubEnv('PI_CODING_AGENT_DIR', path.join(root, 'override'));
    vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', path.join(root, 'override-sessions'));
    const filePath = fixture('pi', '.pi/agent/sessions/project/pi.jsonl');
    expect(await getHarnessProvider('pi').sessions.discover(workspace)).toEqual([
      expect.objectContaining({ id: 'pi-fixture', title: 'Pi fixture title', modelId: 'pi-model', provider: 'provider', filePath }),
    ]);
  });
  it('keeps OMP conventional-root discovery and title-before-header behavior', async () => {
    vi.stubEnv('OMP_HOME', path.join(root, 'override'));
    vi.stubEnv('PI_CODING_AGENT_DIR', path.join(root, 'override-agent'));
    const filePath = fixture('omp', '.omp/agent/sessions/project/omp.jsonl');
    expect(await getHarnessProvider('omp').sessions.discover(workspace)).toEqual([
      expect.objectContaining({ id: 'omp-fixture', title: 'OMP fixture title', modelId: 'provider/omp-model', filePath }),
    ]);
  });
  it.each(['json', 'jsonl'])('leaves OpenCode storage compatibility to its native CLI (%s response)', async (format) => {
    const entry = { id: 'native-cli-session', title: 'OpenCode fixture', directory: workspace, updated: 1000 };
    state.output = format === 'json' ? JSON.stringify([entry]) : `${JSON.stringify(entry)}\n${JSON.stringify({ ...entry, id: 'second' })}`;
    const result = await getHarnessProvider('opencode').sessions.discover(workspace);
    expect(result[0]).toMatchObject({ id: entry.id, title: entry.title, cwd: workspace, timestamp: 1000 });
    expect(state.calls[0].slice(-4)).toEqual(['session', 'list', '--format', 'json']);
  });
  it('reads Agy SQLite without modification, tolerates extra columns, and retains workspace/title fallbacks', async () => {
    const database = path.join(root, 'agy.db');
    const db = new DatabaseSync(database);
    db.exec('CREATE TABLE conversation_summaries (conversation_id, title, preview, last_modified_time, last_user_input_time, workspace_uris, future_column)');
    const insert = db.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run('agy-fixture', '', 'Preview fallback', '2026-09-27T10:00:00Z', '', JSON.stringify([pathToFileURL(workspace).href]), 'ignored');
    insert.run('global-fixture', 'Global fallback', '', '2026-09-27T10:00:00Z', '', '[]', 'ignored');
    db.close();
    const before = fs.readFileSync(database);
    expect(await discoverAgySessions(workspace, database)).toEqual([
      expect.objectContaining({ id: 'agy-fixture', title: 'Preview fallback', cwd: workspace }),
      expect.objectContaining({ id: 'global-fixture', title: 'Global fallback', cwd: workspace }),
    ]);
    expect(fs.readFileSync(database)).toEqual(before);
  });
  it('reports changed Agy schemas instead of silently treating them as an empty store', async () => {
    const database = path.join(root, 'changed.db');
    const db = new DatabaseSync(database);
    db.exec('CREATE TABLE conversation_summaries (conversation_id)'); db.close();
    const result = await discoverAgySessions(workspace, database).catch(classifyHarnessFailure);
    expect(result).toMatchObject({ kind: 'storage-changed' });
  });
});
