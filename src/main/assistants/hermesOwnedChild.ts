import type { ServeChild } from './hermesBackend';

export const HERMES_CLEANUP_ERROR = 'Hermes service cleanup could not be confirmed. Clanker still owns the process and will not start another service. Retry cleanup.';

/** Exact child-handle ownership, not a PID/process-tree scavenger. Signal delivery is
 * never exit acknowledgement. Native PTY descendants are outside this guarantee. */
export class HermesOwnedChild {
  ready = false;
  stopRequested = false;
  cleanupIncomplete = false;
  private exited = false;
  private readonly exit: Promise<void>;
  private stopOp: Promise<void> | undefined;

  constructor(readonly child: ServeChild, onExit: () => void) {
    this.exit = new Promise<void>((resolve) => {
      const finish = () => {
        if (this.exited) return;
        this.exited = true;
        resolve();
        onExit();
      };
      child.on('exit', finish);
      child.on('error', () => {
        // A failed spawn has no process. A runtime/kill error on a spawned child
        // says nothing about its liveness and must not release ownership.
        if (child.pid === undefined) finish();
      });
      if (child.exitCode !== null || child.signalCode != null) {
        this.exited = true;
        resolve();
      }
    });
  }

  get hasExited(): boolean { return this.exited; }

  stop(graceMs: number, killMs: number): Promise<void> {
    if (this.stopOp) return this.stopOp;
    this.stopRequested = true;
    const operation = this.terminate(graceMs, killMs);
    this.stopOp = operation;
    const clear = () => { if (this.stopOp === operation) this.stopOp = undefined; };
    operation.then(clear, clear);
    return operation;
  }

  private async terminate(graceMs: number, killMs: number): Promise<void> {
    if (!this.exited) {
      try { this.child.kill('SIGTERM'); } catch { /* Wait for evidence, not signal success. */ }
      if (!(await this.waitForExit(graceMs))) {
        try { this.child.kill('SIGKILL'); } catch { /* Still require exit acknowledgement. */ }
        await this.waitForExit(killMs);
      }
    }
    this.cleanupIncomplete = !this.exited;
    if (this.cleanupIncomplete) throw new Error(HERMES_CLEANUP_ERROR);
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.exited) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.exit, new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
      return this.exited;
    } finally { clearTimeout(timer); }
  }
}
