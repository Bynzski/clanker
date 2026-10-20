import { describe, expect, it } from 'vitest';
import { resolveBrowserAddress } from '../../../src/renderer/lib/browserAddress';

describe('browser address intent', () => {
  it.each(['chat', '8000', 'react useEffect cleanup', 'café & tea #1', 'how does example.com work?'])('searches ordinary text %s', input => {
    expect(resolveBrowserAddress(`  ${input}  `)).toMatchObject({ kind: 'search', url: `https://www.google.com/search?q=${encodeURIComponent(input)}` });
  });

  it.each([
    ['example.com/docs?q=hello#section', 'https://example.com/docs?q=hello#section'],
    ['https://example.com', 'https://example.com'],
    ['example.com/my report?q=some text', 'https://example.com/my report?q=some text'],
    ['http://intranet:8000', 'http://intranet:8000'],
    ['localhost', 'http://localhost'],
    ['localhost:8000/app', 'http://localhost:8000/app'],
    ['127.0.0.1:5173', 'http://127.0.0.1:5173'],
    ['[::1]:8000', 'http://[::1]:8000'],
    ['192.168.1.10:8000', 'https://192.168.1.10:8000'],
    ['例え.jp', 'https://例え.jp'],
    ['file:///tmp/report.html', 'file:///tmp/report.html'],
    ['/tmp/my report #1?.html', 'file:///tmp/my%20report%20%231%3F.html'],
    ['C:\\Users\\Jay\\my report #1.html', 'file:///C:/Users/Jay/my%20report%20%231.html'],
  ])('opens address %s', (input, url) => {
    expect(resolveBrowserAddress(input)).toMatchObject({ kind: 'navigate', url });
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'https://', 'https://bad host', 'file://server/share', 'localhost:99999'])('rejects explicit invalid addresses without searching: %s', input => {
    expect(resolveBrowserAddress(input)?.kind).toBe('invalid');
  });

  it('ignores blank input', () => expect(resolveBrowserAddress('   ')).toBeNull());
});
