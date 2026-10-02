import { expect, it, vi } from 'vitest';
import { createTerminalPreviewSignal } from '../../../src/main/remote/terminalPreviewSignal';
it('extracts only complete remote loopback URLs, reusing terminal link normalization', () => {
  const notify = vi.fn(), read = createTerminalPreviewSignal(notify);
  read('\x1b[32mLocal: http://localhost:51'); expect(notify).not.toHaveBeenCalled();
  read('73/docs).\x1b[0m\r\n');
  read('https://[::1]:6006/\nhttp://0.0.0.0:8080\n');
  expect(notify.mock.calls).toEqual([[{ remoteHost: '127.0.0.1', remotePort: 5173 }], [{ remoteHost: '::1', remotePort: 6006 }], [{ remoteHost: '127.0.0.1', remotePort: 8080 }]]);
});
it('ignores LAN, privileged ports, secrets, hidden OSC targets and oversized lines', () => {
  const notify = vi.fn(), read = createTerminalPreviewSignal(notify);
  read('http://10.0.0.1:5173\nhttp://localhost:80\nhttp://user:secret@localhost:5173\n');
  read('\x1b]8;;http://localhost:'); read('5173\x1b\\label\x1b]8;;\x07\n');
  read('x'.repeat(4096) + 'http://localhost:5173\n'); expect(notify).not.toHaveBeenCalled();
  read('http://localhost:5173\n'); expect(notify).toHaveBeenCalledTimes(1);
});
it('deduplicates repeated output without blocking a changed port or later restart', () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(10000);
  const notify = vi.fn(), read = createTerminalPreviewSignal(notify);
  read('http://localhost:5173\n'.repeat(10)); read('http://localhost:5174\n');
  expect(notify).toHaveBeenCalledTimes(2);
  now.mockReturnValue(16000); read('http://localhost:5173\n'); expect(notify).toHaveBeenCalledTimes(3);
  now.mockRestore();
});
