// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import NotesPane from '../../../src/renderer/components/NotesPane';
import { getNotesContentStorageKey } from '../../../src/renderer/lib/notesStorage';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';

function setupWorkspace(overrides: Parameters<typeof createWorkspaceFixture>[0] = {}) {
  const workspace = createWorkspaceFixture({
    id: 'ws-notes',
    workspacePath: '/workspace/notes',
    notesVisible: true,
    notesPane: { id: 'notes-1' },
    ...overrides,
  });

  useWorkspaceStore.setState({
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    activeWorkspaceLifecycle: 'active',
    ...workspace,
  });

  return workspace;
}

function installLocalStorageMock() {
  let store: Record<string, string> = {};
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
    },
  });
}

describe('NotesPane', () => {
  beforeEach(() => {
    installLocalStorageMock();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('loads existing local notes for the workspace path', () => {
    setupWorkspace();
    window.localStorage.setItem('clanker-grid:notes:v1:/workspace/notes', 'remember this');

    render(<NotesPane workspaceId="ws-notes" />);

    expect(screen.getByPlaceholderText('Notes…')).toHaveValue('remember this');
    expect(window.localStorage.getItem(getNotesContentStorageKey('/workspace/notes', 'ws-notes'))).toBe('remember this');
  });

  it('writes edits to localStorage without a save action', () => {
    setupWorkspace();
    render(<NotesPane workspaceId="ws-notes" />);

    expect(screen.getByPlaceholderText('Notes…')).toHaveClass('clanker-textarea');
    expect(screen.getByRole('button', { name: 'Close notes' })).toHaveClass('clanker-icon-button');
    fireEvent.change(screen.getByPlaceholderText('Notes…'), {
      target: { value: 'local scratch note' },
    });

    expect(window.localStorage.getItem(getNotesContentStorageKey('/workspace/notes', 'ws-notes'))).toBe('local scratch note');
  });

  it('uses one storage key for trailing-slash variants of a workspace path', () => {
    const workspace = createWorkspaceFixture({
      id: 'ws-notes',
      workspacePath: '/workspace/notes/',
      notesVisible: true,
      notesPane: { id: 'notes-1' },
    });
    useWorkspaceStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: workspace.id,
      activeWorkspaceLifecycle: 'active',
      ...workspace,
    });

    render(<NotesPane workspaceId="ws-notes" />);
    fireEvent.change(screen.getByPlaceholderText('Notes…'), {
      target: { value: 'same key' },
    });

    expect(window.localStorage.getItem(getNotesContentStorageKey('/workspace/notes', 'ws-notes'))).toBe('same key');
    expect(window.localStorage.getItem('clanker-grid:notes:v1:/workspace/notes/')).toBeNull();
  });

  it('uses one storage key for Windows path casing variants', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });

    try {
      expect(getNotesContentStorageKey('C:\\Users\\Jay\\Project', 'ws-notes')).toBe(
        getNotesContentStorageKey('c:/users/jay/project', 'ws-notes')
      );
      expect(getNotesContentStorageKey('/Repos/Jay', 'remote-id', 'ssh-server')).not.toBe(
        getNotesContentStorageKey('/repos/jay', 'remote-id', 'ssh-server'),
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('keeps same-path local and SSH note content independent across workspace switches', () => {
    setupWorkspace();
    const localView = render(<NotesPane workspaceId="ws-notes" />);
    fireEvent.change(screen.getByPlaceholderText('Notes…'), { target: { value: 'local only' } });
    localView.unmount();

    setupWorkspace({ id: 'ws-remote', environmentId: 'ssh-server' });
    const remoteView = render(<NotesPane workspaceId="ws-remote" />);
    expect(screen.getByPlaceholderText('Notes…')).toHaveValue('');
    fireEvent.change(screen.getByPlaceholderText('Notes…'), { target: { value: 'remote only' } });
    remoteView.unmount();

    setupWorkspace();
    render(<NotesPane workspaceId="ws-notes" />);
    expect(screen.getByPlaceholderText('Notes…')).toHaveValue('local only');
    expect(window.localStorage.getItem(getNotesContentStorageKey('/workspace/notes', 'ws-remote', 'ssh-server'))).toBe('remote only');
  });

  it('never imports path-only legacy note content into an SSH workspace', () => {
    window.localStorage.setItem('clanker-grid:notes:v1:/workspace/notes', 'local legacy');
    setupWorkspace({ id: 'ws-remote', environmentId: 'ssh-server' });
    render(<NotesPane workspaceId="ws-remote" />);

    expect(screen.getByPlaceholderText('Notes…')).toHaveValue('');
    expect(window.localStorage.getItem(getNotesContentStorageKey('/workspace/notes', 'ws-remote', 'ssh-server'))).toBeNull();
  });

  it('closes the notes pane from the pane header', () => {
    setupWorkspace();
    render(<NotesPane workspaceId="ws-notes" />);

    fireEvent.click(screen.getByLabelText('Close notes'));

    expect(useWorkspaceStore.getState().notesVisible).toBe(false);
  });

  it('renders presentation controls inside the single notes header before close button', () => {
    setupWorkspace({
      activePageId: 'page-1',
      pages: [
        {
          id: 'page-1',
          layoutRoot: { type: 'leaf', nodeId: 'leaf-notes', paneId: 'notes-1' },
          layoutRevision: 1,
          layoutUndoStack: [],
          activeTerminalId: null,
        },
      ],
      layoutRoot: { type: 'leaf', nodeId: 'leaf-notes', paneId: 'notes-1' },
      minimizedPanes: [],
    });
    render(<NotesPane workspaceId="ws-notes" />);

    const header = document.querySelector('.notes-pane-header')!;
    expect(header).toBeTruthy();
    expect(document.querySelector('.utility-presentation-controls')).toBeNull();

    const minimizeBtn = screen.getByRole('button', { name: 'Minimize pane' });
    const maximizeBtn = screen.getByRole('button', { name: 'Maximize pane' });
    const closeBtn = screen.getByRole('button', { name: 'Close notes' });

    expect(header).toContainElement(minimizeBtn);
    expect(header).toContainElement(maximizeBtn);
    expect(header).toContainElement(closeBtn);

    // Verify ordering: minimize -> maximize -> close
    const children = Array.from(header.children);
    const minimizeIndex = children.indexOf(minimizeBtn);
    const maximizeIndex = children.indexOf(maximizeBtn);
    const closeIndex = children.indexOf(closeBtn);

    expect(minimizeIndex).toBeLessThan(maximizeIndex);
    expect(maximizeIndex).toBeLessThan(closeIndex);

    // Test clicking minimize pane from header
    fireEvent.click(minimizeBtn);
    expect(useWorkspaceStore.getState().workspaces[0].minimizedPanes?.some((e) => e.paneId === 'notes-1')).toBe(true);
  });
});
