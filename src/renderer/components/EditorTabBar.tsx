import { useState } from 'react';
import { X } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import ConfirmCloseDialog from './ConfirmCloseDialog';
import './EditorTabBar.css';

export default function EditorTabBar() {
  const { editorTabs, activeEditorTabId, setActiveEditorTab, closeEditorTab, saveEditorFile } = useWorkspaceStore();
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);

  if (editorTabs.length === 0) {
    return null;
  }

  const pendingCloseTab = pendingCloseTabId ? editorTabs.find((t) => t.id === pendingCloseTabId) : null;

  const handleTabClick = (tabId: string) => {
    setActiveEditorTab(tabId);
  };

  const handleCloseClick = (tabId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    const tab = editorTabs.find((t) => t.id === tabId);
    if (tab?.isDirty) {
      setPendingCloseTabId(tabId);
    } else {
      closeEditorTab(tabId);
    }
  };

  const handleSaveAndClose = async () => {
    if (pendingCloseTabId) {
      const saved = await saveEditorFile(pendingCloseTabId);
      if (!saved) {
        return;
      }

      const latestTab = useWorkspaceStore.getState().editorTabs.find((tab) => tab.id === pendingCloseTabId);
      if (latestTab?.isDirty) {
        return;
      }

      closeEditorTab(pendingCloseTabId);
      setPendingCloseTabId(null);
    }
  };

  const handleDontSaveAndClose = () => {
    if (pendingCloseTabId) {
      closeEditorTab(pendingCloseTabId);
      setPendingCloseTabId(null);
    }
  };

  const handleCancelClose = () => {
    setPendingCloseTabId(null);
  };

  return (
    <>
      <div className="editor-tab-bar" role="tablist" aria-label="Open files">
        {editorTabs.map((tab) => {
          const isActive = tab.id === activeEditorTabId;

          return (
            <button
              key={tab.id}
              className={`editor-tab ${isActive ? 'active' : ''}`}
              role="tab"
              aria-selected={isActive}
              onClick={() => handleTabClick(tab.id)}
              title={tab.filePath}
            >
              {tab.isDirty && (
                <span className="editor-tab-dirty" aria-label="Unsaved changes" />
              )}
              <span className="editor-tab-name">{tab.fileName}</span>
              <span
                className="editor-tab-close"
                onClick={(e) => handleCloseClick(tab.id, e)}
                role="button"
                aria-label={`Close ${tab.fileName}`}
                title={`Close ${tab.fileName}`}
              >
                <X size={12} strokeWidth={2} />
              </span>
            </button>
          );
        })}
      </div>
      <ConfirmCloseDialog
        isOpen={pendingCloseTab !== null}
        title="Unsaved Changes"
        message={pendingCloseTab ? `Do you want to save changes to "${pendingCloseTab.fileName}"?` : ''}
        options={[
          {
            label: 'Save',
            variant: 'primary',
            action: handleSaveAndClose,
          },
          {
            label: "Don't Save",
            variant: 'danger',
            action: handleDontSaveAndClose,
          },
        ]}
        onCancel={handleCancelClose}
      />
    </>
  );
}
