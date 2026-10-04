import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverSshSessions } from '../../../src/main/remote/sshSessionDiscovery';
import type { SshCommandExecutor, SshExecOptions } from '../../../src/main/remote/sshCommandExecutor';

describe('SSH session response validation', () => {
  it('requests a bounded complete OpenCode list and fails closed if it exceeds the limit', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: JSON.stringify(Array(4097).fill({ id: 'old' })) });
    await expect(discoverSshSessions({ exec } as unknown as SshCommandExecutor, 'host', '/ws', ['opencode'])).rejects.toThrow('scan limit exceeded');
    expect(exec.mock.calls[0][2][1]).toContain("'--max-count' '4097'");
    expect(exec).toHaveBeenCalledTimes(1);
  });
  it('rejects contradictory duplicate session IDs instead of selecting one', async () => {
    const session = { harness: 'pi', id: 'same', cwd: '/ws', title: 'title', timestamp: 123, filePath: '/home/pi/a.jsonl' };
    const exec = vi.fn().mockResolvedValue({ stdout: JSON.stringify([session, { ...session, filePath: '/home/pi/b.jsonl' }]) });
    const executor = { exec } as unknown as SshCommandExecutor;
    await expect(discoverSshSessions(executor, 'host', '/ws', ['pi'])).rejects.toThrow('Conflicting metadata');
    exec.mockResolvedValueOnce({ stdout: JSON.stringify([session, session]) });
    expect(await discoverSshSessions(executor, 'host', '/ws', ['pi'])).toEqual([session]);
  });
  it('does not infer harness availability from local options or run unsupported discovery', async () => {
    const exec = vi.fn();
    expect(await discoverSshSessions({ exec } as unknown as SshCommandExecutor, 'host', '/ws', ['hermes'])).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });
  it('rejects invalid response metadata and propagates transport errors', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: '[{"harness":"codex","id":"s","cwd":"/ws","title":"t","timestamp":null}]' });
    const executor = { exec } as unknown as SshCommandExecutor;
    await expect(discoverSshSessions(executor, 'host', '/ws', ['codex'])).rejects.toThrow('Invalid remote session response');
    exec.mockRejectedValue(new Error('SSH authentication failed'));
    await expect(discoverSshSessions(executor, 'host', '/ws', ['codex'])).rejects.toThrow('authentication failed');
  });
});

const pythonAvailable = spawnSync('python3', ['--version']).status === 0;
describe.skipIf(process.platform === 'win32' || !pythonAvailable)('remote session metadata Python protocol', () => {
  let fixture: string;
  let home: string;
  let root: string;
  let opencodeOutput: string;
  const exec = vi.fn(async (_target: string, command: string, args: string[], options: SshExecOptions) => ({
    stdout: command === 'sh' ? opencodeOutput : execFileSync(command, args, {
      input: options.input, env: { ...process.env, HOME: home }, encoding: 'utf8', maxBuffer: options.maxBuffer,
    }), stderr: '', exitCode: 0,
  }));
  const executor = { exec } as unknown as SshCommandExecutor;
  function jsonl(relative: string, events: unknown[]) {
    const file = join(home, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
    return file;
  }
  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(join(tmpdir(), 'clanker-sessions-')));
    home = join(fixture, 'home'); root = join(fixture, 'workspace');
    mkdirSync(home); mkdirSync(root);
    opencodeOutput = '[]';
    exec.mockClear();
  });
  afterEach(() => rmSync(fixture, { recursive: true, force: true }));

  it('discovers bounded metadata for all six locally integrated harnesses on the owning host', async () => {
    const child = join(root, 'child'); mkdirSync(child);
    jsonl('.codex/sessions/2026/rollout.jsonl', [{ type: 'session_meta', payload: { id: 'cx', cwd: root, model: 'codex-model' } }]);
    jsonl('.codex/session_index.jsonl', [{ id: 'cx', thread_name: 'Codex title', updated_at: '2026-01-02T00:00:00Z' }]);
    jsonl('.claude/projects/project/claude-id.jsonl', [
      { type: 'user', cwd: root, message: { content: 'Claude title' } },
      { type: 'assistant', message: { model: 'claude-model' } },
    ]);
    const piFile = jsonl('.pi/agent/sessions/project/pi.jsonl', [
      { type: 'session', id: 'pi-id', cwd: child },
      { type: 'model_change', modelId: 'pi-model', provider: 'provider' },
      { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Pi title' }] } },
    ]);
    const ompFile = jsonl('.omp/agent/sessions/project/omp.jsonl', [
      { type: 'title', title: 'OMP title' }, { type: 'session', id: 'omp-id', cwd: root },
      { type: 'model_change', model: 'omp-model' },
    ]);
    const db = join(home, '.gemini/antigravity-cli/conversation_summaries.db');
    mkdirSync(join(db, '..'), { recursive: true });
    execFileSync('python3', ['-c', `import sqlite3,sys,json\nwith sqlite3.connect(sys.argv[1]) as c:\n c.execute('CREATE TABLE conversation_summaries (conversation_id,title,preview,last_modified_time,last_user_input_time,workspace_uris)')\n c.execute('INSERT INTO conversation_summaries VALUES (?,?,?,?,?,?)', ('agy-id','AGY title','','2026-01-03T00:00:00Z','',json.dumps(['file://' + sys.argv[2]])))`, db, root]);
    opencodeOutput = JSON.stringify([{ id: 'oc-id', title: 'OpenCode title', directory: root, updated: 100 }]);
    const sessions = await discoverSshSessions(executor, 'remote-host', root, ['codex', 'claude', 'pi', 'omp', 'agy', 'opencode']);
    expect(sessions).toHaveLength(6);
    // All file-backed stores share one host execution; OpenCode retains its CLI + validation.
    expect(exec).toHaveBeenCalledTimes(3);
    expect(JSON.parse(exec.mock.calls[0][2][3])).toEqual(['codex', 'claude', 'pi', 'omp', 'agy']);
    for (const [harness, title] of [['codex', 'Codex title'], ['claude', 'Claude title'], ['pi', 'Pi title'], ['omp', 'OMP title'], ['agy', 'AGY title'], ['opencode', 'OpenCode title']]) {
      expect(sessions).toContainEqual(expect.objectContaining({ harness, title }));
    }
    expect(sessions.find((session) => session.harness === 'pi')).toMatchObject({ cwd: child, filePath: piFile, provider: 'provider', modelId: 'pi-model' });
    expect(sessions.find((session) => session.harness === 'omp')).toMatchObject({ filePath: ompFile, modelId: 'omp-model' });
    expect(exec.mock.calls.every(([target]) => target === 'remote-host')).toBe(true);
    expect(exec.mock.calls.every(([, , , options]) => options.maxBuffer === 1024 * 1024)).toBe(true);
  });
  it('filters sibling workspaces and canonicalizes OpenCode paths before associating them', async () => {
    const outside = join(fixture, 'workspace-other'); mkdirSync(outside);
    const link = join(root, 'escape'); symlinkSync(outside, link);
    opencodeOutput = [{ id: 'outside', directory: outside }, { id: 'escape', directory: link }, { id: 'valid', directory: root, title: 'a'.repeat(200) }].map((item) => JSON.stringify(item)).join('\n');
    jsonl('.pi/agent/sessions/p/outside.jsonl', [{ type: 'session', id: 'outside', cwd: link }]);
    const sessions = await discoverSshSessions(executor, 'host', root, ['pi', 'opencode']);
    expect(sessions).toEqual([expect.objectContaining({ id: 'valid', title: 'a'.repeat(120), cwd: root })]);
  });
  it('handles missing stores and malformed JSONL while refusing store symlinks and replaced roots', async () => {
    expect(await discoverSshSessions(executor, 'host', root, ['codex', 'claude', 'pi', 'omp', 'agy'])).toEqual([]);
    const file = jsonl('.pi/agent/sessions/p/valid.jsonl', [{ type: 'session', id: 'valid', cwd: root }]);
    writeFileSync(file, 'malformed\n' + JSON.stringify({ type: 'session', id: 'valid', cwd: root }) + '\n');
    expect(await discoverSshSessions(executor, 'host', root, ['pi'])).toHaveLength(1);
    rmSync(file); symlinkSync(join(fixture, 'private'), file);
    await expect(discoverSshSessions(executor, 'host', root, ['pi'])).rejects.toThrow();
    rmSync(root, { recursive: true }); symlinkSync(home, root);
    await expect(discoverSshSessions(executor, 'host', root, ['codex'])).rejects.toThrow();
  });
  it('fails clearly when matching sessions exceed the result bound', async () => {
    for (let index = 0; index < 513; index++) jsonl(`.pi/agent/sessions/p/${index}.jsonl`, [{ type: 'session', id: String(index), cwd: root }]);
    await expect(discoverSshSessions(executor, 'host', root, ['pi'])).rejects.toThrow('limit 512');
  });

  describe('worktree scopes', () => {
    it('reports sessions of live and removed worktrees inside a main-provided scope, once, in one host scan', async () => {
      const container = join(fixture, 'workspace-worktrees');
      const live = join(container, 'live-1'); mkdirSync(join(live, 'src'), { recursive: true });
      const removed = join(container, 'removed-2', 'src'); // never created: the worktree was removed
      jsonl('.claude/projects/a/in-live.jsonl', [{ type: 'user', cwd: join(live, 'src'), message: { content: 'live' } }]);
      jsonl('.claude/projects/b/in-removed.jsonl', [{ type: 'user', cwd: removed, message: { content: 'removed' } }]);
      jsonl('.codex/sessions/2026/in-main.jsonl', [{ type: 'session_meta', payload: { id: 'cx', cwd: root } }]);
      const sessions = await discoverSshSessions(executor, 'host', root, ['claude', 'codex'], [container]);
      expect(sessions.map((item) => [item.id, item.cwd]).sort()).toEqual([
        ['cx', root], ['in-live', join(live, 'src')], ['in-removed', removed],
      ]);
      expect(exec).toHaveBeenCalledTimes(1);
      expect(JSON.parse(exec.mock.calls[0][2][4])).toEqual([container]);
    });

    it('never reports a missing directory outside every scope, inside the workspace itself, or beside a scope', async () => {
      const container = join(fixture, 'workspace-worktrees');
      jsonl('.claude/projects/a/gone-in-workspace.jsonl', [{ type: 'user', cwd: join(root, 'deleted'), message: { content: 'x' } }]);
      jsonl('.claude/projects/a/gone-elsewhere.jsonl', [{ type: 'user', cwd: join(fixture, 'elsewhere', 'x'), message: { content: 'x' } }]);
      jsonl('.claude/projects/a/gone-lookalike.jsonl', [{ type: 'user', cwd: join(fixture, 'workspace-worktrees-other', 'x'), message: { content: 'x' } }]);
      jsonl('.claude/projects/a/gone-dotdot.jsonl', [{ type: 'user', cwd: join(container, '..', 'elsewhere', 'x'), message: { content: 'x' } }]);
      expect(await discoverSshSessions(executor, 'host', root, ['claude'], [container])).toEqual([]);
      // Without any scope a removed worktree is invisible, exactly as before.
      jsonl('.claude/projects/a/gone-in-scope.jsonl', [{ type: 'user', cwd: join(container, 'removed'), message: { content: 'x' } }]);
      expect(await discoverSshSessions(executor, 'host', root, ['claude'])).toEqual([]);
      expect(await discoverSshSessions(executor, 'host', root, ['claude'], [container])).toHaveLength(1);
    });

    it('resolves symlinks for existing directories so a link cannot smuggle a path into a scope', async () => {
      const container = join(fixture, 'workspace-worktrees'); mkdirSync(container);
      const outside = join(fixture, 'private'); mkdirSync(outside);
      symlinkSync(outside, join(container, 'link'));
      jsonl('.claude/projects/a/escape.jsonl', [{ type: 'user', cwd: join(container, 'link'), message: { content: 'x' } }]);
      expect(await discoverSshSessions(executor, 'host', root, ['claude'], [container])).toEqual([]);
    });

    it('applies scopes to Antigravity and OpenCode too', async () => {
      const container = join(fixture, 'workspace-worktrees');
      const removed = join(container, 'gone-3');
      const db = join(home, '.gemini/antigravity-cli/conversation_summaries.db');
      mkdirSync(join(db, '..'), { recursive: true });
      execFileSync('python3', ['-c', `import sqlite3,sys,json\nwith sqlite3.connect(sys.argv[1]) as c:\n c.execute('CREATE TABLE conversation_summaries (conversation_id,title,preview,last_modified_time,last_user_input_time,workspace_uris)')\n c.execute('INSERT INTO conversation_summaries VALUES (?,?,?,?,?,?)', ('agy-id','AGY','','2026-01-03T00:00:00Z','',json.dumps(['file://' + sys.argv[2]])))`, db, removed]);
      opencodeOutput = JSON.stringify([{ id: 'oc-id', title: 'OC', directory: removed, updated: 5 }, { id: 'oc-stranger', title: 'OC', directory: join(fixture, 'nope'), updated: 5 }]);
      const sessions = await discoverSshSessions(executor, 'host', root, ['agy', 'opencode'], [container]);
      expect(sessions.map((item) => item.id).sort()).toEqual(['agy-id', 'oc-id']);
      // The OpenCode validation pass receives the same scopes.
      expect(exec.mock.calls.every(([, command, args]) => command === 'sh' || args[4] === JSON.stringify([container]))).toBe(true);
    });

    it('rejects relative, unnormalized, root and excessive scopes before running anything', async () => {
      for (const scopes of [['relative/path'], [`${fixture}/a/../b`], ['/'], [`/a${'\0'}b`], Array.from({ length: 65 }, (_, index) => `/s/${index}`)]) {
        await expect(discoverSshSessions(executor, 'host', root, ['claude'], scopes)).rejects.toThrow('Invalid remote session scan scopes');
      }
      expect(exec).not.toHaveBeenCalled();
      expect(await discoverSshSessions(executor, 'host', root, ['claude'], Array.from({ length: 64 }, (_, index) => `/s/${index}`))).toEqual([]);
    });

    it('keeps the existing result bound when scoped sessions are counted', async () => {
      const container = join(fixture, 'workspace-worktrees');
      for (let index = 0; index < 513; index++) jsonl(`.pi/agent/sessions/p/${index}.jsonl`, [{ type: 'session', id: String(index), cwd: join(container, `gone-${index}`) }]);
      await expect(discoverSshSessions(executor, 'host', root, ['pi'], [container])).rejects.toThrow('limit 512');
    });
  });
});
