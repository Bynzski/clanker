import { findTerminalUrls } from '../../shared/terminalUrls';
import type { RemoteWebEndpoint } from './sshPortDiscovery';
import { isPreviewPort } from '../../shared/types/remotePreview';

/** Per-terminal bounded row parser. Only complete rows can supply a port, so
 * split chunks cannot mistake localhost:51 + 73 for port 51. No renderer input. */
export function createTerminalPreviewSignal(notify: (endpoint: RemoteWebEndpoint) => void): (data: string) => void {
  let row = '', escape: 'plain' | 'esc' | 'csi' | 'osc' | 'osc-esc' = 'plain', overflow = false;
  const recent = new Map<string, number>();
  const complete = () => {
    if (!overflow) for (const match of findTerminalUrls(row)) {
      const url = new URL(match.target);
      const host = url.hostname.toLowerCase();
      if (!['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '[::]'].includes(host) || url.username || url.password) continue;
      const port = Number(url.port);
      if (!isPreviewPort(port)) continue;
      const remoteHost = host.startsWith('[') ? '::1' as const : '127.0.0.1' as const;
      const key = `${remoteHost}:${port}`;
      if (Date.now() - (recent.get(key) ?? -Infinity) < 5000) continue;
      if (recent.size >= 8) recent.delete(recent.keys().next().value!);
      recent.set(key, Date.now()); notify({ remoteHost, remotePort: port });
    }
    row = ''; overflow = false;
  };
  return (data) => {
    for (const char of data) {
      // Skip ANSI CSI and OSC (including OSC hyperlink targets), across chunks.
      if (escape === 'osc') { if (char === '\x07') escape = 'plain'; else if (char === '\x1b') escape = 'osc-esc'; continue; }
      if (escape === 'osc-esc') { escape = char === '\\' ? 'plain' : 'osc'; continue; }
      if (escape === 'csi') { if (char >= '@' && char <= '~') escape = 'plain'; continue; }
      if (escape === 'esc') { escape = char === '[' ? 'csi' : char === ']' ? 'osc' : 'plain'; continue; }
      if (char === '\x1b') { escape = 'esc'; continue; }
      if (char === '\n' || char === '\r') { complete(); continue; }
      if (row.length >= 4096) { overflow = true; continue; }
      if (char >= ' ' && char !== '\x7f') row += char;
    }
  };
}
