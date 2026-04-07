// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorkspaceGateContent, { TERMINAL_PRESETS } from '../../../src/renderer/components/WorkspaceGateContent';

describe('WorkspaceGateContent', () => {
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock localStorage for jsdom
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
      clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
    });
    window.electronAPI = {
      getLastWorkspace: vi.fn().mockResolvedValue('/home/user/'),
      getHarnessOptions: vi.fn().mockResolvedValue({
        codex: true,
        claude: false,
        opencode: false,
        pi: false,
      }),
      getHarnessModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4', label: 'GPT-4' },
        { id: 'gpt-3.5', label: 'GPT-3.5' },
      ]),
      openDirectoryDialog: vi.fn().mockResolvedValue(null),
      readDirectory: vi.fn().mockResolvedValue([]),
    } as unknown as typeof window.electronAPI;
  });

  function renderGate(overrides: { initialPath?: string } = {}) {
    return render(<WorkspaceGateContent onSubmit={mockOnSubmit} {...overrides} />);
  }

  // =========================================================================
  // Rendering
  // =========================================================================
  it('renders the title and subtitle', () => {
    renderGate();
    expect(screen.getByText('Clanker Grid')).toBeTruthy();
    expect(screen.getByText('Developer Workspace Launcher')).toBeTruthy();
  });

  it('renders the Launch Workspace button', () => {
    renderGate();
    expect(screen.getByText('Launch Workspace')).toBeTruthy();
  });

  it('renders terminal presets', () => {
    renderGate();
    for (const preset of TERMINAL_PRESETS) {
      expect(screen.getByText(new RegExp(`${preset.count} terminal`))).toBeTruthy();
    }
  });

  it('uses initialPath when provided', () => {
    renderGate({ initialPath: '/home/user/project/' });
    const input = screen.getByPlaceholderText('/home/username/projects/') as HTMLInputElement;
    expect(input.value).toBe('/home/user/project/');
  });

  // =========================================================================
  // Terminal preset selection
  // =========================================================================
  it('selects terminal preset on click', () => {
    renderGate({ initialPath: '/workspace/' });
    const preset1 = screen.getByText('1 terminal');
    fireEvent.click(preset1);
    // The preset should now be selected (visual confirmation via class)
    expect(preset1.closest('.grid-option')?.classList.contains('selected')).toBe(true);
  });

  // =========================================================================
  // Harness selection
  // =========================================================================
  it('shows available harnesses from electron API', async () => {
    renderGate();
    await waitFor(() => {
      // Only codex is enabled in our mock, plus the terminal-only option
      expect(screen.getByText('Codex')).toBeTruthy();
    });
  });

  it('changes harness on click', async () => {
    renderGate();
    await waitFor(() => {
      expect(screen.getByText('Codex')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Codex'));
    // Should load models for codex
    await waitFor(() => {
      expect(window.electronAPI.getHarnessModels).toHaveBeenCalledWith('codex');
    });
  });

  // =========================================================================
  // Form submission
  // =========================================================================
  it('calls onSubmit with correct data', async () => {
    renderGate({ initialPath: '/workspace/' });
    await waitFor(() => {
      const input = screen.getByPlaceholderText('/home/username/projects/') as HTMLInputElement;
      expect(input.value).toBe('/workspace/');
    });
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/workspace/',
        terminalCount: expect.any(Number),
        harness: expect.any(String),
      })
    );
  });

  it('appends trailing slash to path on submit', async () => {
    renderGate({ initialPath: '/workspace' });
    await waitFor(() => {
      const input = screen.getByPlaceholderText('/home/username/projects/') as HTMLInputElement;
      expect(input.value).toBe('/workspace');
    });
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workspace/' })
    );
  });

  it('does not submit when path is empty', () => {
    renderGate({ initialPath: '' });
    // Override input to be empty
    const input = screen.getByPlaceholderText('/home/username/projects/');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('does not submit when path does not start with /', () => {
    renderGate({ initialPath: 'relative/path' });
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Directory picker
  // =========================================================================
  it('opens directory picker when browse button is clicked', async () => {
    renderGate({ initialPath: '/workspace/' });
    const browseBtn = screen.getByTitle('Browse directories');
    fireEvent.click(browseBtn);
    expect(window.electronAPI.openDirectoryDialog).toHaveBeenCalled();
  });

  it('updates path when directory is selected', async () => {
    vi.mocked(window.electronAPI.openDirectoryDialog).mockResolvedValue('/selected/dir');
    renderGate({ initialPath: '/workspace/' });
    fireEvent.click(screen.getByTitle('Browse directories'));
    await waitFor(() => {
      const input = screen.getByPlaceholderText('/home/username/projects/') as HTMLInputElement;
      expect(input.value).toBe('/selected/dir/');
    });
  });

  // =========================================================================
  // Keyboard shortcuts
  // =========================================================================
  it('submits on Enter key', async () => {
    renderGate({ initialPath: '/workspace/' });
    await waitFor(() => {
      const input = screen.getByPlaceholderText('/home/username/projects/') as HTMLInputElement;
      expect(input.value).toBe('/workspace/');
    });
    const input = screen.getByPlaceholderText('/home/username/projects/');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnSubmit).toHaveBeenCalled();
  });

  // =========================================================================
  // Model selector
  // =========================================================================
  it('shows model selector when a harness is selected', async () => {
    renderGate();
    await waitFor(() => {
      expect(screen.getByText('Codex')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Codex'));
    await waitFor(() => {
      expect(screen.getByText('Model')).toBeTruthy();
    });
  });

  it('does not show model selector for terminal-only mode', async () => {
    renderGate();
    await waitFor(() => {
      expect(screen.getByText('Terminal')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Terminal'));
    expect(screen.queryByText('Model')).toBeNull();
  });
});
