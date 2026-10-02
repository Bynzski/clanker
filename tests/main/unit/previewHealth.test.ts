import { createServer } from 'node:net';
import * as http from 'node:http';
import { expect, it } from 'vitest';
import { allocatePreviewPort, probePreviewUrl } from '../../../src/main/remote/previewHealth';
it('allocates exclusively on loopback and falls back when the preferred port is occupied', async () => {
  const server = createServer(); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
  expect(address.address).toBe('127.0.0.1');
  const port = await allocatePreviewPort(address.port, new Set()); expect(port).not.toBe(address.port);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  expect(await allocatePreviewPort(address.port, new Set())).toBe(address.port);
});
it('probes only HTTP headers on desktop loopback and distinguishes an unavailable service', async () => {
  const server = http.createServer((_, response) => { response.writeHead(404); response.end(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
  const controller = new AbortController();
  expect(await probePreviewUrl(`http://127.0.0.1:${address.port}`, controller.signal)).toBe(true);
  expect(await probePreviewUrl('http://192.168.1.2:3000', controller.signal)).toBe(false);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  expect(await probePreviewUrl(`http://127.0.0.1:${address.port}`, controller.signal)).toBe(false);
  controller.abort(); expect(await probePreviewUrl(`http://127.0.0.1:${address.port}`, controller.signal)).toBe(false);
});
