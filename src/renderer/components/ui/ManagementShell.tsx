import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { DialogContent, DialogTitle, DialogClose, type DialogContentProps } from './Dialog';
import { Button } from './Button';
import { IconButton } from './IconButton';
import './ManagementShell.css';

export interface ManagementNavigationItem {
  id: string;
  label: string;
  group: string;
}

/** Presentation only. The caller owns the Dialog root, selection, scope and page content. */
export function ManagementShell({ title, items, selectedId, onSelect, children, headerActions, busy = false, ...props }:
  Omit<DialogContentProps, 'children' | 'title' | 'onSelect'> & {
    title: string;
    items: readonly ManagementNavigationItem[];
    selectedId: string;
    onSelect: (id: string) => void;
    children: ReactNode;
    headerActions?: ReactNode;
    busy?: boolean;
  }) {
  const contentId = useId();
  return (
    <DialogContent {...props} className={`management-shell ${props.className ?? ''}`} aria-describedby={undefined}>
      <div className="clanker-dialog-header">
        <DialogTitle className="clanker-dialog-title">{title}</DialogTitle>
        <div className="management-header-actions">
          {headerActions}
          <DialogClose asChild>
            <IconButton variant="ghost" className="clanker-dialog-close" disabled={busy} aria-label={`Close ${title}`}><X size={14} /></IconButton>
          </DialogClose>
        </div>
      </div>
      <div className="management-layout">
        <nav className="management-navigation" aria-label={`${title} sections`}>
          {items.map((item, index) => (
            <div key={item.id}>
              {(index === 0 || items[index - 1].group !== item.group) && <h2 className="management-group">{item.group}</h2>}
              <Button disabled={busy} size="sm" variant="ghost" className="management-navigation-item"
                aria-current={selectedId === item.id ? 'page' : undefined} aria-controls={contentId}
                onClick={() => onSelect(item.id)}>{item.label}</Button>
            </div>
          ))}
        </nav>
        <section id={contentId} className="management-content clanker-dialog-body"
          aria-label={items.find((item) => item.id === selectedId)?.label} tabIndex={0}>
          {children}
        </section>
      </div>
    </DialogContent>
  );
}
