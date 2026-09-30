import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore } from '../../../src/renderer/theme/themeStore';
import { startTerminalThemeSync } from '../../../src/renderer/theme/themeRuntime';
import { getTerminalTheme, registerThemedTerminal, unregisterThemedTerminal } from '../../../src/renderer/theme/terminalTheme';

const terminal = { options: {} };
let stop: () => void;
beforeEach(() => {
  useThemeStore.setState({ theme: 'dark' });
  registerThemedTerminal(terminal, 'dark');
});
afterEach(() => {
  stop?.();
  unregisterThemedTerminal(terminal);
});

describe('renderer terminal theme subscription', () => {
  it.each(['light', 'slate'] as const)('synchronizes %s and installs only one subscription', (theme) => {
    useThemeStore.setState({ theme });
    stop = startTerminalThemeSync();
    expect(terminal.options).toEqual({ theme: getTerminalTheme(theme) });
    expect(startTerminalThemeSync()).toBe(stop);
    const setter = vi.fn();
    Object.defineProperty(terminal.options, 'theme', { set: setter, configurable: true });
    useThemeStore.setState({ theme: 'dark' });
    expect(setter).toHaveBeenCalledOnce();
    useThemeStore.setState({ resolved: true });
    expect(setter).toHaveBeenCalledOnce();
    delete (terminal.options as { theme?: unknown }).theme;
  });

  it('can stop and restart without leaving an old subscription', () => {
    stop = startTerminalThemeSync();
    const oldStop = stop;
    oldStop();
    useThemeStore.setState({ theme: 'light' });
    expect(terminal.options).toEqual({ theme: getTerminalTheme('dark') });
    stop = startTerminalThemeSync();
    oldStop();
    expect(startTerminalThemeSync()).toBe(stop);
    expect(terminal.options).toEqual({ theme: getTerminalTheme('light') });
    useThemeStore.setState({ theme: 'dark' });
    expect(terminal.options).toEqual({ theme: getTerminalTheme('dark') });
  });
});
