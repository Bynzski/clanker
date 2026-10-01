import type { HarnessSession } from '../../../shared/types/session';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { sessionMatchesWorkspace, isMissing } from '../sessionFiles';

interface AgyConversationRow {
  conversation_id: string;
  title: string;
  preview: string;
  last_modified_time: string;
  last_user_input_time: string;
  workspace_uris: string;
}

export function parseAgyWorkspaceUris(rawUris: string): string[] | null {
  if (!rawUris) return [];
  if (typeof rawUris !== 'string') return null;
  try {
    const uris: unknown = JSON.parse(rawUris);
    if (!Array.isArray(uris)) return null;
    const workspacePaths: string[] = [];
    for (const uri of uris) {
      if (typeof uri !== 'string' || !uri.trim()) return null;
      workspacePaths.push(uri.startsWith('file://') ? fileURLToPath(uri) : uri);
    }
    return workspacePaths;
  } catch {
    return null;
  }
}

export function mapAgyRowToSession(
  row: Partial<AgyConversationRow>,
  workspacePath?: string,
): HarnessSession | null {
  const id = String(row.conversation_id || '').trim();
  if (!id) return null;

  const workspacePaths = parseAgyWorkspaceUris(row.workspace_uris || '');
  if (workspacePaths === null) return null;
  const cwd = workspacePath
    ? workspacePaths.find((candidate) => sessionMatchesWorkspace(workspacePath, candidate))
    : workspacePaths[0];
  if (workspacePath && workspacePaths.length > 0 && !cwd) {
    return null;
  }

  let title = (typeof row.title === 'string' ? row.title : '').trim();
  const preview = (typeof row.preview === 'string' ? row.preview : '').trim();
  if (!title && preview && preview !== '<conversation>') {
    title = preview;
  }
  if (!title) {
    title = 'Antigravity session';
  }

  const timestamp = Date.parse(row.last_modified_time || '') || Date.parse(row.last_user_input_time || '') || 0;

  return {
    id,
    harness: 'agy',
    title,
    cwd: cwd || workspacePath || os.homedir(),
    timestamp,
  };
}

export async function discoverAgySessions(
  workspacePath: string,
  customDbPath?: string,
): Promise<HarnessSession[]> {
  const dbPath = customDbPath ?? path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversation_summaries.db');
  try {
    await fs.promises.stat(dbPath);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  let db: { prepare: (sql: string) => { all: () => unknown[] }; close: () => void } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqlite = require('node:sqlite');
    if (!sqlite?.DatabaseSync) throw new Error('SQLite session discovery is unavailable');
    const database = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    db = database;

    const stmt = database.prepare(`
      SELECT conversation_id, title, preview, last_modified_time, last_user_input_time, workspace_uris
      FROM conversation_summaries
      WHERE (title != '' OR (preview != '' AND preview != '<conversation>'))
        AND last_modified_time NOT LIKE '0001%'
      ORDER BY last_modified_time DESC
    `);
    const rows = stmt.all() as Array<Partial<AgyConversationRow>>;
    const sessions: HarnessSession[] = [];
    for (const row of rows) {
      const session = mapAgyRowToSession(row, workspacePath);
      if (session) {
        sessions.push(session);
      }
    }
    return sessions;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}
