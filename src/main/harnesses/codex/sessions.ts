import type { HarnessSession } from '../../../shared/types/session';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { sessionMatchesWorkspace, isMissing, mapSessionFiles, readFirstLineJson } from '../sessionFiles';

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
  let directories = [sessionsDir];
  while (directories.length > 0) {
    const batches = await mapSessionFiles(directories, async (dir) => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return { files: [] as Array<[string, string]>, directories: [] as string[] };
        throw error;
      }
      const files: Array<[string, string]> = [];
      const childDirectories: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          childDirectories.push(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const match = entry.name.match(
            /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
          );
          if (match) {
            files.push([match[1], fullPath]);
          }
        }
      }
      return { files, directories: childDirectories };
    });
    directories = [];
    for (const batch of batches) {
      for (const [id, filePath] of batch.files) map.set(id, filePath);
      directories.push(...batch.directories);
    }
  }
  return map;
}

/**
 * Read leading lines of a Codex session file and return the first user_message content.
 * Returns null if no user message is found.
 */
async function readCodexFirstUserMessage(filePath: string): Promise<string | null> {
  const MAX_LINES = 30;
  return new Promise<string | null>((resolve, reject) => {
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
      rl.once('error', (error) => isMissing(error) ? resolve(null) : reject(error));
      stream.once('error', (error) => isMissing(error) ? resolve(null) : reject(error));
    } catch (error) {
      if (isMissing(error)) resolve(null);
      else reject(error);
    }
  });
}

/**
 * Collect orphaned session data from the file map built during discovery.
 */
async function collectOrphanedSessions(
  fileMap: Map<string, string>,
  workspacePath: string,
  indexedIds: Set<string>
): Promise<CodexSessionData[]> {
  const candidates = [...fileMap].filter(([id]) => !indexedIds.has(id));
  const orphaned = await mapSessionFiles(candidates, async ([sessionId, fullPath]): Promise<CodexSessionData | null> => {
    const meta = await readFirstLineJson<CodexSessionMeta>(fullPath);
    if (!meta?.payload?.cwd) return null;
    if (workspacePath && !sessionMatchesWorkspace(workspacePath, meta.payload.cwd)) return null;
    let timestamp = 0;
    try {
      timestamp = (await fs.promises.stat(fullPath)).mtimeMs;
    } catch {
      // Keep sessions whose file was removed during discovery.
    }
    return {
      filePath: fullPath,
      id: sessionId,
      cwd: meta.payload.cwd,
      timestamp,
      modelId: meta.payload.model ?? undefined,
      provider: meta.payload.model ? (meta.payload.model_provider ?? 'openai') : undefined,
    };
  });
  return orphaned.filter((session): session is CodexSessionData => session !== null);
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
  const indexed = await mapSessionFiles(indexEntries, async (entry): Promise<HarnessSession | null> => {
    const filePath = fileMap.get(entry.id);
    if (!filePath) return null;
    const meta = await readFirstLineJson<CodexSessionMeta>(filePath);
    if (!meta?.payload?.cwd) return null;
    if (workspacePath && !sessionMatchesWorkspace(workspacePath, meta.payload.cwd)) return null;
    return {
      id: entry.id,
      harness: 'codex',
      title: entry.thread_name?.trim() || 'Codex session',
      cwd: meta.payload.cwd,
      timestamp: entry.updated_at ? Date.parse(entry.updated_at) : 0,
      modelId: meta.payload.model ?? undefined,
      provider: meta.payload.model ? (meta.payload.model_provider ?? 'openai') : undefined,
    };
  });
  sessions.push(...indexed.filter((session): session is HarnessSession => session !== null));
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

/** The native/default Codex home; managed accounts pass their own trusted `CODEX_HOME` instead. */
export function defaultCodexHome(): string {
  return path.join(os.homedir(), '.codex');
}

export async function discoverCodexSessions(workspacePath: string, codexHome: string = defaultCodexHome()): Promise<HarnessSession[]> {
  const indexPath = path.join(codexHome, 'session_index.jsonl');
  const sessionsDir = path.join(codexHome, 'sessions');

  let indexContent = '';
  try {
    indexContent = await fs.promises.readFile(indexPath, 'utf8');
  } catch (error) {
    // Some installs (notably on Windows) may have sessions on disk without
    // session_index.jsonl. Treat missing index as empty and continue scanning.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }

  const indexEntries = parseCodexIndexEntries(indexContent);
  const fileMap = await buildCodexFileMap(sessionsDir);
  const sessions = await buildCodexIndexedSessions(indexEntries, fileMap, workspacePath);

  const indexThreadNames = buildCodexThreadNameMap(indexEntries);
  const indexedIds = new Set(indexEntries.map((entry) => entry.id));
  const orphaned = await collectOrphanedSessions(fileMap, workspacePath, indexedIds);

  const orphanedSessions = await mapSessionFiles(orphaned, async (session) => ({
    id: session.id,
    harness: 'codex' as const,
    title: await resolveCodexOrphanedTitle(session, indexThreadNames),
    cwd: session.cwd,
    timestamp: session.timestamp,
    modelId: session.modelId,
    provider: session.provider,
  }));

  return [...sessions, ...orphanedSessions];
}
// ============================================================================
// Pi session discovery
// ============================================================================
