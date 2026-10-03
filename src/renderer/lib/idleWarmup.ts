/** Wait after a workspace becomes active before any background warm-up, so opening it is never contended. */
export const WARMUP_DELAY_MS = 3000;
/** Upper bound on waiting for an idle moment once the delay has passed. */
const IDLE_TIMEOUT_MS = 2000;

/**
 * Runs `task` after `delayMs`, then at the next idle moment, so background prefetches
 * (conversation history, usage) never compete with a workspace opening its terminals.
 * Returns a cancel function.
 */
export function scheduleIdleWarmup(task: () => void, delayMs = WARMUP_DELAY_MS): () => void {
  let idleHandle: number | undefined;
  const timer = setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(() => { idleHandle = undefined; task(); }, { timeout: IDLE_TIMEOUT_MS });
    } else {
      task();
    }
  }, delayMs);
  return () => {
    clearTimeout(timer);
    if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle);
  };
}
