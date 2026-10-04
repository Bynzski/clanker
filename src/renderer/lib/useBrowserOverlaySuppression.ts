import { useLayoutEffect } from 'react';
import { useScopedWorkspaceId } from '../components/WorkspaceScope';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { useAssistantSurfaceStore } from '../store/assistantSurfaceStore';

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
    if (ownerId !== undefined && !useWorkspaceStore.getState().workspaces.some((workspace) => workspace.id === ownerId)) return;
    push(ownerId);
    return () => {
      // An undefined scope resolves at call time. Once a workspace is selected,
      // its snapshot replaces the legacy count; never pop that new workspace.
      if (ownerId === undefined && useWorkspaceStore.getState().activeWorkspaceId !== null) return;
      if (ownerId !== undefined && !useWorkspaceStore.getState().workspaces.some((workspace) => workspace.id === ownerId)) return;
      pop(ownerId);
    };
  }, [open, ownerId, push, pop]);
}

/** An open popover/dialog also hides the active Assistant's native Browser view, which would otherwise overlay it. */
export function useAssistantBrowserOverlaySuppression(open: boolean): void {
  const activeAssistantId = useAssistantNavStore((state) => state.activeAssistantId);
  useLayoutEffect(() => {
    if (!open || !activeAssistantId) return;
    useAssistantSurfaceStore.getState().pushOverlay(activeAssistantId);
    return () => useAssistantSurfaceStore.getState().popOverlay(activeAssistantId);
  }, [open, activeAssistantId]);
}
