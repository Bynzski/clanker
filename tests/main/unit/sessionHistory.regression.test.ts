/**
 * Session History Regression Tests
 *
 * Tests for the fixes applied in the chat history / session discovery polish pass:
 *
 * 1. Path-boundary matching: workspace filtering must not use raw prefix matching
 * 2. Duplicate CodexSessionMeta interface removed
 * 3. Orphaned tests in sessionHistory.test.ts fixed (userFlags blocks re-nested)
 * 4. Session invoke flag parity: resumed sessions include harness default flags
 * 5. Missing harness readers: Pi and Claude session discovery coverage
 * 6. Global listing: undefined / empty workspacePath returns all sessions
 *
 * Key rules:
 * - sessionMatchesWorkspace(a, b) returns true when b == a  (exact match)
 *   or b.startsWith(a + sep) (child path).  All other cases return false.
 * - buildSessionInvokeArgs appends harness default flags from the store
 *   via the userFlags argument (harnessDefaults[harness].flags).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';
import { toPosixPath } from '../../../src/shared/pathNormalize';

// ============================================================================
// Hoisted mocks (same pattern as sessionHistory.test.ts)
// ============================================================================

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));
const { mockHomedir } = vi.hoisted(() => ({ mockHomedir: vi.fn() }));

import * as path from 'node:path';
const TEST_HOME = path.join(process.platform === 'win32' ? 'C:\\Users\\testuser' : '/tmp', 'testuser');
const TEST_WORKSPACE = path.join(TEST_HOME, 'project');
const TEST_OTHER = path.join(TEST_HOME, 'other');
const TEST_HARNESS_WRAPPER = path.join(TEST_HOME, '.clanker-grid', 'harness-wrapper.sh');
const TEST_PI_SESSIONS_DIR = path.join(TEST_HOME, '.pi', 'agent', 'sessions', 'dir');
const TEST_WORKSPACE_POSIX = toPosixPath(TEST_WORKSPACE);
const TEST_PI_SESSIONS_DIR_POSIX = toPosixPath(TEST_PI_SESSIONS_DIR);

// Additional platform-neutral path constants for sessionMatchesWorkspace tests
const TEST_JAY_FOO = path.join(TEST_HOME, 'jay', 'dev', 'projects', 'foo');
const TEST_JAY_FOO_SRC = path.join(TEST_JAY_FOO, 'src');
const TEST_JAY_FOO_SRC_LIB = path.join(TEST_JAY_FOO_SRC, 'lib');
const TEST_JAY_FOO_OLD = path.join(TEST_HOME, 'jay', 'dev', 'projects', 'foo-old');
const TEST_JAY_FOO_OLD_BAR = path.join(TEST_JAY_FOO_OLD, 'bar');
const TEST_JAY_BAR = path.join(TEST_HOME, 'jay', 'dev', 'projects', 'bar');
const TEST_JAY_OTHER = path.join(TEST_HOME, 'jay', 'dev', 'other');

mockHomedir.mockReturnValue(TEST_HOME);

vi.mock('child_process', () => ({ execFile: mockExecFile }));
vi.mock('os', () => ({ homedir: mockHomedir, default: { homedir: mockHomedir } }));

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
  ensureHarnessWrapperScript: () => TEST_HARNESS_WRAPPER,
  buildHarnessWrapperScript: () => '#!/bin/sh\nexec "$@"',
  getHarnessWrapperScriptPath: () => TEST_HARNESS_WRAPPER,
  buildHarnessSpawnArgs: vi.fn(),
  resolveHarnessSpawn: (command: string, args: string[], wrapperPath: string | null) =>
    wrapperPath
      ? { spawnCmd: wrapperPath, spawnArgs: [command, ...args] }
      : { spawnCmd: command, spawnArgs: args },
}));

// ============================================================================
// Helpers
// ============================================================================

function makeReadableLines(lines: string[]): Readable {
  return Readable.from([lines.join('\n') + '\n']);
}

// ============================================================================
// Imports
// ============================================================================

import {
  discoverSessions,
  buildSessionInvokeArgs,
  clearSessionCache,
  sessionMatchesWorkspace,
} from '../../../src/main/sessionHistory';
import type { HarnessSession } from '../../../src/shared/types/session';

// ============================================================================
// 1. Path-boundary matching
// ============================================================================

describe('sessionMatchesWorkspace', () => {
  it('returns true for exact match', () => {
    expect(sessionMatchesWorkspace(TEST_JAY_FOO, TEST_JAY_FOO)).toBe(true);
  });

  it('returns true for child path', () => {
    expect(sessionMatchesWorkspace(TEST_JAY_FOO, TEST_JAY_FOO_SRC)).toBe(true);
    expect(sessionMatchesWorkspace(TEST_JAY_FOO, TEST_JAY_FOO_SRC_LIB)).toBe(true);
  });

  it('returns false for sibling with same prefix (different dirname)', () => {
    // The bug: raw .startsWith would return true here incorrectly
    expect(sessionMatchesWorkspace(TEST_JAY_FOO, TEST_JAY_FOO_OLD)).toBe(false);
  });

  it('returns false for unrelated path', () => {
    expect(sessionMatchesWorkspace(TEST_JAY_FOO, TEST_JAY_BAR)).toBe(false);
    expect(sessionMatchesWorkspace(TEST_JAY_FOO, TEST_JAY_OTHER)).toBe(false);
  });

  it('returns true when workspacePath is empty/undefined (global listing)', () => {
    expect(sessionMatchesWorkspace('', TEST_JAY_FOO)).toBe(true);
    expect(sessionMatchesWorkspace('', path.join(path.sep, 'any', 'path'))).toBe(true);
  });

  it('returns false when candidatePath is empty but workspacePath is set', () => {
    expect(sessionMatchesWorkspace(TEST_JAY_FOO, '')).toBe(false);
  });

  it('returns true for nested child paths', () => {
    expect(sessionMatchesWorkspace(TEST_JAY_FOO, path.join(TEST_JAY_FOO, 'a', 'b', 'c'))).toBe(true);
  });

  it('handles paths without trailing sep as exact match boundary', () => {
    // Without the fix, /foo-old would incorrectly match /foo's prefix
    const foo = path.join(path.sep, 'foo');
    expect(sessionMatchesWorkspace(foo, `${foo}-old`)).toBe(false);
    expect(sessionMatchesWorkspace(foo, foo)).toBe(true);
  });

  it('handles workspacePath with trailing sep', () => {
    const foo = path.join(path.sep, 'foo');
    expect(sessionMatchesWorkspace(`${foo}${path.sep}`, foo)).toBe(true);
    expect(sessionMatchesWorkspace(`${foo}${path.sep}`, path.join(foo, 'bar'))).toBe(true);
    expect(sessionMatchesWorkspace(`${foo}${path.sep}`, `${foo}-old`)).toBe(false);
  });
});

// ============================================================================
// 4. Session invoke flag parity
//    buildSessionInvokeArgs must include harness default flags (userFlags)
//    alongside session-specific args (--resume, --session, --fork, etc.)
// ============================================================================

describe('buildSessionInvokeArgs — harness default flag parity', () => {
  describe('session-specific args always appear before userFlags', () => {
    it('opencode: session id + userFlags', () => {
      const session: HarnessSession = {
        id: 'ses_abc123',
        harness: 'opencode',
        title: 'Test',
        cwd: TEST_WORKSPACE,
        timestamp: Date.now(),
      };
      const result = buildSessionInvokeArgs(session, false, '--yolo --skip-confirm');
      expect(result.spawnArgs).toEqual([
        'opencode', '--session', 'ses_abc123', '--yolo', '--skip-confirm',
      ]);
    });

    it('codex: resume + userFlags', () => {
      const session: HarnessSession = {
        id: '019d9661-a4d3-7e93-a413-229086109874',
        harness: 'codex',
        title: 'Fix the bug',
        cwd: TEST_WORKSPACE,
        timestamp: Date.now(),
      };
      const result = buildSessionInvokeArgs(session, false, '--verbose');
      expect(result.spawnArgs).toEqual([
        'codex', 'resume', '019d9661-a4d3-7e93-a413-229086109874', '--verbose',
      ]);
    });

    it('claude: resume + fork-session + userFlags', () => {
      const session: HarnessSession = {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        harness: 'claude',
        title: 'Claude session',
        cwd: TEST_WORKSPACE,
        timestamp: Date.now(),
      };
      const result = buildSessionInvokeArgs(session, true, '--dangerously-skip-permissions');
      expect(result.spawnArgs).toEqual([
        'claude', '--resume', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        '--fork-session', '--dangerously-skip-permissions',
      ]);
    });

    it('pi: session path + model + userFlags', () => {
      const session: HarnessSession = {
        id: '019d998e-221f-7114-b69c-b4d5c3fd546f',
        harness: 'pi',
        title: 'Pi session',
        cwd: TEST_WORKSPACE,
        timestamp: Date.now(),
        modelId: 'MiniMax-M2.7',
        provider: 'minimax',
        filePath: path.join(TEST_PI_SESSIONS_DIR, '1234_uuid.jsonl'),
      };
      const result = buildSessionInvokeArgs(session, false, '--verbose');
      expect(result.spawnArgs).toEqual([
        'pi', '--session', `${TEST_PI_SESSIONS_DIR_POSIX}/1234_uuid.jsonl`,
        '--model', 'minimax/MiniMax-M2.7', '--verbose',
      ]);
    });

    it('userFlags with multiple space-separated flags are split', () => {
      const session: HarnessSession = {
        id: 'ses_abc123',
        harness: 'opencode',
        title: 'Test',
        cwd: TEST_WORKSPACE,
        timestamp: Date.now(),
      };
      const result = buildSessionInvokeArgs(session, false, '  --flag1  --flag2=value  ');
      expect(result.spawnArgs).toEqual([
        'opencode', '--session', 'ses_abc123', '--flag1', '--flag2=value',
      ]);
    });

    it('no userFlags still produces correct session-specific args', () => {
      const session: HarnessSession = {
        id: 'ses_abc123',
        harness: 'opencode',
        title: 'Test',
        cwd: TEST_WORKSPACE,
        timestamp: Date.now(),
      };
      const result = buildSessionInvokeArgs(session);
      expect(result.spawnArgs).toEqual(['opencode', '--session', 'ses_abc123']);
    });
  });
});

// ============================================================================
// 5. Missing harness readers — Pi and Claude session discovery
// ============================================================================

describe('discoverSessions — pi', () => {
  beforeEach(() => {
    clearSessionCache();
    vi.clearAllMocks();
    // Fail everything except pi sessions dir
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(new Error('not found'), '', '');
    });
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    // Mock .pi/agent/sessions/{subdir}/ dir listings
    mockReaddir.mockImplementation((dir: string) => {
      const s = String(dir).replace(/\\/g, '/');
      if (s.endsWith('.pi/agent/sessions')) {
        const d = { name: 'session-subdir', isDirectory: () => true, isFile: () => false } as import('fs').Dirent;
        return Promise.resolve([d]);
      }
      // Inside the subdir — returns the session file
      if (s.includes('session-subdir')) {
        const d = { name: 'abc123.jsonl', isDirectory: () => false, isFile: () => true } as import('fs').Dirent;
        return Promise.resolve([d]);
      }
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });
  });

  afterEach(() => clearSessionCache());

  it('discovers a pi session with correct cwd filtering', async () => {
    const sessionLine = JSON.stringify({ type: 'session', id: 'pi_001', timestamp: '2026-04-17T00:00:00Z', cwd: TEST_WORKSPACE });
    const modelChangeLine = JSON.stringify({ type: 'model_change', modelId: 'MiniMax-M2.7', provider: 'minimax' });
    mockCreateReadStream.mockImplementation((fp: string) => {
      if (String(fp).includes('abc123')) {
        return makeReadableLines([sessionLine, modelChangeLine]);
      }
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return new Readable({ read() { this.destroy(err); } });
    });

    const sessions = await discoverSessions(TEST_WORKSPACE);
    const piSessions = sessions.filter((s) => s.harness === 'pi');
    expect(piSessions).toHaveLength(1);
    expect(piSessions[0].id).toBe('pi_001');
    expect(piSessions[0].cwd).toBe(TEST_WORKSPACE_POSIX);
  });

  it('filters out pi sessions outside workspace', async () => {
    const sessionLine = JSON.stringify({ type: 'session', id: 'pi_002', timestamp: '2026-04-17T00:00:00Z', cwd: TEST_OTHER });
    mockCreateReadStream.mockImplementation((fp: string) => {
      if (String(fp).includes('abc123')) {
        return makeReadableLines([sessionLine]);
      }
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return new Readable({ read() { this.destroy(err); } });
    });

    const sessions = await discoverSessions(TEST_WORKSPACE);
    const piSessions = sessions.filter((s) => s.harness === 'pi');
    expect(piSessions).toHaveLength(0);
  });
});

describe('discoverSessions — claude', () => {
  // Encode workspace path the same way discoverClaudeSessions does:
  // /home/user/project → -home-user-project
  const encodedWorkspace = `-${toPosixPath(TEST_WORKSPACE).replace(/^\//, '').replace(/\//g, '-')}`;

  beforeEach(() => {
    clearSessionCache();
    vi.clearAllMocks();
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(new Error('not found'), '', '');
    });
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    // .claude/projects dir — uses includes since path normalization may vary
    mockReaddir.mockImplementation((dir: string) => {
      const s = String(dir).replace(/\\/g, '/');
      if (s.endsWith('.claude/projects')) {
        // Encoded workspace: derived from TEST_WORKSPACE
        const d = { name: encodedWorkspace, isDirectory: () => true, isFile: () => false } as import('fs').Dirent;
        return Promise.resolve([d]);
      }
      if (s.includes(encodedWorkspace)) {
        const d = { name: 'sess_abc123.jsonl', isDirectory: () => false, isFile: () => true } as import('fs').Dirent;
        return Promise.resolve([d]);
      }
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });
  });

  afterEach(() => clearSessionCache());

  it('discovers a claude session matching the workspace', async () => {
    const sessionLine = JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello world' }, timestamp: '2026-04-17T00:00:00Z', cwd: TEST_WORKSPACE });
    const assistantLine = JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-haiku-4-5-20251001' } });
    mockCreateReadStream.mockImplementation((fp: string) => {
      if (String(fp).includes('sess_abc123')) {
        return makeReadableLines([sessionLine, assistantLine]);
      }
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return new Readable({ read() { this.destroy(err); } });
    });

    const sessions = await discoverSessions(TEST_WORKSPACE);
    const claudeSessions = sessions.filter((s) => s.harness === 'claude');
    expect(claudeSessions).toHaveLength(1);
    expect(claudeSessions[0].id).toBe('sess_abc123');
  });

  it('does not discover sessions from a different encoded project dir', async () => {
    // A different project's dir should not be returned when a workspace filter is active
    mockReaddir.mockImplementation((dir: string) => {
      const s = String(dir);
      if (s.endsWith('.claude/projects')) {
        // Only the non-matching project
        const d = { name: '-home-other-project', isDirectory: () => true, isFile: () => false } as import('fs').Dirent;
        return Promise.resolve([d]);
      }
      if (s.includes('-home-other-project')) {
        const d = { name: 'sess_other.jsonl', isDirectory: () => false, isFile: () => true } as import('fs').Dirent;
        return Promise.resolve([d]);
      }
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });
    mockCreateReadStream.mockImplementation((fp: string) => {
      if (String(fp).includes('sess_other')) {
        const line = JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' }, timestamp: '2026-04-17T00:00:00Z' });
        return makeReadableLines([line]);
      }
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return new Readable({ read() { this.destroy(err); } });
    });

    const sessions = await discoverSessions(TEST_WORKSPACE);
    const claudeSessions = sessions.filter((s) => s.harness === 'claude');
    expect(claudeSessions).toHaveLength(0);
  });
});

// ============================================================================
// 5. Global listing: undefined / empty workspacePath returns all sessions
// ============================================================================

describe('discoverSessions — global listing (workspacePath undefined/empty)', () => {
  beforeEach(() => {
    clearSessionCache();
    vi.clearAllMocks();
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(null, JSON.stringify([
        { id: 'ses_001', title: 'Project session', directory: TEST_WORKSPACE, updated: 1700000000000 },
        { id: 'ses_002', title: 'Other session', directory: TEST_OTHER, updated: 1700000001000 },
      ]), '');
    });
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockReaddir.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
  });

  afterEach(() => clearSessionCache());

  it('returns all sessions when workspacePath is undefined', async () => {
    const sessions = await discoverSessions(undefined);
    const opencodeSessions = sessions.filter((s) => s.harness === 'opencode');
    expect(opencodeSessions).toHaveLength(2);
  });

  it('returns all sessions when workspacePath is empty string', async () => {
    const sessions = await discoverSessions('');
    const opencodeSessions = sessions.filter((s) => s.harness === 'opencode');
    expect(opencodeSessions).toHaveLength(2);
  });

  it('filters correctly when workspacePath has trailing slash', async () => {
    const sessions = await discoverSessions(TEST_WORKSPACE + path.sep);
    const opencodeSessions = sessions.filter((s) => s.harness === 'opencode');
    expect(opencodeSessions).toHaveLength(1);
    expect(opencodeSessions[0].id).toBe('ses_001');
  });
});

// ============================================================================
// 1. Integration: workspace filtering with path-boundary matching
//    Full discoverSessions path-boundary regression (siblings excluded)
// ============================================================================

describe('discoverSessions — path-boundary workspace filtering', () => {
  beforeEach(() => {
    clearSessionCache();
    vi.clearAllMocks();
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(null, JSON.stringify([
        // Exact match
        { id: 'ses_exact', title: 'Exact workspace', directory: TEST_JAY_FOO, updated: 1700000000001 },
        // Child path
        { id: 'ses_child', title: 'Subdirectory', directory: TEST_JAY_FOO_SRC, updated: 1700000000002 },
        // Sibling: foo-old — raw prefix matching would INCORRECTLY include this
        { id: 'ses_sibling', title: 'Sibling dir (BUG)', directory: TEST_JAY_FOO_OLD, updated: 1700000000003 },
        // Another sibling
        { id: 'ses_sibling2', title: 'Another sibling (BUG)', directory: TEST_JAY_FOO_OLD_BAR, updated: 1700000000004 },
        // Unrelated
        { id: 'ses_unrelated', title: 'Other project', directory: TEST_JAY_BAR, updated: 1700000000005 },
      ]), '');
    });
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockReaddir.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
  });

  afterEach(() => clearSessionCache());

  it('includes exact workspace session', async () => {
    const sessions = await discoverSessions(TEST_JAY_FOO);
    const ids = sessions.filter((s) => s.harness === 'opencode').map((s) => s.id);
    expect(ids).toContain('ses_exact');
  });

  it('includes child path session', async () => {
    const sessions = await discoverSessions(TEST_JAY_FOO);
    const ids = sessions.filter((s) => s.harness === 'opencode').map((s) => s.id);
    expect(ids).toContain('ses_child');
  });

  it('excludes sibling foo-old', async () => {
    const sessions = await discoverSessions(TEST_JAY_FOO);
    const ids = sessions.filter((s) => s.harness === 'opencode').map((s) => s.id);
    expect(ids).not.toContain('ses_sibling');
  });

  it('excludes sibling foo-old/bar', async () => {
    const sessions = await discoverSessions(TEST_JAY_FOO);
    const ids = sessions.filter((s) => s.harness === 'opencode').map((s) => s.id);
    expect(ids).not.toContain('ses_sibling2');
  });

  it('excludes unrelated project', async () => {
    const sessions = await discoverSessions(TEST_JAY_FOO);
    const ids = sessions.filter((s) => s.harness === 'opencode').map((s) => s.id);
    expect(ids).not.toContain('ses_unrelated');
  });
});
