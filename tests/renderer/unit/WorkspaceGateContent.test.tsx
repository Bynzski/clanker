// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorkspaceGateContent, { TERMINAL_PRESETS } from '../../../src/renderer/components/WorkspaceGateContent';

// Platform-neutral path constants for test fixtures
const TEST_HOME_USER = path.join(path.sep === '\\' ? 'C:\\Users\\user' : '/home', 'user');
const TEST_PROJECTS = path.join(TEST_HOME_USER, 'projects');
const TEST_PROJECT = path.join(TEST_HOME_USER, 'project');

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
      getLastWorkspace: vi.fn().mockResolvedValue(TEST_HOME_USER + path.sep),
      getBaseDirectory: vi.fn().mockResolvedValue(TEST_PROJECTS + path.sep),
      openBaseDirectoryDialog: vi.fn().mockResolvedValue(null),
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
    renderGate({ initialPath: TEST_PROJECT + path.sep });
    const input = screen.getByPlaceholderText('project name') as HTMLInputElement;
    expect(input.value).toBe(TEST_PROJECT + path.sep);
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
      const input = screen.getByPlaceholderText('project name') as HTMLInputElement;
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
      const input = screen.getByPlaceholderText('project name') as HTMLInputElement;
      expect(input.value).toBe('/workspace');
    });
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workspace/' })
    );
  });

  it('accepts UNC-style absolute paths on submit', async () => {
    renderGate({ initialPath: '//server/share/repo' });
    await waitFor(() => {
      const input = screen.getByPlaceholderText('project name') as HTMLInputElement;
      expect(input.value).toBe('//server/share/repo');
    });
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ path: '//server/share/repo/' })
    );
  });

  it('does not submit when path is empty', () => {
    renderGate({ initialPath: '' });
    // Override input to be empty
    const input = screen.getByPlaceholderText('project name');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('resolves relative input against the base directory on submit', async () => {
    renderGate({ initialPath: 'my-project' });
    // Wait for base to load before submitting
    await waitFor(() => {
      expect(window.electronAPI.getBaseDirectory).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByText('Launch Workspace'));
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ path: path.join(TEST_PROJECTS, 'my-project') + path.sep })
      );
    });
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
      const input = screen.getByPlaceholderText('project name') as HTMLInputElement;
      expect(input.value).toBe('/selected/dir/');
    });
  });

  // =========================================================================
  // Keyboard shortcuts
  // =========================================================================
  it('submits on Enter key', async () => {
    renderGate({ initialPath: '/workspace/' });
    await waitFor(() => {
      const input = screen.getByPlaceholderText('project name') as HTMLInputElement;
      expect(input.value).toBe('/workspace/');
    });
    const input = screen.getByPlaceholderText('project name');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnSubmit).toHaveBeenCalled();
  });

  // =========================================================================
  // Model selector
  // =========================================================================
  it('shows model picker when a harness is selected', async () => {
    renderGate();
    await waitFor(() => {
      expect(screen.getByText('Codex')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Codex'));
    // New compact picker shows a model pill instead of "Model" label
    await waitFor(() => {
      expect(document.querySelector('.model-pill')).toBeTruthy();
    });
  });

  it('does not show model picker for terminal-only mode', async () => {
    renderGate();
    await waitFor(() => {
      expect(screen.getByText('Terminal')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Terminal'));
    // Terminal-only mode should not show the model picker
    expect(document.querySelector('.model-picker')).toBeNull();
  });
});
