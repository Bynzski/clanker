// @vitest-environment jsdom

/**
 * Renderer Bootstrap & Startup Handshake Tests
 *
 * Verifies that:
 * 1. The persisted theme is applied to document root before signalling ready-to-show.
 * 2. Theme initialization failures fall back to Dark and do not leave the app permanently hidden.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { bootstrap } from '../../../src/renderer/main';
import { useThemeStore } from '../../../src/renderer/theme/themeStore';
import { startTerminalThemeSync } from '../../../src/renderer/theme/themeRuntime';
import { getTerminalTheme, registerThemedTerminal, unregisterThemedTerminal } from '../../../src/renderer/theme/terminalTheme';
import { installElectronApiMock } from '../../setup/electron';

// Mock child components of App to isolate bootstrap logic
vi.mock('../../../src/renderer/components/Header', () => ({
  default: () => <div data-testid="header">Header</div>,
}));

vi.mock('../../../src/renderer/components/TitleBar', () => ({
  default: () => <div data-testid="title-bar">TitleBar</div>,
}));

vi.mock('../../../src/renderer/components/StatusBar', () => ({
  default: () => <div data-testid="status-bar">StatusBar</div>,
}));

vi.mock('../../../src/renderer/components/WorkspaceGate', () => ({
  WorkspaceGateFullscreen: () => <div data-testid="gate">Gate</div>,
  WorkspaceGateModal: () => null,
}));

vi.mock('../../../src/renderer/lib/harnessDefaultsMigration', () => ({
  migrateLegacyFavorites: vi.fn().mockResolvedValue(undefined),
}));

describe('bootstrap startup handshake', () => {
  let rootContainer: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';

    useThemeStore.setState({
      theme: 'dark',
      resolved: false,
    });

    rootContainer = document.createElement('div');
    rootContainer.id = 'root';
    document.body.appendChild(rootContainer);
  });

  afterEach(() => {
    cleanup();
    startTerminalThemeSync()();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('applies the persisted light ThemeId before signalling windowReadyToShow', async () => {
    const terminal = { options: {} };
    registerThemedTerminal(terminal, 'dark');
    let terminalThemeWhenSignalled;
    let themeAppliedWhenSignalled: string | null = null;
    let colorSchemeWhenSignalled: string | null = null;

    const mockGetTheme = vi.fn().mockResolvedValue('light');
    const mockWindowReadyToShow = vi.fn().mockImplementation(() => {
      // Capture DOM state at the exact moment windowReadyToShow is invoked
      themeAppliedWhenSignalled = document.documentElement.getAttribute('data-theme');
      colorSchemeWhenSignalled = document.documentElement.style.colorScheme;
      terminalThemeWhenSignalled = terminal.options;
      return Promise.resolve();
    });

    installElectronApiMock({
      getTheme: mockGetTheme,
      windowReadyToShow: mockWindowReadyToShow,
    });

    await act(async () => {
      await bootstrap(rootContainer);
    });

    expect(terminalThemeWhenSignalled).toEqual({ theme: getTerminalTheme('light') });
    unregisterThemedTerminal(terminal);
    expect(mockGetTheme).toHaveBeenCalledTimes(1);
    expect(mockWindowReadyToShow).toHaveBeenCalledTimes(1);

    // Guaranteed order: data-theme and colorScheme must ALREADY be 'light' before signal
    expect(themeAppliedWhenSignalled).toBe('light');
    expect(colorSchemeWhenSignalled).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies the persisted dark ThemeId before signalling windowReadyToShow', async () => {
    let themeAppliedWhenSignalled: string | null = null;

    const mockGetTheme = vi.fn().mockResolvedValue('dark');
    const mockWindowReadyToShow = vi.fn().mockImplementation(() => {
      themeAppliedWhenSignalled = document.documentElement.getAttribute('data-theme');
      return Promise.resolve();
    });

    installElectronApiMock({
      getTheme: mockGetTheme,
      windowReadyToShow: mockWindowReadyToShow,
    });
    await act(async () => {
      await bootstrap(rootContainer);
    });

    expect(mockGetTheme).toHaveBeenCalledTimes(1);
    expect(mockWindowReadyToShow).toHaveBeenCalledTimes(1);
    expect(themeAppliedWhenSignalled).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('falls back to dark on theme initialization error and still signals windowReadyToShow', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mockGetTheme = vi.fn().mockRejectedValue(new Error('Store failure'));
    const mockWindowReadyToShow = vi.fn().mockResolvedValue(undefined);

    installElectronApiMock({
      getTheme: mockGetTheme,
      windowReadyToShow: mockWindowReadyToShow,
    });

    await act(async () => {
      await bootstrap(rootContainer);
    });

    expect(mockGetTheme).toHaveBeenCalledTimes(1);

    // Safe fallback to dark
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');

    // Never left permanently hidden
    expect(mockWindowReadyToShow).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });
});
