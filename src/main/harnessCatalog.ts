import { app } from 'electron';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { normalizePiModelId, type HarnessConfig } from './harnessLaunch';
import {
  ElectronStoreModelCache,
  DEFAULT_MODEL_CACHE_TTL_MS,
} from './modelCache';

// Module-level singleton for persistent model cache
const persistentModelCache = new ElectronStoreModelCache();

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
  claude: {
    name: 'Claude',
    command: 'claude',
    args: [],
    icon: '✨',
    modelArg: '--model',
  },
};

const MODEL_DISCOVERY_FALLBACKS: Record<string, ModelOption[]> = {
  codex: [
    { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { id: 'gpt-5.4', label: 'gpt-5.4' },
    { id: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark' },
    { id: 'gpt-5.1-codex-max', label: 'gpt-5.1-codex-max' },
    { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
  ],
  opencode: [
    { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'openai/gpt-4o', label: 'GPT-4o' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  ],
  pi: [],
  claude: [
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'opus', label: 'Opus' },
    { id: 'haiku', label: 'Haiku' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  ],
};



function runCommandOutput(
  command: string,
  args: string[],
  timeoutMs = 6000,
  extraEnv?: Record<string, string>,
  cwd?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      cwd,
      env: {
        ...process.env,
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

function readCodexConfiguredModel(): string | null {
  const configPath = path.join(app.getPath('home'), '.codex', 'config.toml');
  try {
    const contents = fs.readFileSync(configPath, 'utf8');
    const match = contents.match(/^\s*model\s*=\s*["']([^"']+)["']\s*$/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function discoverCodexModels(): Promise<ModelOption[]> {
  const configuredModel = readCodexConfiguredModel();
  const fallback = MODEL_DISCOVERY_FALLBACKS.codex;
  return configuredModel
    ? [{ id: configuredModel, label: configuredModel }, ...fallback.filter((model) => model.id !== configuredModel)]
    : fallback;
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

async function discoverHarnessModelsAsync(harness: string): Promise<DiscoveryResult> {
  const config = HARNESS_OPTIONS[harness];
  if (!config) {
    return { models: [], discovered: false };
  }

  try {
    if (harness === 'codex') {
      return { models: dedupeModels(await discoverCodexModels()), discovered: true };
    }

    if (harness === 'opencode') {
      const output = await runCommandOutput('opencode', ['models'], 6000);
      return { models: dedupeModels(parseOpenCodeModels(output)), discovered: true };
    }

    if (harness === 'pi') {
      const output = await runCommandOutput('pi', ['--list-models'], 6000);
      return { models: dedupeModels(parsePiModels(output)), discovered: true };
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

export async function discoverHarnessModels(harness: string): Promise<ModelOption[]> {
  // Check persistent cache first for fast startup
  const cached = persistentModelCache.get(harness, DEFAULT_MODEL_CACHE_TTL_MS);
  if (cached) {
    // Fire-and-forget background refresh to keep cache fresh for next launch
    refreshCacheSilently(harness);
    return cached;
  }

  const config = HARNESS_OPTIONS[harness];
  if (!config) {
    return [];
  }

  const { models, discovered } = await discoverHarnessModelsAsync(harness);
  const result = models.length > 0 ? models : (MODEL_DISCOVERY_FALLBACKS[harness] ?? []);

  if (discovered) {
    // Persist only successful discovery results so a transient failure cannot
    // replace a good cache entry with fallback data.
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

  // Run discovery async without blocking
  discoverHarnessModelsAsync(harness)
    .then(({ models, discovered }) => {
      if (discovered) {
        persistentModelCache.set(harness, models);
      }
    })
    .catch(() => {
      // Silently ignore background refresh failures
    });
}

function isCommandAvailable(command: string): boolean {
  const homeBin = path.join(app.getPath('home'), '.local', 'bin');
  const searchPaths = new Set<string>([
    process.cwd(),
    path.join(process.cwd(), 'node_modules', '.bin'),
    app.getAppPath(),
    path.join(app.getAppPath(), 'node_modules', '.bin'),
    homeBin,
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
