// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DiffViewer from '../../../src/renderer/components/DiffViewer';

vi.mock('@codemirror/merge', () => ({
  MergeView: class MockMergeView {
    private parent: HTMLElement;

    constructor(options: { parent: HTMLElement }) {
      this.parent = options.parent;
      const marker = document.createElement('div');
      marker.className = 'mock-merge-view';
      this.parent.appendChild(marker);
    }

    destroy() {
      this.parent.replaceChildren();
    }
  },
}));

describe('DiffViewer', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderDiffViewer(overrides = {}) {
    const props = {
      oldContent: '',
      newContent: '',
      oldPath: '',
      newPath: '',
      isBinary: false,
      hasDiff: false,
      isLoading: false,
      error: null,
      onClose: mockOnClose,
      ...overrides,
    };
    return render(<DiffViewer {...props} />);
  }

  // =========================================================================
  // Loading state
  // =========================================================================
  describe('loading state', () => {
    it('renders loading state', () => {
      renderDiffViewer({ isLoading: true });
      expect(screen.getByText('Loading diff...')).toBeTruthy();
      expect(screen.getByText('Loading...')).toBeTruthy();
    });
  });

  // =========================================================================
  // Error state
  // =========================================================================
  describe('error state', () => {
    it('renders error state', () => {
      renderDiffViewer({ error: 'Something went wrong' });
      expect(screen.getByText('Diff Error')).toBeTruthy();
      expect(screen.getByText('Something went wrong')).toBeTruthy();
    });
  });

  // =========================================================================
  // Binary file state
  // =========================================================================
  describe('binary file state', () => {
    it('renders binary message', () => {
      renderDiffViewer({ isBinary: true, newPath: 'image.png' });
      expect(screen.getByText('Binary file — diff not shown')).toBeTruthy();
    });
  });

  // =========================================================================
  // No changes state
  // =========================================================================
  describe('no changes state', () => {
    it('renders no changes message', () => {
      renderDiffViewer({ hasDiff: false, newPath: 'file.ts' });
      expect(screen.getByText('No changes')).toBeTruthy();
    });
  });

  // =========================================================================
  // Diff content
  // =========================================================================
  describe('diff content', () => {
    it('renders diff content', () => {
      renderDiffViewer({
        oldContent: 'line1\nline2\n',
        newContent: 'line1\nmodified\n',
        hasDiff: true,
        newPath: 'file.ts',
      });
      const mergeRoot = document.querySelector('.diff-viewer-merge-root');
      expect(mergeRoot).toBeTruthy();
      expect(mergeRoot?.querySelector('.mock-merge-view')).toBeTruthy();
    });
  });

  // =========================================================================
  // Close behavior
  // =========================================================================
  describe('close behavior', () => {
    it('calls onClose when close button clicked', () => {
      renderDiffViewer({
        oldContent: 'line1\n',
        newContent: 'line2\n',
        hasDiff: true,
        newPath: 'file.ts',
      });
      fireEvent.click(screen.getByTitle('Close'));
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onClose when overlay clicked', () => {
      renderDiffViewer({
        oldContent: 'line1\n',
        newContent: 'line2\n',
        hasDiff: true,
        newPath: 'file.ts',
      });
      const overlay = document.querySelector('.diff-viewer-overlay');
      expect(overlay).toBeTruthy();
      fireEvent.click(overlay!);
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // File paths
  // =========================================================================
  describe('file paths', () => {
    it('shows file paths in pane headers', () => {
      renderDiffViewer({
        oldContent: 'line1\n',
        newContent: 'line2\n',
        hasDiff: true,
        oldPath: 'old-file.txt',
        newPath: 'new-file.txt',
      });
      // Check that both paths appear in pane headers specifically
      const oldPaneHeaders = document.querySelectorAll('.diff-viewer-pane-header');
      expect(oldPaneHeaders[0].textContent).toBe('old-file.txt');
      expect(oldPaneHeaders[1].textContent).toBe('new-file.txt');
    });
  });

  // =========================================================================
  // Empty content handling
  // =========================================================================
  describe('empty content handling', () => {
    it('handles empty old content (new file)', () => {
      renderDiffViewer({
        oldContent: '',
        newContent: 'hello\n',
        hasDiff: true,
        oldPath: '',
        newPath: 'newfile.txt',
      });
      // Should show "(new file)" as the old path label
      expect(screen.getByText('(new file)')).toBeTruthy();
    });

    it('handles empty new content (deleted file)', () => {
      renderDiffViewer({
        oldContent: 'hello\n',
        newContent: '',
        hasDiff: true,
        oldPath: 'deleted.txt',
        newPath: '',
      });
      // Should show "(deleted)" as the new path label
      expect(screen.getByText('(deleted)')).toBeTruthy();
    });
  });
});
