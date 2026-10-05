import type { HarnessCheckoutRehomeCapability } from '../types';

/** `-C <dir>`, `-C<dir>`, `--cd <dir>` and `--cd=<dir>` are all the same option; none may survive next to ours. */
function withoutExplicitDirectory(args: readonly string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-C' || arg === '--cd') { index += 1; continue; }
    if (arg.startsWith('--cd=') || (arg.startsWith('-C') && arg.length > 2 && !arg.startsWith('--'))) continue;
    kept.push(arg);
  }
  return kept;
}

/**
 * Codex runs conversations in a shared per-CODEX_HOME app-server daemon that holds a thread's writer
 * lock for as long as the thread is loaded. Observed with Codex 0.160.0 in an isolated CODEX_HOME:
 *
 * - while a TUI is attached to a thread, or a turn is still running after its TUI was killed, a new
 *   `codex resume <id> --cd <other>` does NOT fail: it attaches to the live thread, which keeps its
 *   original working directory (the header and `pwd` still showed the source checkout);
 * - once the turn has completed and no TUI is attached, `codex resume <id> --cd <other>` works at once
 *   and the thread's `pwd` is the new directory.
 *
 * So a conversation must never be hot-replaced: it is moved after its native root turn completes, with
 * the old process retired first, and the target is passed explicitly with `--cd`.
 */
export const checkoutRehome: HarnessCheckoutRehomeCapability = {
  mode: 'after-turn',
  withTargetDirectory: (args, directory) => [...withoutExplicitDirectory(args), '--cd', directory],
  // Strings present in the 0.160.0 binary for the thread-ownership failure ("failed to acquire thread
  // writer lock ...", "... is already running with a different rollout path"). Not reproduced by the
  // flows above, which attach silently, so this stays a narrow, bounded safety net.
  isWriterContention: (output) => /failed to acquire thread writer lock|already running with a different rollout path/i.test(output),
  writerContentionRetry: { attempts: 3, delayMs: 250 },
};
