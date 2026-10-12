import { EventEmitter } from 'node:events';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppClosePrompt } from '../../../src/main/appClosePrompt';
import { APP_CLOSE_REQUEST } from '../../../src/shared/ipcChannels';

function fixture() {
  const owner = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: vi.fn(() => false), send: vi.fn() });
  const window = { isDestroyed: () => false, webContents: owner } as unknown as BrowserWindow;
  let current: BrowserWindow | null = window;
  const event = { sender: owner, senderFrame: owner.mainFrame } as unknown as IpcMainInvokeEvent;
  const prompt = new AppClosePrompt(() => current, 1000);
  return { prompt, owner, event, replace: () => { current = null; }, ready: () => prompt.setReady(event, true),
    id: () => owner.send.mock.calls.find(([channel, id]) => channel === APP_CLOSE_REQUEST && id)?.[1] };
}
afterEach(() => vi.useRealTimers());
describe('renderer close prompt handshake', () => {
  it('requires a live subscribed main frame; rejects unsolicited, stale and foreign responses', async () => {
    const f = fixture();
    expect(await f.prompt.request(new AbortController().signal)).toBe(false);
    f.ready();
    f.prompt.respond(f.event, 'unsolicited', true);
    const result = f.prompt.request(new AbortController().signal);
    const settled = vi.fn(); void result.then(settled);
    f.prompt.respond(f.event, 'stale', true);
    f.prompt.respond({ ...f.event, senderFrame: {} } as IpcMainInvokeEvent, f.id(), true);
    f.prompt.respond({ ...f.event, sender: {} } as IpcMainInvokeEvent, f.id(), true);
    await Promise.resolve(); expect(settled).not.toHaveBeenCalled();
    f.prompt.respond(f.event, f.id(), true);
    expect(await result).toBe(true);
    expect(f.owner.send).toHaveBeenLastCalledWith(APP_CLOSE_REQUEST, null);
    f.replace(); expect(await f.prompt.request(new AbortController().signal)).toBe(false);
  });
  it('accepts only literal true and rejects duplicate requests', async () => {
    const f = fixture(); f.ready();
    const result = f.prompt.request(new AbortController().signal);
    expect(await f.prompt.request(new AbortController().signal)).toBe(false);
    f.prompt.respond(f.event, f.id(), 'true');
    expect(await result).toBe(false);
  });
  it.each(['abort', 'timeout', 'destroyed', 'render-process-gone', 'navigation', 'unmount', 'send-failure'])('fails closed on %s and permits a later retry', async (reason) => {
    vi.useFakeTimers(); const f = fixture(); f.ready();
    if (reason === 'send-failure') f.owner.send.mockImplementationOnce(() => { throw new Error('closed'); });
    const controller = new AbortController();
    const result = f.prompt.request(controller.signal);
    if (reason === 'abort') controller.abort();
    if (reason === 'timeout') vi.advanceTimersByTime(1000);
    if (reason === 'navigation') f.owner.emit('did-start-navigation', {}, 'file:///reload', false, true);
    if (reason === 'unmount') f.prompt.setReady(f.event, false);
    if (reason === 'destroyed' || reason === 'render-process-gone') f.owner.emit(reason);
    expect(await result).toBe(false);
    f.ready(); const retry = f.prompt.request(new AbortController().signal);
    const calls = f.owner.send.mock.calls.filter(([, id]) => id);
    const id = calls[calls.length - 1][1];
    f.prompt.respond(f.event, id, true); expect(await retry).toBe(true);
    f.prompt.setReady(f.event, false);
    expect(f.owner.listenerCount('did-start-navigation')).toBe(0);
  });
  it('does not invalidate on subframe or in-page navigation', async () => {
    const f = fixture(); f.ready(); const result = f.prompt.request(new AbortController().signal);
    f.owner.emit('did-start-navigation', {}, 'https://example.com', false, false);
    f.owner.emit('did-start-navigation', {}, 'file:///index#anchor', true, true);
    f.prompt.respond(f.event, f.id(), true); expect(await result).toBe(true);
    f.prompt.setReady(f.event, false);
  });
});
