// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';

// Mock CodeMirror modules synchronously (vi.mock is hoisted so all references must be inline)
vi.mock('@codemirror/state', () => ({
  EditorState: {
    create: vi.fn(({ doc }: { doc: string }) => ({
      doc: { toString: () => doc },
      facet: vi.fn(() => []),
      extensionField: vi.fn(),
      update: vi.fn(() => ({ state: {} })),
    })),
  },
  StateEffect: {
    define: vi.fn(() => ({ is: vi.fn(() => false) })),
    appendConfig: { of: vi.fn(() => ({})), type: { map: vi.fn(), implements: true } },
    reconfigure: { of: vi.fn(() => ({})) },
  },
  Compartment: class MockCompartment {
    of = vi.fn(() => ({}));
    reconfigure = vi.fn(() => ({}));
  },
}));

vi.mock('@codemirror/view', () => {
  // Define the mock constructor inline (can't reference outer class due to hoisting)
  const MockEditorView = function (this: Record<string, unknown>) {
    this.dom = { addEventListener: vi.fn() };
    this.state = {
      doc: { toString: vi.fn(() => '') },
      facet: vi.fn(() => []),
      extensionField: vi.fn(),
    };
    this.dispatch = vi.fn();
    this.destroy = vi.fn();
    this.setState = vi.fn();
  };
  (MockEditorView as unknown as Record<string, unknown>).updateListener = { of: vi.fn(() => ({})) };
  (MockEditorView as unknown as Record<string, unknown>).lineWrapping = true;
  return {
    EditorView: MockEditorView as unknown as typeof import('@codemirror/view').EditorView,
    lineNumbers: vi.fn(() => ({})),
    highlightActiveLine: vi.fn(() => ({})),
    keymap: { of: vi.fn(() => ({})) },
  };
});

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: vi.fn(() => ({})),
}));

vi.mock('@codemirror/lang-javascript', () => ({
  javascript: vi.fn(() => ({})),
}));

vi.mock('@codemirror/theme-one-dark', () => ({
  oneDark: {},
}));

vi.mock('../../../src/renderer/components/DynamicPaneLayout', () => ({
  useDragHandle: vi.fn().mockReturnValue({}),
}));

// Import EditorPane AFTER mocks are set up
import EditorPane from '../../../src/renderer/components/EditorPane';

describe('EditorPane', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installElectronApiMock();

    // Set up a minimal store state for all tests
    useWorkspaceStore.setState({
      editorVisible: true,
      editorPane: null,
      editorTabs: [],
      activeEditorTabId: null,
      toggleEditorLock: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // =========================================================================
  // Rendering
  // =========================================================================
  describe('renders', () => {
    it('editor panel container', () => {
      render(<EditorPane />);
      expect(document.querySelector('.editor-panel')).toBeTruthy();
    });

    it('header with "Editor" title', () => {
      render(<EditorPane />);
      expect(screen.getByText('Editor')).toBeTruthy();
    });

    it('drag handle element', () => {
      render(<EditorPane />);
      const dragHandle = document.querySelector('.editor-pane-drag-handle');
      expect(dragHandle).toBeTruthy();
    });

    it('content area', () => {
      render(<EditorPane />);
      const contentArea = document.querySelector('.editor-content-area');
      expect(contentArea).toBeTruthy();
    });
  });

  // =========================================================================
  // Empty State
  // =========================================================================
  describe('empty state', () => {
    it('shows empty state message when no tabs are open', () => {
      render(<EditorPane />);
      expect(screen.getByText('No file open')).toBeTruthy();
    });

    it('shows hint text about double-clicking in the empty state', () => {
      render(<EditorPane />);
      expect(
        screen.getByText('Double-click a file in the explorer to open it')
      ).toBeTruthy();
    });

    it('does not render editor content div when no tabs are open', () => {
      render(<EditorPane />);
      const editorContent = document.querySelector('.editor-content');
      expect(editorContent).toBeNull();
    });

    it('renders content div when tabs exist', () => {
      useWorkspaceStore.setState({
        editorVisible: true,
        editorPane: { id: 'editor-1', locked: false },
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: false,
            content: 'const x = 1;',
            originalContent: 'const x = 1;',
          },
        ],
        activeEditorTabId: 'tab-1',
        toggleEditorLock: vi.fn(),
      });

      render(<EditorPane />);
      const editorContent = document.querySelector('.editor-content');
      expect(editorContent).toBeTruthy();
    });
  });

  // =========================================================================
  // Lock Button
  // =========================================================================
  describe('lock button', () => {
    it('renders lock button', () => {
      render(<EditorPane />);
      const lockBtn = document.querySelector('.editor-pane-lock-btn');
      expect(lockBtn).toBeTruthy();
    });

    it('shows lock button when editor pane is locked', () => {
      useWorkspaceStore.setState({
        editorVisible: true,
        editorPane: { id: 'editor-1', locked: true },
        editorTabs: [],
        activeEditorTabId: null,
        toggleEditorLock: vi.fn(),
      });

      render(<EditorPane />);
      const lockBtn = document.querySelector('.editor-pane-lock-btn');
      expect(lockBtn).toBeTruthy();
    });

    it('calls toggleEditorLock when lock button is clicked', () => {
      const toggleEditorLock = vi.fn();
      useWorkspaceStore.setState({
        editorVisible: true,
        editorPane: { id: 'editor-1', locked: false },
        editorTabs: [],
        activeEditorTabId: null,
        toggleEditorLock,
      });

      render(<EditorPane />);
      const lockBtn = document.querySelector('.editor-pane-lock-btn') as HTMLButtonElement;
      lockBtn.click();

      expect(toggleEditorLock).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Visibility
  // =========================================================================
  describe('visibility', () => {
    it('renders when editorVisible is true', () => {
      useWorkspaceStore.setState({
        editorVisible: true,
        editorPane: null,
        editorTabs: [],
        activeEditorTabId: null,
        toggleEditorLock: vi.fn(),
      });

      render(<EditorPane />);
      expect(document.querySelector('.editor-panel')).toBeTruthy();
    });

    it('returns null and renders nothing when editorVisible is false', () => {
      useWorkspaceStore.setState({
        editorVisible: false,
        editorPane: null,
        editorTabs: [],
        activeEditorTabId: null,
        toggleEditorLock: vi.fn(),
      });

      const { container } = render(<EditorPane />);
      expect(container.firstChild).toBeNull();
    });
  });

  // =========================================================================
  // Store Integration
  // =========================================================================
  describe('store integration', () => {
    it('renders header with lock button from store state', () => {
      useWorkspaceStore.setState({
        editorVisible: true,
        editorPane: { id: 'editor-1', locked: false },
        editorTabs: [],
        activeEditorTabId: null,
        toggleEditorLock: vi.fn(),
      });

      render(<EditorPane />);

      const lockBtn = document.querySelector('.editor-pane-lock-btn');
      expect(lockBtn).toBeTruthy();
    });

    it('renders content area that changes when tabs are added', () => {
      useWorkspaceStore.setState({
        editorVisible: true,
        editorPane: null,
        editorTabs: [],
        activeEditorTabId: null,
        toggleEditorLock: vi.fn(),
      });

      const { rerender } = render(<EditorPane />);

      expect(document.querySelector('.editor-content')).toBeNull();

      useWorkspaceStore.setState({
        editorVisible: true,
        editorPane: { id: 'editor-1', locked: false },
        editorTabs: [
          {
            id: 'tab-new',
            filePath: '/workspace/new.ts',
            fileName: 'new.ts',
            isDirty: false,
            content: 'hello',
            originalContent: 'hello',
          },
        ],
        activeEditorTabId: 'tab-new',
        toggleEditorLock: vi.fn(),
      });

      rerender(<EditorPane />);

      expect(document.querySelector('.editor-content')).toBeTruthy();
    });
  });
});
