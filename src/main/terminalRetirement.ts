import type { IPty } from 'node-pty';

/** The part of a registered terminal that retirement touches. */
export interface RetirableTerminal {
  pty: Pick<IPty, 'kill'>;
  releaseResources?: () => Promise<void>;
}

/**
 * Retires one terminal the way every explicit close does: its attention registration is released
 * (a revisioned tombstone), its launch attachments are disposed (which revokes its bridge credential),
 * the process is killed, and it leaves the terminal table at once so nothing counts it as live
 * (checkout release, worktree inspection, bridge authority).
 *
 * Returns the cleanup promise; callers that need the guarantee that cleanup finished await it. A
 * terminal that is already gone is a no-op, so retirement is idempotent.
 */
export function retireTerminal(
  params: {
    terminals: Map<string, RetirableTerminal>;
    releaseAttention?: (terminalId: string) => void;
  },
  terminalId: string,
): Promise<void> {
  const terminal = params.terminals.get(terminalId);
  if (!terminal) return Promise.resolve();
  params.releaseAttention?.(terminalId);
  const cleanup = terminal.releaseResources?.() ?? Promise.resolve();
  try {
    terminal.pty.kill();
  } catch {
    // On Windows, node-pty may warn about SIGTERM before falling back to TerminateProcess.
    // Suppress the noise: the process is gone.
  }
  params.terminals.delete(terminalId);
  return cleanup;
}
