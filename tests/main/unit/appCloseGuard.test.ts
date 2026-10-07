import { describe, expect, it, vi } from 'vitest';
import { AppCloseGuard } from '../../../src/main/appCloseGuard';

const event = () => ({ preventDefault: vi.fn() });
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function fixture(windowCloseQuitsApp = true) {
  let answer!: (confirmed: boolean) => void;
  const hasRunningWork = vi.fn().mockReturnValue(true);
  const confirmClose = vi.fn((signal: AbortSignal) => { void signal; return new Promise<boolean>((resolve) => { answer = resolve; }); });
  const closeWindow = vi.fn();
  const quit = vi.fn();
  const onError = vi.fn();
  const guard = new AppCloseGuard({ hasRunningWork, confirmClose, closeWindow, quit, onError, windowCloseQuitsApp });
  return { guard, hasRunningWork, confirmClose, closeWindow, quit, onError, answer: (value: boolean) => answer(value) };
}

describe('main-owned close admission', () => {
  it('allows an empty app/window to close without prompting', async () => {
    const f = fixture(); f.hasRunningWork.mockReturnValue(false);
    const close = event(), quit = event();
    f.guard.beforeWindowClose(close);
    expect(f.guard.beforeQuit(quit)).toBe(true);
    await settle();
    expect(close.preventDefault).not.toHaveBeenCalled();
    expect(quit.preventDefault).not.toHaveBeenCalled();
    expect(f.confirmClose).not.toHaveBeenCalled();
  });

  it.each(['window', 'quit'] as const)('cancel keeps live work untouched on %s close', async (intent) => {
    const f = fixture(), request = event();
    if (intent === 'window') f.guard.beforeWindowClose(request);
    else expect(f.guard.beforeQuit(request)).toBe(false);
    expect(request.preventDefault).toHaveBeenCalledOnce();
    await settle();
    f.answer(false); await settle();
    expect(f.closeWindow).not.toHaveBeenCalled();
    expect(f.quit).not.toHaveBeenCalled();
    // Cancellation grants nothing: a fresh attempt asks again.
    f.guard.beforeWindowClose(event()); await settle();
    expect(f.confirmClose).toHaveBeenCalledTimes(2);
  });

  it('shares one prompt across repeated close, quit and Windows session-end attempts', async () => {
    const f = fixture();
    const attempts = [event(), event(), event(), event()];
    f.guard.beforeWindowClose(attempts[0]);
    f.guard.beforeWindowClose(attempts[1]);
    expect(f.guard.beforeQuit(attempts[2])).toBe(false);
    f.guard.beforeSessionEnd(attempts[3]);
    await settle();
    expect(f.confirmClose).toHaveBeenCalledOnce();
    for (const attempt of attempts) expect(attempt.preventDefault).toHaveBeenCalledOnce();
    f.answer(true); await settle();
    expect(f.quit).toHaveBeenCalledOnce();
    expect(f.closeWindow).not.toHaveBeenCalled();
    const approved = event();
    expect(f.guard.beforeQuit(approved)).toBe(true);
    f.guard.beforeWindowClose(approved);
    expect(approved.preventDefault).not.toHaveBeenCalled();
    expect(f.confirmClose).toHaveBeenCalledOnce();
  });

  it('confirmed Linux/Windows window close allows its recursive close and subsequent app quit', async () => {
    const f = fixture();
    f.closeWindow.mockImplementation(() => {
      const repeated = event();
      f.guard.beforeWindowClose(repeated);
      expect(repeated.preventDefault).not.toHaveBeenCalled();
      expect(f.guard.beforeQuit(repeated)).toBe(true);
    });
    f.guard.beforeWindowClose(event()); await settle(); f.answer(true); await settle();
    expect(f.closeWindow).toHaveBeenCalledOnce();
    expect(f.confirmClose).toHaveBeenCalledOnce();
  });

  it('confirmed macOS window close does not authorize a later app quit', async () => {
    const f = fixture(false);
    f.closeWindow.mockImplementation(() => f.guard.beforeWindowClose(event()));
    f.guard.beforeWindowClose(event()); await settle(); f.answer(true); await settle();
    f.guard.windowClosed();
    expect(f.guard.beforeQuit(event())).toBe(false);
    await settle();
    expect(f.confirmClose).toHaveBeenCalledTimes(2);
    expect(f.hasRunningWork).toHaveBeenCalledWith('window');
    expect(f.hasRunningWork).toHaveBeenCalledWith('quit');
  });

  it('an idle Windows session-end query gives no persistent approval if shutdown is cancelled elsewhere', async () => {
    const f = fixture(); f.hasRunningWork.mockReturnValue(false);
    const query = event(); f.guard.beforeSessionEnd(query);
    expect(query.preventDefault).not.toHaveBeenCalled();
    f.hasRunningWork.mockReturnValue(true);
    expect(f.guard.beforeQuit(event())).toBe(false);
    await settle(); expect(f.confirmClose).toHaveBeenCalledOnce();
  });

  it('confirmed Windows session end proceeds through app quit with no second prompt', async () => {
    const f = fixture(), query = event();
    f.guard.beforeSessionEnd(query); await settle();
    expect(query.preventDefault).toHaveBeenCalledOnce();
    f.answer(true); await settle();
    expect(f.quit).toHaveBeenCalledOnce();
    expect(f.guard.beforeQuit(event())).toBe(true);
  });

  it('explicit programmatic approval aborts a pending dialog and ignores its late response', async () => {
    const f = fixture();
    f.guard.beforeWindowClose(event()); await settle();
    const signal = f.confirmClose.mock.calls[0][0];
    f.guard.authorizeQuit();
    expect(signal.aborted).toBe(true);
    f.answer(true); await settle();
    expect(f.closeWindow).not.toHaveBeenCalled();
    expect(f.quit).not.toHaveBeenCalled();
    expect(f.guard.beforeQuit(event())).toBe(true);
  });

  it('approval before native dialog entry suppresses the dialog altogether', async () => {
    const f = fixture();
    f.guard.beforeWindowClose(event());
    f.guard.authorizeQuit(); await settle();
    expect(f.confirmClose).not.toHaveBeenCalled();
  });

  it('a destroyed dialog parent cannot close a replacement window on late approval', async () => {
    const f = fixture();
    f.guard.beforeWindowClose(event()); await settle();
    const signal = f.confirmClose.mock.calls[0][0];
    f.guard.windowClosed();
    expect(signal.aborted).toBe(true);
    f.answer(true); await settle();
    expect(f.closeWindow).not.toHaveBeenCalled();
    expect(f.quit).not.toHaveBeenCalled();
    f.guard.beforeWindowClose(event()); await settle();
    expect(f.confirmClose).toHaveBeenCalledTimes(2);
  });

  it('dialog failure keeps work alive and allows another attempt', async () => {
    const f = fixture();
    f.confirmClose.mockRejectedValueOnce(new Error('Dialog unavailable'));
    f.guard.beforeWindowClose(event()); await settle();
    expect(f.onError).toHaveBeenCalledOnce();
    expect(f.closeWindow).not.toHaveBeenCalled();
    expect(f.quit).not.toHaveBeenCalled();
    f.guard.beforeWindowClose(event()); await settle();
    expect(f.confirmClose).toHaveBeenCalledTimes(2);
  });
});
