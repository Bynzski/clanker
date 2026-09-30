import { useLayoutEffect } from 'react';
import { useScopedWorkspaceId } from '../components/WorkspaceScope';
import { useWorkspaceStore } from '../store/workspaceStore';

/** Own one store suppression lease while open. Explicit/context scope wins;
 * otherwise follow the active workspace, including the legacy no-workspace state.
 */
export function useBrowserOverlaySuppression(open: boolean, workspaceId?: string): void {
  const scopedWorkspaceId = useScopedWorkspaceId(workspaceId);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const ownerId = scopedWorkspaceId ?? activeWorkspaceId ?? undefined;
  const push = useWorkspaceStore((state) => state.pushBrowserOverlay);
  const pop = useWorkspaceStore((state) => state.popBrowserOverlay);

  useLayoutEffect(() => {
    if (!open) return;
    push(ownerId);
    return () => {
      // An undefined scope resolves at call time. Once a workspace is selected,
      // its snapshot replaces the legacy count; never pop that new workspace.
      if (ownerId === undefined && useWorkspaceStore.getState().activeWorkspaceId !== null) return;
      pop(ownerId);
    };
  }, [open, ownerId, push, pop]);
}
