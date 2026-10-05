import type { HarnessSession } from '../../../shared/types/session';
import { execFile } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { resolveHarnessSpawn } from '../../harnessLaunch';
import { prependUserCliBinsToPath } from '../../platformShell';
import { sessionMatchesWorkspace } from '../sessionFiles';

function runCommandOutput(command: string, args: string[], cwd?: string): Promise<string> {
  const { spawnCmd, spawnArgs } = resolveHarnessSpawn(command, args, null);

  return new Promise((resolve, reject) => {
    execFile(
      spawnCmd,
      spawnArgs,
      {
        timeout: 8000,
        maxBuffer: 2 * 1024 * 1024,
        ...(cwd ? { cwd } : {}),
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

/**
 * Where `opencode session list` must run for a scan of `workspacePath`: OpenCode lists the sessions of
 * the project that contains its working directory (measured with 1.18.34: from an unrelated directory
 * it prints an empty list). A repository root is its own project. A directory that is not a checkout but
 * holds some (the `<repo>-worktrees` container Clanker scans for isolated agents) uses its first checkout
 * child, which is a worktree of the same project. Anything else runs where it is asked about.
 */
export function openCodeListingDirectory(workspacePath: string): string | undefined {
  if (!workspacePath || !existsSync(workspacePath)) return undefined;
  if (existsSync(join(workspacePath, '.git'))) return workspacePath;
  try {
    for (const entry of readdirSync(workspacePath, { withFileTypes: true }).slice(0, 256)) {
      if (entry.isDirectory() && existsSync(join(workspacePath, entry.name, '.git'))) return join(workspacePath, entry.name);
    }
  } catch { /* unreadable: fall through */ }
  return workspacePath;
}

interface OpenCodeSessionRaw {
  id: string;
  title?: string;
  directory?: string;
  updated?: number;
  created?: number;
}

export async function discoverOpenCodeSessions(workspacePath: string): Promise<HarnessSession[]> {
    // `opencode session list` lists the sessions of the project that contains its working directory, not
    // of every project (measured with 1.18.34: from an unrelated directory it prints an empty list), so it
    // must run inside the workspace being asked about. Worktrees of one repository share a project.
    const output = await runCommandOutput('opencode', ['session', 'list', '--format', 'json'], openCodeListingDirectory(workspacePath));
    const trimmed = output.trim();
    if (!trimmed) return [];

    let rawSessions: OpenCodeSessionRaw[] = [];
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid OpenCode session list');
      rawSessions = Array.isArray(parsed) ? (parsed as OpenCodeSessionRaw[]) : [parsed as OpenCodeSessionRaw];
    } catch {
      // Fall back to JSONL
      for (const line of trimmed.split('\n')) {
        const l = line.trim();
        if (!l) continue;
        try {
          rawSessions.push(JSON.parse(l) as OpenCodeSessionRaw);
        } catch {
          throw new Error('Invalid OpenCode session list');
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
}

// ============================================================================
// Codex session discovery
// ============================================================================
