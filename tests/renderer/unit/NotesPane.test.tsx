// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import NotesPane from '../../../src/renderer/components/NotesPane';
import { getNotesContentStorageKey } from '../../../src/renderer/lib/notesStorage';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';

function setupWorkspace() {
  const workspace = createWorkspaceFixture({
    id: 'ws-notes',
    workspacePath: '/workspace/notes',
    notesVisible: true,
    notesPane: { id: 'notes-1' },
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

    expect(screen.getByPlaceholderText('Notes...')).toHaveValue('remember this');
  });

  it('writes edits to localStorage without a save action', () => {
    setupWorkspace();
    render(<NotesPane workspaceId="ws-notes" />);

    fireEvent.change(screen.getByPlaceholderText('Notes...'), {
      target: { value: 'local scratch note' },
    });

    expect(window.localStorage.getItem('clanker-grid:notes:v1:/workspace/notes')).toBe('local scratch note');
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
    fireEvent.change(screen.getByPlaceholderText('Notes...'), {
      target: { value: 'same key' },
    });

    expect(window.localStorage.getItem('clanker-grid:notes:v1:/workspace/notes')).toBe('same key');
    expect(window.localStorage.getItem('clanker-grid:notes:v1:/workspace/notes/')).toBeNull();
  });

  it('uses one storage key for Windows path casing variants', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });

    try {
      expect(getNotesContentStorageKey('C:\\Users\\Jay\\Project', 'ws-notes')).toBe(
        getNotesContentStorageKey('c:/users/jay/project', 'ws-notes')
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('closes the notes pane from the pane header', () => {
    setupWorkspace();
    render(<NotesPane workspaceId="ws-notes" />);

    fireEvent.click(screen.getByLabelText('Close notes'));

    expect(useWorkspaceStore.getState().notesVisible).toBe(false);
  });
});
