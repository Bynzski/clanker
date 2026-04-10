import { useEffect, useMemo } from 'react';
import {
  FileText,
  FolderOpen,
  Pencil,
  Trash2,
  Copy,
  Link,
  FolderOutput,
} from 'lucide-react';
import type { FileExplorerEntry } from '../../../shared/types/fileExplorer';
import './ContextMenu.css';

export type ContextAction =
  | 'open-editor'
  | 'open-terminal'
  | 'rename'
  | 'delete'
  | 'copy-path'
  | 'copy-relative-path'
  | 'reveal-in-files';

export interface ContextMenuProps {
  x: number;
  y: number;
  entry: FileExplorerEntry;
  onAction: (action: ContextAction) => void;
  onClose: () => void;
}

export default function ContextMenu({ x, y, entry, onAction, onClose }: ContextMenuProps) {
  // Viewport edge clamping
  const menuStyle = useMemo(() => {
    const menuWidth = 200;
    const menuHeight = entry.isDirectory ? 280 : 320;
    return {
      left: Math.min(x, window.innerWidth - menuWidth - 8),
      top: Math.min(y, window.innerHeight - menuHeight - 8),
    };
  }, [x, y, entry.isDirectory]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <>
      {/* Invisible overlay to capture clicks outside */}
      <div className="context-menu-overlay" onClick={onClose} />
      <div
        className="context-menu"
        role="menu"
        style={menuStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Open actions */}
        <button
          type="button"
          className="context-menu-action"
          role="menuitem"
          onClick={() => onAction('open-editor')}
        >
          <span className="context-menu-icon">
            {entry.isDirectory ? <FolderOpen size={14} /> : <FileText size={14} />}
          </span>
          {entry.isDirectory ? 'Open Folder' : 'Open in Editor'}
        </button>

        <button
          type="button"
          className="context-menu-action"
          role="menuitem"
          onClick={() => onAction('open-terminal')}
        >
          <span className="context-menu-icon">
            <FolderOutput size={14} />
          </span>
          Open in Terminal
        </button>

        <div className="context-menu-separator" />

        {/* Rename */}
        <button
          type="button"
          className="context-menu-action"
          role="menuitem"
          onClick={() => onAction('rename')}
        >
          <span className="context-menu-icon">
            <Pencil size={14} />
          </span>
          Rename
        </button>

        {/* Delete */}
        <button
          type="button"
          className="context-menu-action danger"
          role="menuitem"
          onClick={() => onAction('delete')}
        >
          <span className="context-menu-icon">
            <Trash2 size={14} />
          </span>
          Delete
        </button>

        <div className="context-menu-separator" />

        {/* Copy path */}
        <button
          type="button"
          className="context-menu-action"
          role="menuitem"
          onClick={() => onAction('copy-path')}
        >
          <span className="context-menu-icon">
            <Copy size={14} />
          </span>
          Copy Path
        </button>

        {/* Copy relative path */}
        <button
          type="button"
          className="context-menu-action"
          role="menuitem"
          onClick={() => onAction('copy-relative-path')}
        >
          <span className="context-menu-icon">
            <Link size={14} />
          </span>
          Copy Relative Path
        </button>

        {/* Reveal in file manager */}
        <button
          type="button"
          className="context-menu-action"
          role="menuitem"
          onClick={() => onAction('reveal-in-files')}
        >
          <span className="context-menu-icon">
            <FolderOutput size={14} />
          </span>
          Reveal in File Manager
        </button>
      </div>
    </>
  );
}
