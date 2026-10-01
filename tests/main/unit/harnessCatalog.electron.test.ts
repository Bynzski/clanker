/**
 * Harness Catalog - Electron-Dependent Function Tests
 * 
 * Tests for harnessCatalog functions that depend on Electron's app module.
 * These tests require mocking the Electron module since it cannot be
 * imported in the Node.js test environment.
 * 
 * Note: isCommandAvailable and readCodexConfiguredModel are private functions
 * and tested indirectly through getAvailableHarnessOptions and discoverHarnessModels.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// =============================================================================
// Model Cache Integration Tests
// =============================================================================

describe('discoverHarnessModels cache integration', () => {
  const mockApp = {
    getAppPath: vi.fn(() => '/opt/clanker-grid'),
    getPath: vi.fn(() => path.join(os.tmpdir(), 'test-home')),
  };

  // Mock electron-store to control cache
  const mockStoreInstance = {
    get: vi.fn(() => ({})),
    set: vi.fn(),
  };
  const mockExecFile = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    mockStoreInstance.get.mockReset();
    mockStoreInstance.set.mockReset();
    mockStoreInstance.get.mockReturnValue({});
    mockExecFile.mockReset();
    mockExecFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, JSON.stringify({
        models: [
          { slug: 'gpt-5.4', display_name: 'GPT-5.4', visibility: 'list' },
        ],
      }), '');
    });
    vi.doMock('electron', () => ({
      app: mockApp,
    }));
    vi.doMock('electron-store', () => ({
      default: class {
        get = mockStoreInstance.get;
        set = mockStoreInstance.set;
      },
    }));
    vi.doMock('child_process', () => ({
      execFile: mockExecFile,
    }));
  });

  afterEach(() => {
    vi.doUnmock('electron');
    vi.doUnmock('electron-store');
    vi.doUnmock('child_process');
    vi.restoreAllMocks();
  });

  it('delegates to the selected provider and retains unsupported versus failure results', async () => {
    const { discoverHarnessModelsDetailed, HARNESS_OPTIONS } = await import('../../../src/main/harnessCatalog');
    const { getHarnessProvider } = await import('../../../src/main/harnesses/registry');
    const discover = vi.spyOn(getHarnessProvider('pi').models!, 'discover').mockResolvedValue([{ id: 'fixture', label: 'Fixture' }]);
    expect(await discoverHarnessModelsDetailed('pi')).toEqual({ models: [{ id: 'fixture', label: 'Fixture' }], success: true, cacheable: true });
    expect(discover).toHaveBeenCalledWith(false);
    expect((await discoverHarnessModelsDetailed('claude')).failure?.kind).toBe('unsupported');
    expect((await discoverHarnessModelsDetailed('unknown')).failure?.kind).toBe('unsupported');
    discover.mockRejectedValueOnce(Object.assign(new Error('binary missing'), { code: 'ENOENT' }));
    expect((await discoverHarnessModelsDetailed('pi')).failure?.kind).toBe('binary-unavailable');
    discover.mockRejectedValueOnce(Object.assign(new Error('command timed out'), { killed: true }));
    expect((await discoverHarnessModelsDetailed('pi')).failure?.kind).toBe('timeout');
    mockExecFile.mockImplementation((_command, _args, _options, callback) => callback(null, '{', ''));
    expect((await discoverHarnessModelsDetailed('omp')).failure?.kind).toBe('parse-failure');
    expect(await discoverHarnessModelsDetailed('codex')).toMatchObject({ models: [], success: false, cacheable: true, failure: { kind: 'parse-failure' } });
    await expect(getHarnessProvider('codex').models!.discover()).rejects.toMatchObject({ kind: 'parse-failure' });
    // The IPC compatibility catalog must never contain provider methods.
    expect(structuredClone(HARNESS_OPTIONS)).toEqual(HARNESS_OPTIONS);
  });

  it('distinguishes valid empty discovery from parse failure and uncached fallback', async () => {
    const { discoverHarnessModelsDetailed } = await import('../../../src/main/harnessCatalog');
    const { getHarnessProvider } = await import('../../../src/main/harnesses/registry');
    vi.spyOn(getHarnessProvider('pi').models, 'discover').mockResolvedValue([]);
    expect(await discoverHarnessModelsDetailed('pi')).toEqual({ models: [], success: true, cacheable: true });
    vi.spyOn(getHarnessProvider('opencode').models, 'discover').mockRejectedValue(new SyntaxError('bad models'));
    expect(await discoverHarnessModelsDetailed('opencode')).toEqual({
      models: getHarnessProvider('opencode').models.fallback, success: false, cacheable: false,
      failure: expect.objectContaining({ kind: 'parse-failure' }),
    });
  });

  it('returns cached models immediately without CLI calls on cache hit', async () => {
    const cachedModels = [
      { id: 'cached-model-1', label: 'Cached Model 1' },
      { id: 'cached-model-2', label: 'Cached Model 2' },
    ];
    mockStoreInstance.get.mockReturnValue({
      pi: { models: cachedModels, cachedAt: Date.now() },
    });

    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const result = await discoverHarnessModels('pi');

    expect(result).toEqual(cachedModels);
    // Store should not have been updated on cache hit
    expect(mockStoreInstance.set).not.toHaveBeenCalled();
  });

  it('runs discovery when cache is empty', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const result = await discoverHarnessModels('codex');

    expect(Array.isArray(result)).toBe(true);
    // Store should have been updated after successful CLI discovery.
    expect(mockStoreInstance.set).toHaveBeenCalled();
  });

  it('runs CLI discovery when cache is expired', async () => {
    const oldTimestamp = Date.now() - (60 * 60 * 1000 + 1); // Past TTL
    mockStoreInstance.get.mockReturnValue({
      codex: { models: [{ id: 'old', label: 'Old' }], cachedAt: oldTimestamp },
    });

    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const result = await discoverHarnessModels('codex');

    expect(Array.isArray(result)).toBe(true);
    // Store should have been updated with fresh results
    expect(mockStoreInstance.set).toHaveBeenCalled();
  });

  it('persists results to cache after discovery', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    await discoverHarnessModels('codex');

    // Should persist to cache
    expect(mockStoreInstance.set).toHaveBeenCalledWith('models', expect.objectContaining({
      codex: expect.objectContaining({
        models: expect.any(Array),
        cachedAt: expect.any(Number),
      }),
    }));
  });

  it('does not cache malformed OMP model output', async () => {
    mockExecFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, '{"models":', '');
    });
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    expect(await discoverHarnessModels('omp')).toEqual([]);
    expect(mockStoreInstance.set).not.toHaveBeenCalled();
  });

  it('returns empty array for claude (no CLI discovery available)', async () => {
    mockStoreInstance.get.mockReturnValue({});

    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const result = await discoverHarnessModels('claude');

    expect(result).toEqual([]);
  });

  it('returns models from codex debug CLI when cache is empty', async () => {
    mockStoreInstance.get.mockReturnValue({});

    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const result = await discoverHarnessModels('codex');

    expect(Array.isArray(result)).toBe(true);
  });

  it('handles unknown harness by returning empty array', async () => {
    mockStoreInstance.get.mockReturnValue({});

    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const result = await discoverHarnessModels('non-existent-harness');

    expect(result).toEqual([]);
  });
});

describe('Hermes gateway discovery', () => {
  const home = path.join(os.tmpdir(), 'test-hermes-home');
  const store = { get: vi.fn(() => ({})), set: vi.fn() };
  const spawnGateway = vi.fn();
  let response: string;
  let exitCode: number;
  let request: string;

  beforeEach(() => {
    vi.resetModules();
    store.get.mockReset().mockReturnValue({});
    store.set.mockReset();
    spawnGateway.mockReset().mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => void;
      };
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      child.stdin.on('data', (chunk: Buffer) => { request += chunk.toString('utf8'); });
      queueMicrotask(() => {
        child.stdout.write('{"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready"}}\n');
        child.stdout.write(response);
        child.emit('close', exitCode);
      });
      return child;
    });
    request = '';
    exitCode = 0;
    response = '{"jsonrpc":"2.0","id":1,"result":{"providers":[{"slug":"copilot","name":"Copilot","models":["same"]},{"slug":"codex","name":"Codex","models":["same"]}]}}\n';
    vi.doMock('electron', () => ({
      app: { getPath: () => home, getAppPath: () => '/opt/clanker-grid' },
    }));
    vi.doMock('electron-store', () => ({
      default: class { get = store.get; set = store.set; },
    }));
    vi.doMock('child_process', () => ({ execFile: vi.fn(), spawn: spawnGateway }));
  });

  afterEach(() => {
    vi.doUnmock('electron');
    vi.doUnmock('electron-store');
    vi.doUnmock('child_process');
  });

  it('queries local model.options through the installed gateway and caches distinct provider choices', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    expect(await discoverHarnessModels('hermes')).toEqual([
      { id: 'hermes-provider:copilot:same', label: 'same · Copilot' },
      { id: 'hermes-provider:codex:same', label: 'same · Codex' },
    ]);
    const root = path.join(home, '.hermes', 'hermes-agent');
    expect(spawnGateway).toHaveBeenCalledWith(
      process.env.HERMES_PYTHON?.trim() || path.join(root, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
      ['-m', 'tui_gateway.entry'],
      expect.objectContaining({
        cwd: root,
        env: expect.objectContaining({ PYTHONPATH: expect.stringContaining(root), HERMES_PYTHON_SRC_ROOT: root }),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    );
    expect(JSON.parse(request)).toEqual({ jsonrpc: '2.0', id: 1, method: 'model.options', params: {} });
    expect(store.set).toHaveBeenCalled();
  });

  it('does not cache a failed or malformed gateway response and can retry', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    response = '{"jsonrpc":"2.0","id":1,"error":{"code":5033}}\n';
    expect(await discoverHarnessModels('hermes')).toEqual([]);
    exitCode = 1;
    expect(await discoverHarnessModels('hermes')).toEqual([]);
    expect(store.set).not.toHaveBeenCalled();
    exitCode = 0;
    response = '{"jsonrpc":"2.0","id":1,"result":{"providers":[{"slug":"copilot","name":"Copilot","models":["same"]}]}}\n';
    expect(await discoverHarnessModels('hermes')).toEqual([
      { id: 'hermes-provider:copilot:same', label: 'same · Copilot' },
    ]);
    expect(spawnGateway).toHaveBeenCalledTimes(3);
  });
  it('bypasses the cached Hermes catalog only on explicit refresh and persists fresh provider rows', async () => {
    let cache = {} as Record<string, { models: { id: string; label: string }[]; cachedAt: number }>;
    store.get.mockImplementation(() => cache);
    store.set.mockImplementation((_key: string, value: typeof cache) => { cache = value; });
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const initial = await discoverHarnessModels('hermes');
    expect(JSON.parse(request).params).toEqual({});

    response = '{"jsonrpc":"2.0","id":1,"result":{"providers":[{"slug":"copilot","name":"Copilot","models":["live"]}]}}\n';
    expect(await discoverHarnessModels('hermes')).toEqual(initial);
    // The normal cache hit may refresh in the background, but its request must
    // still use the fast nonblocking catalog, not an authenticated refresh.
    expect(JSON.parse(request.trim().split('\n').pop()!).params).toEqual({});
    // Provider implementations load lazily; wait until the warmup has sent its request.
    await vi.waitFor(() => expect(spawnGateway).toHaveBeenCalledTimes(2));
    request = '';
    const fresh = await discoverHarnessModels('hermes', true);
    expect(JSON.parse(request).params).toEqual({ refresh: true });
    expect(fresh).toEqual([{ id: 'hermes-provider:copilot:live', label: 'live · Copilot' }]);
    expect(cache.hermes.models).toEqual(fresh);
    expect(await discoverHarnessModels('hermes')).toEqual(fresh);
  });

  it('does not let an earlier nonblocking warmup overwrite an explicit refresh', async () => {
    const old = [{ id: 'hermes-provider:copilot:old', label: 'old · Copilot' }];
    let cache = { hermes: { models: old, cachedAt: Date.now() } };
    store.get.mockImplementation(() => cache);
    store.set.mockImplementation((_key: string, value: typeof cache) => { cache = value; });
    const normalSpawn = spawnGateway.getMockImplementation()!;
    const delayed = new EventEmitter() as EventEmitter & {
      stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => void;
    };
    delayed.stdin = new PassThrough();
    delayed.stdout = new PassThrough();
    delayed.stderr = new PassThrough();
    delayed.kill = vi.fn();
    spawnGateway.mockImplementationOnce(() => delayed).mockImplementation(normalSpawn);
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    expect(await discoverHarnessModels('hermes')).toEqual(old);
    response = '{"jsonrpc":"2.0","id":1,"result":{"providers":[{"slug":"copilot","name":"Copilot","models":["fresh"]}]}}\n';
    const fresh = await discoverHarnessModels('hermes', true);
    delayed.stdout.write('{"jsonrpc":"2.0","id":1,"result":{"providers":[{"slug":"copilot","name":"Copilot","models":["obsolete"]}]}}\n');
    delayed.emit('close', 0);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cache.hermes.models).toEqual(fresh);
  });

  it('returns an expired usable Hermes cache when an explicit refresh has malformed output', async () => {
    const stale = [{ id: 'hermes-provider:copilot:old', label: 'old · Copilot' }];
    const cache = { hermes: { models: stale, cachedAt: Date.now() - 2 * 60 * 60 * 1000 } };
    store.get.mockReturnValue(cache);
    response = '{"jsonrpc":"2.0","id":1,"result":{"providers":[]}}\n';
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    expect(await discoverHarnessModels('hermes', true)).toEqual(stale);
    expect(JSON.parse(request).params).toEqual({ refresh: true });
    expect(store.set).not.toHaveBeenCalled();
  });

  it('bounds explicit refresh at 45 seconds while retaining the last catalog', async () => {
    vi.useFakeTimers();
    try {
      const stale = [{ id: 'hermes-provider:copilot:old', label: 'old · Copilot' }];
      store.get.mockReturnValue({ hermes: { models: stale, cachedAt: Date.now() } });
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => void;
      };
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      spawnGateway.mockReturnValue(child);
      const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
      const result = discoverHarnessModels('hermes', true);
      await vi.advanceTimersByTimeAsync(44_999);
      expect(child.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toEqual(stale);
      expect(child.kill).toHaveBeenCalledOnce();
      expect(store.set).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds explicit refresh output and does not persist truncated data', async () => {
    response = 'x'.repeat(8 * 1024 * 1024 + 1);
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    expect(await discoverHarnessModels('hermes', true)).toEqual([]);
    expect(spawnGateway.mock.results[0].value.kill).toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

});

// =============================================================================
// Cache Failure Regression Tests
// =============================================================================

describe('discoverHarnessModels cache failure regressions', () => {
  const mockApp = {
    getAppPath: vi.fn(() => '/opt/clanker-grid'),
    getPath: vi.fn(() => path.join(os.tmpdir(), 'test-home')),
  };

  const mockStoreInstance = {
    get: vi.fn(() => ({})),
    set: vi.fn(),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: mockApp,
    }));
    vi.doMock('electron-store', () => ({
      default: class {
        get = mockStoreInstance.get;
        set = mockStoreInstance.set;
      },
    }));
    vi.doMock('child_process', () => ({
      execFile: vi.fn((_command: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(new Error('mock discovery failure'), '', '');
      }),
    }));
  });

  afterEach(() => {
    vi.doUnmock('electron');
    vi.doUnmock('electron-store');
    vi.doUnmock('child_process');
    vi.restoreAllMocks();
  });

  it('does not persist fallback models when cold-start discovery fails', async () => {
    mockStoreInstance.get.mockReturnValue({});

    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const result = await discoverHarnessModels('opencode');

    expect(result.length).toBeGreaterThan(0);
    expect(mockStoreInstance.set).not.toHaveBeenCalled();
  });

  it('does not overwrite a good cache entry when background refresh fails', async () => {
    const cachedModels = [
      { id: 'cached-model-1', label: 'Cached Model 1' },
      { id: 'cached-model-2', label: 'Cached Model 2' },
    ];
    mockStoreInstance.get.mockReturnValue({
      pi: { models: cachedModels, cachedAt: Date.now() },
    });

    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const result = await discoverHarnessModels('pi');

    expect(result).toEqual(cachedModels);

    await new Promise<void>((resolve) => {
      setImmediate(() => resolve());
    });

    expect(mockStoreInstance.set).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Windows command invocation regressions
// =============================================================================

describe('discoverHarnessModels Windows command invocation', () => {
  const mockApp = {
    getAppPath: vi.fn(() => '/opt/clanker-grid'),
    getPath: vi.fn(() => path.join(os.tmpdir(), 'test-home')),
  };

  const mockStoreInstance = {
    get: vi.fn(() => ({})),
    set: vi.fn(),
  };

  const mockExecFile = vi.fn();
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.resetModules();
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockExecFile.mockReset();
    mockStoreInstance.get.mockReset();
    mockStoreInstance.set.mockReset();
    mockStoreInstance.get.mockReturnValue({});

    vi.doMock('electron', () => ({
      app: mockApp,
    }));
    vi.doMock('electron-store', () => ({
      default: class {
        get = mockStoreInstance.get;
        set = mockStoreInstance.set;
      },
    }));
    vi.doMock('child_process', () => ({
      execFile: mockExecFile,
    }));
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    vi.doUnmock('electron');
    vi.doUnmock('electron-store');
    vi.doUnmock('child_process');
    vi.restoreAllMocks();
  });

  it('wraps codex model discovery with cmd.exe /c on Windows', async () => {
    mockExecFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, JSON.stringify({ models: [{ slug: 'gpt-5.4', display_name: 'GPT-5.4', visibility: 'list' }] }), '');
    });

    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    await discoverHarnessModels('codex');

    expect(mockExecFile).toHaveBeenCalled();
    const [command, args] = mockExecFile.mock.calls[0] as [string, string[]];
    expect(command).toBe('cmd.exe');
    expect(args).toEqual(['/c', 'codex', 'debug', 'models']);
  });

  it('wraps opencode model discovery with cmd.exe /c on Windows', async () => {
    mockExecFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, 'openai/gpt-4o\n', '');
    });

    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    await discoverHarnessModels('opencode');

    expect(mockExecFile).toHaveBeenCalled();
    const [command, args] = mockExecFile.mock.calls[0] as [string, string[]];
    expect(command).toBe('cmd.exe');
    expect(args).toEqual(['/c', 'opencode', 'models']);
  });

  it('wraps pi model discovery with cmd.exe /c on Windows', async () => {
    mockExecFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, 'Provider  Model\nopenai  gpt-4o\n', '');
    });

    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    await discoverHarnessModels('pi');

    expect(mockExecFile).toHaveBeenCalled();
    const [command, args] = mockExecFile.mock.calls[0] as [string, string[]];
    expect(command).toBe('cmd.exe');
    expect(args).toEqual(['/c', 'pi', '--list-models']);
  });
});

// ============================================================================
// getAvailableHarnessOptions Tests
// ============================================================================

describe('getAvailableHarnessOptions', () => {
  // We need to mock Electron at the top level
  const mockApp = {
    getAppPath: vi.fn(() => '/opt/clanker-grid'),
    getPath: vi.fn(() => path.join(os.tmpdir(), 'test-home')),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: mockApp,
    }));
  });

  afterEach(() => {
    vi.doUnmock('electron');
    vi.restoreAllMocks();
  });

  it('returns an object', async () => {
    const { getAvailableHarnessOptions } = await import('../../../src/main/harnessCatalog');
    const result = getAvailableHarnessOptions();
    expect(typeof result).toBe('object');
  });

  it('returns only harnesses with available commands', async () => {
    const { getAvailableHarnessOptions } = await import('../../../src/main/harnessCatalog');
    const result = getAvailableHarnessOptions();
    const availableKeys = Object.keys(result);

    // All returned keys should be valid harness names
    const validKeys = ['codex', 'opencode', 'pi', 'omp', 'claude', 'hermes', 'agy'];
    for (const key of availableKeys) {
      expect(validKeys).toContain(key);
    }
  });

  it('each returned harness has required fields', async () => {
    const { getAvailableHarnessOptions } = await import('../../../src/main/harnessCatalog');
    const result = getAvailableHarnessOptions();

    for (const [name, config] of Object.entries(result)) {
      expect(config.name, `${name}: name should be truthy`).toBeTruthy();
      expect(config.command, `${name}: command should be truthy`).toBeTruthy();
      expect(Array.isArray(config.args), `${name}: args should be array`).toBe(true);
      expect(config.icon, `${name}: icon should be truthy`).toBeTruthy();
    }
  });

  it('filters out unavailable harnesses', async () => {
    const { getAvailableHarnessOptions, HARNESS_OPTIONS } = await import('../../../src/main/harnessCatalog');
    const allHarnesses = Object.keys(HARNESS_OPTIONS);
    const availableHarnesses = Object.keys(getAvailableHarnessOptions());

    // Available should be a subset of all harnesses
    for (const harness of availableHarnesses) {
      expect(allHarnesses).toContain(harness);
    }
  });

  it('preserves harness configuration structure', async () => {
    const { getAvailableHarnessOptions, HARNESS_OPTIONS } = await import('../../../src/main/harnessCatalog');
    const result = getAvailableHarnessOptions();

    // Check that returned configs match HARNESS_OPTIONS structure
    for (const [key, config] of Object.entries(result)) {
      expect(config).toEqual(HARNESS_OPTIONS[key]);
    }
  });

  it('handles empty PATH gracefully', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '';

    try {
      const { getAvailableHarnessOptions } = await import('../../../src/main/harnessCatalog');
      const result = getAvailableHarnessOptions();
      expect(typeof result).toBe('object');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('returns empty object when no commands are findable', async () => {
    // Temporarily clear PATH
    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    delete process.env.PATH;
    delete process.env.HOME;

    try {
      const { getAvailableHarnessOptions } = await import('../../../src/main/harnessCatalog');
      const result = getAvailableHarnessOptions();
      // Should return an object (may be empty if no commands are findable)
      expect(typeof result).toBe('object');
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
    }
  });
});

// ============================================================================
// discoverHarnessModels Error Path Tests
// ============================================================================

describe('discoverHarnessModels error paths', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: {
        getAppPath: vi.fn(() => '/opt/clanker-grid'),
        getPath: vi.fn(() => path.join(os.tmpdir(), 'test-home')),
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock('electron');
    vi.restoreAllMocks();
  });

  it('returns empty array for unknown harness', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const result = await discoverHarnessModels('completely-invalid-harness-xyz');
    expect(result).toEqual([]);
  });

  it('returns empty array for undefined harness', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    // @ts-expect-error - Testing invalid input
    const result = await discoverHarnessModels(undefined);
    expect(result).toEqual([]);
  });

  it('returns empty array for null harness', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    // @ts-expect-error - Testing invalid input
    const result = await discoverHarnessModels(null);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty string harness', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const result = await discoverHarnessModels('');
    expect(result).toEqual([]);
  });

  it('uses fallback when harness command fails', async () => {
    // Test with pi harness which may not be installed
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const result = await discoverHarnessModels('pi');
    // Should return something (either real models or fallback)
    expect(Array.isArray(result)).toBe(true);
  });

  it('caches results after first call', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    // Clear any existing cache by calling with different harness first
    await discoverHarnessModels('claude');

    // First call
    const result1 = await discoverHarnessModels('claude');

    // Second call should return same results (from cache or same source)
    const result2 = await discoverHarnessModels('claude');

    // Results should be equal
    expect(result1).toEqual(result2);
  });

  it('deduplicates models from different sources', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const result = await discoverHarnessModels('codex');

    const ids = result.map(m => m.id);
    const uniqueIds = [...new Set(ids)];

    expect(ids.length).toBe(uniqueIds.length);
  });

  it('handles concurrent calls for different harnesses', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const promises = [
      discoverHarnessModels('codex'),
      discoverHarnessModels('opencode'),
      discoverHarnessModels('pi'),
      discoverHarnessModels('claude'),
    ];

    const results = await Promise.all(promises);

    expect(results).toHaveLength(4);
    expect(results.every(Array.isArray)).toBe(true);
  });

  it('handles harness with special characters in name', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    const result = await discoverHarnessModels('opencode');
    expect(Array.isArray(result)).toBe(true);
  });

  it('handles harness with empty fallback (pi)', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    // pi has empty MODEL_DISCOVERY_FALLBACKS.pi
    const result = await discoverHarnessModels('pi');
    expect(Array.isArray(result)).toBe(true);
  });

  it('discovers codex models via CLI regardless of home directory', async () => {
    vi.resetModules();
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');

    const result = await discoverHarnessModels('codex');

    expect(Array.isArray(result)).toBe(true);
  });
});

// ============================================================================
// Integration: Command Availability and Harness Discovery
// ============================================================================

describe('harness discovery integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('node is typically available on test systems', async () => {
    const { getAvailableHarnessOptions } = await import('../../../src/main/harnessCatalog');
    const result = getAvailableHarnessOptions();
    
    // Since we're running on node/vitest, some commands should be available
    // The exact result depends on what's installed
    expect(typeof result).toBe('object');
  });

  it('model IDs are properly formatted across all harnesses', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    
    const harnesses = ['codex', 'opencode', 'pi', 'omp', 'claude', 'hermes', 'agy'];
    for (const harness of harnesses) {
      const models = await discoverHarnessModels(harness);
      
      for (const model of models) {
        // Model IDs should match expected patterns
        expect(model.id).toMatch(/^[\w/~.:-]+$/);
        // Labels may contain spaces (e.g., "Claude Sonnet 4.6")
        expect(typeof model.label).toBe('string');
        expect(model.label.length).toBeGreaterThan(0);
      }
    }
  }, 15000);

  it('no duplicate model IDs returned for any harness', async () => {
    const { discoverHarnessModels } = await import('../../../src/main/harnessCatalog');
    
    const harnesses = ['codex', 'opencode', 'pi', 'omp', 'claude', 'hermes', 'agy'];
    for (const harness of harnesses) {
      const models = await discoverHarnessModels(harness);
      const ids = models.map(m => m.id);
      const uniqueIds = [...new Set(ids)];
      
      expect(ids.length).toBe(uniqueIds.length);
    }
  });
});
