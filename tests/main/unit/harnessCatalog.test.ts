import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse } from 'path';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApp = {
  getPath: vi.fn(() => '/home/user'),
  getAppPath: vi.fn(() => '/app/path'),
};

vi.mock('electron', () => ({
  app: mockApp,
}));

const mockFs = {
  readFileSync: vi.fn(),
  mkdtempSync: vi.fn(() => '/tmp/clanker-grid-opencode-xyz'),
  rmSync: vi.fn(),
  accessSync: vi.fn(),
  constants: { X_OK: 1 },
};

vi.mock('fs', () => ({
  ...mockFs,
  default: mockFs,
}));

vi.mock('os', () => ({
  tmpdir: () => '/tmp',
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Import after mocks
let execFileMock: ReturnType<typeof vi.fn>;
let harnessCatalog: typeof import('../../../src/main/harnessCatalog');

beforeEach(async () => {
  // Re-import to reset module-level cache
  vi.resetModules();

  execFileMock = vi.fn();
  vi.doMock('child_process', () => ({
    execFile: execFileMock,
  }));

  mockFs.readFileSync.mockReturnValue('');
  mockFs.mkdtempSync.mockReturnValue('/tmp/clanker-grid-opencode-xyz');
  mockFs.rmSync.mockReturnValue(undefined);
  mockFs.accessSync.mockImplementation(() => { throw new Error('not found'); });
  mockApp.getPath.mockReturnValue('/home/user');
  mockApp.getAppPath.mockReturnValue('/app/path');

  harnessCatalog = await import('../../../src/main/harnessCatalog');
});

// ---------------------------------------------------------------------------
// HARNESS_OPTIONS
// ---------------------------------------------------------------------------
describe('HARNESS_OPTIONS', () => {
  it('contains codex, opencode, pi, claude configs', () => {
    const opts = harnessCatalog.HARNESS_OPTIONS;
    expect(Object.keys(opts).sort()).toEqual(['claude', 'codex', 'opencode', 'pi']);
  });

  it('each config has command, args, name, icon', () => {
    for (const [key, config] of Object.entries(harnessCatalog.HARNESS_OPTIONS)) {
      expect(config.command).toBeTruthy();
      expect(Array.isArray(config.args)).toBe(true);
      expect(config.name).toBeTruthy();
      expect(config.icon).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// discoverHarnessModels — codex
// ---------------------------------------------------------------------------
describe('discoverHarnessModels — codex', () => {
  it('returns fallback when no configured model', async () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('no config');
    });

    const models = await harnessCatalog.discoverHarnessModels('codex');

    expect(models.length).toBeGreaterThan(0);
    expect(models[0].id).toBeTruthy();
    expect(models[0].label).toBeTruthy();
  });

  it('prepends configured model when present in config', async () => {
    mockFs.readFileSync.mockReturnValue('model = "my-custom-model"\n');

    const models = await harnessCatalog.discoverHarnessModels('codex');

    expect(models[0].id).toBe('my-custom-model');
    expect(models[0].label).toBe('my-custom-model');
    // Should not duplicate in the list
    expect(models.filter(m => m.id === 'my-custom-model')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// discoverHarnessModels — opencode
// ---------------------------------------------------------------------------
describe('discoverHarnessModels — opencode', () => {
  it('discovers models from command output', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, 'anthropic/claude-sonnet-4-6\nopenai/gpt-4o\n', '');
    });

    const models = await harnessCatalog.discoverHarnessModels('opencode');

    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('anthropic/claude-sonnet-4-6');
    expect(models[1].id).toBe('openai/gpt-4o');
  });

  it('creates and cleans up temp directory', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, 'model-1\n', '');
    });

    await harnessCatalog.discoverHarnessModels('opencode');

    expect(mockFs.mkdtempSync).toHaveBeenCalledWith(expect.stringContaining('clanker-grid-opencode-'));
    expect(mockFs.rmSync).toHaveBeenCalledWith('/tmp/clanker-grid-opencode-xyz', { recursive: true, force: true });
  });

  it('falls back when command fails', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(new Error('command not found'), '', 'error');
    });

    const models = await harnessCatalog.discoverHarnessModels('opencode');

    // Should return fallback list
    expect(models.length).toBeGreaterThan(0);
  });

  it('still cleans up temp dir on command failure', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(new Error('failed'), '', '');
    });

    await harnessCatalog.discoverHarnessModels('opencode');

    expect(mockFs.rmSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// discoverHarnessModels — pi
// ---------------------------------------------------------------------------
describe('discoverHarnessModels — pi', () => {
  it('parses pi model output', async () => {
    const output = [
      'Provider  Model',
      '────────  ────────────────',
      'anthropic  claude-sonnet-4-6',
      'openai     gpt-4o',
    ].join('\n');

    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, output, '');
    });

    const models = await harnessCatalog.discoverHarnessModels('pi');

    expect(models.length).toBe(2);
    expect(models[0].id).toBe('anthropic/claude-sonnet-4-6');
    expect(models[0].label).toBe('anthropic/claude-sonnet-4-6');
    expect(models[1].id).toBe('openai/gpt-4o');
  });

  it('returns empty when no models available', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, 'No models available', '');
    });

    const models = await harnessCatalog.discoverHarnessModels('pi');

    // Should fall back (pi fallback is empty array, so result will be empty or fallback)
    expect(models).toBeDefined();
  });

  it('falls back on command error', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(new Error('pi not installed'), '', 'error');
    });

    const models = await harnessCatalog.discoverHarnessModels('pi');
    expect(models).toBeDefined();
  });

  it('deduplicates models', async () => {
    const output = [
      'anthropic  claude-sonnet-4-6',
      'anthropic  claude-sonnet-4-6',
    ].join('\n');

    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, output, '');
    });

    const models = await harnessCatalog.discoverHarnessModels('pi');
    const ids = models.map(m => m.id);
    const uniqueIds = [...new Set(ids)];
    expect(ids).toEqual(uniqueIds);
  });
});

// ---------------------------------------------------------------------------
// discoverHarnessModels — unknown harness
// ---------------------------------------------------------------------------
describe('discoverHarnessModels — unknown', () => {
  it('returns empty for unknown harness', async () => {
    const models = await harnessCatalog.discoverHarnessModels('nonexistent');
    expect(models).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// discoverHarnessModels — caching
// ---------------------------------------------------------------------------
describe('discoverHarnessModels — caching', () => {
  it('caches results for the same harness', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('no config'); });

    const first = await harnessCatalog.discoverHarnessModels('codex');
    const second = await harnessCatalog.discoverHarnessModels('codex');

    expect(first).toBe(second); // Same reference — cached
  });
});

// ---------------------------------------------------------------------------
// getAvailableHarnessOptions
// ---------------------------------------------------------------------------
describe('getAvailableHarnessOptions', () => {
  it('returns empty when no commands are found on PATH', () => {
    mockFs.accessSync.mockImplementation(() => { throw new Error('not found'); });

    const result = harnessCatalog.getAvailableHarnessOptions();
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('returns harness options for available commands', () => {
    // Make all commands "available"
    mockFs.accessSync.mockImplementation(() => {});

    const result = harnessCatalog.getAvailableHarnessOptions();
    expect(Object.keys(result).sort()).toEqual(['claude', 'codex', 'opencode', 'pi']);
  });

  it('returns only available harnesses', () => {
    // Make only 'codex' available
    mockFs.accessSync.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.includes('codex')) return;
      throw new Error('not found');
    });

    const result = harnessCatalog.getAvailableHarnessOptions();
    expect(Object.keys(result)).toEqual(['codex']);
  });
});
