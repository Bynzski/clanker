export type CloseIntent = 'window' | 'quit';
interface CloseEvent { preventDefault(): void }

interface AppCloseGuardOptions {
  hasRunningWork(intent: CloseIntent): boolean;
  confirmClose(signal: AbortSignal): Promise<boolean>;
  closeWindow(): void;
  quit(): void;
  /** Closing the last window quits on Linux/Windows, but not on macOS. */
  windowCloseQuitsApp: boolean;
  onError(error: unknown): void;
}

/** Main-owned admission to existing teardown; nothing is cleaned up before approval. */
export class AppCloseGuard {
  private quitAuthorized = false;
  private windowAuthorized = false;
  private pending: { intent: CloseIntent; controller: AbortController } | undefined;

  constructor(private readonly options: AppCloseGuardOptions) {}

  /** Returns true only when the caller may begin the existing quit cleanup. */
  beforeQuit(event: CloseEvent): boolean { return this.admit(event, 'quit'); }

  beforeWindowClose(event: CloseEvent): void { this.admit(event, 'window'); }

  /** Windows may cancel system shutdown elsewhere after this query; no lasting approval when idle. */
  beforeSessionEnd(event: CloseEvent): void {
    if (this.pending || this.options.hasRunningWork('quit')) this.admit(event, 'quit');
  }

  /** Fatal exit / already-confirmed programmatic quit must not show a second prompt. */
  authorizeQuit(): void {
    this.quitAuthorized = true;
    this.cancelPending();
  }

  /** A destroyed parent must not let a late dialog result close a replacement window. */
  windowClosed(): void { this.cancelPending(); }

  private cancelPending(): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.controller.abort();
  }

  private admit(event: CloseEvent, intent: CloseIntent): boolean {
    if (this.quitAuthorized || (intent === 'window' && this.windowAuthorized)) return true;
    if (this.pending) {
      event.preventDefault();
      // A quit request arriving during a window-close prompt shares its answer.
      if (intent === 'quit') this.pending.intent = 'quit';
      return false;
    }
    if (!this.options.hasRunningWork(intent)) {
      if (intent === 'quit') this.quitAuthorized = true;
      return true;
    }

    event.preventDefault();
    const pending = { intent, controller: new AbortController() };
    this.pending = pending;
    // Reserve the prompt synchronously before entering native dialog code.
    void Promise.resolve().then(() => this.pending === pending
      ? this.options.confirmClose(pending.controller.signal) : false).then((confirmed) => {
      if (this.pending !== pending) return;
      this.pending = undefined;
      if (!confirmed) return;
      if (pending.intent === 'quit') {
        this.quitAuthorized = true;
        this.options.quit();
      } else {
        if (this.options.windowCloseQuitsApp) this.quitAuthorized = true;
        this.windowAuthorized = true;
        try { this.options.closeWindow(); }
        finally { this.windowAuthorized = false; }
      }
    }).catch((error: unknown) => {
      if (this.pending === pending) this.pending = undefined;
      // Dialog failure keeps the application open; a later attempt can retry.
      this.options.onError(error);
    });
    return false;
  }
}
