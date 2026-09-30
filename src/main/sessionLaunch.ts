import type { HarnessSession } from '../shared/types/session';

export const SUPPORTED_RESUME_HARNESSES: ReadonlySet<string> = new Set(['codex', 'claude', 'opencode', 'pi', 'omp', 'agy']);

/** Pure native CLI arguments, shared by local and SSH session launches. */
export function buildSessionCommand(session: HarnessSession, fork = false, userFlags?: string): { command: string; args: string[] } {
  const command = (command: string, args: string[]) => ({ command, args });
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
      return command('opencode', [
        '--session', session.id, ...(fork ? ['--fork'] : []), ...flagArgs,
      ]);

    case 'pi': {
      const target = session.filePath ?? session.id;
      return command('pi', [
        fork ? '--fork' : '--session', target,
        ...(modelStr ? ['--model', modelStr] : []), ...flagArgs,
      ]);
    }

    case 'omp': {
      const target = session.filePath ?? session.id;
      return command('omp', [
        fork ? '--fork' : '--resume', target,
        ...(modelStr ? ['--model', modelStr] : []), ...flagArgs,
      ]);
    }

    case 'codex':
      return command('codex', [
        fork ? 'fork' : 'resume', session.id,
        ...(modelStr ? ['-m', modelStr] : []), ...flagArgs,
      ]);

    case 'agy':
      return command('agy', [
        '--conversation', session.id,
        ...(modelStr ? ['--model', modelStr] : []), ...flagArgs,
      ]);

    case 'claude':
      return command('claude', [
        '--resume', session.id,
        ...(fork ? ['--fork-session'] : []),
        ...(modelStr ? ['--model', modelStr] : []), ...flagArgs,
      ]);
    default: throw new Error(`${session.harness} session invocation is not supported`);
  }
}
