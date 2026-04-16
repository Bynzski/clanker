/**
 * HarnessDefaults Validation — Unit Tests
 *
 * Tests for validateHarnessDefaultsMap() in harnessDefaultsValidation.ts.
 * Covers the rules:
 * - Rejects non-object payloads
 * - Strips unknown harness IDs
 * - Fills missing harness IDs with defaults
 * - Coerces malformed entries
 * - Filters non-string favorites
 */

import { describe, it, expect } from 'vitest';
import { validateHarnessDefaultsMap } from '../../../src/main/harnessDefaultsValidation';

const DEFAULT_ENTRY = { model: '', favorites: [], flags: '' };

describe('validateHarnessDefaultsMap', () => {
  describe('valid payload', () => {
    it('passes through unchanged', () => {
      const input = {
        codex: { model: 'gpt-4', favorites: ['gpt-4', 'gpt-3.5'], flags: '--yolo' },
        opencode: { model: '', favorites: [], flags: '--pure' },
        pi: { model: 'sonnet', favorites: ['sonnet'], flags: '' },
        claude: { model: '', favorites: [], flags: '' },
      };
      const result = validateHarnessDefaultsMap(input);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.sanitized.codex.model).toBe('gpt-4');
        expect(result.sanitized.codex.favorites).toEqual(['gpt-4', 'gpt-3.5']);
        expect(result.sanitized.codex.flags).toBe('--yolo');
        expect(result.sanitized.opencode.model).toBe('');
        expect(result.sanitized.opencode.flags).toBe('--pure');
      }
    });
  });

  describe('unknown harness IDs', () => {
    it('strips unknown harness IDs', () => {
      const input = {
        codex: { model: 'gpt-4', favorites: [], flags: '' },
        unknown_harness: { model: 'bad', favorites: [], flags: '' },
        another_bad: { model: 'also-bad', favorites: [], flags: '' },
      };
      const result = validateHarnessDefaultsMap(input);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.sanitized.codex).toBeDefined();
        expect((result.sanitized as Record<string, unknown>)['unknown_harness']).toBeUndefined();
        expect((result.sanitized as Record<string, unknown>)['another_bad']).toBeUndefined();
      }
    });
  });

  describe('missing harness IDs', () => {
    it('fills missing harness IDs with defaults', () => {
      const input = {
        codex: { model: 'gpt-4', favorites: [], flags: '' },
        // opencode, pi, claude are missing
      };
      const result = validateHarnessDefaultsMap(input);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.sanitized.codex.model).toBe('gpt-4');
        expect(result.sanitized.opencode).toEqual(DEFAULT_ENTRY);
        expect(result.sanitized.pi).toEqual(DEFAULT_ENTRY);
        expect(result.sanitized.claude).toEqual(DEFAULT_ENTRY);
      }
    });
  });

  describe('malformed entry', () => {
    it('coerces wrong-type fields to defaults', () => {
      const input = {
        codex: { model: 123 as unknown, favorites: 'not an array', flags: true },
      };
      const result = validateHarnessDefaultsMap(input);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.sanitized.codex.model).toBe(''); // number coerced to ''
        expect(result.sanitized.codex.favorites).toEqual([]); // string coerced to []
        expect(result.sanitized.codex.flags).toBe(''); // boolean coerced to ''
      }
    });

    it('treats null entry as defaults', () => {
      const input = { codex: null } as unknown;
      const result = validateHarnessDefaultsMap(input);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.sanitized.codex).toEqual(DEFAULT_ENTRY);
      }
    });

    it('treats string entry as defaults', () => {
      const input = { codex: 'not an object' } as unknown;
      const result = validateHarnessDefaultsMap(input);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.sanitized.codex).toEqual(DEFAULT_ENTRY);
      }
    });

    it('treats array entry as defaults', () => {
      const input = { codex: ['array', 'entries'] } as unknown;
      const result = validateHarnessDefaultsMap(input);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.sanitized.codex).toEqual(DEFAULT_ENTRY);
      }
    });
  });

  describe('non-object payload', () => {
    it('rejects null', () => {
      const result = validateHarnessDefaultsMap(null);
      expect(result.valid).toBe(false);
      const errResult = result as { valid: false; error: string };
      expect(errResult.error).toBe('Payload must be a non-null object');
    });

    it('rejects undefined', () => {
      const result = validateHarnessDefaultsMap(undefined);
      expect(result.valid).toBe(false);
    });

    it('rejects a string', () => {
      const result = validateHarnessDefaultsMap('not an object');
      expect(result.valid).toBe(false);
    });

    it('rejects an array', () => {
      const result = validateHarnessDefaultsMap([{ codex: {} }]);
      expect(result.valid).toBe(false);
    });

    it('rejects a number', () => {
      const result = validateHarnessDefaultsMap(42);
      expect(result.valid).toBe(false);
    });
  });

  describe('favorites filtering', () => {
    it('filters non-string entries from favorites', () => {
      const input = {
        codex: {
          model: 'gpt-4',
          favorites: ['valid-model', 123, null, undefined, 'another-valid', {}],
          flags: '',
        },
      };
      const result = validateHarnessDefaultsMap(input);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.sanitized.codex.favorites).toEqual(['valid-model', 'another-valid']);
      }
    });

    it('accepts empty favorites array', () => {
      const input = {
        codex: { model: 'gpt-4', favorites: [], flags: '' },
      };
      const result = validateHarnessDefaultsMap(input);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.sanitized.codex.favorites).toEqual([]);
      }
    });

    it('accepts favorites with all valid strings', () => {
      const input = {
        codex: { model: 'gpt-4', favorites: ['gpt-4', 'gpt-3.5', 'claude-3'], flags: '' },
      };
      const result = validateHarnessDefaultsMap(input);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.sanitized.codex.favorites).toEqual(['gpt-4', 'gpt-3.5', 'claude-3']);
      }
    });
  });
});
