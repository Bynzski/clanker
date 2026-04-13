import { useEffect, useRef, useMemo, useState } from 'react';
import { Lock, Unlock, X } from 'lucide-react';
import { EditorState, StateEffect, Compartment, type Extension } from '@codemirror/state';
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  keymap,
} from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useDragHandle } from './DynamicPaneLayout';
import { useScopedWorkspace } from './WorkspaceScope';
import EditorTabBar from './EditorTabBar';
import ConfirmCloseDialog from './ConfirmCloseDialog';
import { getLanguageExtension } from '../lib/editorLanguage';
import './EditorPane.css';

export default function EditorPane({ workspaceId }: { workspaceId?: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastSyncedTabIdRef = useRef<string | null>(null);
  const langCompartmentRef = useRef<Compartment>(new Compartment());

  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false);
  const workspace = useScopedWorkspace(workspaceId);

  const {
    toggleEditorLock,
    closeEditorPane,
    reloadEditorTab,
    clearEditorTabExternalFlag,
    closeEditorTab,
    saveEditorFile,
  } = useWorkspaceStore();

  const editorLocked = workspace?.editorPane?.locked ?? false;
  const editorVisible = workspace?.editorVisible ?? false;
  const editorTabs = workspace?.editorTabs ?? [];
  const activeEditorTabId = workspace?.activeEditorTabId ?? null;
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

  // Sync content when the active tab changes or when content is reloaded externally.
  useEffect(() => {
    const view = viewRef.current;
    if (view == null) return;

    if (activeEditorTabId == null) {
      const lastSynced = lastSyncedTabIdRef.current;
      if (lastSynced != null) {
        lastSyncedTabIdRef.current = null;
        const currentContent = view.state.doc.toString();
        if (currentContent !== '') {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: '' },
          });
        }
      }
      return;
    }

    const tab = editorTabs.find((t) => t.id === activeEditorTabId);
    if (!tab) return;

    lastSyncedTabIdRef.current = activeEditorTabId;

    const currentContent = view.state.doc.toString();
    if (currentContent === tab.content) return;


    // Only sync if the tab is clean (not mid-edit) or has an external change flag
    if (tab.isDirty && !tab.hasExternalChange) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: tab.content },
    });
  }, [activeEditorTabId, editorTabs]);

  // Attach update listener that dispatches changes to the store.
  useEffect(() => {
    const view = viewRef.current;
    if (view == null) return;

    const listener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const { updateEditorContent, getWorkspaceById, getActiveWorkspace } = useWorkspaceStore.getState();
      const currentWorkspace = workspaceId ? getWorkspaceById(workspaceId) : getActiveWorkspace();
      const currentTabId = currentWorkspace?.activeEditorTabId ?? null;
      if (!currentTabId) return;
      const newContent = update.state.doc.toString();
      if (workspaceId) {
        updateEditorContent(currentTabId, newContent, workspaceId);
      } else {
        updateEditorContent(currentTabId, newContent);
      }
    });

    view.dispatch({
      effects: StateEffect.appendConfig.of(listener),
    });

    return () => {
      // No-op: the listener persists for the editor lifetime.
    };
  }, [workspaceId]);

  const handleToggleLock = () => {
    if (workspaceId) {
      toggleEditorLock(workspaceId);
    } else {
      toggleEditorLock();
    }
  };

  const handleClosePane = () => {
    if (hasDirtyTabs) {
      setShowCloseConfirmation(true);
    } else {
      if (workspaceId) {
        closeEditorPane(workspaceId);
      } else {
        closeEditorPane();
      }
    }
  };

  const handleDontSaveAndClose = () => {
    if (workspaceId) {
      closeEditorPane(workspaceId);
    } else {
      closeEditorPane();
    }
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

        <EditorTabBar workspaceId={workspaceId} />

        {activeTab?.hasExternalChange && (
          <div className="editor-reload-banner">
            <span className="editor-reload-banner-text">
              This file has been modified externally.
            </span>
            <button
              className="editor-reload-banner-btn"
              onClick={() => {
                if (workspaceId) {
                  void reloadEditorTab(activeTab.id, workspaceId);
                } else {
                  void reloadEditorTab(activeTab.id);
                }
              }}
            >
              Reload
            </button>
            <button
              className="editor-reload-banner-btn editor-reload-banner-btn--secondary"
              onClick={() => {
                if (workspaceId) {
                  clearEditorTabExternalFlag(activeTab.id, workspaceId);
                } else {
                  clearEditorTabExternalFlag(activeTab.id);
                }
              }}
            >
              Keep Mine
            </button>
          </div>
        )}
        {activeTab?.isDeleted && (
          <div className="editor-reload-banner editor-reload-banner--danger">
            <span className="editor-reload-banner-text">
              This file has been deleted.
            </span>
            <button
              className="editor-reload-banner-btn"
              onClick={() => {
                if (workspaceId) {
                  closeEditorTab(activeTab.id, workspaceId);
                } else {
                  closeEditorTab(activeTab.id);
                }
              }}
            >
              Close
            </button>
            <button
              className="editor-reload-banner-btn editor-reload-banner-btn--secondary"
              onClick={() => {
                if (workspaceId) {
                  void saveEditorFile(activeTab.id, workspaceId);
                } else {
                  void saveEditorFile(activeTab.id);
                }
              }}
            >
              Save
            </button>
          </div>
        )}

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
