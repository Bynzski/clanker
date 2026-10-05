import type { IPty } from 'node-pty';

/** The part of a registered terminal that retirement touches. */
export interface RetirableTerminal {
  pty: Pick<IPty, 'kill'>;
  releaseResources?: () => Promise<void>;
  /** Settles on the process' real exit (node-pty `onExit`). */
  exited?: Promise<void>;
}

/**
 * - `exited`: the process' own exit event fired; nothing of it is left running.
 * - `absent`: no such terminal was registered (it was already retired or closed: nothing here proves it exited).
 * - `timeout`: it did not exit after a graceful and a forced kill, within the bounds.
 * - `unverifiable`: the record has no exit signal, so exit cannot be proven.
 */
export type TerminalExitOutcome = 'exited' | 'absent' | 'timeout' | 'unverifiable';

export interface RetireWaitTiming {
  /** How long the ordinary kill gets before it is escalated. */
  gracefulMs: number;
  /** How long the forced kill gets before giving up. */
  forcedMs: number;
}
const DEFAULT_RETIRE_WAIT: RetireWaitTiming = { gracefulMs: 3_000, forcedMs: 2_000 };

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

/**
 * `retireTerminal`, then wait for the process to REALLY exit. For moves where a second process for the same
 * conversation must never overlap the first (the old one can silently keep a conversation in its old
 * directory). Source authority is revoked and the terminal leaves the table at once, exactly as for any
 * retirement; what this adds is the proof. The wait is bounded: a graceful kill, then a forced one
 * (SIGKILL where signals exist), then `timeout`. The exit promise belongs to the record, so no pid is
 * ever polled and a reused pid cannot be mistaken for it.
 */
export async function retireTerminalAndWait(
  params: { terminals: Map<string, RetirableTerminal>; releaseAttention?: (terminalId: string) => void },
  terminalId: string,
  timing: Partial<RetireWaitTiming> = {},
): Promise<TerminalExitOutcome> {
  const terminal = params.terminals.get(terminalId);
  if (!terminal) return 'absent';
  const { gracefulMs, forcedMs } = { ...DEFAULT_RETIRE_WAIT, ...timing };
  const exited = terminal.exited;
  const cleanup = retireTerminal(params, terminalId);
  if (!exited) { await cleanup.catch(() => undefined); return 'unverifiable'; }

  const waitFor = (ms: number): Promise<boolean> => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void exited.then(() => { clearTimeout(timer); resolve(true); });
  });
  let done = await waitFor(gracefulMs);
  if (!done) {
    try { terminal.pty.kill('SIGKILL'); } catch { /* no signals (Windows) or already gone */ }
    done = await waitFor(forcedMs);
  }
  await cleanup.catch(() => undefined);
  return done ? 'exited' : 'timeout';
}
