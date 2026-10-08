import { closestCorners, pointerWithin, type CollisionDetection } from '@dnd-kit/core';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { collectLeafPaneIds } from '../store/workspaceLayout';

export interface WorkspacePaneDragData { workspaceId: string; pageId: string; paneId: string }
export interface WorkspacePageDropTarget { kind: 'workspace-page'; workspaceId: string; pageId?: string }

export function pageDropTarget(value: unknown): WorkspacePageDropTarget | null {
  if (!value || typeof value !== 'object') return null;
  const target = value as Partial<WorkspacePageDropTarget>;
  return target.kind === 'workspace-page' && typeof target.workspaceId === 'string'
    && (target.pageId === undefined || typeof target.pageId === 'string') ? target as WorkspacePageDropTarget : null;
}
export function currentPaneDrag(value: unknown, workspace: WorkspaceTab): WorkspacePaneDragData | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<WorkspacePaneDragData>;
  return data.workspaceId === workspace.id && typeof data.pageId === 'string' && data.pageId === workspace.activePageId && typeof data.paneId === 'string'
    && !workspace.pages?.find(page => page.id === workspace.activePageId)?.maximizedPaneId
    && collectLeafPaneIds(workspace.layoutRoot).includes(data.paneId) ? data as WorkspacePaneDragData : null;
}

/** Preserve workspace-edge priority; footer page hits take precedence over layout targets. */
export const paneCollisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const rank = (id: string) => id.startsWith('workspace-page-drop-') ? 0 : id.startsWith('workspace-edge-') ? 1 : 2;
  // Only an enabled page hit may commit a pointer drop anywhere in the footer.
  // Disabled buttons are excluded from the collision containers, so protect the whole bar,
  // not just registered targets; nearest-pane fallback here would unexpectedly edit topology.
  if (!hits.some(hit => rank(String(hit.id)) === 0) && args.pointerCoordinates && typeof document !== 'undefined') {
    const footer = document.querySelector('.status-bar')?.getBoundingClientRect();
    const { x, y } = args.pointerCoordinates;
    if (footer && footer.width > 0 && footer.height > 0 && x >= footer.left && x <= footer.right && y >= footer.top && y <= footer.bottom) return [];
  }
  if (hits.length) return [...hits].sort((a, b) => rank(String(a.id)) - rank(String(b.id)));
  // Pointer drags must actually hit a page button, not pick it as a distant layout fallback.
  return closestCorners(args.pointerCoordinates ? { ...args,
    droppableContainers: args.droppableContainers.filter(container => !String(container.id).startsWith('workspace-page-drop-')) } : args);
};
