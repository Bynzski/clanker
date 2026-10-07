import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { undo, redo } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

const live = vi.hoisted(() => ({ views: [] as import('@codemirror/view').EditorView[] }));
vi.mock('@codemirror/view', async (original) => {
  const module = await original<typeof import('@codemirror/view')>();
  return { ...module, EditorView: class extends module.EditorView {
    constructor(config: import('@codemirror/view').EditorViewConfig) { super(config); live.views.push(this); }
  } };
});
vi.mock('../../../src/renderer/components/dragHandleContext', () => ({ useDragHandle: () => ({}) }));
import EditorPane from '../../../src/renderer/components/EditorPane';

beforeEach(() => {
  installElectronApiMock();
  const workspace = createWorkspaceFixture({ id: 'ws', workspacePath: '/workspace', lifecycle: 'active', editorVisible: true,
    editorPane: { id: 'editor' }, activeEditorTabId: 'md', editorTabs: [{ id: 'md', filePath: '/workspace/README.md', fileName: 'README.md',
      content: '# Saved', originalContent: '# Saved', isDirty: false, hasExternalChange: false }] });
  useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id, pendingEditorOperations: {} });
});
afterEach(() => { cleanup(); live.views.length = 0; });
const tab = () => useWorkspaceStore.getState().workspaces[0].editorTabs[0];

describe('Markdown with real CodeMirror', () => {
  it('preserves document, selection, scrolling and undo/redo across preview, and saves through the existing bridge', async () => {
    render(<EditorPane workspaceId="ws" />);
    const view = live.views[0];
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '# Unsaved' }, selection: EditorSelection.cursor(4) }));
    expect(tab()).toMatchObject({ content: '# Unsaved', isDirty: true });
    const doc = view.state.doc, selection = view.state.selection;
    view.scrollDOM.scrollTop = 48;
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('heading', { name: 'Unsaved' })).toBeTruthy();
    expect(view.state.doc).toBe(doc);
    expect(view.state.selection).toBe(selection);
    expect(view.scrollDOM.scrollTop).toBe(48);
    expect(window.electronAPI.editorReadFile).not.toHaveBeenCalled();
    expect(window.electronAPI.editorWriteFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(live.views).toEqual([view]);
    act(() => { expect(undo(view)).toBe(true); });
    expect(view.state.doc.toString()).toBe('# Saved');
    expect(tab().isDirty).toBe(false);
    act(() => { expect(redo(view)).toBe(true); });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await act(async () => { expect(await useWorkspaceStore.getState().saveEditorFile('md', 'ws')).toBe(true); });
    expect(window.electronAPI.editorWriteFile).toHaveBeenCalledWith({ workspaceId: 'ws', workspacePath: '/workspace', filePath: '/workspace/README.md', content: '# Unsaved' });
    expect(tab().isDirty).toBe(false);
    expect(screen.getByRole('heading', { name: 'Unsaved' })).toBeTruthy();
  });

  it('keeps dirty/external-change handling and close confirmation in preview', async () => {
    render(<EditorPane workspaceId="ws" />);
    act(() => live.views[0].dispatch({ changes: { from: 0, to: 7, insert: '# Mine' } }));
    act(() => useWorkspaceStore.getState().markEditorTabExternallyChanged('md', 'ws'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('heading', { name: 'Mine' })).toBeTruthy();
    expect(screen.getByText('File changed on disk.')).toBeTruthy();
    expect(tab()).toMatchObject({ isDirty: true, hasExternalChange: true });
    fireEvent.click(screen.getByRole('button', { name: 'Keep Mine' }));
    expect(tab()).toMatchObject({ content: '# Mine', isDirty: true, hasExternalChange: false });
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('1 unsaved file');
  });
});
