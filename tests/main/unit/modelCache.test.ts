/**
 * Model Cache — Unit Tests
 *
 * Tests for the ModelCache interface and its implementations.
 * per S3.1.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ModelOption } from '../../../src/main/harnessCatalog';
import {
  InMemoryModelCache,
  ElectronStoreModelCache,
  DEFAULT_MODEL_CACHE_TTL_MS,
} from '../../../src/main/modelCache';

const CODEX_MODELS: ModelOption[] = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
];

const PI_MODELS: ModelOption[] = [
  { id: 'anthropic/claude-sonnet-4-6', label: 'anthropic/claude-sonnet-4-6' },
  { id: 'openai/gpt-4o', label: 'openai/gpt-4o' },
];

// =============================================================================
// InMemoryModelCache Tests
// =============================================================================

describe('InMemoryModelCache', () => {
  let cache: InMemoryModelCache;

  beforeEach(() => {
    cache = new InMemoryModelCache();
  });

  describe('get', () => {
    it('returns null for cache miss', () => {
      expect(cache.get('unknown', DEFAULT_MODEL_CACHE_TTL_MS)).toBeNull();
    });

    it('returns null for expired entry', () => {
      cache.set('codex', CODEX_MODELS);

      // Advance fake time beyond TTL
      vi.useFakeTimers();
      vi.advanceTimersByTime(DEFAULT_MODEL_CACHE_TTL_MS + 1);
      try {
        expect(cache.get('codex', DEFAULT_MODEL_CACHE_TTL_MS)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns cached models within TTL', () => {
      cache.set('codex', CODEX_MODELS);
      const result = cache.get('codex', DEFAULT_MODEL_CACHE_TTL_MS);
      expect(result).toEqual(CODEX_MODELS);
    });

    it('respects custom TTL shorter than default', () => {
      cache.set('codex', CODEX_MODELS);

      vi.useFakeTimers();
      vi.advanceTimersByTime(2); // 2ms past the 1ms TTL
      try {
        expect(cache.get('codex', 1)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('set', () => {
    it('stores models so get returns them', () => {
      cache.set('pi', PI_MODELS);
      const result = cache.get('pi', DEFAULT_MODEL_CACHE_TTL_MS);
      expect(result).toEqual(PI_MODELS);
    });

    it('overwrites previous entry for same harness', () => {
      cache.set('codex', CODEX_MODELS);
      const newModels: ModelOption[] = [{ id: 'gpt-5', label: 'GPT-5' }];
      cache.set('codex', newModels);
      const result = cache.get('codex', DEFAULT_MODEL_CACHE_TTL_MS);
      expect(result).toEqual(newModels);
    });

    it('stores empty model array', () => {
      cache.set('empty-harness', []);
      expect(cache.get('empty-harness', DEFAULT_MODEL_CACHE_TTL_MS)).toEqual([]);
    });
  });

  describe('multiple harnesses', () => {
    it('handles multiple harnesses independently', () => {
      cache.set('codex', CODEX_MODELS);
      cache.set('pi', PI_MODELS);
      expect(cache.get('codex', DEFAULT_MODEL_CACHE_TTL_MS)).toEqual(CODEX_MODELS);
      expect(cache.get('pi', DEFAULT_MODEL_CACHE_TTL_MS)).toEqual(PI_MODELS);
    });

    it('one harness expiry does not affect others', () => {
      cache.set('codex', CODEX_MODELS);

      vi.useFakeTimers();
      // Advance time but not past TTL for codex
      vi.advanceTimersByTime(10);
      try {
        // codex should still be valid
        expect(cache.get('codex', DEFAULT_MODEL_CACHE_TTL_MS)).toEqual(CODEX_MODELS);
        // pi was never set, so it should be null
        expect(cache.get('pi', DEFAULT_MODEL_CACHE_TTL_MS)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

// =============================================================================
// ElectronStoreModelCache Tests
// =============================================================================

// Mock electron-store with a controllable store instance
const mockStoreInstance = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('electron-store', () => ({
  default: class {
    get = mockStoreInstance.get;
    set = mockStoreInstance.set;
  },
}));

describe('ElectronStoreModelCache', () => {
  beforeEach(() => {
    mockStoreInstance.get.mockReturnValue({});
    mockStoreInstance.set.mockReset();
  });

  describe('get', () => {
    it('returns null for cache miss (empty store)', () => {
      mockStoreInstance.get.mockReturnValue({});
      const cache = new ElectronStoreModelCache();
      expect(cache.get('unknown', DEFAULT_MODEL_CACHE_TTL_MS)).toBeNull();
      expect(mockStoreInstance.get).toHaveBeenCalledWith('models');
    });

    it('returns null when no entry exists for harness', () => {
      mockStoreInstance.get.mockReturnValue({ other: { models: CODEX_MODELS, cachedAt: Date.now() } });
      const cache = new ElectronStoreModelCache();
      expect(cache.get('codex', DEFAULT_MODEL_CACHE_TTL_MS)).toBeNull();
    });

    it('returns null for expired entry', () => {
      const past = Date.now() - (DEFAULT_MODEL_CACHE_TTL_MS + 1);
      mockStoreInstance.get.mockReturnValue({ codex: { models: CODEX_MODELS, cachedAt: past } });
      const cache = new ElectronStoreModelCache();
      expect(cache.get('codex', DEFAULT_MODEL_CACHE_TTL_MS)).toBeNull();
    });

    it('returns cached models within TTL', () => {
      mockStoreInstance.get.mockReturnValue({ codex: { models: CODEX_MODELS, cachedAt: Date.now() } });
      const cache = new ElectronStoreModelCache();
      const result = cache.get('codex', DEFAULT_MODEL_CACHE_TTL_MS);
      expect(result).toEqual(CODEX_MODELS);
    });

    it('respects custom TTL shorter than stored age', () => {
      const past = Date.now() - 2;
      mockStoreInstance.get.mockReturnValue({ codex: { models: CODEX_MODELS, cachedAt: past } });
      const cache = new ElectronStoreModelCache();
      expect(cache.get('codex', 1)).toBeNull();
    });

    it('returns null when allEntries is undefined', () => {
      mockStoreInstance.get.mockReturnValue(undefined);
      const cache = new ElectronStoreModelCache();
      expect(cache.get('codex', DEFAULT_MODEL_CACHE_TTL_MS)).toBeNull();
    });
  });

  describe('set', () => {
    it('stores models that can be retrieved via get', () => {
      const entries: Record<string, unknown> = {};
      mockStoreInstance.get.mockImplementation(() => entries);
      mockStoreInstance.set.mockImplementation((_key: string, value: Record<string, unknown>) => {
        Object.assign(entries, value);
      });

      const cache = new ElectronStoreModelCache();
      cache.set('codex', CODEX_MODELS);
      expect(mockStoreInstance.set).toHaveBeenCalledWith('models', expect.objectContaining({
        codex: expect.objectContaining({ models: CODEX_MODELS }),
      }));
      const result = cache.get('codex', DEFAULT_MODEL_CACHE_TTL_MS);
      expect(result).toEqual(CODEX_MODELS);
    });

    it('overwrites existing entry for same harness', () => {
      const newModels: ModelOption[] = [{ id: 'gpt-5', label: 'GPT-5' }];
      let entries: Record<string, unknown> = {
        codex: { models: CODEX_MODELS, cachedAt: Date.now() - 1000 },
      };
      mockStoreInstance.get.mockImplementation(() => entries);
      mockStoreInstance.set.mockImplementation((_key: string, value: Record<string, unknown>) => {
        entries = value;
      });

      const cache = new ElectronStoreModelCache();
      cache.set('codex', newModels);
      const result = cache.get('codex', DEFAULT_MODEL_CACHE_TTL_MS);
      expect(result).toEqual(newModels);
    });

    it('stores empty model array', () => {
      const entries: Record<string, unknown> = {};
      mockStoreInstance.get.mockImplementation(() => entries);
      mockStoreInstance.set.mockImplementation((_key: string, value: Record<string, unknown>) => {
        Object.assign(entries, value);
      });

      const cache = new ElectronStoreModelCache();
      cache.set('empty-harness', []);
      const result = cache.get('empty-harness', DEFAULT_MODEL_CACHE_TTL_MS);
      expect(result).toEqual([]);
    });
  });

  describe('multiple harnesses isolation', () => {
    it('codex and pi entries are independent', () => {
      let entries: Record<string, unknown> = {};
      mockStoreInstance.get.mockImplementation(() => entries);
      mockStoreInstance.set.mockImplementation((_key: string, value: Record<string, unknown>) => {
        entries = value;
      });

      const cache = new ElectronStoreModelCache();
      cache.set('codex', CODEX_MODELS);
      cache.set('pi', PI_MODELS);
      expect(cache.get('codex', DEFAULT_MODEL_CACHE_TTL_MS)).toEqual(CODEX_MODELS);
      expect(cache.get('pi', DEFAULT_MODEL_CACHE_TTL_MS)).toEqual(PI_MODELS);
    });

    it('expiry of one does not affect the other', () => {
      const past = Date.now() - (DEFAULT_MODEL_CACHE_TTL_MS + 1);
      const entries: Record<string, unknown> = {
        codex: { models: CODEX_MODELS, cachedAt: past },
        pi: { models: PI_MODELS, cachedAt: Date.now() },
      };
      mockStoreInstance.get.mockReturnValue(entries);
      const cache = new ElectronStoreModelCache();
      expect(cache.get('codex', DEFAULT_MODEL_CACHE_TTL_MS)).toBeNull();
      expect(cache.get('pi', DEFAULT_MODEL_CACHE_TTL_MS)).toEqual(PI_MODELS);
    });
  });
});

// =============================================================================
// DEFAULT_MODEL_CACHE_TTL_MS Tests
// =============================================================================

describe('DEFAULT_MODEL_CACHE_TTL_MS', () => {
  it('equals 1 hour in milliseconds', () => {
    expect(DEFAULT_MODEL_CACHE_TTL_MS).toBe(60 * 60 * 1000);
  });

  it('is positive', () => {
    expect(DEFAULT_MODEL_CACHE_TTL_MS).toBeGreaterThan(0);
  });
});
