import type { LayoutNode, WorkspacePage, WorkspaceTab } from './workspaceTypes';
import { collectLeafPaneIds, insertPaneIntoLayout, removePaneFromLayout, capturePanePlacementInLayout, restorePanePlacementInLayout } from './workspaceLayout';

export const MAX_WORKSPACE_PAGES = 9;
export function activePage(workspace: WorkspaceTab): WorkspacePage | undefined {
  return workspace.pages?.find((page) => page.id === workspace.activePageId);
}

export function paneIsPresented(workspace: WorkspaceTab, paneId: string): boolean {
  const page = activePage(workspace);
  return collectLeafPaneIds(workspace.layoutRoot).includes(paneId)
    && (!page?.maximizedPaneId || page.maximizedPaneId === paneId);
}

export function workspaceBrowserPresented(workspace: WorkspaceTab): boolean {
  return workspace.browserVisible && (!workspace.pages || Boolean(workspace.browserPane && paneIsPresented(workspace, workspace.browserPane.id)));
}

function validPaneIds(workspace: WorkspaceTab): Set<string> {
  return new Set([
    ...workspace.panes.map((pane) => pane.id),
    ...(workspace.browserVisible && workspace.browserPane ? [workspace.browserPane.id] : []),
    ...(workspace.editorVisible && workspace.editorPane ? [workspace.editorPane.id] : []),
    ...(workspace.notesVisible && workspace.notesPane ? [workspace.notesPane.id] : []),
  ]);
}

function prune(root: LayoutNode | null, allowed: Set<string>, seen: Set<string>): LayoutNode | null {
  if (!root) return null;
  if (root.type === 'leaf') {
    if (!allowed.has(root.paneId) || seen.has(root.paneId)) return null;
    seen.add(root.paneId);
    return root;
  }
  const first = prune(root.first, allowed, seen);
  const second = prune(root.second, allowed, seen);
  if (!first) return second;
  if (!second) return first;
  return first === root.first && second === root.second ? root : { ...root, first, second };
}

/** Integration boundary for legacy layout writers. Page state owns history; fields are its projection. */
export function synchronizePages(previous: WorkspaceTab | undefined, next: WorkspaceTab): WorkspaceTab {
  // Legacy test/embedding snapshots can be partial; only sanitize creates their first page.
  if (previous && !previous.pages && !next.pages) return next;
  const initial: WorkspacePage = {
    id: `${next.id}::page-1`, layoutRoot: next.layoutRoot,
    layoutRevision: next.layoutRevision ?? 0, layoutUndoStack: next.layoutUndoStack ?? [],
    activeTerminalId: next.activeTerminalId,
  };
  const pages = next.pages?.length ? next.pages : [initial];
  const activePageId = pages.some((page) => page.id === next.activePageId) ? next.activePageId! : pages[0].id;
  const switched = previous?.activePageId !== undefined && previous.activePageId !== activePageId;
  const allowed = validPaneIds(next);
  const minimizedPanes = (next.minimizedPanes ?? []).filter((entry) => allowed.has(entry.paneId) && pages.some((page) => page.id === entry.pageId));
  const seen = new Set(minimizedPanes.map((entry) => entry.paneId));
  const updatedPages = pages.map((page) => {
    const projected = page.id === activePageId && !switched
      ? { ...page, layoutRoot: next.layoutRoot, layoutRevision: next.layoutRevision ?? page.layoutRevision,
        layoutUndoStack: next.layoutUndoStack ?? page.layoutUndoStack, activeTerminalId: next.activeTerminalId }
      : page;
    const layoutRoot = prune(projected.layoutRoot, allowed, seen);
    const tiledIds = new Set(collectLeafPaneIds(layoutRoot));
    const maximizedPaneId = projected.maximizedPaneId && tiledIds.has(projected.maximizedPaneId) ? projected.maximizedPaneId : undefined;
    const terminalIds = next.panes.filter((pane) => tiledIds.has(pane.id) && (!maximizedPaneId || maximizedPaneId === pane.id)).map((pane) => pane.terminalId).filter((id): id is string => Boolean(id));
    return { ...projected, layoutRoot,
      activeTerminalId: projected.activeTerminalId && terminalIds.includes(projected.activeTerminalId) ? projected.activeTerminalId : terminalIds[0] ?? null,
      maximizedPaneId };
  });
  const selected = updatedPages.find((page) => page.id === activePageId)!;
  const editorPresented = next.editorVisible && next.editorPane && collectLeafPaneIds(selected.layoutRoot).includes(next.editorPane.id)
    && (!selected.maximizedPaneId || selected.maximizedPaneId === next.editorPane.id);
  return { ...next, pages: updatedPages, activePageId, minimizedPanes,
    pendingTerminalIds: next.pendingTerminalIds?.filter((id) => next.terminals.some((terminal) => terminal.id === id)),
    layoutRoot: selected.layoutRoot, layoutRevision: selected.layoutRevision, layoutUndoStack: selected.layoutUndoStack,
    activeTerminalId: selected.activeTerminalId, fileSurfaceContextId: !switched && editorPresented ? next.fileSurfaceContextId : undefined };
}

export function selectPage(workspace: WorkspaceTab, pageId: string): WorkspaceTab {
  const page = workspace.pages?.find((entry) => entry.id === pageId);
  if (!page) return workspace;
  return { ...workspace, activePageId: pageId, layoutRoot: page.layoutRoot,
    layoutRevision: page.layoutRevision, layoutUndoStack: page.layoutUndoStack, activeTerminalId: page.activeTerminalId,
    fileSurfaceContextId: undefined };
}

/** Keep the selected page/editor focus when a launch or reservation mutates another page. */
export function retainSelectedPage(previous: WorkspaceTab, updated: WorkspaceTab): WorkspaceTab {
  if (!previous.activePageId || previous.activePageId === updated.activePageId) return updated;
  return { ...selectPage(updated, previous.activePageId), fileSurfaceContextId: previous.fileSurfaceContextId };
}

/** Move one live tiled resource; membership changes, never resource identity or process ownership. */
export function movePaneToPage(workspace: WorkspaceTab, paneId: string, destinationId: string | undefined, sourcePageId: string): WorkspaceTab {
  const source = activePage(workspace);
  if (!source || source.id !== sourcePageId || source.maximizedPaneId || !collectLeafPaneIds(source.layoutRoot).includes(paneId)) return workspace;
  const pane = workspace.panes.find((entry) => entry.id === paneId);
  // Pending launch/resume placeholders cannot change their reserved destination mid-handshake.
  if (pane && !pane.terminalId) return workspace;
  let pages = workspace.pages!;
  let destination = pages.find((page) => page.id === destinationId);
  if (destinationId === undefined) {
    if (pages.length >= MAX_WORKSPACE_PAGES) return workspace;
    destination = { id: `${workspace.id}::${crypto.randomUUID()}`, layoutRoot: null, layoutRevision: 0, layoutUndoStack: [], activeTerminalId: null };
    pages = [...pages, destination];
  }
  if (!destination || destination === source) return workspace;
  const target = selectPage({ ...workspace, pages }, destination.id);
  const layoutRoot = insertPaneIntoLayout(destination.layoutRoot, paneId, {
    ...target, explorerPane: target.explorerPane ?? null, notesPane: target.notesPane ?? null, notesVisible: target.notesVisible ?? false,
  });
  pages = pages.map((page) => page.id === source.id
    ? { ...page, layoutRoot: removePaneFromLayout(source.layoutRoot, paneId), layoutRevision: page.layoutRevision + 1 }
    : page.id === destination.id ? { ...page, layoutRoot, layoutRevision: page.layoutRevision + 1,
      activeTerminalId: pane?.terminalId ?? page.activeTerminalId, maximizedPaneId: undefined, focusBeforeMaximize: undefined } : page);
  return selectPage({ ...workspace, pages }, destination.id);
}

export function minimizePane(workspace: WorkspaceTab, paneId: string): WorkspaceTab {
  if (!workspace.activePageId || !collectLeafPaneIds(workspace.layoutRoot).includes(paneId)) return workspace;
  return { ...workspace, layoutRoot: removePaneFromLayout(workspace.layoutRoot, paneId),
    layoutRevision: (workspace.layoutRevision ?? 0) + 1,
    minimizedPanes: [...(workspace.minimizedPanes ?? []), { paneId, pageId: workspace.activePageId, placement: capturePanePlacementInLayout(workspace.layoutRoot, paneId) }] };
}

export function restorePane(workspace: WorkspaceTab, paneId: string): WorkspaceTab {
  const entry = workspace.minimizedPanes?.find((item) => item.paneId === paneId);
  if (!entry) return workspace;
  const selected = selectPage(workspace, entry.pageId);
  const restored = entry.placement ? restorePanePlacementInLayout(selected.layoutRoot, paneId, entry.placement) : null;
  const layoutRoot = restored?.ok ? restored.layoutRoot : insertPaneIntoLayout(selected.layoutRoot, paneId, {
    ...selected, explorerPane: selected.explorerPane ?? null, notesPane: selected.notesPane ?? null, notesVisible: selected.notesVisible ?? false,
  });
  // Update the target page explicitly: the integration boundary detects page switches.
  const activeTerminalId = workspace.panes.find((pane) => pane.id === paneId)?.terminalId ?? selected.activeTerminalId;
  return { ...selected, layoutRoot, activeTerminalId, layoutRevision: (selected.layoutRevision ?? 0) + 1,
    pages: selected.pages?.map((page) => page.id === entry.pageId ? { ...page, layoutRoot, activeTerminalId, layoutRevision: page.layoutRevision + 1, maximizedPaneId: undefined } : page),
    minimizedPanes: workspace.minimizedPanes?.filter((item) => item.paneId !== paneId) };
}

export function revealPane(workspace: WorkspaceTab, paneId: string): WorkspaceTab {
  const restored = restorePane(workspace, paneId);
  const page = restored.pages?.find((item) => collectLeafPaneIds(item.layoutRoot).includes(paneId));
  if (!page) return restored;
  const selected = selectPage(restored, page.id);
  return { ...selected, pages: selected.pages?.map((item) => item.id === page.id ? { ...item, maximizedPaneId: undefined } : item) };
}

export function revealTerminal(workspace: WorkspaceTab, terminalId: string): WorkspaceTab {
  const pane = workspace.panes.find((item) => item.terminalId === terminalId);
  if (!pane) return !workspace.pages && workspace.terminals.some((terminal) => terminal.id === terminalId) ? { ...workspace, activeTerminalId: terminalId, fileSurfaceContextId: undefined } : workspace;
  let next = restorePane(workspace, pane.id);
  const page = next.pages?.find((item) => collectLeafPaneIds(item.layoutRoot).includes(pane.id));
  if (page) next = selectPage(next, page.id);
  return { ...next, activeTerminalId: terminalId, fileSurfaceContextId: undefined,
    pages: next.pages?.map((item) => item.id === next.activePageId ? { ...item, activeTerminalId: terminalId, maximizedPaneId: undefined } : item) };
}
