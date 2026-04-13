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

      if (workspace.id === activeWorkspaceId && workspace.lifecycle === 'active') {
        continue;
      }

      window.electronAPI.browserHide(workspace.id);
    }
  }, [activeWorkspaceId, workspaces]);

  return null;
}
