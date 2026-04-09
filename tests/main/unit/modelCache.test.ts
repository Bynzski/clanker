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
