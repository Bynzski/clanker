import { describe, expect, it } from 'vitest';
import { THEME_IDS, getThemeMetadata } from '../../../src/shared/types/theme';
import { getTerminalTheme } from '../../../src/renderer/theme/terminalTheme';

const ANSI_ROLES = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
  'brightMagenta', 'brightCyan', 'brightWhite',
] as const;

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)!.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('terminal palette contract', () => {
  it.each(THEME_IDS)('provides complete ANSI and interaction colors for %s', (theme) => {
    const palette = getTerminalTheme(theme);
    for (const role of [...ANSI_ROLES, 'background', 'foreground', 'cursor', 'cursorAccent', 'selectionBackground'] as const) {
      expect(palette[role], role).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(palette.background).toBe(getThemeMetadata(theme).windowBackground);
  });

  it('preserves the production Dark palette exactly', () => {
    expect(getTerminalTheme('dark')).toEqual({
      background: '#121212', foreground: '#e8e8e8', cursor: '#8b949e',
      cursorAccent: '#121212', selectionBackground: '#2f2f2f',
      black: '#121212', red: '#f85149', green: '#3fb950', yellow: '#d29922',
      blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#e8e8e8',
      brightBlack: '#9b9b9b', brightRed: '#ffa198', brightGreen: '#56d364',
      brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd', brightWhite: '#ffffff',
    });
  });

  it.each(ANSI_ROLES)('keeps Light %s readable against its default background', (role) => {
    const palette = getTerminalTheme('light');
    // Practical foreground floor; explicit ANSI backgrounds/inverse video are
    // application-controlled and cannot all satisfy a single contrast rule.
    expect(contrast(palette[role]!, palette.background!)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps default Light text, cursor and selected text visible', () => {
    const palette = getTerminalTheme('light');
    expect(contrast(palette.foreground!, palette.background!)).toBeGreaterThanOrEqual(7);
    expect(contrast(palette.cursor!, palette.background!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.selectionForeground!, palette.selectionBackground!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.selectionForeground!, palette.selectionInactiveBackground!)).toBeGreaterThanOrEqual(4.5);
  });

  it('returns independent option objects', () => {
    const palette = getTerminalTheme('light');
    palette.background = '#000000';
    expect(getTerminalTheme('light').background).toBe('#f3f4f6');
  });
});
