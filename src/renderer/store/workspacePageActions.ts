import type { StoreApi } from 'zustand';
import type { WorkspaceState } from './workspaceStoreTypes';
import { patchWorkspaceById } from './workspaceStoreHelpers';
import { activePage, MAX_WORKSPACE_PAGES, minimizePane, movePaneToPage, restorePane, selectPage } from './workspacePages';
import { collectLeafPaneIds } from './workspaceLayout';
import { useAssistantNavStore } from './assistantNavStore';

export function workspacePageActions(set: StoreApi<WorkspaceState>['setState']): Pick<WorkspaceState,
  'addWorkspacePage' | 'selectWorkspacePage' | 'removeWorkspacePage' | 'minimizeWorkspacePane' | 'restoreWorkspacePane' | 'toggleMaximizedPane' | 'movePaneToWorkspacePage'> {
  const allowed = () => !useAssistantNavStore.getState().activeAssistantId;
  return {
    addWorkspacePage: (workspaceId) => set((state) => {
      if (!allowed()) return state;
      return patchWorkspaceById(state, workspaceId, (workspace) => {
        if (!workspace.pages || workspace.pages.length >= MAX_WORKSPACE_PAGES) return workspace;
        const id = `${workspaceId}::${crypto.randomUUID()}`;
        const page = { id, layoutRoot: null, layoutRevision: 0, layoutUndoStack: [], activeTerminalId: null };
        return selectPage({ ...workspace, pages: [...workspace.pages, page] }, id);
      });
    }),
    movePaneToWorkspacePage: (workspaceId, paneId, pageId, sourcePageId) => set((state) => {
      if (!allowed() || state.activeWorkspaceId !== workspaceId) return state;
      return patchWorkspaceById(state, workspaceId, (workspace) => movePaneToPage(workspace, paneId, pageId, sourcePageId));
    }),
    selectWorkspacePage: (workspaceId, pageId) => set((state) => allowed()
      ? patchWorkspaceById(state, workspaceId, (workspace) => selectPage(workspace, pageId)) : state),
    removeWorkspacePage: (workspaceId, pageId) => set((state) => {
      if (!allowed()) return state;
      return patchWorkspaceById(state, workspaceId, (workspace) => {
        const page = workspace.pages?.find((item) => item.id === pageId);
        if (!page || workspace.pages!.length <= 1 || page.browser?.pane || page.layoutRoot || workspace.minimizedPanes?.some((item) => item.pageId === pageId)) return workspace;
        const pages = workspace.pages!.filter((item) => item.id !== pageId);
        return selectPage({ ...workspace, pages }, workspace.activePageId === pageId ? pages[0].id : workspace.activePageId!);
      });
    }),
    minimizeWorkspacePane: (workspaceId, paneId) => set((state) => allowed()
      ? patchWorkspaceById(state, workspaceId, (workspace) => minimizePane(workspace, paneId)) : state),
    restoreWorkspacePane: (workspaceId, paneId) => set((state) => allowed()
      ? patchWorkspaceById(state, workspaceId, (workspace) => restorePane(workspace, paneId)) : state),
    toggleMaximizedPane: (workspaceId, paneId) => set((state) => {
      if (!allowed()) return state;
      return patchWorkspaceById(state, workspaceId, (workspace) => {
        if (!collectLeafPaneIds(workspace.layoutRoot).includes(paneId)) return workspace;
        const page = activePage(workspace);
        const restoring = page?.maximizedPaneId === paneId;
        const activeTerminalId = restoring ? page.focusBeforeMaximize ?? null : workspace.panes.find((pane) => pane.id === paneId)?.terminalId ?? null;
        return { ...workspace, activeTerminalId, fileSurfaceContextId: undefined,
          pages: workspace.pages?.map((item) => item === page ? { ...item,
            maximizedPaneId: restoring ? undefined : paneId,
            focusBeforeMaximize: restoring ? undefined : item.activeTerminalId } : item) };
      });
    }),
  };
}
