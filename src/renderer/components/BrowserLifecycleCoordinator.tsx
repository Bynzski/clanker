import { useEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAssistantSurfaceStore } from '../store/assistantSurfaceStore';
import { workspaceBrowserPresented } from '../store/workspacePages';
import { assistantBrowserOwnerId } from '../../shared/browserOwner';

interface BrowserLifecycleCoordinatorProps {
  /** The single Browser owner (a workspace id or an Assistant browser scope) allowed to show a native view. */
  activeOwnerId: string | null;
}

export default function BrowserLifecycleCoordinator({ activeOwnerId }: BrowserLifecycleCoordinatorProps) {
  const { workspaces } = useWorkspaceStore();
  const assistantSurfaces = useAssistantSurfaceStore((state) => state.byId);

  useEffect(() => {
    // Hide every owner except the active one: a workspace and an Assistant native view never coexist.
    // Store invariant W4 guarantees workspace.id === activeWorkspaceId implies lifecycle === 'active'.
    for (const workspace of workspaces) {
      if ((!workspace.browserVisible && !workspace.browserPane) || (workspace.id === activeOwnerId && workspaceBrowserPresented(workspace) && !workspace.browserOverlayCount)) continue;
      window.electronAPI.browserHide(workspace.id);
    }
    for (const [assistantId, ui] of Object.entries(assistantSurfaces)) {
      const ownerId = assistantBrowserOwnerId(assistantId);
      if (!ui.browserVisible || ownerId === activeOwnerId) continue;
      window.electronAPI.browserHide(ownerId);
    }
  }, [activeOwnerId, workspaces, assistantSurfaces]);

  return null;
}
