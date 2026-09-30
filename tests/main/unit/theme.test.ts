/**
 * Theme Model and Metadata Tests
 *
 * Verifies canonical theme identity, runtime validation, normalization,
 * and appearance metadata mappings.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THEME_ID,
  THEME_IDS,
  THEME_METADATA,
  isThemeId,
  normalizeThemeId,
  getThemeMetadata,
} from '../../../src/shared/types/theme';

describe('theme model', () => {
  it('defines dark as the default theme', () => {
    expect(DEFAULT_THEME_ID).toBe('dark');
  });

  it('includes dark, light and slate in THEME_IDS', () => {
    expect(THEME_IDS).toContain('dark');
    expect(THEME_IDS).toContain('light');
    expect(THEME_IDS).toContain('slate');
    expect(THEME_IDS).toHaveLength(3);
  });

  describe('isThemeId', () => {
    it('returns true for dark', () => {
      expect(isThemeId('dark')).toBe(true);
    });

    it('returns true for slate', () => {
      expect(isThemeId('slate')).toBe(true);
    });

    it('returns true for light', () => {
      expect(isThemeId('light')).toBe(true);
    });

    it('returns false for invalid strings and non-string values', () => {
      expect(isThemeId('')).toBe(false);
      expect(isThemeId('solarized')).toBe(false);
      expect(isThemeId('DARK')).toBe(false);
      expect(isThemeId(null)).toBe(false);
      expect(isThemeId(undefined)).toBe(false);
      expect(isThemeId(123)).toBe(false);
      expect(isThemeId({})).toBe(false);
      expect(isThemeId([])).toBe(false);
    });
  });

  describe('normalizeThemeId', () => {
    it('returns the same ThemeId for valid inputs', () => {
      expect(normalizeThemeId('dark')).toBe('dark');
      expect(normalizeThemeId('light')).toBe('light');
      expect(normalizeThemeId('slate')).toBe('slate');
    });

    it('normalizes invalid, legacy, or corrupt values to DEFAULT_THEME_ID', () => {
      expect(normalizeThemeId('unknown-theme')).toBe('dark');
      expect(normalizeThemeId('')).toBe('dark');
      expect(normalizeThemeId(null)).toBe('dark');
      expect(normalizeThemeId(undefined)).toBe('dark');
      expect(normalizeThemeId(42)).toBe('dark');
      expect(normalizeThemeId({ theme: 'light' })).toBe('dark');
    });
  });

  describe('THEME_METADATA', () => {
    it('provides exhaustive metadata for all registered ThemeIds', () => {
      for (const id of THEME_IDS) {
        const meta = THEME_METADATA[id];
        expect(meta).toBeDefined();
        expect(meta.id).toBe(id);
        expect(meta.colorScheme).toBe(id === 'light' ? 'light' : 'dark');
        expect(typeof meta.windowBackground).toBe('string');
        expect(meta.windowBackground.startsWith('#')).toBe(true);
      }
    });

    it('maps dark to #121212 windowBackground and dark colorScheme', () => {
      expect(THEME_METADATA.dark).toEqual({
        id: 'dark',
        label: 'Dark',
        colorScheme: 'dark',
        windowBackground: '#121212',
      });
    });

    it('maps light to #f3f4f6 windowBackground and light colorScheme', () => {
      expect(THEME_METADATA.light).toEqual({
        id: 'light',
        label: 'Light',
        colorScheme: 'light',
        windowBackground: '#f3f4f6',
      });
    });
  });

  describe('getThemeMetadata', () => {
    it('retrieves metadata for valid themes', () => {
      expect(getThemeMetadata('dark').windowBackground).toBe('#121212');
      expect(getThemeMetadata('light').windowBackground).toBe('#f3f4f6');
    });

    it('safely falls back to default theme metadata for invalid inputs', () => {
      expect(getThemeMetadata('invalid').id).toBe('dark');
      expect(getThemeMetadata(null).id).toBe('dark');
      expect(getThemeMetadata(undefined).id).toBe('dark');
    });
  });
});
