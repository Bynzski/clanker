import { useEffect, useRef, useMemo, useState } from 'react';
import { Lock, Unlock, X } from 'lucide-react';
import { EditorState, StateEffect, Compartment, type Extension } from '@codemirror/state';
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  keymap,
} from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useDragHandle } from './DynamicPaneLayout';
import EditorTabBar from './EditorTabBar';
import ConfirmCloseDialog from './ConfirmCloseDialog';
import './EditorPane.css';

function getLanguageExtension(fileName: string): Extension {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return markdown();
  }
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs')
  ) {
    return javascript({ typescript: lower.endsWith('.ts') || lower.endsWith('.tsx') });
  }
  return [];
}

export default function EditorPane() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastSyncedTabIdRef = useRef<string | null>(null);
  const langCompartmentRef = useRef<Compartment>(new Compartment());

  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false);

  const {
    editorPane,
    editorVisible,
    editorTabs,
    activeEditorTabId,
    toggleEditorLock,
    closeEditorPane,
  } = useWorkspaceStore();

  const editorLocked = editorPane?.locked ?? false;
  const activeTab = editorTabs.find((t) => t.id === activeEditorTabId) ?? null;
  const dragHandleProps = useDragHandle();

  const hasDirtyTabs = editorTabs.some((t) => t.isDirty);

  // Build the language extension only when the active tab changes.
  const languageExtension = useMemo(
    () => (activeTab ? getLanguageExtension(activeTab.fileName) : []),
    [activeTab],
  );

  // Initialize CodeMirror editor with a compartment for language switching.
  useEffect(() => {
    if (editorRef.current == null) return;
    if (viewRef.current != null) return;

    const langCompartment = langCompartmentRef.current;

    const baseExtensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      keymap.of([]),
      oneDark,
      EditorView.lineWrapping,
      langCompartment.of(languageExtension),
    ];

    const state = EditorState.create({
      doc: '',
      extensions: baseExtensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      lastSyncedTabIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync language extension when the active tab changes.
  useEffect(() => {
    const view = viewRef.current;
    if (view == null || activeTab == null) return;

    view.dispatch({
      effects: langCompartmentRef.current.reconfigure(getLanguageExtension(activeTab.fileName)),
    });
  }, [activeTab]);

  // Sync content when the active tab changes.
  useEffect(() => {
    const view = viewRef.current;
    if (view == null) return;

    const lastSynced = lastSyncedTabIdRef.current;
    if (lastSynced === activeEditorTabId) return;

    lastSyncedTabIdRef.current = activeEditorTabId ?? null;

    if (activeEditorTabId == null) {
      const currentContent = view.state.doc.toString();
      if (currentContent !== '') {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: '' },
        });
      }
      return;
    }

    const tab = editorTabs.find((t) => t.id === activeEditorTabId);
    if (!tab) return;

    const currentContent = view.state.doc.toString();
    if (currentContent !== tab.content) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: tab.content },
      });
    }
  }, [activeEditorTabId, editorTabs]);

  // Attach update listener that dispatches changes to the store.
  useEffect(() => {
    const view = viewRef.current;
    if (view == null) return;

    const listener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const { activeEditorTabId: currentTabId, updateEditorContent } = useWorkspaceStore.getState();
      if (!currentTabId) return;
      const newContent = update.state.doc.toString();
      updateEditorContent(currentTabId, newContent);
    });

    view.dispatch({
      effects: StateEffect.appendConfig.of(listener),
    });

    return () => {
      // No-op: the listener persists for the editor lifetime.
    };
  }, []);

  const handleToggleLock = () => {
    toggleEditorLock();
  };

  const handleClosePane = () => {
    if (hasDirtyTabs) {
      setShowCloseConfirmation(true);
    } else {
      closeEditorPane();
    }
  };

  const handleDontSaveAndClose = () => {
    closeEditorPane();
    setShowCloseConfirmation(false);
  };

  if (!editorVisible) {
    return null;
  }

  const dirtyCount = editorTabs.filter((t) => t.isDirty).length;

  return (
    <>
      <div className="editor-panel">
        <div className="editor-pane-header" {...dragHandleProps}>
          <div className="editor-pane-drag-handle" aria-hidden="true" title="Drag to move pane" />
          <span className="editor-pane-title">Editor</span>
          <span className="editor-pane-spacer" />
          <button
            className="editor-pane-close-btn"
            onClick={handleClosePane}
            title="Close editor"
            aria-label="Close editor"
          >
            <X size={12} strokeWidth={2} />
          </button>
          <button
            className="editor-pane-lock-btn"
            onClick={handleToggleLock}
            title={editorLocked ? 'Unlock editor pane' : 'Lock editor pane'}
            aria-label={editorLocked ? 'Unlock editor pane' : 'Lock editor pane'}
          >
            {editorLocked ? (
              <Lock size={12} strokeWidth={2} />
            ) : (
              <Unlock size={12} strokeWidth={2} />
            )}
          </button>
        </div>

        <EditorTabBar />

        <div className="editor-content-area">
          {editorTabs.length === 0 ? (
            <div className="editor-empty-state">
              <span>No file open</span>
              <span className="hint">Double-click a file in the explorer to open it</span>
            </div>
          ) : (
            <div className="editor-content" ref={editorRef} />
          )}
        </div>
      </div>
      <ConfirmCloseDialog
        isOpen={showCloseConfirmation}
        title="Unsaved Changes"
        message={`You have ${dirtyCount} unsaved file${dirtyCount !== 1 ? 's' : ''}. Close editor anyway?`}
        options={[
          {
            label: "Don't Save",
            variant: 'danger',
            action: handleDontSaveAndClose,
          },
        ]}
        onCancel={() => setShowCloseConfirmation(false)}
      />
    </>
  );
}
