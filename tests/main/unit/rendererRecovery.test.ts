import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserWindow, dialog } from 'electron';
import { createMainWindow } from '../../../src/main/windowManager';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
  BrowserWindow: vi.fn(), Menu: { setApplicationMenu: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function fixture() {
  vi.stubEnv('NODE_ENV', 'production');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const contents = Object.assign(new EventEmitter(), {
    id: 42, reload: vi.fn(), isDestroyed: vi.fn(() => false),
  });
  const window = Object.assign(new EventEmitter(), {
    setMenuBarVisibility: vi.fn(), setAutoHideMenuBar: vi.fn(), loadFile: vi.fn(),
    isDestroyed: vi.fn(() => false), webContents: contents,
  });
  vi.mocked(BrowserWindow).mockImplementation(function () { return window as never; });
  let respond!: (value: { response: number; checkboxChecked: boolean }) => void;
  vi.mocked(dialog.showMessageBox).mockReset().mockImplementation(() => new Promise(resolve => { respond = resolve; }));
  const teardown = vi.fn();
  createMainWindow({ preloadPath: '/preload.js', gitService: { stopPolling: vi.fn() },
    fileWatcher: { unwatchAll: vi.fn() }, onRendererGone: teardown });
  const crash = (reason = 'crashed') => contents.emit('render-process-gone', {}, { reason, exitCode: 139 });
  return { window, contents, log, teardown, crash, respond: (response: number) => respond({ response, checkboxChecked: false }) };
}

describe('native renderer recovery', () => {
  it('logs production crashes, tears down first, and reloads only on consent', async () => {
    const f = fixture();
    f.crash();
    expect(f.teardown).toHaveBeenCalledOnce();
    expect(f.log).toHaveBeenCalledWith(expect.stringContaining('reason=crashed exitCode=139'));
    expect(dialog.showMessageBox).toHaveBeenCalledWith(f.window, expect.objectContaining({ cancelId: 1 }));
    expect(f.contents.reload).not.toHaveBeenCalled();
    f.respond(0);
    await vi.waitFor(() => expect(f.contents.reload).toHaveBeenCalledOnce());
  });

  it('does not prompt for a clean exit', () => {
    const f = fixture();
    f.crash('clean-exit');
    expect(f.teardown).toHaveBeenCalledOnce();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it.each(['decline', 'close', 'navigation', 'destroyed', 'contents-destroyed'])('does not reload after %s', async reason => {
    const f = fixture();
    f.crash();
    if (reason === 'close') f.window.emit('close', {});
    if (reason === 'navigation') f.contents.emit('did-start-navigation', {}, 'file:///app', false, true);
    if (reason === 'destroyed') f.window.isDestroyed.mockReturnValue(true);
    if (reason === 'contents-destroyed') f.contents.isDestroyed.mockReturnValue(true);
    f.respond(reason === 'decline' ? 1 : 0);
    await new Promise(resolve => setImmediate(resolve));
    expect(f.contents.reload).not.toHaveBeenCalled();
  });

  it('deduplicates pending prompts and permits a later explicit recovery', async () => {
    const f = fixture();
    f.crash();
    f.crash('oom');
    expect(dialog.showMessageBox).toHaveBeenCalledOnce();
    f.respond(0);
    await vi.waitFor(() => expect(f.contents.reload).toHaveBeenCalledOnce());
    f.crash('oom');
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
    f.respond(1);
  });

  it('handles native dialog failure without an unhandled rejection', async () => {
    const f = fixture();
    vi.mocked(dialog.showMessageBox).mockRejectedValueOnce(new Error('dialog unavailable'));
    f.crash();
    await vi.waitFor(() => expect(f.log).toHaveBeenCalledWith('[clanker-grid] renderer recovery failed:', expect.any(Error)));
    expect(f.contents.reload).not.toHaveBeenCalled();
  });
});
