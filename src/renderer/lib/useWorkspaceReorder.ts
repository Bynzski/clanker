import { useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';

type Axis = 'horizontal' | 'vertical';
export type ReorderSide = 'start' | 'end';

/**
 * Drag/keyboard reordering of workspaces via the store's `moveWorkspace`.
 * `start`/`end` are the leading/trailing edge along the list axis.
 */
export function useWorkspaceReorder(
  workspaces: ReadonlyArray<{ id: string }>,
  moveWorkspace: (workspaceId: string, targetWorkspaceId: string) => void,
  options: { axis: Axis; ignoreDragSelector: string },
) {
  const draggedIdRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const [dropTarget, setDropTarget] = useState<{ id: string; side: ReorderSide } | null>(null);

  const onDragStart = (event: DragEvent<HTMLElement>, workspaceId: string) => {
    if (event.target instanceof Element && event.target.closest(options.ignoreDragSelector)) {
      event.preventDefault();
      return;
    }
    draggedIdRef.current = workspaceId;
    suppressClickRef.current = true;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', workspaceId);
  };

  const onDragOver = (event: DragEvent<HTMLElement>, targetId: string) => {
    const draggedId = draggedIdRef.current;
    if (!draggedId || draggedId === targetId) return;
    const fromIndex = workspaces.findIndex((workspace) => workspace.id === draggedId);
    const targetIndex = workspaces.findIndex((workspace) => workspace.id === targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget({ id: targetId, side: fromIndex < targetIndex ? 'end' : 'start' });
  };

  const onDragLeave = (workspaceId: string) => {
    setDropTarget((current) => current?.id === workspaceId ? null : current);
  };

  const onDrop = (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    const draggedId = draggedIdRef.current;
    draggedIdRef.current = null;
    setDropTarget(null);
    if (draggedId && draggedId !== targetId) moveWorkspace(draggedId, targetId);
  };

  const onDragEnd = () => {
    draggedIdRef.current = null;
    setDropTarget(null);
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
  };

  const [prevKey, nextKey] = options.axis === 'horizontal'
    ? ['ArrowLeft', 'ArrowRight']
    : ['ArrowUp', 'ArrowDown'];

  const onReorderKey = (event: KeyboardEvent<HTMLElement>, workspaceId: string, index: number) => {
    if (event.target !== event.currentTarget || !event.altKey || !event.shiftKey) return;
    const targetIndex = event.key === prevKey ? index - 1 : event.key === nextKey ? index + 1 : -1;
    const target = workspaces[targetIndex];
    if (!target) return;
    event.preventDefault();
    moveWorkspace(workspaceId, target.id);
  };

  return { dropTarget, suppressClickRef, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, onReorderKey };
}
