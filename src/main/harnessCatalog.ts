import { app } from 'electron';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { normalizePiModelId, resolveHarnessSpawn, type HarnessConfig } from './harnessLaunch';
import {
  ElectronStoreModelCache,
  DEFAULT_MODEL_CACHE_TTL_MS,
} from './modelCache';
import { prependUserCliBinsToPath, userCliBinPaths } from './platformShell';

// Module-level singleton for persistent model cache
const persistentModelCache = new ElectronStoreModelCache();
// Successful explicit refreshes invalidate older nonblocking Hermes warmups.
let hermesCatalogEpoch = 0;

export interface ModelOption {
  id: string;
  label: string;
}

export const HARNESS_OPTIONS: Record<string, HarnessConfig> = {
  codex: {
    name: 'Codex',
    command: 'codex',
    args: [],
    icon: '🧠',
    modelArg: '-m',
  },
  opencode: {
    name: 'OpenCode',
    command: 'opencode',
    args: [],
    icon: '⚡',
    modelArg: '-m',
    env: {
      OPENCODE_PERMISSION: JSON.stringify({
        bash: { '*': 'allow' },
        edit: 'allow',
      }),
    },
  },
  pi: {
    name: 'Pi',
    command: 'pi',
    args: [],
    icon: 'π',
    modelArg: '--model',
  },
  omp: {
    name: 'Oh My Pi',
    command: 'omp',
    args: [],
    icon: 'π',
    modelArg: '--model',
  },
  claude: {
    name: 'Claude',
    command: 'claude',
    args: [],
    icon: '✨',
    modelArg: '--model',
  },
  hermes: {
    name: 'Hermes',
    command: 'hermes',
    args: ['--tui'],
    icon: '☿',
    modelArg: '-m',
  },
};

const MODEL_DISCOVERY_FALLBACKS: Record<string, ModelOption[]> = {
  opencode: [
    { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'openai/gpt-4o', label: 'GPT-4o' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  ],
  pi: [],
};


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

function runHermesModelOptions(refresh = false): Promise<string> {
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


function runCommandOutput(
  command: string,
  args: string[],
  timeoutMs = 6000,
  extraEnv?: Record<string, string>,
  cwd?: string
): Promise<string> {
  const { spawnCmd, spawnArgs } = resolveHarnessSpawn(command, args, null);

  return new Promise((resolve, reject) => {
    execFile(spawnCmd, spawnArgs, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      cwd,
      env: {
        ...process.env,
        PATH: prependUserCliBinsToPath(process.env.PATH ?? '', app.getPath('home')),
        ...extraEnv,
      } as { [key: string]: string },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
        return;
      }

      resolve(String(stdout ?? '') || String(stderr ?? ''));
    });
  });
}

// ============================================================================
// Pure Parsing Functions (exported for testability)
// ============================================================================

/**
 * Normalize a model line by removing ANSI codes, prefixes, and trimming.
 */
export function normalizeModelLine(line: string): string {
  return line
    .replace(/\u001B\[[0-9;]*m/g, '')
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .trim();
}

/**
 * Parse model list from pi --list-models output.
 * Returns array of ModelOption with id in provider/model format.
 */
export function parsePiModels(output: string): ModelOption[] {
  if (/no models available/i.test(output)) {
    return [];
  }

  const lines = output
    .split(/\r?\n/)
    .map((line) => normalizeModelLine(line))
    .filter(Boolean);

  const models: ModelOption[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (/^(warning:|provider\s+model|─|─+|-+|=+|pi\s+-\s+ai coding assistant)/i.test(line)) {
      continue;
    }

    const cols = line.split(/\s{2,}|\t+/).map((part) => part.trim()).filter(Boolean);
    if (cols.length < 2) {
      continue;
    }

    const provider = cols[0];
    const model = cols[1];
    if (!model || seen.has(model)) {
      continue;
    }

    seen.add(model);
    models.push({
      id: normalizePiModelId(provider, model),
      label: `${provider}/${model}`,
    });
  }

  return models;
}

/**
 * Parse model list from opencode models command output.
 * Returns array of ModelOption with id matching the command output.
 */
export function parseOpenCodeModels(output: string): ModelOption[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => normalizeModelLine(line))
    .filter((line) => /^[-A-Za-z0-9_./:]+$/.test(line));

  const seen = new Set<string>();
  const models: ModelOption[] = [];

  for (const line of lines) {
    if (seen.has(line)) {
      continue;
    }
    seen.add(line);
    models.push({ id: line, label: line });
  }

  return models;
}

/** Return null for a malformed catalog so it is not stored as a successful empty result. */
function parseOmpModelCatalog(output: string): ModelOption[] | null {
  try {
    const data: unknown = JSON.parse(output);
    if (!data || typeof data !== 'object' || !('models' in data) || !Array.isArray(data.models)) return null;
    const seen = new Set<string>();
    const models: ModelOption[] = [];
    for (const entry of data.models) {
      if (!entry || typeof entry !== 'object' || entry.kind !== 'chat'
        || typeof entry.selector !== 'string' || !entry.selector || seen.has(entry.selector)) continue;
      seen.add(entry.selector);
      models.push({ id: entry.selector, label: entry.selector });
    }
    return models;
  } catch {
    return null;
  }
}

/** OMP's JSON catalog uses selector as the exact --model value. */
export function parseOmpModels(output: string): ModelOption[] {
  return parseOmpModelCatalog(output) ?? [];
}

/**
 * Parse model list from codex debug models JSON output.
 * Filters to visibility:"list" models only.
 */
export function parseCodexDebugModels(output: string): ModelOption[] {
  try {
    const data = JSON.parse(output) as {
      models?: Array<{ slug?: string; display_name?: string; visibility?: string }>;
    };
    return (data.models ?? [])
      .filter((m) => m.visibility === 'list' && m.slug)
      .map((m) => ({ id: m.slug!, label: m.display_name || m.slug! }));
  } catch {
    return [];
  }
}

function dedupeModels(models: ModelOption[]): ModelOption[] {
  return models.filter((model, index, array) =>
    index === array.findIndex((entry) => entry.id === model.id)
  );
}

interface DiscoveryResult {
  models: ModelOption[];
  discovered: boolean;
}

async function discoverHarnessModelsAsync(harness: string, refresh = false): Promise<DiscoveryResult> {
  const config = HARNESS_OPTIONS[harness];
  if (!config) {
    return { models: [], discovered: false };
  }

  try {
    if (harness === 'codex') {
      const output = await runCommandOutput('codex', ['debug', 'models'], 8000);
      return { models: dedupeModels(parseCodexDebugModels(output)), discovered: true };
    }

    if (harness === 'opencode') {
      const output = await runCommandOutput('opencode', ['models'], 6000);
      return { models: dedupeModels(parseOpenCodeModels(output)), discovered: true };
    }

    if (harness === 'pi') {
      const output = await runCommandOutput('pi', ['--list-models'], 6000);
      return { models: dedupeModels(parsePiModels(output)), discovered: true };
    }

    if (harness === 'omp') {
      const output = await runCommandOutput('omp', ['models', '--json'], 8000);
      const models = parseOmpModelCatalog(output);
      if (!models) throw new Error('Malformed OMP model catalog');
      return { models, discovered: true };
    }
    if (harness === 'hermes') {
      const models = parseHermesModelOptions(await runHermesModelOptions(refresh));
      if (!models) throw new Error('Malformed Hermes model options');
      return { models, discovered: true };
    }

  } catch {
    return {
      models: MODEL_DISCOVERY_FALLBACKS[harness] ?? [],
      discovered: false,
    };
  }

  return {
    models: [],
    discovered: false,
  };
}

export async function discoverHarnessModels(harness: string, refresh = false): Promise<ModelOption[]> {
  // Only an explicit Hermes refresh bypasses the TTL. Retain even an expired
  // catalog if a transient gateway failure prevents replacing it.
  const hermesRefresh = harness === 'hermes' && refresh === true;
  const cached = persistentModelCache.get(
    harness,
    hermesRefresh ? Number.POSITIVE_INFINITY : DEFAULT_MODEL_CACHE_TTL_MS
  );
  if (cached && !hermesRefresh) {
    // Fire-and-forget background refresh to keep cache fresh for next launch
    refreshCacheSilently(harness);
    return cached;
  }

  const config = HARNESS_OPTIONS[harness];
  if (!config) {
    return [];
  }

  const { models, discovered } = await discoverHarnessModelsAsync(harness, hermesRefresh);
  const result = discovered
    ? models
    : (cached ?? (models.length > 0 ? models : (MODEL_DISCOVERY_FALLBACKS[harness] ?? [])));

  if (discovered) {
    // Persist only successful discovery results so a transient failure cannot
    // replace a good cache entry with fallback data.
    if (hermesRefresh) hermesCatalogEpoch += 1;
    persistentModelCache.set(harness, result);
  }

  return result;
}

/**
 * Kick off a silent background refresh of the model cache for a harness.
 * Results are persisted to disk so the next launch gets fresh data instantly.
 * Errors are silently ignored — fallback models are always available.
 */
function refreshCacheSilently(harness: string): void {
  const config = HARNESS_OPTIONS[harness];
  if (!config) return;

  const hermesEpoch = hermesCatalogEpoch;
  // Run discovery async without blocking
  discoverHarnessModelsAsync(harness)
    .then(({ models, discovered }) => {
      if (discovered && (harness !== 'hermes' || hermesEpoch === hermesCatalogEpoch)) {
        persistentModelCache.set(harness, models);
      }
    })
    .catch(() => {
      // Silently ignore background refresh failures
    });
}

function isCommandAvailable(command: string): boolean {
  const homeDir = app.getPath('home');
  const searchPaths = new Set<string>([
    process.cwd(),
    path.join(process.cwd(), 'node_modules', '.bin'),
    app.getAppPath(),
    path.join(app.getAppPath(), 'node_modules', '.bin'),
    ...userCliBinPaths(homeDir),
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
  ]);

  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT?.split(';').filter(Boolean) ?? ['.EXE', '.CMD', '.BAT', '.COM'])
    : [''];
  const candidates = path.extname(command) ? [command] : [command, ...extensions.map((ext) => `${command}${ext}`)];

  for (const searchPath of searchPaths) {
    for (const candidate of candidates) {
      const fullPath = path.isAbsolute(candidate) ? candidate : path.join(searchPath, candidate);
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
        return true;
      } catch {
        // continue searching
      }
    }
  }

  return false;
}

export function getAvailableHarnessOptions() {
  return Object.fromEntries(
    Object.entries(HARNESS_OPTIONS).filter(([, config]) => isCommandAvailable(config.command))
  );
}

// Re-export cache types for consumers
export type { ModelCache } from './modelCache';
export { InMemoryModelCache } from './modelCache';
