import * as net from 'node:net';
import { normalizeTrustedAppBrowserUrl } from './security';
import type { RecipePreviewProbeResult } from '../shared/types/recipes';

const PREVIEW_WAIT_MS = 5000;
const PREVIEW_RETRY_MS = 200;
const CONNECT_TIMEOUT_MS = 250;

function connectOnce(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ready);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => finish(false));
  });
}

async function isPortReachable(host: string, port: number): Promise<boolean> {
  const hosts = host === 'localhost' ? ['127.0.0.1', '::1'] : [host];
  const results = await Promise.all(hosts.map((candidate) => connectOnce(candidate, port)));
  return results.some(Boolean);
}

/** Probe only a recipe's configured loopback URL after normal browser URL validation. */
export async function probeRecipePreview(rawUrl: string, waitForReady: boolean): Promise<RecipePreviewProbeResult> {
  const safeUrl = normalizeTrustedAppBrowserUrl(rawUrl);
  if (!safeUrl) return { status: 'invalid', error: 'Invalid preview URL' };
  const parsed = new URL(safeUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { status: 'remote' };
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return { status: 'remote' };
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  const deadline = Date.now() + (waitForReady ? PREVIEW_WAIT_MS : 0);
  do {
    if (await isPortReachable(host, port)) return { status: 'ready', host, port };
    if (!waitForReady || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(PREVIEW_RETRY_MS, deadline - Date.now())));
  } while (Date.now() < deadline);
  return { status: 'unavailable', host, port };
}
