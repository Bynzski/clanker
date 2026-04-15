import { useEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';

interface BrowserLifecycleCoordinatorProps {
  activeWorkspaceId: string | null;
}

export default function BrowserLifecycleCoordinator({ activeWorkspaceId }: BrowserLifecycleCoordinatorProps) {
  const { workspaces } = useWorkspaceStore();

  useEffect(() => {
    for (const workspace of workspaces) {
      if (!workspace.browserVisible) {
        continue;
      }

      // Hide non-focused workspaces. Store invariant W4 guarantees
      // workspace.id === activeWorkspaceId implies lifecycle === 'active',
      // so a separate lifecycle check is redundant here.
      if (workspace.id === activeWorkspaceId) {
        continue;
      }

      window.electronAPI.browserHide(workspace.id);
    }
  }, [activeWorkspaceId, workspaces]);

  return null;
}
