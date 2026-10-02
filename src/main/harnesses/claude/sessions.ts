import type { HarnessSession } from '../../../shared/types/session';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { sessionMatchesWorkspace, isMissing, mapSessionFiles } from '../sessionFiles';

export function encodeClaudeProjectDir(workspacePath: string): string {
  if (!workspacePath) return '';
  return workspacePath.replace(/[^A-Za-z0-9-]/g, '-');
}

async function readClaudeSessionData(filePath: string): Promise<{
  cwd?: string;
  title?: string;
  timestamp?: number;
  modelId?: string;
}> {
  return new Promise((resolve, reject) => {
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

      rl.once('error', (error) => {
        if (!closed) {
          closed = true;
          if (isMissing(error)) resolve({ cwd, title, timestamp, modelId });
          else reject(error);
        }
      });
      stream.once('error', (error) => {
        if (!closed) {
          closed = true;
          if (isMissing(error)) resolve({ cwd, title, timestamp, modelId });
          else reject(error);
        }
      });
    } catch (error) {
      if (isMissing(error)) resolve({ cwd, title, timestamp, modelId });
      else reject(error);
    }
  });
}

async function discoverClaudeProjectDir(
  projectDir: string,
): Promise<string[]> {
  let fileEntries: fs.Dirent[];
  try {
    fileEntries = await fs.promises.readdir(projectDir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  return fileEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(projectDir, entry.name));
}

async function discoverClaudeSessionFile(filePath: string, workspacePath: string): Promise<HarnessSession | null> {
  const sessionId = path.basename(filePath).replace(/\.jsonl$/, '');
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
}

/** The native/default Claude config directory; managed accounts pass their own trusted `CLAUDE_CONFIG_DIR`. */
export function defaultClaudeConfigDir(): string {
  return path.join(os.homedir(), '.claude');
}

export async function discoverClaudeSessions(workspacePath: string, configDir: string = defaultClaudeConfigDir()): Promise<HarnessSession[]> {
  const claudeProjectsDir = path.join(configDir, 'projects');

  const encodedPrefix = encodeClaudeProjectDir(workspacePath);

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = await fs.promises.readdir(claudeProjectsDir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const projectDirs = dirEntries
    .filter(
      (e) => e.isDirectory() && (!encodedPrefix || e.name.startsWith(encodedPrefix))
    )
    .map((e) => path.join(claudeProjectsDir, e.name));

  const filesByProject = await mapSessionFiles(projectDirs, discoverClaudeProjectDir);
  const sessionResults = await mapSessionFiles(filesByProject.flat(), (filePath) =>
    discoverClaudeSessionFile(filePath, workspacePath));
  return sessionResults.filter((session): session is HarnessSession => session !== null);
}

// ============================================================================
// Antigravity Session Discovery
// ============================================================================
