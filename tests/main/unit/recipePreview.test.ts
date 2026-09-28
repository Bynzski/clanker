import { describe, it, expect } from 'vitest';
import * as net from 'node:net';
import { probeRecipePreview } from '../../../src/main/recipePreview';

async function listen(server: net.Server, port = 0): Promise<number> {
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  return address.port;
}

async function close(server: net.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('recipe preview loopback probe', () => {
  it('reports a port already occupied before launch', async () => {
    const server = net.createServer();
    const port = await listen(server);
    try {
      expect(await probeRecipePreview(`http://127.0.0.1:${port}`, false))
        .toEqual({ status: 'ready', host: '127.0.0.1', port });
    } finally {
      await close(server);
    }
  });

  it('waits for a local preview that becomes reachable after a delay', async () => {
    const reservation = net.createServer();
    const port = await listen(reservation);
    await close(reservation);
    const server = net.createServer();
    const start = setTimeout(() => { void listen(server, port); }, 300);
    try {
      expect(await probeRecipePreview(`http://localhost:${port}`, true))
        .toEqual({ status: 'ready', host: 'localhost', port });
    } finally {
      clearTimeout(start);
      await close(server);
    }
  }, 10000);

  it('reports an unavailable local preview after the bounded wait', async () => {
    const reservation = net.createServer();
    const port = await listen(reservation);
    await close(reservation);
    expect(await probeRecipePreview(`http://127.0.0.1:${port}`, true))
      .toEqual({ status: 'unavailable', host: '127.0.0.1', port });
  }, 10000);

  it('does not probe remote URLs and rejects unsafe URL schemes', async () => {
    expect(await probeRecipePreview('https://example.com', true)).toEqual({ status: 'remote' });
    expect(await probeRecipePreview('javascript:alert(1)', false)).toEqual({ status: 'invalid', error: 'Invalid preview URL' });
  });
});
