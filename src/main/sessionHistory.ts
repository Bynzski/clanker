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
import { ensureHarnessWrapperScript } from './harnessLaunch';

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
 */
export function sessionMatchesWorkspace(
  workspacePath: string,
  candidatePath: string
): boolean {
  if (!workspacePath) return true;
  if (!candidatePath) return false;
  const sep = path.sep;
  const normedWorkspace = workspacePath.endsWith(sep)
    ? workspacePath
    : workspacePath + sep;
  const normedCandidate = candidatePath.endsWith(sep)
    ? candidatePath
    : candidatePath + sep;
  return normedCandidate.startsWith(normedWorkspace);
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
  const normalizedPath = (workspacePath ?? '').replace(/\/+$/, '');

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

  sessionCache.set(normalizedPath, { sessions, cachedAt: Date.now() });
  return sessions;
}

export function buildSessionInvokeArgs(
  session: HarnessSession,
  fork = false,
  userFlags?: string
): { spawnCmd: string; spawnArgs: string[] } {
  const wrapperPath = ensureHarnessWrapperScript();

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
      return {
        spawnCmd: wrapperPath,
        spawnArgs: ['opencode', '--session', session.id, ...(fork ? ['--fork'] : []), ...flagArgs],
      };

    case 'pi': {
      const target = session.filePath ?? session.id;
      return {
        spawnCmd: wrapperPath,
        spawnArgs: fork
          ? ['pi', '--fork', target, ...(modelStr ? ['--model', modelStr] : []), ...flagArgs]
          : ['pi', '--session', target, ...(modelStr ? ['--model', modelStr] : []), ...flagArgs],
      };
    }

    case 'codex':
      return {
        spawnCmd: wrapperPath,
        spawnArgs: [
          'codex',
          fork ? 'fork' : 'resume',
          session.id,
          ...(modelStr ? ['-m', modelStr] : []),
          ...flagArgs,
        ],
      };

    case 'claude':
    default:
      return {
        spawnCmd: wrapperPath,
        spawnArgs: [
          'claude',
          '--resume',
          session.id,
          ...(fork ? ['--fork-session'] : []),
          ...(modelStr ? ['--model', modelStr] : []),
          ...flagArgs,
        ],
      };
  }
}

// ============================================================================
// File I/O helpers
// ============================================================================

function runCommandOutput(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: 8000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: `${os.homedir()}/.local/bin:${process.env.PATH ?? ''}`,
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
    console.debug('[session-history] opencode session list failed or not available');
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
 * Read first ~10 lines of a Codex session file and return the first user_message content.
 * Returns null if no user message is found.
 */
async function readCodexFirstUserMessage(filePath: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let stream: fs.ReadStream | null = null;
    let linesRead = 0;
    try {
      stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 16 * 1024 });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      rl.on('line', (line) => {
        if (!line.trim() || linesRead > 10) {
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
            rl.close();
            stream?.destroy();
            resolve(payload.message.trim().slice(0, 120));
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

async function discoverCodexSessions(workspacePath: string): Promise<HarnessSession[]> {
  const homeDir = os.homedir();
  const indexPath = path.join(homeDir, '.codex', 'session_index.jsonl');
  const sessionsDir = path.join(homeDir, '.codex', 'sessions');

  let indexContent: string;
  try {
    indexContent = await fs.promises.readFile(indexPath, 'utf8');
  } catch {
    console.debug('[session-history] codex session_index.jsonl not found');
    return [];
  }

  const fileMap = await buildCodexFileMap(sessionsDir);
  const sessions: HarnessSession[] = [];

  // Index-based discovery pass
  for (const line of indexContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: CodexIndexEntry;
    try {
      entry = JSON.parse(trimmed) as CodexIndexEntry;
    } catch {
      continue;
    }

    if (!entry.id) continue;
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
      provider: meta.payload.model
        ? (meta.payload.model_provider ?? 'openai')
        : undefined,
    });
  }

  // Build index thread-name map for orphaned session title lookup.
  const indexThreadNames = new Map<string, string>();
  for (const l of indexContent.split('\n')) {
    const t = l.trim();
    if (!t) continue;
    let e: CodexIndexEntry;
    try { e = JSON.parse(t) as CodexIndexEntry; } catch { continue; }
    if (e.id) indexThreadNames.set(e.id, e.thread_name ?? '');
  }

  // Fallback pass: orphaned sessions — title from index first,
  // then readCodexFirstUserMessage, then directory name, then "Codex session"
  const indexedIds = new Set(sessions.map((s) => s.id));
  const orphaned = await collectOrphanedSessions(sessionsDir, workspacePath, indexedIds);
  for (const session of orphaned) {
    const indexTitle = indexThreadNames.get(session.id);
    const userMessageTitle = await readCodexFirstUserMessage(session.filePath);
    const title =
      (indexTitle && indexTitle.trim()) ||
      userMessageTitle ||
      session.cwd.split('/').pop() ||
      'Codex session';
    sessions.push({
      id: session.id,
      harness: 'codex',
      title,
      cwd: session.cwd,
      timestamp: session.timestamp,
      modelId: session.modelId,
      provider: session.provider,
    });
  }
  return sessions;
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

async function discoverPiSessionFile(
  filePath: string,
  workspacePath: string
): Promise<HarnessSession | null> {
  const first = await readFirstLineJson<PiSessionFirst>(filePath);
  if (!first || first.type !== 'session' || !first.cwd || !first.id) return null;
  if (workspacePath && !sessionMatchesWorkspace(workspacePath, first.cwd)) return null;

  // Scan all lines for last model_change and first user message title
  const rawLines = await readFileLines(filePath);
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
      // Don't break — keep scanning for title
    }
    // Extract title from first real user message (Pi content is [{type:"text",text:"..."}])
    if (
      !title &&
      parsed.type === 'message' &&
      (parsed as Record<string, unknown>).message !== undefined
    ) {
      const msg = (parsed as Record<string, unknown>).message as Record<string, unknown>;
      if (msg.role === 'user') {
        const content = msg.content;
        let text = '';
        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          text = (content as Array<Record<string, unknown>>)
            .filter((c) => typeof c === 'object' && c !== null)
            .map((c) => String((c as Record<string, unknown>).text ?? ''))
            .join('');
        }
        if (text.trim()) {
          title = text.slice(0, 120);
        }
      }
    }
  }

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
    console.debug('[session-history] pi sessions dir not found');
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

  // Encode: /home/jay/dev/projects/foo → -home-jay-dev-projects-foo
  const encodedPrefix = workspacePath
    ? `-${workspacePath.replace(/^\//, '').replace(/\//g, '-')}`
    : '';

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = await fs.promises.readdir(claudeProjectsDir, { withFileTypes: true });
  } catch {
    console.debug('[session-history] claude projects dir not found');
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
