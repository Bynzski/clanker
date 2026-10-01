import type { HarnessSession } from '../../../shared/types/session';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { extractPiTitleFromParsedEvent } from '../pi/sessions';
import { sessionMatchesWorkspace, isMissing } from '../sessionFiles';

interface OmpSessionMetadata {
  id?: string;
  cwd?: string;
  timestamp?: string;
  title?: string;
  modelId?: string;
}

function applyOmpSessionLine(metadata: OmpSessionMetadata, line: string): void {
  // Long message/tool records carry no metadata needed by the history list.
  if (line.length > 64 * 1024) return;
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  const entry = parsed as Record<string, unknown>;
  if (entry.type === 'session') {
    if (typeof entry.id === 'string') metadata.id = entry.id;
    if (typeof entry.cwd === 'string') metadata.cwd = entry.cwd;
    if (typeof entry.timestamp === 'string') metadata.timestamp = entry.timestamp;
  } else if (entry.type === 'title' && typeof entry.title === 'string' && entry.title.trim()) {
    metadata.title = entry.title.trim().slice(0, 120);
  } else if (entry.type === 'model_change' && typeof entry.model === 'string') {
    metadata.modelId = entry.model;
  } else if (!metadata.title && entry.type === 'message'
    && entry.message && typeof entry.message === 'object' && !Array.isArray(entry.message)) {
    metadata.title = extractPiTitleFromParsedEvent(entry);
  }
}

/** OMP may write a title record before the session header. */
export function parseOmpSessionMetadata(lines: string[]): OmpSessionMetadata {
  const metadata: OmpSessionMetadata = {};
  for (const line of lines) applyOmpSessionLine(metadata, line);
  return metadata;
}

async function readOmpSessionMetadata(filePath: string): Promise<OmpSessionMetadata> {
  return new Promise((resolve, reject) => {
    const metadata: OmpSessionMetadata = {};
    try {
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
      lines.on('line', (line) => applyOmpSessionLine(metadata, line));
      lines.once('close', () => resolve(metadata));
      lines.once('error', (error) => isMissing(error) ? resolve(metadata) : reject(error));
      stream.once('error', (error) => {
        if (isMissing(error)) resolve(metadata);
        else reject(error);
        lines.close();
      });
    } catch (error) {
      if (isMissing(error)) resolve(metadata);
      else reject(error);
    }
  });
}

async function discoverOmpSessionFile(filePath: string, workspacePath: string): Promise<HarnessSession | null> {
  const metadata = await readOmpSessionMetadata(filePath);
  if (!metadata.id || !metadata.cwd || (workspacePath && !sessionMatchesWorkspace(workspacePath, metadata.cwd))) {
    return null;
  }
  return {
    id: metadata.id,
    harness: 'omp',
    title: metadata.title ?? metadata.modelId ?? 'Oh My Pi session',
    cwd: metadata.cwd,
    timestamp: metadata.timestamp ? Date.parse(metadata.timestamp) || 0 : 0,
    modelId: metadata.modelId,
    filePath,
  };
}

export async function discoverOmpSessions(workspacePath: string): Promise<HarnessSession[]> {
  const root = path.join(os.homedir(), '.omp', 'agent', 'sessions');
  let projectDirs: fs.Dirent[];
  try { projectDirs = await fs.promises.readdir(root, { withFileTypes: true }); } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const sessionFiles: string[] = [];
  for (const project of projectDirs.filter((entry) => entry.isDirectory())) {
    const projectPath = path.join(root, project.name);
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(projectPath, { withFileTypes: true }); } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    sessionFiles.push(...entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(projectPath, entry.name)));
  }
  const sessions: HarnessSession[] = [];
  for (let index = 0; index < sessionFiles.length; index += 16) {
    const batch = await Promise.all(sessionFiles.slice(index, index + 16)
      .map((filePath) => discoverOmpSessionFile(filePath, workspacePath).catch((error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      })));
    sessions.push(...batch.filter((session): session is HarnessSession => session !== null));
  }
  return sessions;
}

// ============================================================================
// Claude Code session discovery
// ============================================================================

