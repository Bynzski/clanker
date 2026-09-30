import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
import { useThemeStore } from '../../../src/renderer/theme/themeStore';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

const live = vi.hoisted(() => ({ views: [] as import('@codemirror/view').EditorView[], merges: [] as import('@codemirror/merge').MergeView[] }));
vi.mock('@codemirror/view', async (original) => {
  const module = await original<typeof import('@codemirror/view')>();
  return { ...module, EditorView: class extends module.EditorView {
    constructor(config: import('@codemirror/view').EditorViewConfig) { super(config); live.views.push(this); }
  } };
});
vi.mock('@codemirror/merge', async (original) => {
  const module = await original<typeof import('@codemirror/merge')>();
  return { ...module, MergeView: class extends module.MergeView {
    constructor(config: import('@codemirror/merge').DirectMergeConfig) { super(config); live.merges.push(this); }
  } };
});
vi.mock('../../../src/renderer/components/dragHandleContext', () => ({ useDragHandle: () => ({}) }));
import EditorPane from '../../../src/renderer/components/EditorPane';
import DiffViewer from '../../../src/renderer/components/DiffViewer';

afterEach(() => { cleanup(); live.views.length = 0; live.merges.length = 0; });

describe('real CodeMirror theme transactions', () => {
  it('keeps the live EditorPane document, selection, scroll and dirty/external state', () => {
    installElectronApiMock(); useThemeStore.setState({ theme: 'dark' });
    const content = Array.from({ length: 120 }, (_, i) => `const value${i} = ${i};`).join('\n');
    const workspace = createWorkspaceFixture({ id: 'real-editor', lifecycle: 'active', editorVisible: true,
      editorPane: { id: 'editor' }, activeEditorTabId: 'dirty',
      editorTabs: [{ id: 'dirty', filePath: '/workspace/file.ts', fileName: 'file.ts', content, originalContent: '', isDirty: true, hasExternalChange: true }] });
    const updateEditorContent = vi.fn();
    useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id, updateEditorContent });
    render(<EditorPane workspaceId={workspace.id} />);
    const view = live.views[0], destroy = vi.spyOn(view, 'destroy');
    act(() => view.dispatch({ selection: EditorSelection.range(25, 47) }));
    view.scrollDOM.scrollTop = 160;
    const doc = view.state.doc, selection = view.state.selection;
    for (const theme of ['light', 'slate', 'dark'] as const) {
      act(() => useThemeStore.setState({ theme }));
      expect(live.views).toEqual([view]); expect(destroy).not.toHaveBeenCalled();
      expect(view.state.doc).toBe(doc); expect(view.state.selection).toBe(selection);
      expect(view.scrollDOM.scrollTop).toBe(160);
      expect(useWorkspaceStore.getState().workspaces[0]).toBe(workspace);
    }
    expect(updateEditorContent).not.toHaveBeenCalled();
  });
  it('keeps the real MergeView, chunks, collapsed widgets, selections and scrolling', () => {
    useThemeStore.setState({ theme: 'dark' });
    const lines = Array.from({ length: 140 }, (_, i) => `const line${i} = ${i};`);
    const oldContent = lines.join('\n'); lines[60] = 'const changed = "new";';
    render(<DiffViewer oldContent={oldContent} newContent={lines.join('\n')} oldPath="file.ts" newPath="file.ts" isBinary={false} hasDiff isLoading={false} error={null} onClose={() => {}} />);
    const merge = live.merges[0], a = merge.a, b = merge.b, chunks = merge.chunks;
    const destroy = vi.spyOn(merge, 'destroy');
    act(() => { a.dispatch({ selection: EditorSelection.range(900, 910) }); b.dispatch({ selection: EditorSelection.range(900, 910) }); });
    a.scrollDOM.scrollTop = 130; b.scrollDOM.scrollTop = 130;
    const docs = [a.state.doc, b.state.doc], selections = [a.state.selection, b.state.selection];
    const collapsed = merge.dom.querySelectorAll('.cm-collapsedLines').length;
    expect(collapsed).toBeGreaterThan(0);
    for (const theme of ['light', 'slate', 'dark'] as const) {
      act(() => useThemeStore.setState({ theme }));
      expect(live.merges).toEqual([merge]); expect(destroy).not.toHaveBeenCalled();
      expect(merge.a).toBe(a); expect(merge.b).toBe(b); expect(merge.chunks).toBe(chunks);
      expect(merge.dom.querySelectorAll('.cm-collapsedLines')).toHaveLength(collapsed);
      for (const [index, view] of [a, b].entries()) {
        expect(view.state.doc).toBe(docs[index]); expect(view.state.selection).toBe(selections[index]);
        expect(view.scrollDOM.scrollTop).toBe(130); expect(view.state.readOnly).toBe(true);
      }
    }
  });
});
