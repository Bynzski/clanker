// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useThemeStore } from '../../../src/renderer/theme/themeStore';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import DiffViewer from '../../../src/renderer/components/DiffViewer';

const mergeMocks = vi.hoisted(() => ({ instances: [] as {
  a: { state: import('@codemirror/state').EditorState; dispatch: ReturnType<typeof vi.fn> };
  b: { state: import('@codemirror/state').EditorState; dispatch: ReturnType<typeof vi.fn> };
  destroy: ReturnType<typeof vi.fn>;
}[] }));
vi.mock('@codemirror/merge', () => ({
  MergeView: class MockMergeView {
    a; b; destroy;
    constructor(options: import('@codemirror/merge').DirectMergeConfig) {
      const side = (config: import('@codemirror/state').EditorStateConfig) => {
        const editor = { state: EditorState.create(config), dispatch: vi.fn((spec: import('@codemirror/state').TransactionSpec) => { editor.state = editor.state.update(spec).state; }) };
        return editor;
      };
      this.a = side(options.a); this.b = side(options.b);
      const parent = options.parent!;
      const marker = document.createElement('div'); marker.className = 'mock-merge-view'; parent.appendChild(marker);
      this.destroy = vi.fn(() => parent.replaceChildren());
      mergeMocks.instances.push(this);
    }
  },
}));

describe('DiffViewer', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mergeMocks.instances.length = 0;
    useThemeStore.setState({ theme: 'dark' });
  });

  afterEach(cleanup);

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

  const themeProps = { oldContent: 'const old = 1;', newContent: 'const next = 2;', oldPath: 'a.ts', newPath: 'b.ts', isBinary: false, hasDiff: true, isLoading: false, error: null, onClose: mockOnClose };
  it.each(['dark', 'light'] as const)('initializes both sides in %s', (theme) => {
    useThemeStore.setState({ theme }); render(<DiffViewer {...themeProps} />);
    const merge = mergeMocks.instances[0];
    for (const side of [merge.a, merge.b]) {
      expect(side.state.facet(EditorView.darkTheme)).toBe(theme === 'dark');
      expect(side.state.readOnly).toBe(true);
      expect(side.state.facet(EditorView.editable)).toBe(false);
      expect(side.dispatch).not.toHaveBeenCalled();
    }
  });
  it('reconfigures both sides in place and keeps input changes independent', () => {
    const rendered = render(<DiffViewer {...themeProps} />);
    const merge = mergeMocks.instances[0], a = merge.a, b = merge.b;
    for (const theme of ['light', 'dark'] as const) {
      act(() => useThemeStore.setState({ theme }));
      expect(mergeMocks.instances).toEqual([merge]);
      expect(merge.destroy).not.toHaveBeenCalled();
      expect(merge.a).toBe(a); expect(merge.b).toBe(b);
      expect(a.state.doc.toString()).toBe(themeProps.oldContent);
      expect(b.state.doc.toString()).toBe(themeProps.newContent);
      for (const side of [a, b]) {
        expect(side.state.facet(EditorView.darkTheme)).toBe(theme === 'dark');
        expect(side.state.readOnly).toBe(true);
        expect(side.state.facet(EditorView.editable)).toBe(false);
      }
    }
    expect(a.dispatch).toHaveBeenCalledTimes(2); expect(b.dispatch).toHaveBeenCalledTimes(2);
    rendered.rerender(<DiffViewer {...themeProps} newContent="actual content change" />);
    expect(merge.destroy).toHaveBeenCalledOnce(); expect(mergeMocks.instances).toHaveLength(2);
    expect(mergeMocks.instances[1].b.state.doc.toString()).toBe('actual content change');
  });

  it.each([{ oldContent: 'changed HEAD text' }, { newPath: 'plain.txt' }])('keeps actual diff input changes in the creation lifecycle: %j', (changed) => {
    const rendered = render(<DiffViewer {...themeProps} />);
    const original = mergeMocks.instances[0];
    rendered.rerender(<DiffViewer {...themeProps} {...changed} />);
    expect(original.destroy).toHaveBeenCalledOnce();
    expect(mergeMocks.instances).toHaveLength(2);
  });

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

    it('calls onClose when overlay clicked', async () => {
      const user = userEvent.setup();
      renderDiffViewer({
        oldContent: 'line1\n',
        newContent: 'line2\n',
        hasDiff: true,
        newPath: 'file.ts',
      });
      const overlay = document.querySelector('.diff-viewer-overlay');
      expect(overlay).toBeTruthy();
      await user.click(overlay!);
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
