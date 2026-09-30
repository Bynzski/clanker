/**
 * Canonical Theme Model and Metadata
 *
 * Defines the application-wide theme identity and appearance metadata.
 * Both main and renderer processes import from this canonical module.
 */

export type ThemeId = 'dark' | 'light' | 'slate';

export const THEME_IDS: readonly ThemeId[] = ['dark', 'light', 'slate'] as const;

export const DEFAULT_THEME_ID: ThemeId = 'dark';

export interface ThemeMetadata {
  id: ThemeId;
  label: string;
  colorScheme: 'dark' | 'light';
  windowBackground: string;
}

export const THEME_METADATA: Readonly<Record<ThemeId, ThemeMetadata>> = {
  dark: {
    id: 'dark',
    label: 'Dark',
    colorScheme: 'dark',
    windowBackground: '#121212',
  },
  light: {
    id: 'light',
    label: 'Light',
    colorScheme: 'light',
    windowBackground: '#f3f4f6',
  },
  slate: {
    id: 'slate',
    label: 'Slate',
    colorScheme: 'dark',
    windowBackground: '#22272e',
  },
} as const;

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

export function normalizeThemeId(value: unknown): ThemeId {
  if (isThemeId(value)) {
    return value;
  }
  return DEFAULT_THEME_ID;
}

export function getThemeMetadata(value: unknown): ThemeMetadata {
  const id = normalizeThemeId(value);
  return THEME_METADATA[id];
}
