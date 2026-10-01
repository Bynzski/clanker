import { getHarnessProviders } from '../harnesses/registry';
import { remoteSessionScript } from '../harnesses/remoteSessionRuntime';
import type { HarnessSession } from '../../shared/types/session';
import type { SshCommandExecutor } from './sshCommandExecutor';
import { isPathContained } from './remotePaths';
import { REMOTE_CLI_PATH_SETUP } from './sshAgentAttention';
import { quotePosixCommand } from './posixQuote';
import { posix } from 'node:path';

export async function discoverSshSessions(executor: SshCommandExecutor, target: string, workspacePath: string, harnessIds: string[]): Promise<HarnessSession[]> {
  const providers = getHarnessProviders().filter((provider) => harnessIds.includes(provider.descriptor.id) && provider.sessions?.remote);
  const harnesses = providers.map((provider) => provider.descriptor.id);
  const script = remoteSessionScript(providers);
  if (!workspacePath.startsWith('/') || workspacePath.includes('\0') || posix.normalize(workspacePath) !== workspacePath || Buffer.byteLength(workspacePath) > 4096) throw new Error('Invalid remote workspace path');
  const scans: Promise<string>[] = [];
  const batched = providers.filter((provider) => !provider.sessions?.remote?.command);
  if (batched.length) scans.push(executor.exec(target, 'python3', ['-c', script, workspacePath, JSON.stringify(batched.map((provider) => provider.descriptor.id))], { timeoutMs: 20000, maxBuffer: 1024 * 1024 }).then((result) => result.stdout));
  // Ask for one beyond the scan limit. The CLI's default page is incomplete
  // launch evidence: an older session updated later could otherwise look new.
  for (const provider of providers.filter((entry) => entry.sessions?.remote?.command)) {
    const command = provider.sessions!.remote!.command!;
    scans.push(executor.exec(target, 'sh', ['-c', `${REMOTE_CLI_PATH_SETUP}\nexec ${quotePosixCommand(command.command, command.args)}`], { cwd: workspacePath, timeoutMs: 20000, maxBuffer: 1024 * 1024 }).then(async (result) => {
    let raw: unknown;
    try { raw = JSON.parse(result.stdout); }
    catch { raw = result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
    const entries = Array.isArray(raw) ? raw : [raw];
    if (entries.length > 4096) throw new Error('Remote OpenCode session scan limit exceeded');
    const validated = await executor.exec(target, 'python3', ['-c', script, workspacePath, JSON.stringify([provider.descriptor.id])], { input: JSON.stringify(entries), timeoutMs: 10000, maxBuffer: 1024 * 1024 });
    return validated.stdout;
  }));
  }
  const sessions: HarnessSession[] = [];
  const seen = new Map<string, HarnessSession>();
  for (const output of await Promise.all(scans)) {
    const entries: unknown = JSON.parse(output);
    if (!Array.isArray(entries)) throw new Error('Invalid remote session response');
    for (const item of entries) {
      if (!item || typeof item !== 'object') throw new Error('Invalid remote session response');
      const session = item as HarnessSession;
      if (!harnesses.includes(session.harness) || typeof session.id !== 'string' || !session.id || session.id.length > 256
        || typeof session.cwd !== 'string' || !session.cwd.startsWith('/') || session.cwd.includes('\0')
        || typeof session.title !== 'string' || session.title.length > 120 || !Number.isFinite(session.timestamp)
        || [session.modelId, session.provider, session.filePath].some((value) => value !== undefined && (typeof value !== 'string' || value.includes('\0')))) throw new Error('Invalid remote session response');
      if (!isPathContained(workspacePath, session.cwd)) continue;
      const key = `${session.harness}\0${session.id}`;
      const previous = seen.get(key);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(session)) throw new Error('Conflicting metadata for a remote session; select it after repairing the host session store');
        continue;
      }
      seen.set(key, session);
      sessions.push(session);
      if (sessions.length > 512) throw new Error('Too many matching remote sessions (limit 512)');
    }
  }
  return sessions.sort((a, b) => b.timestamp - a.timestamp);
}
