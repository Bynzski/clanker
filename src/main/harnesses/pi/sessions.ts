import type { HarnessSession } from '../../../shared/types/session';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { sessionMatchesWorkspace, isMissing, mapSessionFiles, readFirstLineJson } from '../sessionFiles';

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

export function extractPiTitleFromParsedEvent(parsed: Record<string, unknown>): string | undefined {
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

async function readPiSessionMetadata(filePath: string): Promise<{ modelId?: string; provider?: string; title?: string }> {
  return new Promise((resolve, reject) => {
    const metadata: { modelId?: string; provider?: string; title?: string } = {};
    try {
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
      lines.on('line', (line) => {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        if (parsed.type === 'model_change' && typeof parsed.modelId === 'string'
          && typeof parsed.provider === 'string') {
          metadata.modelId = parsed.modelId;
          metadata.provider = parsed.provider;
        }
        metadata.title = extractPiTitleFromParsedEvent(parsed) ?? metadata.title;
      });
      lines.once('close', () => resolve(metadata));
      lines.once('error', (error) => isMissing(error) ? resolve(metadata) : reject(error));
      stream.once('error', (error) => isMissing(error) ? resolve(metadata) : reject(error));
    } catch (error) {
      if (isMissing(error)) resolve(metadata);
      else reject(error);
    }
  });
}

async function discoverPiSessionFile(
  filePath: string,
  workspacePath: string
): Promise<HarnessSession | null> {
  const first = await readFirstLineJson<PiSessionFirst>(filePath);
  if (!first || first.type !== 'session' || !first.cwd || !first.id) return null;
  if (workspacePath && !sessionMatchesWorkspace(workspacePath, first.cwd)) return null;

  const { modelId, provider, title } = await readPiSessionMetadata(filePath);
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

export async function discoverPiSessions(workspacePath: string): Promise<HarnessSession[]> {
  const homeDir = os.homedir();
  const piSessionsDir = path.join(homeDir, '.pi', 'agent', 'sessions');

  let subdirEntries: fs.Dirent[];
  try {
    subdirEntries = await fs.promises.readdir(piSessionsDir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const subdirs = subdirEntries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(piSessionsDir, e.name));

  const filesByDirectory = await mapSessionFiles(subdirs, async (subdir) => {
      let fileEntries: fs.Dirent[];
      try {
        fileEntries = await fs.promises.readdir(subdir, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
      return fileEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => path.join(subdir, entry.name));
  });
  const sessionResults = await mapSessionFiles(filesByDirectory.flat(), (filePath) =>
    discoverPiSessionFile(filePath, workspacePath).catch((error: unknown) => {
      if (isMissing(error)) return null;
      throw error;
    }));
  return sessionResults.filter((session): session is HarnessSession => session !== null);
}

// ============================================================================
// Oh My Pi session discovery
// ============================================================================

