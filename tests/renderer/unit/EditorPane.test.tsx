// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

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
      workspaces: [],
      activeWorkspaceId: null,
      activeWorkspaceLifecycle: null,
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
    it('reads editor state from the requested workspace', () => {
      const parkedWorkspace = createWorkspaceFixture({
        id: 'ws-1',
        lifecycle: 'parked',
        editorVisible: true,
        editorPane: { id: 'editor-1', locked: false },
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace-a/alpha.ts',
            fileName: 'alpha.ts',
            isDirty: false,
            content: 'export const alpha = 1;',
            originalContent: 'export const alpha = 1;',
          },
        ],
        activeEditorTabId: 'tab-1',
      });
      const activeWorkspace = createWorkspaceFixture({
        id: 'ws-2',
        lifecycle: 'active',
        editorVisible: false,
        editorPane: null,
        editorTabs: [],
        activeEditorTabId: null,
      });

      useWorkspaceStore.setState({
        workspaces: [parkedWorkspace, activeWorkspace],
        activeWorkspaceId: 'ws-2',
        editorVisible: false,
        editorPane: null,
        editorTabs: [],
        activeEditorTabId: null,
      });

      render(<EditorPane workspaceId="ws-1" />);

      expect(screen.getByText('alpha.ts')).toBeTruthy();
      expect(document.querySelector('.editor-content')).toBeTruthy();
    });

    it('marks parked workspace editor instances as non-interactive', () => {
      const parkedWorkspace = createWorkspaceFixture({
        id: 'ws-1',
        lifecycle: 'parked',
        editorVisible: true,
        editorPane: { id: 'editor-1', locked: false },
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace-a/alpha.ts',
            fileName: 'alpha.ts',
            isDirty: false,
            content: 'export const alpha = 1;',
            originalContent: 'export const alpha = 1;',
          },
        ],
        activeEditorTabId: 'tab-1',
      });
      const activeWorkspace = createWorkspaceFixture({
        id: 'ws-2',
        lifecycle: 'active',
        editorVisible: false,
      });

      useWorkspaceStore.setState({
        workspaces: [parkedWorkspace, activeWorkspace],
        activeWorkspaceId: 'ws-2',
        activeWorkspaceLifecycle: 'active',
      });

      render(<EditorPane workspaceId="ws-1" />);

      expect(document.querySelector('.editor-panel')).toHaveAttribute('data-workspace-interactive', 'false');
      expect(document.querySelector('.editor-pane-lock-btn')).toBeDisabled();
      expect(document.querySelector('.editor-tab')).toBeDisabled();
    });

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

  // =========================================================================
  // External Change Banner
  // =========================================================================
  describe('external change banner', () => {
    it('renders reload banner when hasExternalChange is true', () => {
      useWorkspaceStore.setState({
        editorVisible: true,
        editorPane: { id: 'editor-1', locked: false },
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: true,
            content: 'const x = 1;',
            originalContent: 'const x = 1;',
            hasExternalChange: true,
          },
        ],
        activeEditorTabId: 'tab-1',
        toggleEditorLock: vi.fn(),
        reloadEditorTab: vi.fn().mockResolvedValue(undefined),
        clearEditorTabExternalFlag: vi.fn(),
      });

      render(<EditorPane />);

      const banner = document.querySelector('.editor-reload-banner');
      expect(banner).toBeTruthy();
      expect(screen.getByText('This file has been modified externally.')).toBeTruthy();
      expect(screen.getByText('Reload')).toBeTruthy();
      expect(screen.getByText('Keep Mine')).toBeTruthy();
    });

    it('calls reloadEditorTab when Reload button is clicked', () => {
      const reloadEditorTab = vi.fn().mockResolvedValue(undefined);
      useWorkspaceStore.setState({
        editorVisible: true,
        editorPane: { id: 'editor-1', locked: false },
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: true,
            content: 'const x = 1;',
            originalContent: 'const x = 1;',
            hasExternalChange: true,
          },
        ],
        activeEditorTabId: 'tab-1',
        toggleEditorLock: vi.fn(),
        reloadEditorTab,
        clearEditorTabExternalFlag: vi.fn(),
      });

      render(<EditorPane />);

      const reloadBtn = screen.getByText('Reload');
      reloadBtn.click();

      expect(reloadEditorTab).toHaveBeenCalledWith('tab-1');
    });

    it('calls clearEditorTabExternalFlag when Keep Mine is clicked', () => {
      const clearEditorTabExternalFlag = vi.fn();
      useWorkspaceStore.setState({
        editorVisible: true,
        editorPane: { id: 'editor-1', locked: false },
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: true,
            content: 'const x = 1;',
            originalContent: 'const x = 1;',
            hasExternalChange: true,
          },
        ],
        activeEditorTabId: 'tab-1',
        toggleEditorLock: vi.fn(),
        reloadEditorTab: vi.fn().mockResolvedValue(undefined),
        clearEditorTabExternalFlag,
      });

      render(<EditorPane />);

      const keepMineBtn = screen.getByText('Keep Mine');
      keepMineBtn.click();

      expect(clearEditorTabExternalFlag).toHaveBeenCalledWith('tab-1');
    });

    it('does not show banner when hasExternalChange is false', () => {
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

      const banner = document.querySelector('.editor-reload-banner');
      expect(banner).toBeNull();
    });
  });

  // =========================================================================
  // Deleted File Banner
  // =========================================================================
  describe('deleted file banner', () => {
    it('renders danger banner when isDeleted is true', () => {
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
            isDeleted: true,
          },
        ],
        activeEditorTabId: 'tab-1',
        toggleEditorLock: vi.fn(),
        closeEditorTab: vi.fn(),
        saveEditorFile: vi.fn().mockResolvedValue(true),
      });

      render(<EditorPane />);

      const banner = document.querySelector('.editor-reload-banner--danger');
      expect(banner).toBeTruthy();
      expect(screen.getByText('This file has been deleted.')).toBeTruthy();
      expect(screen.getByText('Close')).toBeTruthy();
      expect(screen.getByText('Save')).toBeTruthy();
    });

    it('calls closeEditorTab when Close button is clicked on deleted banner', () => {
      const closeEditorTab = vi.fn();
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
            isDeleted: true,
          },
        ],
        activeEditorTabId: 'tab-1',
        toggleEditorLock: vi.fn(),
        closeEditorTab,
        saveEditorFile: vi.fn().mockResolvedValue(true),
      });

      render(<EditorPane />);

      // There are two buttons with "Close" text — the pane close button and the banner close
      // The banner buttons are inside .editor-reload-banner--danger
      const banner = document.querySelector('.editor-reload-banner--danger');
      const closeBtn = Array.from(banner!.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Close'
      );
      closeBtn!.click();

      expect(closeEditorTab).toHaveBeenCalledWith('tab-1');
    });

    it('calls saveEditorFile when Save button is clicked on deleted banner', () => {
      const saveEditorFile = vi.fn().mockResolvedValue(true);
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
            isDeleted: true,
          },
        ],
        activeEditorTabId: 'tab-1',
        toggleEditorLock: vi.fn(),
        closeEditorTab: vi.fn(),
        saveEditorFile,
      });

      render(<EditorPane />);

      const banner = document.querySelector('.editor-reload-banner--danger');
      const saveBtn = Array.from(banner!.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Save'
      );
      saveBtn!.click();

      expect(saveEditorFile).toHaveBeenCalledWith('tab-1');
    });
  });
});
