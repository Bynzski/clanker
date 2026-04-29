import { useEffect, useRef, useMemo, useState } from 'react';
import { X } from 'lucide-react';
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
import { useScopedWorkspace, useScopedWorkspaceActivity } from './WorkspaceScope';
import EditorTabBar from './EditorTabBar';
import ConfirmCloseDialog from './ConfirmCloseDialog';
import { getLanguageExtension } from '../lib/editorLanguage';
import './EditorPane.css';
import { editorCreate, editorDestroy, editorReactMount, editorReactUnmount } from '../lib/workspaceSwitchDebug';

export default function EditorPane({ workspaceId }: { workspaceId?: string }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastSyncedTabIdRef = useRef<string | null>(null);
  const langCompartmentRef = useRef<Compartment>(new Compartment());
  const isInteractiveRef = useRef(true);

  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false);
  const workspace = useScopedWorkspace(workspaceId);
  const isInteractive = useScopedWorkspaceActivity(workspaceId);

  // ── Actual React component mount/unmount (Phase 2 lifecycle separation) ──
  // This fires ONCE on component mount and ONCE on unmount, regardless of
  // workspace switches. Use this to determine whether EditorPane remounts on
  // workspace switch (it should NOT, per the shared-container design).
  // Contrast with editorCreate/editorDestroy which fire when the CodeMirror
  // EditorView is created/destroyed inside this component.
  useEffect(() => {
    editorReactMount(workspaceId, activeEditorTabId);
    return () => {
      editorReactUnmount(workspaceId, activeEditorTabId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    closeEditorPane,
    reloadEditorTab,
    clearEditorTabExternalFlag,
    closeEditorTab,
    saveEditorFile,
  } = useWorkspaceStore();
  const editorVisible = workspace?.editorVisible ?? false;
  const editorTabs = useMemo(() => workspace?.editorTabs ?? [], [workspace]);
  const activeEditorTabId = workspace?.activeEditorTabId ?? null;
  const activeTab = editorTabs.find((t) => t.id === activeEditorTabId) ?? null;
  const dragHandleProps = useDragHandle();
  const headerDragHandleProps = isInteractive ? dragHandleProps : undefined;

  const hasDirtyTabs = editorTabs.some((t) => t.isDirty);

  // Build the language extension only when the active tab changes.
  const languageExtension = useMemo(
    () => (activeTab ? getLanguageExtension(activeTab.fileName) : []),
    [activeTab],
  );

  useEffect(() => {
    isInteractiveRef.current = isInteractive;
  }, [isInteractive]);

  useEffect(() => {
    if (panelRef.current == null) {
      return;
    }

    panelRef.current.inert = !isInteractive;
    panelRef.current.setAttribute('aria-hidden', isInteractive ? 'false' : 'true');

    if (!isInteractive && panelRef.current.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }, [isInteractive]);

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

    // Instrument: EditorView created
    const activeTab = editorTabs.find((t) => t.id === activeEditorTabId);
    editorCreate(workspaceId, activeEditorTabId, activeTab?.fileName ?? null);

    return () => {
      // Instrument: capture tab info before destroying
      const activeTab = editorTabs.find((t) => t.id === activeEditorTabId);
      editorDestroy(workspaceId, activeEditorTabId, activeTab?.fileName ?? null);
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
      // No-op: preserve the editor document so undo history and editor state
      // are not destroyed when switching to a workspace with no active tab.
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
      if (!update.docChanged || !isInteractiveRef.current) return;
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

  const handleClosePane = () => {
    if (!isInteractive) {
      return;
    }
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
    if (!isInteractive) {
      return;
    }
    if (workspaceId) {
      closeEditorPane(workspaceId);
    } else {
      closeEditorPane();
    }
    setShowCloseConfirmation(false);
  };

  const dirtyCount = editorTabs.filter((t) => t.isDirty).length;

  return (
    <>
      <div
        ref={panelRef}
        className={`editor-panel${editorVisible ? '' : ' editor-panel--hidden'}`}
        data-workspace-interactive={isInteractive ? 'true' : 'false'}
      >
        <div className="editor-pane-header" {...headerDragHandleProps}>
          <div className="editor-pane-drag-handle" aria-hidden="true" title="Drag to move pane" />
          <span className="editor-pane-title">Editor</span>
          <span className="editor-pane-spacer" />
          <button
            className="editor-pane-close-btn"
            onClick={handleClosePane}
            title="Close editor"
            aria-label="Close editor"
            disabled={!isInteractive}
          >
            <X size={12} strokeWidth={2} />
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
              disabled={!isInteractive}
              onClick={() => {
                if (!isInteractive) {
                  return;
                }
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
              disabled={!isInteractive}
              onClick={() => {
                if (!isInteractive) {
                  return;
                }
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
              disabled={!isInteractive}
              onClick={() => {
                if (!isInteractive) {
                  return;
                }
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
              disabled={!isInteractive}
              onClick={() => {
                if (!isInteractive) {
                  return;
                }
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
          {editorTabs.length === 0 && (
            <div className="editor-empty-state editor-empty-state--overlay">
              <span>No file open</span>
              <span className="hint">Double-click a file in the explorer to open it</span>
            </div>
          )}
          <div
            className="editor-content"
            ref={editorRef}
            style={{ display: editorVisible && editorTabs.length > 0 ? undefined : 'none' }}
          />
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
