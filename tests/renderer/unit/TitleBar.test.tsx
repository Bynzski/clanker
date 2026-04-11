// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TitleBar from '../../../src/renderer/components/TitleBar';

describe('TitleBar', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      electronAPI: {
        isMaximizedWindow: vi.fn().mockResolvedValue(false),
        minimizeWindow: vi.fn(),
        toggleMaximizeWindow: vi.fn().mockResolvedValue(undefined),
        closeWindow: vi.fn(),
        // WorkspaceTabs dependencies
        getAvailableHarnessOptions: vi.fn().mockResolvedValue({}),
        getModels: vi.fn().mockResolvedValue([]),
        getSettings: vi.fn().mockResolvedValue({}),
        killTerminal: vi.fn().mockResolvedValue({ success: true }),
      },
    });
  });

  it('renders the app name', () => {
    render(<TitleBar />);
    expect(screen.getByText('Clanker Grid')).toBeTruthy();
  });

  it('renders minimize, maximize, and close buttons', () => {
    render(<TitleBar />);
    expect(screen.getByTitle('Minimize window')).toBeTruthy();
    expect(screen.getByTitle('Maximize window')).toBeTruthy();
    expect(screen.getByTitle('Close window')).toBeTruthy();
  });

  it('calls minimizeWindow when minimize is clicked', () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByTitle('Minimize window'));
    expect(window.electronAPI.minimizeWindow).toHaveBeenCalled();
  });

  it('calls closeWindow when close is clicked', () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByTitle('Close window'));
    expect(window.electronAPI.closeWindow).toHaveBeenCalled();
  });

  it('calls toggleMaximizeWindow when maximize is clicked', () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByTitle('Maximize window'));
    expect(window.electronAPI.toggleMaximizeWindow).toHaveBeenCalled();
  });
});
