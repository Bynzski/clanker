/**
 * Session History Tests
 *
 * Tests for session discovery service and invocation args builder.
 *
 * Coverage:
 * - buildSessionInvokeArgs: correct args per harness, fork flag, model passthrough
 * - discoverOpenCodeSessions: parse CLI JSON output, workspace filtering
 * - discoverCodexSessions: index reading, file map building, cwd filtering
 * - discoverPiSessions: first-line cwd check, model_change scanning
 * - discoverClaudeSessions: encoded path prefix matching, isMeta filtering
 * - discoverSessions: graceful ENOENT on missing harnesses, caching
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';

// ============================================================================
// Hoisted mocks
// ============================================================================

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));
const { mockHomedir } = vi.hoisted(() => ({ mockHomedir: vi.fn(() => '/home/testuser') }));

vi.mock('child_process', () => ({ execFile: mockExecFile }));
vi.mock('os', () => ({ homedir: mockHomedir, default: { homedir: mockHomedir } }));

// fs mock: promises and createReadStream
const mockReadFile = vi.hoisted(() => vi.fn());
const mockReaddir = vi.hoisted(() => vi.fn());
const mockStat = vi.hoisted(() => vi.fn());
const mockCreateReadStream = vi.hoisted(() => vi.fn());

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: mockReadFile,
      readdir: mockReaddir,
      stat: mockStat,
    },
    createReadStream: mockCreateReadStream,
  };
});

vi.mock('../../../src/main/harnessLaunch', () => ({
  ensureHarnessWrapperScript: () => '/home/testuser/.clanker-grid/harness-wrapper.sh',
  buildHarnessWrapperScript: () => '#!/bin/sh\nexec "$@"',
  getHarnessWrapperScriptPath: () => '/home/testuser/.clanker-grid/harness-wrapper.sh',
  buildHarnessSpawnArgs: vi.fn(),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeReadableLines(lines: string[]): Readable {
  return Readable.from([lines.join('\n') + '\n']);
}

// ============================================================================
// Imports (after mocks are set up)
// ============================================================================

import { discoverSessions, buildSessionInvokeArgs, clearSessionCache } from '../../../src/main/sessionHistory';
import type { HarnessSession } from '../../../src/shared/types/session';

// ============================================================================
// Tests
// ============================================================================

describe('buildSessionInvokeArgs', () => {
  const wrapper = '/home/testuser/.clanker-grid/harness-wrapper.sh';

  it('builds opencode resume args', () => {
    const session: HarnessSession = {
      id: 'ses_abc123',
      harness: 'opencode',
      title: 'Test session',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
    };
    const result = buildSessionInvokeArgs(session);
    expect(result.spawnCmd).toBe(wrapper);
    expect(result.spawnArgs).toEqual(['opencode', '--session', 'ses_abc123']);
  });

  it('builds opencode fork args', () => {
    const session: HarnessSession = {
      id: 'ses_abc123',
      harness: 'opencode',
      title: 'Test session',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
    };
    const result = buildSessionInvokeArgs(session, true);
    expect(result.spawnArgs).toEqual(['opencode', '--session', 'ses_abc123', '--fork']);
  });

  it('builds claude resume args', () => {
    const session: HarnessSession = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      harness: 'claude',
      title: 'Claude session',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
    };
    const result = buildSessionInvokeArgs(session);
    expect(result.spawnArgs).toEqual(['claude', '--resume', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890']);
  });

  it('builds claude fork args with model', () => {
    const session: HarnessSession = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      harness: 'claude',
      title: 'Claude session',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
      modelId: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
    };
    const result = buildSessionInvokeArgs(session, true);
    expect(result.spawnArgs).toEqual([
      'claude', '--resume', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      '--fork-session',
      '--model', 'claude-haiku-4-5-20251001',
    ]);
  });

  it('builds codex resume args', () => {
    const session: HarnessSession = {
      id: '019d9661-a4d3-7e93-a413-229086109874',
      harness: 'codex',
      title: 'Fix the bug',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
    };
    const result = buildSessionInvokeArgs(session);
    expect(result.spawnArgs).toEqual(['codex', 'resume', '019d9661-a4d3-7e93-a413-229086109874']);
  });

  it('builds codex fork args with model', () => {
    const session: HarnessSession = {
      id: '019d9661-a4d3-7e93-a413-229086109874',
      harness: 'codex',
      title: 'Fix the bug',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
      modelId: 'gpt-5.1-codex-mini',
    };
    const result = buildSessionInvokeArgs(session, true);
    expect(result.spawnArgs).toEqual(['codex', 'fork', '019d9661-a4d3-7e93-a413-229086109874', '-m', 'gpt-5.1-codex-mini']);
  });

  it('builds pi resume args with file path and model', () => {
    const session: HarnessSession = {
      id: '019d998e-221f-7114-b69c-b4d5c3fd546f',
      harness: 'pi',
      title: 'minimax/MiniMax-M2.7',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
      modelId: 'MiniMax-M2.7',
      provider: 'minimax',
      filePath: '/home/testuser/.pi/agent/sessions/dir/1234_uuid.jsonl',
    };
    const result = buildSessionInvokeArgs(session);
    expect(result.spawnArgs).toEqual([
      'pi', '--session', '/home/testuser/.pi/agent/sessions/dir/1234_uuid.jsonl',
      '--model', 'minimax/MiniMax-M2.7',
    ]);
  });

  it('builds pi fork args', () => {
    const session: HarnessSession = {
      id: '019d998e-221f-7114-b69c-b4d5c3fd546f',
      harness: 'pi',
      title: 'Pi session',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
      filePath: '/home/testuser/.pi/agent/sessions/dir/1234_uuid.jsonl',
    };
    const result = buildSessionInvokeArgs(session, true);
    expect(result.spawnArgs).toEqual([
      'pi', '--fork', '/home/testuser/.pi/agent/sessions/dir/1234_uuid.jsonl',
    ]);
  });

  it('omits model flag when modelId is undefined', () => {
    const session: HarnessSession = {
      id: 'ses_abc123',
      harness: 'opencode',
      title: 'Test session',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
    };
    const { spawnArgs } = buildSessionInvokeArgs(session);
    expect(spawnArgs).not.toContain('--model');
  });

  it('appends harness default flags to opencode resume args', () => {
    const session: HarnessSession = {
      id: 'ses_abc123',
      harness: 'opencode',
      title: 'Test session',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
    };
    const result = buildSessionInvokeArgs(session, false, '--yolo --skip-confirm');
    expect(result.spawnArgs).toEqual(['opencode', '--session', 'ses_abc123', '--yolo', '--skip-confirm']);
  });

  it('appends harness default flags to codex resume args', () => {
    const session: HarnessSession = {
      id: '019d9661-a4d3-7e93-a413-229086109874',
      harness: 'codex',
      title: 'Fix the bug',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
    };
    const result = buildSessionInvokeArgs(session, false, '--verbose');
    expect(result.spawnArgs).toEqual(['codex', 'resume', '019d9661-a4d3-7e93-a413-229086109874', '--verbose']);
  });

  it('appends harness default flags to claude resume args', () => {
    const session: HarnessSession = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      harness: 'claude',
      title: 'Claude session',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
      modelId: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
    };
    const result = buildSessionInvokeArgs(session, false, '--dangerously-skip-permissions');
    expect(result.spawnArgs).toEqual([
      'claude', '--resume', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      '--model', 'claude-haiku-4-5-20251001',
      '--dangerously-skip-permissions',
    ]);
  });

  it('appends harness default flags to pi resume args', () => {
    const session: HarnessSession = {
      id: '019d998e-221f-7114-b69c-b4d5c3fd546f',
      harness: 'pi',
      title: 'minimax/MiniMax-M2.7',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
      modelId: 'MiniMax-M2.7',
      provider: 'minimax',
      filePath: '/home/testuser/.pi/agent/sessions/dir/1234_uuid.jsonl',
    };
    const result = buildSessionInvokeArgs(session, false, '--verbose');
    expect(result.spawnArgs).toEqual([
      'pi', '--session', '/home/testuser/.pi/agent/sessions/dir/1234_uuid.jsonl',
      '--model', 'minimax/MiniMax-M2.7',
      '--verbose',
    ]);
  });

  it('appends harness default flags to codex fork args with model', () => {
    const session: HarnessSession = {
      id: '019d9661-a4d3-7e93-a413-229086109874',
      harness: 'codex',
      title: 'Fix the bug',
      cwd: '/home/testuser/project',
      timestamp: Date.now(),
      modelId: 'gpt-5.1-codex-mini',
    };
    const result = buildSessionInvokeArgs(session, true, '--yolo');
    expect(result.spawnArgs).toEqual(['codex', 'fork', '019d9661-a4d3-7e93-a413-229086109874', '-m', 'gpt-5.1-codex-mini', '--yolo']);
  });
});

// ============================================================================
// discoverSessions — OpenCode
// ============================================================================

describe('discoverSessions — opencode', () => {
  beforeEach(() => {
    clearSessionCache();
    vi.clearAllMocks();
    // Make other harness discovery fail with ENOENT so only opencode results show
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockReaddir.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
  });

  afterEach(() => {
    clearSessionCache();
  });

  it('returns sessions matching workspace path from JSON array output', async () => {
    const raw = [
      { id: 'ses_001', title: 'Image fix', directory: '/home/testuser/project', updated: 1700000000000 },
      { id: 'ses_002', title: 'Other project', directory: '/home/testuser/other', updated: 1700000001000 },
    ];
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(null, JSON.stringify(raw), '');
    });

    const sessions = await discoverSessions('/home/testuser/project');
    const opencodeSessions = sessions.filter((s) => s.harness === 'opencode');

    expect(opencodeSessions).toHaveLength(1);
    expect(opencodeSessions[0].id).toBe('ses_001');
    expect(opencodeSessions[0].title).toBe('Image fix');
    expect(opencodeSessions[0].cwd).toBe('/home/testuser/project');
    expect(opencodeSessions[0].timestamp).toBe(1700000000000);
  });

  it('handles JSONL output format', async () => {
    const line1 = { id: 'ses_001', title: 'Session 1', directory: '/home/testuser/project', updated: 1700000000000 };
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(null, JSON.stringify(line1) + '\n', '');
    });

    const sessions = await discoverSessions('/home/testuser/project');
    const opencodeSessions = sessions.filter((s) => s.harness === 'opencode');
    expect(opencodeSessions).toHaveLength(1);
    expect(opencodeSessions[0].id).toBe('ses_001');
  });

  it('returns empty array when opencode CLI is unavailable', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(new Error('ENOENT: opencode not found'), '', '');
    });

    const sessions = await discoverSessions('/home/testuser/project');
    const opencodeSessions = sessions.filter((s) => s.harness === 'opencode');
    expect(opencodeSessions).toHaveLength(0);
  });

  it('filters out sessions not matching workspace', async () => {
    const raw = [
      { id: 'ses_001', title: 'Match', directory: '/home/testuser/project', updated: 1700000000000 },
      { id: 'ses_002', title: 'No match', directory: '/home/testuser/other', updated: 1700000001000 },
    ];
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(null, JSON.stringify(raw), '');
    });

    const sessions = await discoverSessions('/home/testuser/project');
    const ids = sessions.filter((s) => s.harness === 'opencode').map((s) => s.id);
    expect(ids).toContain('ses_001');
    expect(ids).not.toContain('ses_002');
  });
});

// ============================================================================
// discoverSessions — Codex
// ============================================================================

describe('discoverSessions — codex', () => {
  const indexLine = JSON.stringify({
    id: '019d9661-a4d3-7e93-a413-229086109874',
    thread_name: 'Fix the bug',
    updated_at: '2026-04-16T13:03:37.381Z',
  });

  const sessionMetaLine = JSON.stringify({
    type: 'session_meta',
    timestamp: '2026-04-16T13:03:37.381Z',
    payload: {
      id: '019d9661-a4d3-7e93-a413-229086109874',
      cwd: '/home/testuser/project',
      originator: 'codex-tui',
      model_provider: 'openai',
      model: null,
    },
  });

  beforeEach(() => {
    clearSessionCache();
    vi.clearAllMocks();

    // OpenCode fails
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(new Error('not found'), '', '');
    });

    // Pi and Claude dirs fail
    mockReaddir.mockImplementation((dir: string) => {
      if (String(dir).includes('.codex')) {
        // sessions/ directory - return a YYYY/MM/DD subdir structure
        if (String(dir).includes('sessions')) {
          if (String(dir).endsWith('sessions')) {
            const dirent = { name: '2026', isDirectory: () => true, isFile: () => false } as import('fs').Dirent;
            return Promise.resolve([dirent]);
          }
          if (String(dir).endsWith('2026')) {
            const dirent = { name: '04', isDirectory: () => true, isFile: () => false } as import('fs').Dirent;
            return Promise.resolve([dirent]);
          }
          if (String(dir).endsWith('04')) {
            const dirent = { name: '16', isDirectory: () => true, isFile: () => false } as import('fs').Dirent;
            return Promise.resolve([dirent]);
          }
          if (String(dir).endsWith('16')) {
            const dirent = {
              name: 'rollout-20260416-130337-019d9661-a4d3-7e93-a413-229086109874.jsonl',
              isDirectory: () => false,
              isFile: () => true,
            } as import('fs').Dirent;
            return Promise.resolve([dirent]);
          }
        }
      }
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });

    mockReadFile.mockImplementation((filePath: string) => {
      if (String(filePath).endsWith('session_index.jsonl')) {
        return Promise.resolve(indexLine + '\n');
      }
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });

    // Mock createReadStream for the session file
    mockCreateReadStream.mockImplementation((filePath: string) => {
      if (String(filePath).includes('019d9661')) {
        return makeReadableLines([sessionMetaLine]);
      }
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const r = new Readable({ read() { this.destroy(err); } });
      return r;
    });
  });

  afterEach(() => {
    clearSessionCache();
  });

  it('discovers codex sessions matching workspace', async () => {
    const sessions = await discoverSessions('/home/testuser/project');
    const codexSessions = sessions.filter((s) => s.harness === 'codex');

    expect(codexSessions).toHaveLength(1);
    expect(codexSessions[0].id).toBe('019d9661-a4d3-7e93-a413-229086109874');
    expect(codexSessions[0].title).toBe('Fix the bug');
    expect(codexSessions[0].cwd).toBe('/home/testuser/project');
  });

  it('returns empty when session_index.jsonl is missing', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));

    const sessions = await discoverSessions('/home/testuser/project');
    const codexSessions = sessions.filter((s) => s.harness === 'codex');
    expect(codexSessions).toHaveLength(0);
  });
});


describe('discoverSessions — codex title precedence', () => {
  beforeEach(() => {
    clearSessionCache();
    vi.clearAllMocks();
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(new Error('not found'), '', '');
    });
    // Mock readdir so Codex sessions/ dir is found (needed for orphaned pass)
    mockReaddir.mockImplementation((dir: string) => {
      if (String(dir).includes('.codex') && String(dir).includes('sessions')) {
        if (String(dir).endsWith('sessions')) {
          const dirent = { name: '2026', isDirectory: () => true, isFile: () => false } as import('fs').Dirent;
          return Promise.resolve([dirent]);
        }
        if (String(dir).endsWith('2026')) {
          const dirent = { name: '04', isDirectory: () => true, isFile: () => false } as import('fs').Dirent;
          return Promise.resolve([dirent]);
        }
        if (String(dir).endsWith('04')) {
          const dirent = { name: '16', isDirectory: () => true, isFile: () => false } as import('fs').Dirent;
          return Promise.resolve([dirent]);
        }
        if (String(dir).endsWith('16')) {
          const dirent = {
            name: 'rollout-20260416-130337-019d9661-a4d3-7e93-a413-229086109874.jsonl',
            isDirectory: () => false,
            isFile: () => true,
          } as import('fs').Dirent;
          return Promise.resolve([dirent]);
        }
      }
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });
    mockStat.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
  });

  afterEach(() => {
    clearSessionCache();
  });

  it('uses thread_name from session_index.jsonl as title (indexed session)', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if (String(filePath).endsWith('session_index.jsonl')) {
        return Promise.resolve(JSON.stringify({
          id: '019d9661-a4d3-7e93-a413-229086109874',
          thread_name: 'Fix the bug',
          updated_at: '2026-04-16T13:03:37.381Z',
        }) + '\n');
      }
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });

    const sessions = await discoverSessions('/home/testuser/project');
    const codexSessions = sessions.filter((s) => s.harness === 'codex');
    expect(codexSessions).toHaveLength(1);
    expect(codexSessions[0].title).toBe('Fix the bug');
  });

  it('falls back to Codex session when thread_name is missing from index', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if (String(filePath).endsWith('session_index.jsonl')) {
        return Promise.resolve(JSON.stringify({
          id: '019d9661-a4d3-7e93-a413-229086109874',
          updated_at: '2026-04-16T13:03:37.381Z',
        }) + '\n');
      }
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });

    const sessions = await discoverSessions('/home/testuser/project');
    const codexSessions = sessions.filter((s) => s.harness === 'codex');
    expect(codexSessions).toHaveLength(1);
    expect(codexSessions[0].title).toBe('Codex session');
  });

  it('falls back to Codex session when thread_name is empty string in index', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if (String(filePath).endsWith('session_index.jsonl')) {
        return Promise.resolve(JSON.stringify({
          id: '019d9661-a4d3-7e93-a413-229086109874',
          thread_name: '',
          updated_at: '2026-04-16T13:03:37.381Z',
        }) + '\n');
      }
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });

    const sessions = await discoverSessions('/home/testuser/project');
    const codexSessions = sessions.filter((s) => s.harness === 'codex');
    expect(codexSessions).toHaveLength(1);
    expect(codexSessions[0].title).toBe('Codex session');
  });
});

// ============================================================================
// discoverSessions — caching
// ============================================================================

describe('discoverSessions — caching', () => {
  beforeEach(() => {
    clearSessionCache();
    vi.clearAllMocks();
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(new Error('not found'), '', '');
    });
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockReaddir.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
  });

  afterEach(() => {
    clearSessionCache();
  });

  it('returns cached results on second call within TTL', async () => {
    await discoverSessions('/home/testuser/project');
    await discoverSessions('/home/testuser/project');

    // execFile should only have been called once (opencode attempt)
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('clears cache when clearSessionCache is called', async () => {
    await discoverSessions('/home/testuser/project');
    clearSessionCache();
    await discoverSessions('/home/testuser/project');

    // execFile called twice (once per discover call)
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });
});
