import type { WorktreeProvenanceRecord } from '../shared/types/store';

/** Bounds keep the persisted memory small; the least recently seen entries go first. */
export const MAX_PROVENANCE_REPOSITORIES = 64;
export const MAX_PROVENANCE_WORKTREES = 256;

export interface WorktreeProvenancePersistence {
  read(): unknown;
  write(records: WorktreeProvenanceRecord[]): void;
}

export interface RememberedWorktree { path: string; branch: string | null }

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * A canonical absolute path in the application's POSIX-separator form: a POSIX/host path (`/srv/repo`),
 * a local Windows drive path (`C:/repo`) or a UNC path (`//server/share/repo`). Relative paths,
 * backslashes, control characters, dot segments and malformed drives or UNC prefixes are refused.
 */
export function isCanonicalProvenancePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
  if (CONTROL_CHARACTERS.test(value) || value.includes('\\')) return false;
  if (value.split('/').some((segment) => segment === '..' || segment === '.')) return false;
  if (/^[A-Za-z]:/.test(value)) return /^[A-Za-z]:\/(?!\/)/.test(value);
  if (value.startsWith('//')) return /^\/\/[^/]+\/[^/]+(?:\/|$)/.test(value);
  return value.startsWith('/');
}
const validPath = isCanonicalProvenancePath;

function parse(raw: unknown): WorktreeProvenanceRecord[] {
  if (!Array.isArray(raw)) return [];
  const records: WorktreeProvenanceRecord[] = [];
  for (const entry of raw) {
    const record = entry as Partial<WorktreeProvenanceRecord> | null;
    if (!record || typeof record.environmentId !== 'string' || !record.environmentId || !validPath(record.mainPath)
      || !Array.isArray(record.worktrees)) continue;
    const worktrees = record.worktrees.filter((item): item is RememberedWorktree =>
      Boolean(item) && validPath((item as RememberedWorktree).path)
      && ((item as RememberedWorktree).branch === null || typeof (item as RememberedWorktree).branch === 'string'));
    records.push({ environmentId: record.environmentId, mainPath: record.mainPath, worktrees: worktrees.slice(-MAX_PROVENANCE_WORKTREES) });
  }
  return records.slice(-MAX_PROVENANCE_REPOSITORIES);
}

/**
 * Main-owned memory of which directories were linked worktrees of which repository (identified by
 * environment plus main checkout path). Written only from Git's own listing and from checkouts main
 * itself created or attached; read back to keep attributing conversations after Git forgets a
 * worktree. A damaged store reads as empty and is replaced on the next write.
 */
export class WorktreeProvenance {
  private records: WorktreeProvenanceRecord[];

  constructor(private readonly persistence?: WorktreeProvenancePersistence) {
    let raw: unknown;
    try { raw = persistence?.read(); } catch { raw = undefined; }
    this.records = parse(raw);
  }

  public recall(environmentId: string, mainPath: string): RememberedWorktree[] {
    return (this.records.find((record) => record.environmentId === environmentId && record.mainPath === mainPath)?.worktrees ?? [])
      .map((entry) => ({ ...entry }));
  }

  /** Merges by path (a later branch name replaces an earlier one, `null` never erases a known branch). */
  public remember(environmentId: string, mainPath: string, entries: readonly RememberedWorktree[]): void {
    const usable = entries.filter((entry) => validPath(entry.path) && entry.path !== mainPath);
    if (!validPath(mainPath) || !environmentId || usable.length === 0) return;
    const index = this.records.findIndex((record) => record.environmentId === environmentId && record.mainPath === mainPath);
    const current = index >= 0 ? this.records[index] : { environmentId, mainPath, worktrees: [] };
    const merged = new Map(current.worktrees.map((entry) => [entry.path, entry]));
    let changed = index < 0;
    for (const entry of usable) {
      const previous = merged.get(entry.path);
      const branch = entry.branch ?? previous?.branch ?? null;
      if (!previous || previous.branch !== branch) changed = true;
      merged.delete(entry.path);
      merged.set(entry.path, { path: entry.path, branch });
    }
    if (!changed) return;
    const next: WorktreeProvenanceRecord = { environmentId, mainPath, worktrees: [...merged.values()].slice(-MAX_PROVENANCE_WORKTREES) };
    if (index >= 0) this.records.splice(index, 1);
    this.records.push(next);
    this.records = this.records.slice(-MAX_PROVENANCE_REPOSITORIES);
    try { this.persistence?.write(this.records); } catch { /* memory is best effort */ }
  }
}
