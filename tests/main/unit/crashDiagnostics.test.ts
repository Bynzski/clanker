import { afterEach, describe, expect, it, vi } from 'vitest';
import { app, crashReporter } from 'electron';
import { startCrashDiagnostics } from '../../../src/main/crashDiagnostics';

vi.mock('electron', () => ({
  app: { get isPackaged() { return true; }, getVersion: vi.fn(() => '0.12.0'), getPath: vi.fn(() => '/profile/Crashpad') },
  crashReporter: { start: vi.fn() },
}));

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('local crash diagnostics', () => {
  it.each([
    [false, '0.12.0', undefined, true],
    [true, '0.12.0-dev.abc', undefined, true],
    [true, '0.12.0', undefined, false],
    [true, '0.12.0', '1', true],
    [false, '0.12.0', '0', false],
    [true, '0.12.0-dev.abc', '0', false],
    [true, '0.12.0-dev.abc', 'true', false],
    [true, '0.12.0', '', false],
  ])('packaged=%s version=%s override=%s enables=%s', (packaged, version, configured, enabled) => {
    vi.spyOn(app, 'isPackaged', 'get').mockReturnValue(packaged);
    vi.mocked(app.getVersion).mockReturnValue(version);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    startCrashDiagnostics(configured === undefined ? {} : { CLANKER_CRASH_DUMPS: configured });
    if (enabled) {
      expect(crashReporter.start).toHaveBeenCalledExactlyOnceWith({ uploadToServer: false, ignoreSystemCrashHandler: false });
      expect(log).toHaveBeenCalledWith(expect.stringContaining('/profile/Crashpad'));
    } else {
      expect(crashReporter.start).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    }
  });

  it('does not prevent startup when crash capture is unavailable', () => {
    vi.mocked(crashReporter.start).mockImplementationOnce(() => { throw new Error('unavailable'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => startCrashDiagnostics({ CLANKER_CRASH_DUMPS: '1' })).not.toThrow();
    expect(warn).toHaveBeenCalledWith('[clanker-grid] Local crash dump capture could not start:', expect.any(Error));
  });
});
