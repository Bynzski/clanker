/** Wait after a workspace becomes active before any background warm-up, to keep it clear of the opening burst. */
export const WARMUP_DELAY_MS = 3000;
/** Upper bound on waiting for an idle moment once the delay has passed. */
const IDLE_TIMEOUT_MS = 2000;

/**
 * Best-effort delayed prefetch: runs `task` after `delayMs`, then at the next renderer idle moment
 * (forced after a timeout; immediately where requestIdleCallback is missing). Renderer idleness says
 * nothing about main-process or agent startup, so this lowers contention but guarantees nothing.
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
