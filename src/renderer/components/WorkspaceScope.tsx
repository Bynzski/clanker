import { createContext, useContext, type ReactNode } from 'react';
import {
  useWorkspaceStore,
  findWorkspaceById,
  DEFAULT_RUNTIME_STATE,
  type WorkspaceTab,
} from '../store/workspaceStore';

const WorkspaceScopeContext = createContext<string | null>(null);

export function WorkspaceScopeProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  return (
    <WorkspaceScopeContext.Provider value={workspaceId}>
      {children}
    </WorkspaceScopeContext.Provider>
  );
}

function useScopedWorkspaceId(workspaceId?: string): string | null {
  const scopedWorkspaceId = useContext(WorkspaceScopeContext);
  return workspaceId ?? scopedWorkspaceId;
}

export function useScopedWorkspace(workspaceId?: string): WorkspaceTab | null {
  const resolvedWorkspaceId = useScopedWorkspaceId(workspaceId);
  const state = useWorkspaceStore();

  const matchedWorkspace = findWorkspaceById(state.workspaces, resolvedWorkspaceId)
    ?? findWorkspaceById(state.workspaces, state.activeWorkspaceId);

  if (matchedWorkspace) {
    return matchedWorkspace;
  }

  if (state.activeWorkspaceId == null && state.workspaces.length === 0) {
    return {
      id: resolvedWorkspaceId ?? 'workspace-scope-active',
      lifecycle: state.activeWorkspaceLifecycle ?? 'active',
      name: state.name,
      workspacePath: state.workspacePath,
      harness: state.harness,
      model: state.model,
      terminals: state.terminals,
      panes: state.panes,
      browserVisible: state.browserVisible,
      browserOverlayCount: state.browserOverlayCount,
      browserUrl: state.browserUrl,
      activeTerminalId: state.activeTerminalId,
      browserPane: state.browserPane,
      editorPane: state.editorPane,
      editorVisible: state.editorVisible,
      notesPane: state.notesPane,
      notesVisible: state.notesVisible,
      editorTabs: state.editorTabs,
      activeEditorTabId: state.activeEditorTabId,
      layoutRoot: state.layoutRoot,
      explorerVisible: state.explorerVisible,
      explorerSidebarWidth: state.explorerSidebarWidth,
      explorerExpandedPaths: state.explorerExpandedPaths,
      explorerSelectedPath: state.explorerSelectedPath,
      explorerEntriesByPath: state.explorerEntriesByPath,
      explorerLoadingPaths: state.explorerLoadingPaths,
      explorerErrorsByPath: state.explorerErrorsByPath,
      showHiddenFiles: state.showHiddenFiles,
      gitChanges: state.gitChanges,
      gitCurrentBranch: state.gitCurrentBranch,
      gitIsRepo: state.gitIsRepo,
      gitIsDetached: state.gitIsDetached,
      runtimeState: { ...DEFAULT_RUNTIME_STATE },
    };
  }

  return null;
}

export function useScopedWorkspaceActivity(workspaceId?: string): boolean {
  const resolvedWorkspaceId = useScopedWorkspaceId(workspaceId);
  const { workspaces, activeWorkspaceId, activeWorkspaceLifecycle } = useWorkspaceStore();

  const matchedWorkspace = findWorkspaceById(workspaces, resolvedWorkspaceId)
    ?? findWorkspaceById(workspaces, activeWorkspaceId);

  if (matchedWorkspace) {
    return matchedWorkspace.id === activeWorkspaceId;
  }

  return activeWorkspaceId == null && activeWorkspaceLifecycle !== 'parked';
}
