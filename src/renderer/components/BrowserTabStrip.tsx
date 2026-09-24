import { useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { Plus, X } from 'lucide-react';
import type { BrowserTab } from '../store/workspaceTypes';

export function getBrowserTabLabel(tab: BrowserTab): string {
  const title = tab.title.trim();
  if (title) return title;
  try {
    return new URL(tab.url).hostname || tab.url || 'New Tab';
  } catch {
    return tab.url || 'New Tab';
  }
}

interface BrowserTabStripProps {
  tabs: BrowserTab[];
  activeTabId: string | null;
  onNewTab: () => void;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (event: MouseEvent, tabId: string) => void;
  onMoveTab: (tabId: string, targetTabId: string) => void;
}

export default function BrowserTabStrip({
  tabs,
  activeTabId,
  onNewTab,
  onSwitchTab,
  onCloseTab,
  onMoveTab,
}: BrowserTabStripProps) {
  const draggedTabIdRef = useRef<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const handleDragStart = (event: DragEvent<HTMLDivElement>, tabId: string) => {
    draggedTabIdRef.current = tabId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tabId);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, tabId: string) => {
    if (!draggedTabIdRef.current || draggedTabIdRef.current === tabId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetId(tabId);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetTabId: string) => {
    event.preventDefault();
    const draggedTabId = draggedTabIdRef.current;
    draggedTabIdRef.current = null;
    setDropTargetId(null);
    if (draggedTabId && draggedTabId !== targetTabId) onMoveTab(draggedTabId, targetTabId);
  };

  const handleReorderKey = (event: KeyboardEvent<HTMLButtonElement>, tabId: string, index: number) => {
    if (!event.altKey || !event.shiftKey) return;
    const targetIndex = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1 : -1;
    const target = tabs[targetIndex];
    if (!target) return;
    event.preventDefault();
    onMoveTab(tabId, target.id);
  };

  return (
    <div className="browser-tab-strip">
      <div className="browser-tab-track" role="tablist" aria-label="Browser tabs">
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            className={`browser-tab${tab.id === activeTabId ? ' active' : ''}${dropTargetId === tab.id ? ' drop-target' : ''}`}
            draggable
            onDragStart={(event) => handleDragStart(event, tab.id)}
            onDragOver={(event) => handleDragOver(event, tab.id)}
            onDragLeave={() => setDropTargetId((current) => current === tab.id ? null : current)}
            onDrop={(event) => handleDrop(event, tab.id)}
            onDragEnd={() => {
              draggedTabIdRef.current = null;
              setDropTargetId(null);
            }}
          >
            <button
              className="browser-tab-select"
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              title={getBrowserTabLabel(tab)}
              onClick={() => onSwitchTab(tab.id)}
              onKeyDown={(event) => handleReorderKey(event, tab.id, index)}
            >
              <span className="browser-tab-label">{getBrowserTabLabel(tab)}</span>
            </button>
            <button
              className="browser-tab-close"
              type="button"
              onClick={(event) => onCloseTab(event, tab.id)}
              disabled={tabs.length <= 1}
              title={tabs.length <= 1 ? 'Cannot close the last tab' : 'Close tab'}
              aria-label={`Close ${getBrowserTabLabel(tab)}`}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
      <button className="browser-tab-add" type="button" onClick={onNewTab} title="New tab" aria-label="New tab">
        <Plus size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
