import * as http from 'node:http';
import * as https from 'node:https';
import { createServer } from 'node:net';

/** OS allocation is loopback-only. The manager retains the numeric reservation
 * through child cleanup; the unavoidable close→ssh handoff race is retried. */
export async function allocatePreviewPort(preferred: number, reserved: ReadonlySet<number>): Promise<number> {
  async function reserve(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
        const address = server.address();
        if (!address || typeof address === 'string') { server.close(); reject(new Error('Invalid local listener')); return; }
        const selected = address.port;
        server.close((error) => error ? reject(error) : resolve(selected));
      });
    });
  }
  if (!reserved.has(preferred)) {
    try { return await reserve(preferred); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' && (error as NodeJS.ErrnoException).code !== 'EACCES') throw error;
    }
  }
  for (let attempt = 0; attempt < 8; attempt++) { const port = await reserve(0); if (!reserved.has(port)) return port; }
  throw new Error('Could not allocate a local preview port');
}
/** Read only response headers through the existing tunnel; never follow redirects,
 * fetch bodies or execute a fresh SSH command. Development TLS may be self-signed. */
export function probePreviewUrl(url: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' || !['http:', 'https:'].includes(parsed.protocol) || signal.aborted) { resolve(false); return; }
    const request = (parsed.protocol === 'https:' ? https : http).request(parsed, {
      method: 'HEAD', signal, rejectUnauthorized: false, maxHeaderSize: 8192,
    }, (response) => { response.destroy(); resolve(true); });
    request.once('error', () => resolve(false));
    const timer = setTimeout(() => { request.destroy(); resolve(false); }, 1500);
    timer.unref();
    request.once('close', () => clearTimeout(timer));
    request.end();
  });
}
