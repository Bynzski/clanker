/**
 * Session History Discovery
 *
 * Discovers past AI harness sessions from all four harness storage locations:
 * OpenCode, Codex, Pi, and Claude Code.
 *
 * All discovery functions are safe — ENOENT on missing harness dirs returns [].
 * Individual file errors are skipped; one bad file never fails the whole harness.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import type { HarnessSession } from '../shared/types/session';
import { ensureHarnessWrapperScript, resolveHarnessSpawn } from './harnessLaunch';
import { toNativePath, toPosixPath } from '../shared/pathNormalize';
import { prependUserCliBinsToPath } from './platformShell';

// ============================================================================
// Path-boundary matching (replaces raw startsWith for workspace filtering)
// ============================================================================

/**
 * Returns true when candidate is either an exact match of workspace or a
 * proper child directory of workspace.
 *
 * Match cases for workspace `/home/jay/dev/projects/foo`:
 *   ✓ `/home/jay/dev/projects/foo`       — exact match
 *   ✓ `/home/jay/dev/projects/foo/src`    — child path
 *   ✗ `/home/jay/dev/projects/foo-old`    — sibling (prefix match only)
 *   ✗ `/home/jay/dev/projects/fooold`     — sibling (different dirname)
 *
 * Both inputs are normalized to forward-slash form before comparison so the
 * check works whether either side stored the path with `/` or `\`. On Windows
 * the comparison is case-insensitive, since paths there are case-insensitive
 * (the JSONL cwd may differ in case from the workspace).
 */
export function sessionMatchesWorkspace(
  workspacePath: string,
  candidatePath: string
): boolean {
  if (!workspacePath) return true;
  if (!candidatePath) return false;
  const norm = (p: string): string => {
    let s = p.replace(/\\/g, '/');
    if (process.platform === 'win32') s = s.toLowerCase();
    return s.endsWith('/') ? s : s + '/';
  };
  return norm(candidatePath).startsWith(norm(workspacePath));
}

/**
 * Encode a workspace path into the directory-name form used by Claude Code
 * under `~/.claude/projects/`.
 *
 * Claude Code encodes the platform-native path string directly by replacing
 * each non-`[A-Za-z0-9-]` character with `-` (no collapsing). This means
 * Windows drive-letter paths do not get a synthetic leading slash:
 *
 *   `/home/jay/foo`         → `-home-jay-foo`
 *   `C:\Users\jay\foo`      → `C--Users-jay-foo`
 *   `\\server\share\foo`    → `--server-share-foo`
 *
 * Returns an empty string for an empty workspace path so callers can use the
 * result as a `startsWith` filter that matches everything.
 */
export function encodeClaudeProjectDir(workspacePath: string): string {
  if (!workspacePath) return '';
  return workspacePath.replace(/[^A-Za-z0-9-]/g, '-');
}

// ============================================================================
// In-memory session cache (60s TTL, keyed by normalised workspace path)
// ============================================================================

const SESSION_CACHE_TTL_MS = 60 * 1000;

interface SessionCacheEntry {
  sessions: HarnessSession[];
  cachedAt: number;
}

const sessionCache = new Map<string, SessionCacheEntry>();

export function clearSessionCache(): void {
  sessionCache.clear();
}

// ============================================================================
// Public API
// ============================================================================

export async function discoverSessions(workspacePath?: string): Promise<HarnessSession[]> {
  const normalizedPath = toNativePath((workspacePath ?? '').replace(/[\\/]+$/, ''), process.platform);

  const cached = sessionCache.get(normalizedPath);
  if (cached && Date.now() - cached.cachedAt < SESSION_CACHE_TTL_MS) {
    return cached.sessions;
  }

  const results = await Promise.allSettled([
    discoverOpenCodeSessions(normalizedPath),
    discoverCodexSessions(normalizedPath),
    discoverPiSessions(normalizedPath),
    discoverClaudeSessions(normalizedPath),
  ]);

  const sessions: HarnessSession[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      sessions.push(...result.value);
    }
  }

  sessions.sort((a, b) => b.timestamp - a.timestamp);

  const posixSessions = sessions.map((session) => ({
    ...session,
    cwd: toPosixPath(session.cwd),
    ...(session.filePath ? { filePath: toPosixPath(session.filePath) } : {}),
  }));

  sessionCache.set(normalizedPath, { sessions: posixSessions, cachedAt: Date.now() });
  return posixSessions;
}

export function buildSessionInvokeArgs(
  session: HarnessSession,
  fork = false,
  userFlags?: string
): { spawnCmd: string; spawnArgs: string[] } {
  const wrapperPath = ensureHarnessWrapperScript();

  /** Helper: wrap harness args with the wrapper script, or invoke via cmd.exe on Windows. */
  const wrapOrDirect = (harnessCmd: string, harnessArgs: string[]): { spawnCmd: string; spawnArgs: string[] } => {
    return resolveHarnessSpawn(harnessCmd, harnessArgs, wrapperPath);
  };

  let modelStr: string | undefined;
  if (session.modelId) {
    if (session.harness === 'pi' && session.provider) {
      modelStr = `${session.provider}/${session.modelId}`;
    } else {
      modelStr = session.modelId;
    }
  }

  const flagArgs = userFlags && userFlags.trim() ? userFlags.trim().split(/\s+/) : [];

  switch (session.harness) {
    case 'opencode':
      return wrapOrDirect('opencode', [
        '--session', session.id, ...(fork ? ['--fork'] : []), ...flagArgs,
      ]);

    case 'pi': {
      const target = session.filePath ? toPosixPath(session.filePath) : session.id;
      return wrapOrDirect('pi', [
        fork ? '--fork' : '--session', target,
        ...(modelStr ? ['--model', modelStr] : []), ...flagArgs,
      ]);
    }

    case 'codex':
      return wrapOrDirect('codex', [
        fork ? 'fork' : 'resume', session.id,
        ...(modelStr ? ['-m', modelStr] : []), ...flagArgs,
      ]);

    case 'claude':
    default:
      return wrapOrDirect('claude', [
        '--resume', session.id,
        ...(fork ? ['--fork-session'] : []),
        ...(modelStr ? ['--model', modelStr] : []), ...flagArgs,
      ]);
  }
}

// ============================================================================
// File I/O helpers
// ============================================================================

function runCommandOutput(command: string, args: string[]): Promise<string> {
  const { spawnCmd, spawnArgs } = resolveHarnessSpawn(command, args, null);

  return new Promise((resolve, reject) => {
    execFile(
      spawnCmd,
      spawnArgs,
      {
        timeout: 8000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: prependUserCliBinsToPath(process.env.PATH ?? ''),
        } as { [key: string]: string },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
          return;
        }
        resolve(String(stdout ?? '') || String(stderr ?? ''));
      }
    );
  });
}

/** Read the first non-empty line of a file and parse it as JSON. Returns null on any error. */
async function readFirstLineJson<T>(filePath: string): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let done = false;
    let stream: fs.ReadStream | null = null;
    try {
      stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 8192 });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.once('line', (line) => {
        done = true;
        rl.close();
        stream?.destroy();
        try {
          resolve(JSON.parse(line) as T);
        } catch {
          resolve(null);
        }
      });

      rl.once('close', () => {
        if (!done) resolve(null);
      });

      stream.once('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/** Read all non-empty lines of a file as raw strings. */
async function readFileLines(filePath: string): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    const lines: string[] = [];
    try {
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      rl.on('line', (line) => {
        if (line.trim()) lines.push(line);
      });
      rl.once('close', () => resolve(lines));
      stream.once('error', () => resolve(lines));
    } catch {
      resolve(lines);
    }
  });
}

/**
 * Read a Claude Code JSONL session file and extract the fields we need.
 * Stops early once cwd + title + modelId are all found.
 */
async function readClaudeSessionData(filePath: string): Promise<{
  cwd?: string;
  title?: string;
  timestamp?: number;
  modelId?: string;
}> {
  return new Promise((resolve) => {
    let cwd: string | undefined;
    let title: string | undefined;
    let timestamp: number | undefined;
    let modelId: string | undefined;
    let closed = false;

    const finish = (stream: fs.ReadStream, rl: readline.Interface) => {
      if (closed) return;
      closed = true;
      rl.close();
      stream.destroy();
      resolve({ cwd, title, timestamp, modelId });
    };

    let stream: fs.ReadStream | null = null;
    try {
      stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed || closed) return;

        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return;
        }

        if (!cwd && typeof entry.cwd === 'string') {
          cwd = entry.cwd;
        }

        if (entry.type === 'user' && !title) {
          const msg = entry.message as Record<string, unknown> | undefined;
          if (!entry.isMeta && msg && typeof msg.content === 'string') {
            const content = msg.content;
            if (!content.startsWith('<command') && !content.startsWith('<local-command')) {
              title = content.slice(0, 120);
              timestamp = typeof entry.timestamp === 'string'
                ? Date.parse(entry.timestamp)
                : undefined;
            }
          }
        }

        if (entry.type === 'assistant' && !modelId) {
          const msg = entry.message as Record<string, unknown> | undefined;
          if (msg && typeof msg.model === 'string') {
            modelId = msg.model;
          }
        }

        if (cwd && title && modelId && stream) {
          finish(stream, rl);
        }
      });

      rl.once('close', () => {
        if (!closed) {
          closed = true;
          resolve({ cwd, title, timestamp, modelId });
        }
      });

      stream.once('error', () => {
        if (!closed) {
          closed = true;
          resolve({ cwd, title, timestamp, modelId });
        }
      });
    } catch {
      resolve({ cwd, title, timestamp, modelId });
    }
  });
}

// ============================================================================
// OpenCode session discovery
// ============================================================================

interface OpenCodeSessionRaw {
  id: string;
  title?: string;
  directory?: string;
  updated?: number;
  created?: number;
}

async function discoverOpenCodeSessions(workspacePath: string): Promise<HarnessSession[]> {
  try {
    const output = await runCommandOutput('opencode', ['session', 'list', '--format', 'json']);
    const trimmed = output.trim();
    if (!trimmed) return [];

    let rawSessions: OpenCodeSessionRaw[] = [];
    try {
      const parsed: unknown = JSON.parse(trimmed);
      rawSessions = Array.isArray(parsed)
        ? (parsed as OpenCodeSessionRaw[])
        : [parsed as OpenCodeSessionRaw];
    } catch {
      // Fall back to JSONL
      for (const line of trimmed.split('\n')) {
        const l = line.trim();
        if (!l) continue;
        try {
          rawSessions.push(JSON.parse(l) as OpenCodeSessionRaw);
        } catch {
          // skip
        }
      }
    }

    const sessions: HarnessSession[] = [];
    for (const raw of rawSessions) {
      if (!raw.id || !raw.directory) continue;
      if (workspacePath && !sessionMatchesWorkspace(workspacePath, raw.directory)) continue;
      sessions.push({
        id: raw.id,
        harness: 'opencode',
        title: raw.title ?? 'OpenCode session',
        cwd: raw.directory,
        timestamp: typeof raw.updated === 'number' ? raw.updated : Date.now(),
      });
    }
    return sessions;
  } catch {
    return [];
  }
}

// ============================================================================
// Codex session discovery
// ============================================================================

interface CodexIndexEntry {
  id: string;
  thread_name?: string;
  updated_at?: string;
}

interface CodexSessionMeta {
  type: string;
  payload: {
    id?: string;
    cwd?: string;
    model?: string | null;
    model_provider?: string;
  };
}

interface CodexSessionData {
  filePath: string;
  id: string;
  cwd: string;
  timestamp: number;
  modelId?: string;
  provider?: string;
}


async function buildCodexFileMap(sessionsDir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const scanDir = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const match = entry.name.match(
            /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
          );
          if (match) {
            map.set(match[1], fullPath);
          }
        }
      })
    );
  };

  await scanDir(sessionsDir);
  return map;
}

/**
 * Read leading lines of a Codex session file and return the first user_message content.
 * Returns null if no user message is found.
 */
async function readCodexFirstUserMessage(filePath: string): Promise<string | null> {
  const MAX_LINES = 30;
  return new Promise<string | null>((resolve) => {
    let stream: fs.ReadStream | null = null;
    let linesRead = 0;
    try {
      stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 16 * 1024 });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      rl.on('line', (line) => {
        if (!line.trim() || linesRead > MAX_LINES) {
          linesRead++;
          return;
        }
        linesRead++;
        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        if (
          entry.type === 'event_msg' &&
          (entry as Record<string, unknown>).payload !== undefined
        ) {
          const payload = (entry as Record<string, unknown>).payload as Record<string, unknown>;
          if (
            payload.type === 'user_message' &&
            typeof payload.message === 'string' &&
            payload.message.trim()
          ) {
            // Resolve before closing — rl.close() emits 'close' synchronously, which
            // would otherwise fire the close handler's resolve(null) first.
            resolve(payload.message.trim().slice(0, 120));
            rl.close();
            stream?.destroy();
            return;
          }
        }
      });
      rl.once('close', () => resolve(null));
      stream.once('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Recursive directory scan that collects orphaned session data (files not in the index).
 */
async function collectOrphanedSessions(
  dir: string,
  workspacePath: string,
  indexedIds: Set<string>
): Promise<CodexSessionData[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const orphaned: CodexSessionData[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await collectOrphanedSessions(fullPath, workspacePath, indexedIds);
        orphaned.push(...sub);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const match = entry.name.match(
          /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
        );
        if (!match) return;
        const sessionId = match[1];
        if (indexedIds.has(sessionId)) return;
        const meta = await readFirstLineJson<CodexSessionMeta>(fullPath);
        if (!meta?.payload?.cwd) return;
        if (workspacePath && !sessionMatchesWorkspace(workspacePath, meta.payload.cwd)) return;
        let timestamp = 0;
        try {
          const stat = await fs.promises.stat(fullPath);
          timestamp = stat.mtimeMs;
        } catch {
          // use 0
        }
        orphaned.push({
          filePath: fullPath,
          id: sessionId,
          cwd: meta.payload.cwd,
          timestamp,
          modelId: meta.payload.model ?? undefined,
          provider: meta.payload.model ? (meta.payload.model_provider ?? 'openai') : undefined,
        });
      }
    })
  );
  return orphaned;
}

function parseCodexIndexEntries(indexContent: string): CodexIndexEntry[] {
  const entries: CodexIndexEntry[] = [];
  for (const line of indexContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as CodexIndexEntry;
      if (entry.id) {
        entries.push(entry);
      }
    } catch {
      // Ignore invalid line
    }
  }
  return entries;
}

async function buildCodexIndexedSessions(
  indexEntries: CodexIndexEntry[],
  fileMap: Map<string, string>,
  workspacePath: string
): Promise<HarnessSession[]> {
  const sessions: HarnessSession[] = [];
  for (const entry of indexEntries) {
    const filePath = fileMap.get(entry.id);
    if (!filePath) continue;
    const meta = await readFirstLineJson<CodexSessionMeta>(filePath);
    if (!meta?.payload?.cwd) continue;
    if (workspacePath && !sessionMatchesWorkspace(workspacePath, meta.payload.cwd)) continue;
    sessions.push({
      id: entry.id,
      harness: 'codex',
      title: entry.thread_name?.trim() || 'Codex session',
      cwd: meta.payload.cwd,
      timestamp: entry.updated_at ? Date.parse(entry.updated_at) : 0,
      modelId: meta.payload.model ?? undefined,
      provider: meta.payload.model ? (meta.payload.model_provider ?? 'openai') : undefined,
    });
  }
  return sessions;
}

function buildCodexThreadNameMap(indexEntries: CodexIndexEntry[]): Map<string, string> {
  const threadNames = new Map<string, string>();
  for (const entry of indexEntries) {
    threadNames.set(entry.id, entry.thread_name ?? '');
  }
  return threadNames;
}

async function resolveCodexOrphanedTitle(
  session: CodexSessionData,
  indexThreadNames: Map<string, string>
): Promise<string> {
  const indexTitle = indexThreadNames.get(session.id);
  const userMessageTitle = await readCodexFirstUserMessage(session.filePath);
  // Split on both separators so a Windows-style cwd (C:\Users\...\foo)
  // resolves to "foo" instead of the entire path string.
  const cwdBasename = session.cwd.split(/[/\\]/).filter(Boolean).pop();
  return (indexTitle && indexTitle.trim()) || userMessageTitle || cwdBasename || 'Codex session';
}

async function discoverCodexSessions(workspacePath: string): Promise<HarnessSession[]> {
  const homeDir = os.homedir();
  const indexPath = path.join(homeDir, '.codex', 'session_index.jsonl');
  const sessionsDir = path.join(homeDir, '.codex', 'sessions');

  let indexContent = '';
  try {
    indexContent = await fs.promises.readFile(indexPath, 'utf8');
  } catch (error) {
    // Some installs (notably on Windows) may have sessions on disk without
    // session_index.jsonl. Treat missing index as empty and continue scanning.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      return [];
    }
  }

  const indexEntries = parseCodexIndexEntries(indexContent);
  const fileMap = await buildCodexFileMap(sessionsDir);
  const sessions = await buildCodexIndexedSessions(indexEntries, fileMap, workspacePath);

  const indexThreadNames = buildCodexThreadNameMap(indexEntries);
  const indexedIds = new Set(sessions.map((s) => s.id));
  const orphaned = await collectOrphanedSessions(sessionsDir, workspacePath, indexedIds);

  const orphanedSessions = await Promise.all(orphaned.map(async (session) => ({
    id: session.id,
    harness: 'codex' as const,
    title: await resolveCodexOrphanedTitle(session, indexThreadNames),
    cwd: session.cwd,
    timestamp: session.timestamp,
    modelId: session.modelId,
    provider: session.provider,
  })));

  return [...sessions, ...orphanedSessions];
}
// ============================================================================
// Pi session discovery
// ============================================================================

interface PiSessionFirst {
  type: string;
  id?: string;
  timestamp?: string;
  cwd?: string;
}

function extractPiMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .filter((entry) => typeof entry === 'object' && entry !== null)
      .map((entry) => String((entry as Record<string, unknown>).text ?? ''))
      .join('');
  }
  return '';
}

function extractPiTitleFromParsedEvent(parsed: Record<string, unknown>): string | undefined {
  if (parsed.type !== 'message' || parsed.message === undefined) {
    return undefined;
  }

  const message = parsed.message as Record<string, unknown>;
  if (message.role !== 'user') {
    return undefined;
  }

  const text = extractPiMessageText(message.content).trim();
  return text ? text.slice(0, 120) : undefined;
}

function extractPiMetadataFromLines(rawLines: string[]): { modelId?: string; provider?: string; title?: string } {
  let modelId: string | undefined;
  let provider: string | undefined;
  let title: string | undefined;

  for (let i = rawLines.length - 1; i >= 0; i--) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawLines[i]) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (
      parsed.type === 'model_change' &&
      typeof parsed.modelId === 'string' &&
      typeof parsed.provider === 'string'
    ) {
      modelId = parsed.modelId;
      provider = parsed.provider;
    }

    if (!title) {
      title = extractPiTitleFromParsedEvent(parsed);
    }
  }

  return { modelId, provider, title };
}

async function discoverPiSessionFile(
  filePath: string,
  workspacePath: string
): Promise<HarnessSession | null> {
  const first = await readFirstLineJson<PiSessionFirst>(filePath);
  if (!first || first.type !== 'session' || !first.cwd || !first.id) return null;
  if (workspacePath && !sessionMatchesWorkspace(workspacePath, first.cwd)) return null;

  const rawLines = await readFileLines(filePath);
  const { modelId, provider, title } = extractPiMetadataFromLines(rawLines);
  const sessionTitle = title ?? (modelId && provider ? `${provider}/${modelId}` : 'Pi session');

  return {
    id: first.id,
    harness: 'pi',
    title: sessionTitle,
    cwd: first.cwd,
    timestamp: first.timestamp ? Date.parse(first.timestamp) : 0,
    modelId,
    provider,
    filePath,
  };
}

async function discoverPiSessions(workspacePath: string): Promise<HarnessSession[]> {
  const homeDir = os.homedir();
  const piSessionsDir = path.join(homeDir, '.pi', 'agent', 'sessions');

  let subdirEntries: fs.Dirent[];
  try {
    subdirEntries = await fs.promises.readdir(piSessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const subdirs = subdirEntries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(piSessionsDir, e.name));

  const allResults = await Promise.all(
    subdirs.map(async (subdir) => {
      let fileEntries: fs.Dirent[];
      try {
        fileEntries = await fs.promises.readdir(subdir, { withFileTypes: true });
      } catch {
        return [];
      }

      const jsonlFiles = fileEntries.filter(
        (e) => e.isFile() && e.name.endsWith('.jsonl')
      );

      const sessionResults = await Promise.all(
        jsonlFiles.map((e) =>
          discoverPiSessionFile(path.join(subdir, e.name), workspacePath).catch(() => null)
        )
      );

      return sessionResults.filter((s): s is HarnessSession => s !== null);
    })
  );

  return allResults.flat();
}

// ============================================================================
// Claude Code session discovery
// ============================================================================

async function discoverClaudeProjectDir(
  projectDir: string,
  workspacePath: string
): Promise<HarnessSession[]> {
  let fileEntries: fs.Dirent[];
  try {
    fileEntries = await fs.promises.readdir(projectDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const jsonlFiles = fileEntries.filter((e) => e.isFile() && e.name.endsWith('.jsonl'));

  const sessionResults = await Promise.all(
    jsonlFiles.map(async (e): Promise<HarnessSession | null> => {
      const filePath = path.join(projectDir, e.name);
      const sessionId = e.name.replace(/\.jsonl$/, '');

      const data = await readClaudeSessionData(filePath);

      if (!data.cwd) return null;
      if (workspacePath && !sessionMatchesWorkspace(workspacePath, data.cwd)) return null;

      let fallbackTimestamp: number | undefined;
      if (!data.timestamp) {
        try {
          const stat = await fs.promises.stat(filePath);
          fallbackTimestamp = stat.mtimeMs;
        } catch {
          fallbackTimestamp = 0;
        }
      }

      return {
        id: sessionId,
        harness: 'claude',
        title: data.title ?? 'Claude session',
        cwd: data.cwd,
        timestamp: data.timestamp ?? fallbackTimestamp ?? 0,
        modelId: data.modelId,
        provider: data.modelId ? 'anthropic' : undefined,
      };
    })
  );

  return sessionResults.filter((s): s is HarnessSession => s !== null);
}

async function discoverClaudeSessions(workspacePath: string): Promise<HarnessSession[]> {
  const homeDir = os.homedir();
  const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');

  const encodedPrefix = encodeClaudeProjectDir(workspacePath);

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = await fs.promises.readdir(claudeProjectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const projectDirs = dirEntries
    .filter(
      (e) => e.isDirectory() && (!encodedPrefix || e.name.startsWith(encodedPrefix))
    )
    .map((e) => path.join(claudeProjectsDir, e.name));

  const allResults = await Promise.all(
    projectDirs.map((dir) => discoverClaudeProjectDir(dir, workspacePath).catch(() => []))
  );

  return allResults.flat();
}
