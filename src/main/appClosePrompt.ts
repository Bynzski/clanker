import { randomUUID } from 'node:crypto';
import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron';
import { APP_CLOSE_REQUEST } from '../shared/ipcChannels';

/** Presentation only. AppCloseGuard retains all admission and shutdown authority. */
export class AppClosePrompt {
  private ready: WebContents | undefined;
  private releaseReady: (() => void) | undefined;
  private pending: { id: string; owner: WebContents; finish: (answer: boolean) => void } | undefined;

  constructor(private readonly getWindow: () => BrowserWindow | null, private readonly timeoutMs = 120_000) {}

  private owns(event: IpcMainInvokeEvent): boolean {
    const window = this.getWindow();
    return !!window && !window.isDestroyed() && event.sender === window.webContents
      && event.senderFrame === event.sender.mainFrame;
  }

  setReady(event: IpcMainInvokeEvent, ready: unknown): void {
    if (!this.owns(event)) return;
    if (ready !== true) { this.invalidate(event.sender); return; }
    if (this.ready === event.sender) return;
    this.releaseReady?.();
    this.ready = event.sender;
    const owner = event.sender;
    const invalidate = () => {
      this.invalidate(owner);
    };
    this.releaseReady = () => {
      owner.removeListener('destroyed', invalidate);
      owner.removeListener('render-process-gone', invalidate);
      owner.removeListener('did-start-navigation', navigation);
    };
    const navigation = (_event: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
      if (isMainFrame && !isInPlace) invalidate();
    };
    owner.once('destroyed', invalidate);
    owner.once('render-process-gone', invalidate);
    owner.on('did-start-navigation', navigation);
  }

  private invalidate(owner: WebContents): void {
    if (this.ready === owner) {
      this.ready = undefined;
      this.releaseReady?.();
      this.releaseReady = undefined;
    }
    if (this.pending?.owner === owner) this.pending.finish(false);
  }

  respond(event: IpcMainInvokeEvent, id: unknown, answer: unknown): void {
    if (this.owns(event) && this.pending?.owner === event.sender && this.pending.id === id) {
      this.pending.finish(answer === true);
    }
  }

  request(signal: AbortSignal): Promise<boolean> {
    const window = this.getWindow();
    // Fail closed without a live, subscribed renderer. Never fall back to a destructive default.
    if (signal.aborted || !window || window.isDestroyed() || window.webContents.isDestroyed()
      || this.ready !== window.webContents || this.pending) return Promise.resolve(false);
    const owner = window.webContents;
    const id = randomUUID();
    return new Promise((resolve) => {
      const finish = (answer: boolean) => {
        if (this.pending?.id !== id) return;
        this.pending = undefined;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        try { if (!owner.isDestroyed()) owner.send(APP_CLOSE_REQUEST, null); }
        catch { /* Renderer loss cannot authorize shutdown or prevent settlement. */ }
        resolve(answer);
      };
      const cancel = () => finish(false);
      const timer = setTimeout(cancel, this.timeoutMs);
      this.pending = { id, owner, finish };
      signal.addEventListener('abort', cancel, { once: true });
      try { owner.send(APP_CLOSE_REQUEST, id); }
      catch { finish(false); }
    });
  }
}
