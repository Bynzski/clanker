// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import EditorTabBar from '../../../src/renderer/components/EditorTabBar';

describe('EditorTabBar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installElectronApiMock();

    useWorkspaceStore.setState({
      editorTabs: [],
      activeEditorTabId: null,
      setActiveEditorTab: vi.fn(),
      closeEditorTab: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // =========================================================================
  // Empty State
  // =========================================================================
  describe('empty state', () => {
    it('renders nothing when editorTabs is empty', () => {
      const { container } = render(<EditorTabBar />);
      expect(container.firstChild).toBeNull();
    });

    it('does not render tab bar when no tabs are open', () => {
      render(<EditorTabBar />);
      expect(document.querySelector('.editor-tab-bar')).toBeNull();
    });
  });

  // =========================================================================
  // Tab Rendering
  // =========================================================================
  describe('tab rendering', () => {
    it('renders tabs for each open file', () => {
      useWorkspaceStore.setState({
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: false,
            content: 'const x = 1;',
            originalContent: 'const x = 1;',
          },
          {
            id: 'tab-2',
            filePath: '/workspace/app.ts',
            fileName: 'app.ts',
            isDirty: false,
            content: 'const y = 2;',
            originalContent: 'const y = 2;',
          },
        ],
        activeEditorTabId: 'tab-1',
        setActiveEditorTab: vi.fn(),
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const tabs = document.querySelectorAll('.editor-tab');
      expect(tabs).toHaveLength(2);
      expect(screen.getByText('test.ts')).toBeTruthy();
      expect(screen.getByText('app.ts')).toBeTruthy();
    });

    it('renders tab bar with role="tablist"', () => {
      useWorkspaceStore.setState({
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
        setActiveEditorTab: vi.fn(),
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const tabBar = document.querySelector('[role="tablist"]');
      expect(tabBar).toBeTruthy();
    });

    it('renders each tab with role="tab"', () => {
      useWorkspaceStore.setState({
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
        setActiveEditorTab: vi.fn(),
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const tabs = document.querySelectorAll('[role="tab"]');
      expect(tabs).toHaveLength(1);
    });
  });

  // =========================================================================
  // Active Tab Highlighting
  // =========================================================================
  describe('active tab highlighting', () => {
    it('marks the active tab with .active class', () => {
      useWorkspaceStore.setState({
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: false,
            content: 'const x = 1;',
            originalContent: 'const x = 1;',
          },
          {
            id: 'tab-2',
            filePath: '/workspace/app.ts',
            fileName: 'app.ts',
            isDirty: false,
            content: 'const y = 2;',
            originalContent: 'const y = 2;',
          },
        ],
        activeEditorTabId: 'tab-2',
        setActiveEditorTab: vi.fn(),
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const activeTab = document.querySelector('.editor-tab.active');
      expect(activeTab).toBeTruthy();
      expect(activeTab?.textContent).toContain('app.ts');
    });

    it('does not mark inactive tabs with .active class', () => {
      useWorkspaceStore.setState({
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: false,
            content: 'const x = 1;',
            originalContent: 'const x = 1;',
          },
          {
            id: 'tab-2',
            filePath: '/workspace/app.ts',
            fileName: 'app.ts',
            isDirty: false,
            content: 'const y = 2;',
            originalContent: 'const y = 2;',
          },
        ],
        activeEditorTabId: 'tab-2',
        setActiveEditorTab: vi.fn(),
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const inactiveTabs = document.querySelectorAll('.editor-tab:not(.active)');
      expect(inactiveTabs).toHaveLength(1);
    });

    it('sets aria-selected="true" on the active tab', () => {
      useWorkspaceStore.setState({
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
        setActiveEditorTab: vi.fn(),
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const activeTab = document.querySelector('[aria-selected="true"]');
      expect(activeTab).toBeTruthy();
    });
  });

  // =========================================================================
  // Dirty Indicator
  // =========================================================================
  describe('dirty indicator', () => {
    it('shows dirty indicator on dirty tabs', () => {
      useWorkspaceStore.setState({
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: true,
            content: 'const x = 1; // modified',
            originalContent: 'const x = 1;',
          },
        ],
        activeEditorTabId: 'tab-1',
        setActiveEditorTab: vi.fn(),
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const dirtyIndicator = document.querySelector('.editor-tab-dirty');
      expect(dirtyIndicator).toBeTruthy();
    });

    it('does not show dirty indicator on clean tabs', () => {
      useWorkspaceStore.setState({
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
        setActiveEditorTab: vi.fn(),
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const dirtyIndicator = document.querySelector('.editor-tab-dirty');
      expect(dirtyIndicator).toBeNull();
    });

    it('shows dirty indicator only on tabs that are dirty', () => {
      useWorkspaceStore.setState({
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: true,
            content: 'const x = 1; // modified',
            originalContent: 'const x = 1;',
          },
          {
            id: 'tab-2',
            filePath: '/workspace/app.ts',
            fileName: 'app.ts',
            isDirty: false,
            content: 'const y = 2;',
            originalContent: 'const y = 2;',
          },
        ],
        activeEditorTabId: 'tab-1',
        setActiveEditorTab: vi.fn(),
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const dirtyIndicators = document.querySelectorAll('.editor-tab-dirty');
      expect(dirtyIndicators).toHaveLength(1);
    });
  });

  // =========================================================================
  // Tab Click Handling
  // =========================================================================
  describe('tab click handling', () => {
    it('calls setActiveEditorTab when a tab is clicked', () => {
      const setActiveEditorTab = vi.fn();
      useWorkspaceStore.setState({
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
        activeEditorTabId: null,
        setActiveEditorTab,
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const tab = document.querySelector('.editor-tab') as HTMLButtonElement;
      tab.click();

      expect(setActiveEditorTab).toHaveBeenCalledWith('tab-1');
    });

    it('calls setActiveEditorTab with correct tab id when multiple tabs exist', () => {
      const setActiveEditorTab = vi.fn();
      useWorkspaceStore.setState({
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: false,
            content: 'const x = 1;',
            originalContent: 'const x = 1;',
          },
          {
            id: 'tab-2',
            filePath: '/workspace/app.ts',
            fileName: 'app.ts',
            isDirty: false,
            content: 'const y = 2;',
            originalContent: 'const y = 2;',
          },
        ],
        activeEditorTabId: 'tab-1',
        setActiveEditorTab,
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const tabs = document.querySelectorAll('.editor-tab');
      (tabs[1] as HTMLButtonElement).click();

      expect(setActiveEditorTab).toHaveBeenCalledWith('tab-2');
    });
  });

  // =========================================================================
  // Close Button Handling
  // =========================================================================
  describe('close button handling', () => {
    it('calls closeEditorTab when close button is clicked', () => {
      const closeEditorTab = vi.fn();
      useWorkspaceStore.setState({
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
        setActiveEditorTab: vi.fn(),
        closeEditorTab,
      });

      render(<EditorTabBar />);

      const closeBtn = document.querySelector('.editor-tab-close') as HTMLSpanElement;
      closeBtn.click();

      expect(closeEditorTab).toHaveBeenCalledWith('tab-1');
    });

    it('stops event propagation when close button is clicked', () => {
      const setActiveEditorTab = vi.fn();
      const closeEditorTab = vi.fn();
      useWorkspaceStore.setState({
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
        activeEditorTabId: null,
        setActiveEditorTab,
        closeEditorTab,
      });

      render(<EditorTabBar />);

      const closeBtn = document.querySelector('.editor-tab-close') as HTMLSpanElement;
      closeBtn.click();

      expect(setActiveEditorTab).not.toHaveBeenCalled();
      expect(closeEditorTab).toHaveBeenCalled();
    });

    it('calls closeEditorTab with correct tab id when multiple tabs exist', () => {
      const closeEditorTab = vi.fn();
      useWorkspaceStore.setState({
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: false,
            content: 'const x = 1;',
            originalContent: 'const x = 1;',
          },
          {
            id: 'tab-2',
            filePath: '/workspace/app.ts',
            fileName: 'app.ts',
            isDirty: false,
            content: 'const y = 2;',
            originalContent: 'const y = 2;',
          },
        ],
        activeEditorTabId: 'tab-1',
        setActiveEditorTab: vi.fn(),
        closeEditorTab,
      });

      render(<EditorTabBar />);

      const closeButtons = document.querySelectorAll('.editor-tab-close');
      (closeButtons[1] as HTMLSpanElement).click();

      expect(closeEditorTab).toHaveBeenCalledWith('tab-2');
    });
  });

  // =========================================================================
  // Accessibility
  // =========================================================================
  describe('accessibility', () => {
    it('has aria-label on the tab bar', () => {
      useWorkspaceStore.setState({
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
        setActiveEditorTab: vi.fn(),
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const tabBar = screen.getByRole('tablist');
      expect(tabBar).toHaveAttribute('aria-label', 'Open files');
    });

    it('has title attribute with full file path', () => {
      useWorkspaceStore.setState({
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/nested/path/test.ts',
            fileName: 'test.ts',
            isDirty: false,
            content: 'const x = 1;',
            originalContent: 'const x = 1;',
          },
        ],
        activeEditorTabId: 'tab-1',
        setActiveEditorTab: vi.fn(),
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const tab = document.querySelector('.editor-tab');
      expect(tab).toHaveAttribute('title', '/workspace/nested/path/test.ts');
    });

    it('has aria-label on close buttons with the file name', () => {
      useWorkspaceStore.setState({
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
        setActiveEditorTab: vi.fn(),
        closeEditorTab: vi.fn(),
      });

      render(<EditorTabBar />);

      const closeBtn = document.querySelector('.editor-tab-close');
      expect(closeBtn).toHaveAttribute('aria-label', 'Close test.ts');
    });
  });
});
