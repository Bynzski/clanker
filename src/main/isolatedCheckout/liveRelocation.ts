import type { AgentAttentionChange, AgentAttentionSnapshot } from '../../shared/types/agentAttention';
import type { CheckoutContext } from '../../shared/types/checkoutContext';
import type { HarnessCheckoutRehomeCapability } from '../harnesses/types';

export interface LiveRelocationRequest {
  terminalId: string;
  sessionId: string;
  source: CheckoutContext;
  target: CheckoutContext;
  baseline: Pick<AgentAttentionSnapshot, 'revision' | 'sessionId' | 'runtime' | 'location'>;
  signal: AbortSignal;
  invoke: NonNullable<HarnessCheckoutRehomeCapability['relocateLiveConversation']>;
  /** Rechecks workspace, terminal, context and native root/turn identity. */
  isCurrent(): boolean;
  /** Synchronous compare-and-rebind of terminal AND bridge authority; false changes nothing. */
  commit(): boolean;
}

interface Pending {
  request: LiveRelocationRequest;
  confirm(): void;
  cancel(): void;
}

/** Main-owned proof gate. An API response, an old snapshot, or an arbitrary cd never commits a move. */
export class LiveCheckoutRelocation {
  private readonly pending = new Map<string, Pending>();
  private stopped = false;

  constructor(private readonly deadlineMs = 12_000) {}

  onAttentionChange(change: AgentAttentionChange): void {
    const pending = this.pending.get(change.terminalId);
    if (!pending) return;
    const { request } = pending;
    const snapshot = change.snapshot;
    if (snapshot && (snapshot.terminalId !== request.terminalId || snapshot.revision !== change.revision)) return;
    if (!snapshot || snapshot.sessionId !== request.sessionId) {
      pending.cancel();
      return;
    }
    if (snapshot.revision <= request.baseline.revision) return;
    if (snapshot.runtime.status !== 'running' || snapshot.runtime.turnId !== request.baseline.runtime.turnId) {
      pending.cancel();
      return;
    }
    // The broker publishes only authenticated root location evidence. It resolves containment against
    // registered contexts, including symlinks locally; a model path or a child event cannot reach here.
    if (snapshot.location?.checkoutContextId === request.target.id && request.isCurrent()) pending.confirm();
  }

  shutdown(): void {
    this.stopped = true;
    for (const pending of this.pending.values()) pending.cancel();
  }

  async relocate(request: LiveRelocationRequest): Promise<void> {
    if (this.stopped || this.pending.has(request.terminalId) || !request.isCurrent()
      || request.baseline.sessionId !== request.sessionId || request.baseline.runtime.status !== 'running'
      || !request.baseline.runtime.turnId || request.baseline.location?.checkoutContextId === request.target.id || request.signal.aborted) {
      throw new Error('Live checkout relocation is not available for this turn');
    }
    const controller = new AbortController();
    let confirm!: () => void;
    let cancel!: () => void;
    const proof = new Promise<void>((resolve) => { confirm = resolve; });
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => { controller.abort(); reject(new Error('Live checkout relocation was cancelled or could not be confirmed')); };
    });
    const pending: Pending = { request, confirm, cancel };
    this.pending.set(request.terminalId, pending);
    const timer = setTimeout(cancel, this.deadlineMs);
    request.signal.addEventListener('abort', cancel, { once: true });
    try {
      // Install the proof gate BEFORE invoking: hooks may report movement before the API settles.
      await Promise.race([
        Promise.all([proof, Promise.resolve().then(() => request.invoke({
          terminalId: request.terminalId, sessionId: request.sessionId,
          source: request.source, target: request.target, signal: controller.signal,
        }))]),
        cancelled,
      ]);
      if (this.stopped || controller.signal.aborted || request.signal.aborted || !request.isCurrent() || !request.commit()) {
        throw new Error('The conversation or checkout changed before live relocation could commit');
      }
    } finally {
      controller.abort();
      clearTimeout(timer);
      request.signal.removeEventListener('abort', cancel);
      if (this.pending.get(request.terminalId) === pending) this.pending.delete(request.terminalId);
    }
  }
}
