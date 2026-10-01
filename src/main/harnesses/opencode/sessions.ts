import type { HarnessSession } from '../../../shared/types/session';
import { execFile } from 'child_process';
import { resolveHarnessSpawn } from '../../harnessLaunch';
import { prependUserCliBinsToPath } from '../../platformShell';
import { sessionMatchesWorkspace } from '../sessionFiles';

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

interface OpenCodeSessionRaw {
  id: string;
  title?: string;
  directory?: string;
  updated?: number;
  created?: number;
}

export async function discoverOpenCodeSessions(workspacePath: string): Promise<HarnessSession[]> {
    const output = await runCommandOutput('opencode', ['session', 'list', '--format', 'json']);
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
