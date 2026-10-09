import { AsyncLocalStorage } from 'node:async_hooks';

export const VCS_REQUEST_DEADLINE_MS = 10_000;
export interface VcsRequestOptions {
  signal?: AbortSignal;
  /** May shorten, never extend, the production budget. */
  timeoutMs?: number;
}
interface RequestBudget { signal: AbortSignal; deadline: number; cancel: () => void }
const budgets = new AsyncLocalStorage<RequestBudget>();

export function currentVcsBudget(): RequestBudget | undefined {
  return budgets.getStore();
}

export function assertVcsBudget(): void {
  const budget = currentVcsBudget();
  if (budget?.signal.aborted || (budget && Date.now() >= budget.deadline)) {
    throw new DOMException('Provider request cancelled or deadline exhausted', 'AbortError');
  }
}

/** Main-only request scope: concurrent calls never mutate a shared provider signal. */
export async function withVcsBudget<T>(operation: () => Promise<T>, options: VcsRequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const requested = options.timeoutMs ?? VCS_REQUEST_DEADLINE_MS;
  const timeoutMs = Number.isFinite(requested) ? Math.max(0, Math.min(requested, VCS_REQUEST_DEADLINE_MS)) : VCS_REQUEST_DEADLINE_MS;
  const deadline = Date.now() + timeoutMs;
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    return await budgets.run({ signal: controller.signal, deadline, cancel: abort }, operation);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

/** Cancellable retry backoff, with no timer/listener left after completion. */
export function vcsRetryDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Provider request cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
