import type { ITheme, Terminal } from '@xterm/xterm';
import type { ThemeId } from '../../shared/types/theme';

// ANSI roles are foreground colors, including white, on the theme's default
// background. Light variants deliberately use darker hues for readability.
const TERMINAL_THEMES: Readonly<Record<ThemeId, Readonly<ITheme>>> = {
  dark: {
    scrollbarSliderBackground: '#3a3a3a',
    scrollbarSliderHoverBackground: '#9b9b9b',
    scrollbarSliderActiveBackground: '#9b9b9b',
    background: '#121212',
    foreground: '#e8e8e8',
    cursor: '#8b949e',
    cursorAccent: '#121212',
    selectionBackground: '#2f2f2f',
    black: '#121212',
    red: '#f85149',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#e8e8e8',
    brightBlack: '#9b9b9b',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#ffffff',
  },
  slate: {
    scrollbarSliderBackground: '#545d68',
    scrollbarSliderHoverBackground: '#768390',
    scrollbarSliderActiveBackground: '#768390',
    background: '#22272e',
    foreground: '#adbac7',
    cursor: '#6cb6ff',
    cursorAccent: '#22272e',
    selectionBackground: '#384e6b',
    selectionInactiveBackground: '#373e47',
    selectionForeground: '#cdd9e5',
    black: '#545d68',
    red: '#f47067',
    green: '#57ab5a',
    yellow: '#c69026',
    blue: '#539bf5',
    magenta: '#b083f0',
    cyan: '#39c5cf',
    white: '#909dab',
    brightBlack: '#909dab',
    brightRed: '#ff938a',
    brightGreen: '#6bc46d',
    brightYellow: '#daaa3f',
    brightBlue: '#6cb6ff',
    brightMagenta: '#dcbdfb',
    brightCyan: '#56d4dd',
    brightWhite: '#cdd9e5',
  },
  light: {
    scrollbarSliderBackground: '#b1bac6',
    scrollbarSliderHoverBackground: '#8895a5',
    scrollbarSliderActiveBackground: '#8895a5',
    background: '#f3f4f6',
    foreground: '#202630',
    cursor: '#46566b',
    cursorAccent: '#f3f4f6',
    selectionBackground: '#bed5f2',
    selectionInactiveBackground: '#d4deeb',
    selectionForeground: '#202630',
    black: '#202630',
    red: '#a32929',
    green: '#236b35',
    yellow: '#795600',
    blue: '#245da8',
    magenta: '#7840a0',
    cyan: '#176b78',
    white: '#525e6d',
    brightBlack: '#626d7b',
    brightRed: '#bc3535',
    brightGreen: '#28783d',
    brightYellow: '#886300',
    brightBlue: '#286bc2',
    brightMagenta: '#8b47b3',
    brightCyan: '#197a86',
    brightWhite: '#657080',
  },
};

/** Give each xterm its own options object, keeping the canonical palette intact. */
export function getTerminalTheme(theme: ThemeId): ITheme {
  return { ...TERMINAL_THEMES[theme] };
}

type ThemedTerminal = Pick<Terminal, 'options'> & Partial<Pick<Terminal, 'element'>>;
const livingTerminals = new Set<ThemedTerminal>();

function applyTerminalTheme(terminal: ThemedTerminal, theme: ThemeId): void {
  const palette = getTerminalTheme(theme);
  terminal.options.theme = palette;
  // xterm 6 colors the inner scrollable element, but its outer viewport CSS
  // defaults to black. Keep the uncovered gutter on the same background.
  if (terminal.element) terminal.element.style.backgroundColor = palette.background ?? '';
}

/** Registration survives DOM detach/cache; only disposal ends membership. */
export function registerThemedTerminal(terminal: ThemedTerminal, theme: ThemeId): void {
  applyTerminalTheme(terminal, theme);
  livingTerminals.add(terminal);
}

export function unregisterThemedTerminal(terminal: ThemedTerminal): void {
  livingTerminals.delete(terminal);
}

export function applyTerminalThemeToRegisteredTerminals(theme: ThemeId): void {
  for (const terminal of livingTerminals) {
    applyTerminalTheme(terminal, theme);
  }
}
