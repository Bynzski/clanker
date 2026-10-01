import { app } from 'electron';
import { spawn } from 'child_process';
import * as path from 'path';
import { HarnessCapabilityError, type ModelOption } from '../types';

const HERMES_GATEWAY_TIMEOUT_MS = 12000;
const HERMES_GATEWAY_REFRESH_TIMEOUT_MS = 45000;
const HERMES_GATEWAY_MAX_BYTES = 8 * 1024 * 1024;
function hermesModelOptionsRequest(refresh: boolean): string {
  return `${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'model.options',
    params: refresh ? { refresh: true } : {},
  })}\n`;
}

/** A malformed or empty response is not a successful catalog discovery. */
export function parseHermesModelOptions(output: string): ModelOption[] | null {
  let result: unknown;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      continue; // Gateway events and diagnostics may precede the response.
    }
    if (!message || typeof message !== 'object' || !('id' in message) || message.id !== 1) continue;
    if (!('jsonrpc' in message) || message.jsonrpc !== '2.0'
      || 'error' in message || !('result' in message)) return null;
    result = message.result;
    break;
  }
  if (!result || typeof result !== 'object' || !('providers' in result)
    || !Array.isArray(result.providers)) return null;

  const models: ModelOption[] = [];
  const seen = new Set<string>();
  for (const row of result.providers) {
    if (!row || typeof row !== 'object'
      || row.authenticated === false
      || typeof row.slug !== 'string' || !row.slug.trim()
      || typeof row.name !== 'string' || !row.name.trim()
      || !Array.isArray(row.models)) continue;
    for (const model of row.models) {
      if (typeof model !== 'string' || !model.trim()) continue;
      const id = `hermes-provider:${encodeURIComponent(row.slug)}:${encodeURIComponent(model)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      models.push({ id, label: `${model} · ${row.name}` });
    }
  }
  return models.length ? models : null;
}

export function runHermesModelOptions(refresh = false): Promise<string> {
  const root = path.join(app.getPath('home'), '.hermes', 'hermes-agent');
  const python = process.env.HERMES_PYTHON?.trim()
    || path.join(root, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const pyPath = process.env.PYTHONPATH?.trim();
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((onSuccess, onFailure) => {
    resolve = onSuccess;
    reject = onFailure;
  });
  const child = spawn(python, ['-m', 'tui_gateway.entry'], {
    cwd: root,
    env: {
      ...process.env,
      PYTHONPATH: pyPath ? `${root}${path.delimiter}${pyPath}` : root,
      HERMES_PYTHON_SRC_ROOT: root,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  let bytes = 0;
  let settled = false;
  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    child.kill();
    reject(error);
  };
  const timer = setTimeout(
    () => fail(new Error('Hermes gateway timed out')),
    refresh ? HERMES_GATEWAY_REFRESH_TIMEOUT_MS : HERMES_GATEWAY_TIMEOUT_MS
  );
  child.stdout.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > HERMES_GATEWAY_MAX_BYTES) {
      fail(new Error('Hermes gateway output exceeded limit'));
      return;
    }
    stdout.push(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > HERMES_GATEWAY_MAX_BYTES) fail(new Error('Hermes gateway output exceeded limit'));
  });
  child.on('error', fail);
  child.on('close', (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
    else reject(new Error(`Hermes gateway exited with code ${code}`));
  });
  child.stdin.on('error', fail);
  child.stdin.end(hermesModelOptionsRequest(refresh));
  return promise;
}

export async function discoverModels(refresh = false): Promise<ModelOption[]> {
  const models = parseHermesModelOptions(await runHermesModelOptions(refresh));
  if (!models) throw new HarnessCapabilityError('parse-failure', 'Malformed Hermes model options');
  return models;
}
