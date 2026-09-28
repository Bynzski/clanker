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
import { toPosixPath } from '../../../src/shared/pathNormalize';

// ============================================================================
// Hoisted mocks
// ============================================================================

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));
const { mockHomedir } = vi.hoisted(() => ({ mockHomedir: vi.fn() }));

// Platform-neutral path constants — built from path.join so tests run on
// Linux, macOS, and Windows with native separators.
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
const TEST_HOME = path.join(process.platform === 'win32' ? 'C:\\Users\\testuser' : '/tmp', 'testuser');
const TEST_WORKSPACE = path.join(TEST_HOME, 'project');
const TEST_OTHER = path.join(TEST_HOME, 'other');
const TEST_HARNESS_WRAPPER = path.join(TEST_HOME, '.clanker-grid', 'harness-wrapper.sh');
const TEST_PI_SESSIONS_DIR = path.join(TEST_HOME, '.pi', 'agent', 'sessions', 'dir');
const TEST_WORKSPACE_POSIX = toPosixPath(TEST_WORKSPACE);
const TEST_PI_SESSIONS_DIR_POSIX = toPosixPath(TEST_PI_SESSIONS_DIR);

mockHomedir.mockReturnValue(TEST_HOME);

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
  ensureHarnessWrapperScript: () => TEST_HARNESS_WRAPPER,
  buildHarnessWrapperScript: () => '#!/bin/sh\nexec "$@"',
  getHarnessWrapperScriptPath: () => TEST_HARNESS_WRAPPER,
  buildHarnessSpawnArgs: vi.fn(),
  resolveHarnessSpawn: (command: string, args: string[], wrapperPath: string | null) =>
    wrapperPath
      ? { spawnCmd: wrapperPath, spawnArgs: [command, ...args] }
      : process.platform === 'win32'
        ? { spawnCmd: 'cmd.exe', spawnArgs: ['/c', command, ...args] }
        : { spawnCmd: command, spawnArgs: args },
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

import {
  discoverSessions,
  discoverSessionsDetailed,
  buildSessionInvokeArgs,
  clearSessionCache,
  getSessionCacheSize,
  SESSION_CACHE_MAX_ENTRIES,
  SESSION_CACHE_TTL_MS,
  sessionMatchesWorkspace,
  encodeClaudeProjectDir,
  parseOmpSessionMetadata,
  parseAgyWorkspaceUris,
  mapAgyRowToSession,
  discoverAgySessions,
} from '../../../src/main/sessionHistory';
import type { HarnessSession } from '../../../src/shared/types/session';

describe('OMP session metadata', () => {
  it('reads title before header and the latest model selector', () => {
    expect(parseOmpSessionMetadata([
      JSON.stringify({ type: 'title', title: 'Review this change' }),
      JSON.stringify({ type: 'session', id: 'session-1', cwd: TEST_WORKSPACE, timestamp: '2026-09-27T10:00:00Z' }),
      JSON.stringify({ type: 'model_change', model: 'openai-codex/gpt-5.5' }),
      JSON.stringify({ type: 'model_change', model: 'anthropic/claude-sonnet-4-6' }),
    ])).toEqual({ id: 'session-1', cwd: TEST_WORKSPACE, timestamp: '2026-09-27T10:00:00Z', title: 'Review this change', modelId: 'anthropic/claude-sonnet-4-6' });
  });

  it('discovers OMP files from their own session store and filters by workspace', async () => {
    clearSessionCache();
    vi.clearAllMocks();
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (error: Error) => void) => cb(new Error('not found')));
    mockReaddir.mockImplementation((dir: string) => {
      const normalized = toPosixPath(dir);
      if (normalized.endsWith('/.omp/agent/sessions')) {
        return Promise.resolve([{ name: 'project', isDirectory: () => true, isFile: () => false }]);
      }
      if (normalized.endsWith('/.omp/agent/sessions/project')) {
        return Promise.resolve([
          { name: 'one.jsonl', isDirectory: () => false, isFile: () => true },
          { name: 'other.jsonl', isDirectory: () => false, isFile: () => true },
        ]);
      }
      return Promise.reject(new Error('ENOENT'));
    });
    mockCreateReadStream.mockImplementation((filePath: string) => makeReadableLines([
      JSON.stringify({ type: 'title', title: 'OMP task' }),
      JSON.stringify({ type: 'session', id: path.basename(filePath), cwd: filePath.endsWith('one.jsonl') ? TEST_WORKSPACE : TEST_OTHER, timestamp: '2026-09-27T10:00:00Z' }),
      JSON.stringify({ type: 'model_change', model: 'openai-codex/gpt-5.5' }),
    ]));
    const sessions = (await discoverSessions(TEST_WORKSPACE)).filter((session) => session.harness === 'omp');
    expect(sessions).toEqual([expect.objectContaining({
      id: 'one.jsonl', title: 'OMP task', cwd: TEST_WORKSPACE_POSIX,
      modelId: 'openai-codex/gpt-5.5', filePath: expect.stringContaining('/.omp/agent/sessions/project/one.jsonl'),
    })]);
  });
});

describe('parseAgyWorkspaceUris', () => {
  it('extracts file URLs using native path separators', () => {
    expect(parseAgyWorkspaceUris(JSON.stringify([pathToFileURL(TEST_WORKSPACE).href])))
      .toEqual([TEST_WORKSPACE]);
  });

  it('accepts multiple raw paths', () => {
    expect(parseAgyWorkspaceUris(JSON.stringify([TEST_WORKSPACE, TEST_OTHER])))
      .toEqual([TEST_WORKSPACE, TEST_OTHER]);
  });

  it('distinguishes absent workspace metadata from malformed data', () => {
    expect(parseAgyWorkspaceUris('')).toEqual([]);
    expect(parseAgyWorkspaceUris('[]')).toEqual([]);
    expect(parseAgyWorkspaceUris('not json')).toBeNull();
    expect(parseAgyWorkspaceUris('[123]')).toBeNull();
  });
});

describe('mapAgyRowToSession', () => {
  it('maps valid row to HarnessSession with matching workspace', () => {
    const row = {
      conversation_id: '79cbc62b-b055-48a5-8655-d9aa83d3a00f',
      title: 'My Project Discussion',
      preview: 'Preview text',
      last_modified_time: '2026-09-28 00:22:11.995865216+00:00',
      workspace_uris: JSON.stringify([pathToFileURL(TEST_WORKSPACE).href]),
    };
    const session = mapAgyRowToSession(row, TEST_WORKSPACE);
    expect(session).toEqual({
      id: '79cbc62b-b055-48a5-8655-d9aa83d3a00f',
      harness: 'agy',
      title: 'My Project Discussion',
      cwd: TEST_WORKSPACE,
      timestamp: expect.any(Number),
    });
  });

  it('matches a requested workspace after the first multi-root entry', () => {
    const row = {
      conversation_id: '79cbc62b-b055-48a5-8655-d9aa83d3a00f',
      title: 'Multi-root discussion',
      workspace_uris: JSON.stringify([
        pathToFileURL(TEST_OTHER).href,
        pathToFileURL(TEST_WORKSPACE).href,
      ]),
    };
    expect(mapAgyRowToSession(row, TEST_WORKSPACE)?.cwd).toBe(TEST_WORKSPACE);
  });

  it('filters out row when workspace does not match', () => {
    const row = {
      conversation_id: '79cbc62b-b055-48a5-8655-d9aa83d3a00f',
      title: 'My Project Discussion',
      workspace_uris: JSON.stringify([pathToFileURL(TEST_OTHER).href]),
    };
    expect(mapAgyRowToSession(row, TEST_WORKSPACE)).toBeNull();
  });

  it('rejects malformed workspace metadata instead of treating it as global', () => {
    expect(mapAgyRowToSession({
      conversation_id: '79cbc62b-b055-48a5-8655-d9aa83d3a00f',
      workspace_uris: 'not json',
    }, TEST_WORKSPACE)).toBeNull();
  });

  it('falls back to preview when title is missing', () => {
    const row = {
      conversation_id: '79cbc62b-b055-48a5-8655-d9aa83d3a00f',
      title: '',
      preview: 'Preview Title',
      workspace_uris: JSON.stringify([pathToFileURL(TEST_WORKSPACE).href]),
    };
    const session = mapAgyRowToSession(row, TEST_WORKSPACE);
    expect(session?.title).toBe('Preview Title');
  });

  it('skips row when conversation_id is missing', () => {
    expect(mapAgyRowToSession({ conversation_id: '' })).toBeNull();
  });
});

describe('discoverAgySessions', () => {
  it('returns empty array when database file does not exist', async () => {
    mockStat.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    const sessions = await discoverAgySessions(TEST_WORKSPACE, '/nonexistent/path/db.sqlite');
    expect(sessions).toEqual([]);
  });
});

// ============================================================================
// Tests
// ============================================================================

describe('encodeClaudeProjectDir', () => {
  it('encodes a POSIX path the same way Claude Code does', () => {
    // Leading dash comes from the leading `/`.
    expect(encodeClaudeProjectDir('/home/jay/dev/projects/foo')).toBe(
      '-home-jay-dev-projects-foo'
    );
  });

  it('encodes a Windows drive-letter path without a synthetic leading dash', () => {
    expect(encodeClaudeProjectDir('C:\\Users\\jay\\dev\\projects\\foo')).toBe(
      'C--Users-jay-dev-projects-foo'
    );
  });

  it('encodes a Windows path with forward-slash separators identically', () => {
    expect(encodeClaudeProjectDir('C:/Users/jay/dev/projects/foo')).toBe(
      'C--Users-jay-dev-projects-foo'
    );
  });

  it('encodes a UNC path with leading double-backslash', () => {
    // `\\server\share\foo` → `--server-share-foo`.
    expect(encodeClaudeProjectDir('\\\\server\\share\\foo')).toBe('--server-share-foo');
  });

  it('returns empty string for empty workspace', () => {
    expect(encodeClaudeProjectDir('')).toBe('');
  });

  it('replaces non-ASCII and special characters with dashes', () => {
    expect(encodeClaudeProjectDir('/home/jay/my project')).toBe('-home-jay-my-project');
  });
});

describe('sessionMatchesWorkspace', () => {
  it('returns true when workspace is empty (no filter)', () => {
    expect(sessionMatchesWorkspace('', '/anything')).toBe(true);
  });

  it('returns false when candidate is empty', () => {
    expect(sessionMatchesWorkspace('/home/jay/foo', '')).toBe(false);
  });

  it('matches exact POSIX path', () => {
    expect(sessionMatchesWorkspace('/home/jay/foo', '/home/jay/foo')).toBe(true);
  });

  it('matches child POSIX path', () => {
    expect(sessionMatchesWorkspace('/home/jay/foo', '/home/jay/foo/src')).toBe(true);
  });

  it('rejects sibling whose name shares a prefix', () => {
    expect(sessionMatchesWorkspace('/home/jay/foo', '/home/jay/foo-old')).toBe(false);
    expect(sessionMatchesWorkspace('/home/jay/foo', '/home/jay/fooold')).toBe(false);
  });

  it('matches across mixed separators (workspace native, cwd posix)', () => {
    // Both inputs normalize to forward-slash form before compare, so a
    // Windows-style workspace still matches a JSONL cwd that was stored
    // with forward slashes.
    expect(
      sessionMatchesWorkspace('C:\\Users\\jay\\foo', 'C:/Users/jay/foo/src')
    ).toBe(true);
  });

  it('matches across mixed separators (workspace posix, cwd native)', () => {
    expect(
      sessionMatchesWorkspace('C:/Users/jay/foo', 'C:\\Users\\jay\\foo\\src')
    ).toBe(true);
  });

  describe('on Windows (case-insensitive)', () => {
    let originalPlatform: PropertyDescriptor | undefined;
    beforeEach(() => {
      originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    });
    afterEach(() => {
      if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    });

    it('matches when drive letter case differs', () => {
      expect(sessionMatchesWorkspace('C:\\Users\\jay\\foo', 'c:\\users\\jay\\foo\\src')).toBe(true);
    });

    it('matches when path segments differ in case', () => {
      expect(sessionMatchesWorkspace('C:\\Users\\Jay\\Foo', 'C:\\users\\jay\\foo\\src')).toBe(true);
    });

    it('still rejects sibling directories that case-collapse-prefix', () => {
      expect(sessionMatchesWorkspace('C:\\Users\\jay\\foo', 'C:\\Users\\jay\\foo-old')).toBe(false);
    });
  });

  describe('on POSIX (case-sensitive)', () => {
    let originalPlatform: PropertyDescriptor | undefined;
    beforeEach(() => {
      originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    });
    afterEach(() => {
      if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    });

    it('treats different-case POSIX paths as different', () => {
      expect(sessionMatchesWorkspace('/home/jay/Foo', '/home/jay/foo/src')).toBe(false);
    });
  });
});

describe('buildSessionInvokeArgs', () => {
  const wrapper = TEST_HARNESS_WRAPPER;

  it('builds OMP resume and fork commands with the session path', () => {
    const filePath = path.join(TEST_HOME, '.omp', 'agent', 'sessions', 'project', 'session.jsonl');
    const session: HarnessSession = {
      id: 'session-1', harness: 'omp', title: 'Task', cwd: TEST_WORKSPACE,
      timestamp: 1, modelId: 'openai-codex/gpt-5.5', filePath,
    };
    expect(buildSessionInvokeArgs(session, false, '--thinking high').spawnArgs).toEqual([
      'omp', '--resume', toPosixPath(filePath), '--model', 'openai-codex/gpt-5.5', '--thinking', 'high',
    ]);
    expect(buildSessionInvokeArgs(session, true).spawnArgs).toEqual([
      'omp', '--fork', toPosixPath(filePath), '--model', 'openai-codex/gpt-5.5',
    ]);
  });

  it('builds opencode resume args', () => {
    const session: HarnessSession = {
      id: 'ses_abc123',
      harness: 'opencode',
      title: 'Test session',
      cwd: TEST_WORKSPACE,
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
      cwd: TEST_WORKSPACE,
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
      cwd: TEST_WORKSPACE,
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
      cwd: TEST_WORKSPACE,
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
      cwd: TEST_WORKSPACE,
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
      cwd: TEST_WORKSPACE,
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
      cwd: TEST_WORKSPACE,
      timestamp: Date.now(),
      modelId: 'MiniMax-M2.7',
      provider: 'minimax',
      filePath: path.join(TEST_PI_SESSIONS_DIR, '1234_uuid.jsonl'),
    };
    const result = buildSessionInvokeArgs(session);
    expect(result.spawnArgs).toEqual([
      'pi', '--session', `${TEST_PI_SESSIONS_DIR_POSIX}/1234_uuid.jsonl`,
      '--model', 'minimax/MiniMax-M2.7',
    ]);
  });

  it('builds pi fork args', () => {
    const session: HarnessSession = {
      id: '019d998e-221f-7114-b69c-b4d5c3fd546f',
      harness: 'pi',
      title: 'Pi session',
      cwd: TEST_WORKSPACE,
      timestamp: Date.now(),
      filePath: path.join(TEST_PI_SESSIONS_DIR, '1234_uuid.jsonl'),
    };
    const result = buildSessionInvokeArgs(session, true);
    expect(result.spawnArgs).toEqual([
      'pi', '--fork', `${TEST_PI_SESSIONS_DIR_POSIX}/1234_uuid.jsonl`,
    ]);
  });

  it('builds agy resume args and ignores fork flag', () => {
    const session: HarnessSession = {
      id: '79cbc62b-b055-48a5-8655-d9aa83d3a00f',
      harness: 'agy',
      title: 'High-Level App Structure Review',
      cwd: TEST_WORKSPACE,
      timestamp: Date.now(),
      modelId: 'gemini-3.8-flash-high',
    };
    const result = buildSessionInvokeArgs(session, true, '--effort max');
    expect(result.spawnCmd).toBe(wrapper);
    expect(result.spawnArgs).toEqual([
      'agy',
      '--conversation',
      '79cbc62b-b055-48a5-8655-d9aa83d3a00f',
      '--model',
      'gemini-3.8-flash-high',
      '--effort',
      'max',
    ]);
  });

  it('builds agy resume args without model or user flags', () => {
    const session: HarnessSession = {
      id: '79cbc62b-b055-48a5-8655-d9aa83d3a00f',
      harness: 'agy',
      title: 'Session',
      cwd: TEST_WORKSPACE,
      timestamp: Date.now(),
    };
    const result = buildSessionInvokeArgs(session, false);
    expect(result.spawnArgs).toEqual(['agy', '--conversation', '79cbc62b-b055-48a5-8655-d9aa83d3a00f']);
  });

  it('omits model flag when modelId is undefined', () => {
    const session: HarnessSession = {
      id: 'ses_abc123',
      harness: 'opencode',
      title: 'Test session',
      cwd: TEST_WORKSPACE,
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
      cwd: TEST_WORKSPACE,
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
      cwd: TEST_WORKSPACE,
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
      cwd: TEST_WORKSPACE,
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
      cwd: TEST_WORKSPACE,
      timestamp: Date.now(),
      modelId: 'MiniMax-M2.7',
      provider: 'minimax',
      filePath: path.join(TEST_PI_SESSIONS_DIR, '1234_uuid.jsonl'),
    };
    const result = buildSessionInvokeArgs(session, false, '--verbose');
    expect(result.spawnArgs).toEqual([
      'pi', '--session', `${TEST_PI_SESSIONS_DIR_POSIX}/1234_uuid.jsonl`,
      '--model', 'minimax/MiniMax-M2.7',
      '--verbose',
    ]);
  });

  it('appends harness default flags to codex fork args with model', () => {
    const session: HarnessSession = {
      id: '019d9661-a4d3-7e93-a413-229086109874',
      harness: 'codex',
      title: 'Fix the bug',
      cwd: TEST_WORKSPACE,
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
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    clearSessionCache();
    vi.clearAllMocks();
    // Make other harness discovery fail with ENOENT so only opencode results show
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockReaddir.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    clearSessionCache();
  });

  it('returns sessions matching workspace path from JSON array output', async () => {
    const raw = [
      { id: 'ses_001', title: 'Image fix', directory: TEST_WORKSPACE, updated: 1700000000000 },
      { id: 'ses_002', title: 'Other project', directory: TEST_OTHER, updated: 1700000001000 },
    ];
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(null, JSON.stringify(raw), '');
    });

    const sessions = await discoverSessions(TEST_WORKSPACE);
    const opencodeSessions = sessions.filter((s) => s.harness === 'opencode');

    expect(opencodeSessions).toHaveLength(1);
    expect(opencodeSessions[0].id).toBe('ses_001');
    expect(opencodeSessions[0].title).toBe('Image fix');
    expect(opencodeSessions[0].cwd).toBe(TEST_WORKSPACE_POSIX);
    expect(opencodeSessions[0].timestamp).toBe(1700000000000);
  });

  it('handles JSONL output format', async () => {
    const line1 = { id: 'ses_001', title: 'Session 1', directory: TEST_WORKSPACE, updated: 1700000000000 };
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(null, JSON.stringify(line1) + '\n', '');
    });

    const sessions = await discoverSessions(TEST_WORKSPACE);
    const opencodeSessions = sessions.filter((s) => s.harness === 'opencode');
    expect(opencodeSessions).toHaveLength(1);
    expect(opencodeSessions[0].id).toBe('ses_001');
  });

  it('returns empty array when opencode CLI is unavailable', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(new Error('ENOENT: opencode not found'), '', '');
    });

    const sessions = await discoverSessions(TEST_WORKSPACE);
    const opencodeSessions = sessions.filter((s) => s.harness === 'opencode');
    expect(opencodeSessions).toHaveLength(0);
  });

  it('filters out sessions not matching workspace', async () => {
    const raw = [
      { id: 'ses_001', title: 'Match', directory: TEST_WORKSPACE, updated: 1700000000000 },
      { id: 'ses_002', title: 'No match', directory: TEST_OTHER, updated: 1700000001000 },
    ];
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(null, JSON.stringify(raw), '');
    });

    const sessions = await discoverSessions(TEST_WORKSPACE);
    const ids = sessions.filter((s) => s.harness === 'opencode').map((s) => s.id);
    expect(ids).toContain('ses_001');
    expect(ids).not.toContain('ses_002');
  });

  it('uses cmd.exe /c for opencode session discovery on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(null, '[]', '');
    });

    await discoverSessions(TEST_WORKSPACE);

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const [cmd, args] = mockExecFile.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('cmd.exe');
    expect(args).toEqual(['/c', 'opencode', 'session', 'list', '--format', 'json']);
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
      cwd: TEST_WORKSPACE,
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
    const sessions = await discoverSessions(TEST_WORKSPACE);
    const codexSessions = sessions.filter((s) => s.harness === 'codex');

    expect(codexSessions).toHaveLength(1);
    expect(codexSessions[0].id).toBe('019d9661-a4d3-7e93-a413-229086109874');
    expect(codexSessions[0].title).toBe('Fix the bug');
    expect(codexSessions[0].cwd).toBe(TEST_WORKSPACE_POSIX);
  });

  it('falls back to filesystem sessions when session_index.jsonl is missing', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));

    const sessions = await discoverSessions(TEST_WORKSPACE);
    const codexSessions = sessions.filter((s) => s.harness === 'codex');
    expect(codexSessions).toHaveLength(1);
    expect(codexSessions[0].id).toBe('019d9661-a4d3-7e93-a413-229086109874');
    expect(codexSessions[0].cwd).toBe(TEST_WORKSPACE_POSIX);
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

    const sessions = await discoverSessions(TEST_WORKSPACE);
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

    const sessions = await discoverSessions(TEST_WORKSPACE);
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

    const sessions = await discoverSessions(TEST_WORKSPACE);
    const codexSessions = sessions.filter((s) => s.harness === 'codex');
    expect(codexSessions).toHaveLength(1);
    expect(codexSessions[0].title).toBe('Codex session');
  });
});

// ============================================================================
// discoverSessions — codex orphaned session title resolution
// ============================================================================

describe('discoverSessions — codex orphaned title resolution', () => {
  const ORPHAN_ID = '019d35b9-09ea-71e1-b368-dca5fbf08b07';
  const ORPHAN_FILE = `rollout-2026-04-16T13-03-37-${ORPHAN_ID}.jsonl`;

  const sessionMetaLine = JSON.stringify({
    type: 'session_meta',
    timestamp: '2026-04-16T13:03:37.381Z',
    payload: {
      id: ORPHAN_ID,
      cwd: TEST_WORKSPACE,
      originator: 'codex_vscode',
      model_provider: 'openai',
    },
  });

  const taskStartedLine = JSON.stringify({
    type: 'event_msg',
    payload: { type: 'task_started' },
  });

  const responseItemLine = JSON.stringify({
    type: 'response_item',
    payload: { type: 'message' },
  });

  const turnContextLine = JSON.stringify({ type: 'turn_context' });

  const userMessageLine = (text: string) => JSON.stringify({
    type: 'event_msg',
    payload: { type: 'user_message', message: text, images: [], local_images: [], text_elements: [] },
  });

  beforeEach(() => {
    clearSessionCache();
    vi.clearAllMocks();

    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(new Error('not found'), '', '');
    });

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
            name: ORPHAN_FILE,
            isDirectory: () => false,
            isFile: () => true,
          } as import('fs').Dirent;
          return Promise.resolve([dirent]);
        }
      }
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });

    // Empty index — session is orphaned
    mockReadFile.mockImplementation((filePath: string) => {
      if (String(filePath).endsWith('session_index.jsonl')) {
        return Promise.resolve('');
      }
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });

    mockStat.mockResolvedValue({ mtimeMs: 1700000000000 });
  });

  afterEach(() => {
    clearSessionCache();
  });

  it('uses first user_message text as title when session is orphaned (not in index)', async () => {
    // Mirror real Codex layout: user_message appears on line 7 after session_meta,
    // task_started, response_items, and a turn_context.
    const lines = [
      sessionMetaLine,
      taskStartedLine,
      responseItemLine,
      responseItemLine,
      turnContextLine,
      responseItemLine,
      userMessageLine('Investigate why the deploy pipeline is failing on staging'),
    ];
    mockCreateReadStream.mockImplementation((filePath: string) => {
      if (String(filePath).includes(ORPHAN_ID)) {
        return makeReadableLines(lines);
      }
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return new Readable({ read() { this.destroy(err); } });
    });

    const sessions = await discoverSessions(TEST_WORKSPACE);
    const codexSessions = sessions.filter((s) => s.harness === 'codex');
    expect(codexSessions).toHaveLength(1);
    expect(codexSessions[0].id).toBe(ORPHAN_ID);
    expect(codexSessions[0].title).toBe('Investigate why the deploy pipeline is failing on staging');
  });

  it('truncates long user messages to 120 chars', async () => {
    const long = 'a'.repeat(300);
    const lines = [sessionMetaLine, userMessageLine(long)];
    mockCreateReadStream.mockImplementation((filePath: string) => {
      if (String(filePath).includes(ORPHAN_ID)) {
        return makeReadableLines(lines);
      }
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return new Readable({ read() { this.destroy(err); } });
    });

    const sessions = await discoverSessions(TEST_WORKSPACE);
    const codexSessions = sessions.filter((s) => s.harness === 'codex');
    expect(codexSessions).toHaveLength(1);
    expect(codexSessions[0].title).toHaveLength(120);
  });

  it('falls back to cwd basename when no user_message exists in scanned lines', async () => {
    const lines = [sessionMetaLine, taskStartedLine, responseItemLine];
    mockCreateReadStream.mockImplementation((filePath: string) => {
      if (String(filePath).includes(ORPHAN_ID)) {
        return makeReadableLines(lines);
      }
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return new Readable({ read() { this.destroy(err); } });
    });

    const sessions = await discoverSessions(TEST_WORKSPACE);
    const codexSessions = sessions.filter((s) => s.harness === 'codex');
    expect(codexSessions).toHaveLength(1);
    expect(codexSessions[0].title).toBe(path.basename(TEST_WORKSPACE));
  });
});

// ============================================================================
// discoverSessions — caching
// ============================================================================

describe('harness discovery health', () => {
  beforeEach(() => {
    clearSessionCache();
    vi.clearAllMocks();
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => cb(null, '[]', ''));
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockReaddir.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockStat.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
  });

  it('treats a successful empty Codex store as authoritative', async () => {
    const result = await discoverSessionsDetailed(TEST_WORKSPACE, { forceRefresh: true });
    expect(result.harnessStatus.codex).toEqual({ status: 'success' });
    expect(result.sessions.filter((session) => session.harness === 'codex')).toEqual([]);
  });

  it('reports Codex I/O failure, keeps other sessions, and retries rather than caching the failure', async () => {
    const indexPath = path.join(TEST_HOME, '.codex', 'session_index.jsonl');
    mockReadFile.mockImplementation((filePath: string) => filePath === indexPath
      ? Promise.reject(Object.assign(new Error('access denied'), { code: 'EACCES' }))
      : Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' })));
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) =>
      cb(null, JSON.stringify([{ id: 'other-session', title: 'Other', directory: TEST_WORKSPACE, updated: 10 }]), ''));

    const first = await discoverSessionsDetailed(TEST_WORKSPACE);
    expect(first.harnessStatus.codex).toMatchObject({ status: 'error', error: 'access denied' });
    expect(first.harnessStatus.opencode).toEqual({ status: 'success' });
    expect(first.sessions.map((session) => session.id)).toContain('other-session');
    expect(getSessionCacheSize()).toBe(0);
    expect((await discoverSessions(TEST_WORKSPACE)).map((session) => session.id)).toContain('other-session');
    expect(mockReadFile).toHaveBeenCalledTimes(2);

    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    expect((await discoverSessionsDetailed(TEST_WORKSPACE, { forceRefresh: true })).harnessStatus.codex)
      .toEqual({ status: 'success' });
  });

  it('keeps Codex authoritative when Claude fails in the same scan', async () => {
    const claudeRoot = path.join(TEST_HOME, '.claude', 'projects');
    mockReaddir.mockImplementation((dir: string) => Promise.reject(
      dir === claudeRoot
        ? Object.assign(new Error('Claude I/O failed'), { code: 'EPERM' })
        : Object.assign(new Error('not found'), { code: 'ENOENT' }),
    ));
    const result = await discoverSessionsDetailed(TEST_WORKSPACE, { forceRefresh: true });
    expect(result.harnessStatus.codex).toEqual({ status: 'success' });
    expect(result.harnessStatus.claude).toMatchObject({ status: 'error', error: 'Claude I/O failed' });
  });

  it('reports an unreadable Pi session file as a harness failure', async () => {
    const piRoot = path.join(TEST_HOME, '.pi', 'agent', 'sessions');
    mockReaddir.mockImplementation((dir: string) => {
      if (dir === piRoot) return Promise.resolve([{ name: 'project', isDirectory: () => true }]);
      if (dir === path.join(piRoot, 'project')) {
        return Promise.resolve([{ name: 'session.jsonl', isFile: () => true }]);
      }
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });
    mockCreateReadStream.mockImplementation(() => new Readable({
      read() { this.destroy(Object.assign(new Error('read denied'), { code: 'EACCES' })); },
    }));
    const result = await discoverSessionsDetailed(TEST_WORKSPACE, { forceRefresh: true });
    expect(result.harnessStatus.pi).toMatchObject({ status: 'error', error: 'read denied' });
  });
});

describe('discoverSessions — caching', () => {
  beforeEach(() => {
    clearSessionCache();
    vi.clearAllMocks();
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(null, '[]', '');
    });
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockReaddir.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockStat.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
  });

  afterEach(() => {
    clearSessionCache();
  });

  it('returns cached results on second call within TTL', async () => {
    await discoverSessions(TEST_WORKSPACE);
    await discoverSessions(TEST_WORKSPACE);

    // execFile should only have been called once (opencode attempt)
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('clears cache when clearSessionCache is called', async () => {
    await discoverSessions(TEST_WORKSPACE);
    clearSessionCache();
    await discoverSessions(TEST_WORKSPACE);

    // execFile called twice (once per discover call)
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it('removes expired entries instead of retaining unreachable workspace keys', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await discoverSessions('/workspace/old');
    expect(getSessionCacheSize()).toBe(1);

    nowSpy.mockReturnValue(1_000 + SESSION_CACHE_TTL_MS);
    await discoverSessions('/workspace/current');

    expect(getSessionCacheSize()).toBe(1);
    nowSpy.mockRestore();
  });

  it('caps cached workspace discoveries', async () => {
    for (let index = 0; index < SESSION_CACHE_MAX_ENTRIES + 3; index += 1) {
      await discoverSessions(`/workspace/${index}`);
    }

    expect(getSessionCacheSize()).toBe(SESSION_CACHE_MAX_ENTRIES);
  });
});
