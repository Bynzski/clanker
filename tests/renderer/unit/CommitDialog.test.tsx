// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CommitDialog from '../../../src/renderer/components/CommitDialog';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';

describe('CommitDialog', () => {
  const mockOnClose = vi.fn();
  const mockOnCommit = vi.fn();
  const mockOnStageAll = vi.fn();
  const mockOnUnstage = vi.fn().mockResolvedValue({ success: true });
  const mockOnUnstageAll = vi.fn().mockResolvedValue({ success: true });

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnUnstage.mockResolvedValue({ success: true });
    mockOnUnstageAll.mockResolvedValue({ success: true });
    const workspace = createWorkspaceFixture({ id: 'workspace-1', lifecycle: 'active', browserOverlayCount: 0 });
    useWorkspaceStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: workspace.id,
      activeWorkspaceLifecycle: 'active',
      browserOverlayCount: 0,
    });
    window.electronAPI = {
      getAiCommitSettings: vi.fn().mockResolvedValue({ enabled: false }),
      generateCommitMessage: vi.fn(),
      gitGetFileDiff: vi.fn().mockResolvedValue({
        success: true,
        oldContent: 'old',
        newContent: 'new',
        oldPath: 'file.ts',
        newPath: 'file.ts',
        isBinary: false,
        hasDiff: true,
      }),
    } as unknown as typeof window.electronAPI;
  });

  function renderDialog(overrides = {}) {
    const props = {
      isOpen: true,
      onClose: mockOnClose,
      onCommit: mockOnCommit,
      onStageAll: mockOnStageAll,
      onUnstage: mockOnUnstage,
      onUnstageAll: mockOnUnstageAll,
      changes: [],
      workspacePath: '/workspace',
      ...overrides,
    };
    return render(<CommitDialog {...props} />);
  }

  // =========================================================================
  // Visibility
  // =========================================================================
  it('renders nothing when isOpen is false', () => {
    const { container } = renderDialog({ isOpen: false });
    expect(container.innerHTML).toBe('');
  });

  it('renders the dialog when isOpen is true', () => {
    renderDialog();
    expect(screen.getByText('Create Commit')).toBeTruthy();
  });

  // =========================================================================
  // Close behavior
  // =========================================================================
  it('calls onClose when close button is clicked', () => {
    renderDialog();
    fireEvent.click(screen.getByTitle('Close'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when overlay is clicked', () => {
    renderDialog();
    const overlay = document.querySelector('.commit-dialog-overlay');
    expect(overlay).toBeTruthy();
    // Simulate clicking the overlay background itself (not child)
    fireEvent.click(overlay!);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('does not call onClose on Escape when dialog is closed', () => {
    renderDialog({ isOpen: false });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    renderDialog();
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  // =========================================================================
  // File list
  // =========================================================================
  it('shows "No changes" when changes array is empty', () => {
    renderDialog({ changes: [] });
    expect(screen.getByText('No changes')).toBeTruthy();
  });

  it('shows file count with changes', () => {
    renderDialog({
      changes: [
        { path: 'file1.ts', status: 'modified' as const, staged: true },
        { path: 'file2.ts', status: 'added' as const, staged: true },
      ],
    });
    expect(screen.getByText('2 files changed')).toBeTruthy();
  });

  it('shows singular form for single file', () => {
    renderDialog({
      changes: [
        { path: 'file1.ts', status: 'modified' as const, staged: true },
      ],
    });
    expect(screen.getByText('1 file changed')).toBeTruthy();
  });

  it('shows status badges for each change', () => {
    renderDialog({
      changes: [
        { path: 'mod.ts', status: 'modified' as const, staged: true },
        { path: 'add.ts', status: 'added' as const, staged: true },
        { path: 'del.ts', status: 'deleted' as const, staged: true },
        { path: 'untracked.ts', status: 'untracked' as const, staged: false },
        { path: 'ren.ts', status: 'renamed' as const, staged: true },
      ],
    });
    expect(screen.getByText('M')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('D')).toBeTruthy();
    expect(screen.getByText('??')).toBeTruthy();
    expect(screen.getByText('R')).toBeTruthy();
  });

  it('shows staged check for staged files', () => {
    renderDialog({
      changes: [
        { path: 'staged.ts', status: 'modified' as const, staged: true },
      ],
    });
    expect(screen.getByTitle('Staged')).toBeTruthy();
  });

  // =========================================================================
  // Stage All button
  // =========================================================================
  it('shows Stage All button when there are unstaged changes', () => {
    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: false },
      ],
    });
    expect(screen.getByText('Stage All')).toBeTruthy();
  });

  it('does not show Stage All button when all changes are staged', () => {
    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: true },
      ],
    });
    expect(screen.queryByText('Stage All')).toBeNull();
  });

  it('calls onStageAll when Stage All is clicked', () => {
    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: false },
      ],
    });
    fireEvent.click(screen.getByText('Stage All'));
    expect(mockOnStageAll).toHaveBeenCalled();
  });

  // =========================================================================
  // Submit button text
  // =========================================================================
  it('shows "Stage All & Commit" when there are unstaged changes', () => {
    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: false },
      ],
    });
    expect(screen.getByText('Stage All & Commit')).toBeTruthy();
  });

  it('shows "Commit" when all changes are staged', () => {
    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: true },
      ],
    });
    expect(screen.getByText('Commit')).toBeTruthy();
  });

  // =========================================================================
  // Commit flow
  // =========================================================================
  it('shows error when submitting empty message', async () => {
    const { container } = renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: true },
      ],
    });
    const form = container.querySelector('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form!);
    await waitFor(() => {
      expect(screen.getByText('Please enter a commit message')).toBeTruthy();
    });
  });

  it('commits with message when all changes are staged', async () => {
    mockOnCommit.mockResolvedValue({ success: true });
    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: true },
      ],
    });

    const textarea = screen.getByPlaceholderText('Describe your changes...');
    fireEvent.change(textarea, { target: { value: 'fix: resolve issue' } });
    // Click the submit button instead of form submit
    fireEvent.click(screen.getByText('Commit'));

    await waitFor(() => {
      expect(mockOnStageAll).not.toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('stages all and commits when there are unstaged changes', async () => {
    mockOnStageAll.mockResolvedValue(undefined);
    mockOnCommit.mockResolvedValue({ success: true });
    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: false },
      ],
    });

    const textarea = screen.getByPlaceholderText('Describe your changes...');
    fireEvent.change(textarea, { target: { value: 'feat: add feature' } });
    // Click the submit button
    fireEvent.click(screen.getByText('Stage All & Commit'));

    await waitFor(() => {
      expect(mockOnCommit).toHaveBeenCalledWith('feat: add feature');
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('shows error when commit fails', async () => {
    mockOnCommit.mockResolvedValue({ success: false, error: 'Nothing to commit' });
    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: true },
      ],
    });

    const textarea = screen.getByPlaceholderText('Describe your changes...');
    fireEvent.change(textarea, { target: { value: 'my commit' } });
    // Click the submit button
    fireEvent.click(screen.getByText('Commit'));

    await waitFor(() => {
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  it('shows commit progress while the commit is running', async () => {
    let resolveCommit: ((value: { success: boolean; error?: string }) => void) | undefined;
    mockOnCommit.mockImplementation(
      () =>
        new Promise<{ success: boolean; error?: string }>((resolve) => {
          resolveCommit = resolve;
        })
    );

    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: true },
      ],
    });

    const textarea = screen.getByPlaceholderText('Describe your changes...');
    fireEvent.change(textarea, { target: { value: 'feat: add feature' } });
    fireEvent.click(screen.getByText('Commit'));

    await waitFor(() => {
      expect(screen.getByText('Running git hooks...')).toBeTruthy();
    });

    resolveCommit?.({ success: true });

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // AI message generation
  // =========================================================================
  it('shows Generate button when AI is enabled and there are changes', async () => {
    vi.mocked(window.electronAPI.getAiCommitSettings).mockResolvedValue({ enabled: true, provider: 'codex', model: '' });
    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: true },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Generate')).toBeTruthy();
    });
  });

  it('does not show Generate button when AI is disabled', () => {
    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: true },
      ],
    });
    expect(screen.queryByText('Generate')).toBeNull();
  });

  it('generates commit message when Generate is clicked', async () => {
    vi.mocked(window.electronAPI.getAiCommitSettings).mockResolvedValue({ enabled: true, provider: 'codex', model: '' });
    vi.mocked(window.electronAPI.generateCommitMessage).mockResolvedValue({
      success: true,
      message: 'fix: auto-generated message',
    });

    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: true },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Generate')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText('Describe your changes...') as HTMLTextAreaElement;
      expect(textarea.value).toBe('fix: auto-generated message');
    });
  });

  it('shows error when AI generation fails', async () => {
    vi.mocked(window.electronAPI.getAiCommitSettings).mockResolvedValue({ enabled: true, provider: 'codex', model: '' });
    vi.mocked(window.electronAPI.generateCommitMessage).mockResolvedValue({
      success: false,
      error: 'API rate limit exceeded',
    });

    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: true },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Generate')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByText('API rate limit exceeded')).toBeTruthy();
    });
  });

  // =========================================================================
  // Unstage (GAP-1)
  // =========================================================================
  it('shows Unstage All button when there are staged files', () => {
    renderDialog({
      changes: [
        { path: 'staged.ts', status: 'modified' as const, staged: true },
        { path: 'unstaged.ts', status: 'modified' as const, staged: false },
      ],
    });

    expect(screen.getByText('Unstage All')).toBeTruthy();
    expect(screen.getByText('Stage All')).toBeTruthy();
  });

  it('does not show Unstage All button when there are only unstaged files', () => {
    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: false },
      ],
    });

    expect(screen.queryByText('Unstage All')).toBeNull();
    expect(screen.getByText('Stage All')).toBeTruthy();
  });

  it('shows per-file unstage button for each staged file', () => {
    renderDialog({
      changes: [
        { path: 'staged1.ts', status: 'modified' as const, staged: true },
        { path: 'staged2.ts', status: 'added' as const, staged: true },
      ],
    });

    expect(screen.getAllByText('unstage')).toHaveLength(2);
  });

  it('does not show per-file unstage for unstaged files', () => {
    renderDialog({
      changes: [
        { path: 'unstaged.ts', status: 'modified' as const, staged: false },
      ],
    });

    expect(screen.queryByText('unstage')).toBeNull();
  });

  it('calls onUnstageAll when Unstage All is clicked', async () => {
    renderDialog({
      changes: [
        { path: 'staged.ts', status: 'modified' as const, staged: true },
      ],
    });

    fireEvent.click(screen.getByText('Unstage All'));

    await waitFor(() => {
      expect(mockOnUnstageAll).toHaveBeenCalled();
    });
  });

  it('calls onUnstage with the correct path when per-file unstage is clicked', async () => {
    renderDialog({
      changes: [
        { path: 'staged.ts', status: 'modified' as const, staged: true },
        { path: 'also-staged.ts', status: 'added' as const, staged: true },
      ],
    });

    const unstageButtons = screen.getAllByText('unstage');
    fireEvent.click(unstageButtons[0]);

    await waitFor(() => {
      expect(mockOnUnstage).toHaveBeenCalledWith('staged.ts');
    });
  });

  it('shows error message when unstage fails', async () => {
    mockOnUnstageAll.mockResolvedValueOnce({
      success: false,
      error: 'Failed to unstage: permission denied',
    });

    renderDialog({
      changes: [
        { path: 'staged.ts', status: 'modified' as const, staged: true },
      ],
    });

    fireEvent.click(screen.getByText('Unstage All'));

    await waitFor(() => {
      expect(screen.getByText('Failed to unstage: permission denied')).toBeTruthy();
    });
  });

  it('disables Unstage All while unstage is in progress', () => {
    mockOnUnstageAll.mockImplementation(
      async () => new Promise((r) => setTimeout(() => r({ success: true }), 100))
    );

    renderDialog({
      changes: [
        { path: 'staged.ts', status: 'modified' as const, staged: true },
      ],
    });

    fireEvent.click(screen.getByText('Unstage All'));
    // Button text changes to "Unstaging..." while in progress
    expect(screen.getByText('Unstaging...')).toBeDisabled();
  });

  it('disables footer buttons while unstage is in progress', () => {
    mockOnUnstageAll.mockImplementation(
      async () => new Promise((r) => setTimeout(() => r({ success: true }), 100))
    );

    renderDialog({
      changes: [
        { path: 'staged.ts', status: 'modified' as const, staged: true },
      ],
    });

    fireEvent.click(screen.getByText('Unstage All'));

    expect(screen.getByText('Cancel')).toBeDisabled();
    expect(screen.getByText('Commit')).toBeDisabled();
  });

  it('shows both Unstage All and Stage All when mixed staged/unstaged files', () => {
    renderDialog({
      changes: [
        { path: 'staged.ts', status: 'modified' as const, staged: true },
        { path: 'unstaged.ts', status: 'modified' as const, staged: false },
      ],
    });

    expect(screen.getByText('Unstage All')).toBeTruthy();
    expect(screen.getByText('Stage All')).toBeTruthy();
  });

  // =========================================================================
  // Browser overlay
  // =========================================================================
  it('pushes browser overlay on mount and pops on unmount', () => {
    const { unmount } = renderDialog();
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(1);
    expect(useWorkspaceStore.getState().workspaces[0]?.browserOverlayCount).toBe(1);
    unmount();
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(0);
    expect(useWorkspaceStore.getState().workspaces[0]?.browserOverlayCount).toBe(0);
  });

  // =========================================================================
  // Eye icon (diff viewer) tests
  // =========================================================================
  it('shows eye icon for each changed file', () => {
    renderDialog({
      changes: [
        { path: 'file1.ts', status: 'modified' as const, staged: true },
        { path: 'file2.ts', status: 'modified' as const, staged: false },
      ],
    });
    const eyeButtons = screen.queryAllByTitle('View diff');
    expect(eyeButtons).toHaveLength(2);
  });

  it('shows eye icon for both staged and unstaged files', () => {
    renderDialog({
      changes: [
        { path: 'staged.ts', status: 'modified' as const, staged: true },
        { path: 'unstaged.ts', status: 'modified' as const, staged: false },
      ],
    });
    const eyeButtons = screen.queryAllByTitle('View diff');
    expect(eyeButtons).toHaveLength(2);
  });

  it('calls gitGetFileDiff with correct args when eye icon clicked for staged file', async () => {
    renderDialog({
      workspacePath: '/test/workspace',
      changes: [
        { path: 'staged.ts', status: 'modified' as const, staged: true },
      ],
    });

    fireEvent.click(screen.getByTitle('View diff'));

    await waitFor(() => {
      expect(window.electronAPI.gitGetFileDiff).toHaveBeenCalledWith(
        '/test/workspace',
        'staged.ts',
        'staged'
      );
    });
  });


  it('calls gitGetFileDiff with correct args when eye icon clicked for unstaged file', async () => {
    renderDialog({
      workspacePath: '/test/workspace',
      changes: [
        { path: 'unstaged.ts', status: 'modified' as const, staged: false },
      ],
    });

    fireEvent.click(screen.getByTitle('View diff'));

    await waitFor(() => {
      expect(window.electronAPI.gitGetFileDiff).toHaveBeenCalledWith(
        '/test/workspace',
        'unstaged.ts',
        'working'
      );
    });
  });

  it('eye icon is disabled while commit is in progress', async () => {
    mockOnCommit.mockImplementation(
      async () => new Promise((r) => setTimeout(() => r({ success: true }), 100))
    );

    renderDialog({
      changes: [
        { path: 'file.ts', status: 'modified' as const, staged: true },
      ],
    });

    // Start a commit by typing a message and clicking Commit
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test message' } });
    fireEvent.click(screen.getByText('Commit'));

    // Eye button should be disabled
    const eyeButton = screen.getByTitle('View diff');
    expect(eyeButton).toBeDisabled();
  });
});
