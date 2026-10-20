export type BrowserAddressAction =
  | { kind: 'navigate' | 'search'; url: string; label: string }
  | { kind: 'invalid'; error: string };

/** Only user-entered address-bar text gets search fallback. IPC still validates every URL. */
export function resolveBrowserAddress(raw: string): BrowserAddressAction | null {
  const value = raw.trim();
  if (!value) return null;

  const invalid = { kind: 'invalid', error: 'Enter a valid HTTP(S) address or absolute local file path.' } as const;
  const windowsPath = /^[a-z]:[\\/]/i.test(value);
  if (value.startsWith('/') || windowsPath) {
    const path = windowsPath ? value.replace(/\\/g, '/') : value;
    const encoded = path.split('/').map((part, index) => windowsPath && index === 0 ? part : encodeURIComponent(part)).join('/');
    return { kind: 'navigate', url: windowsPath ? `file:///${encoded}` : `file://${encoded}`, label: `Open ${value}` };
  }

  const explicitWeb = /^https?:/i.test(value);
  const explicitFile = /^file:/i.test(value);
  // Bare words and numbers are searches; hosts, IPv4/IPv6 and localhost are addresses.
  const authority = value.split(/[/?#]/, 1)[0];
  const addressLike = !/\s/.test(authority) && /^(?:localhost(?::\d+)?|\[[\da-f:]+\](?::\d+)?|[\p{L}\d_-]+(?:\.[\p{L}\d_-]+)+\.?(?::\d+)?)$/iu.test(authority);
  if (explicitWeb || explicitFile || addressLike) {
    try {
      const local = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(authority);
      const url = explicitWeb || explicitFile ? value : `${local ? 'http' : 'https'}://${value}`;
      const parsed = new URL(url);
      if (parsed.protocol === 'file:' && parsed.hostname && parsed.hostname !== 'localhost') return invalid;
      if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) return invalid;
      return { kind: 'navigate', url, label: `Open ${value}` };
    } catch {
      return invalid;
    }
  }

  if (/^[a-z][\w+.-]*:/i.test(value)) return invalid;
  return { kind: 'search', url: `https://www.google.com/search?q=${encodeURIComponent(value)}`, label: `Search Google for “${value}”` };
}
