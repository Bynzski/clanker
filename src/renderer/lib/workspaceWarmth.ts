export const MAX_WARM_WORKSPACE_SURFACES = 3;

/**
 * Record an activation in most-recent-first order and discard closed IDs.
 */
export function recordWorkspaceActivation(
  recentWorkspaceIds: readonly string[],
  activeWorkspaceId: string | null,
  workspaceIds: readonly string[],
): string[] {
  const existingIds = new Set(workspaceIds);
  const next: string[] = [];

  if (activeWorkspaceId && existingIds.has(activeWorkspaceId)) {
    next.push(activeWorkspaceId);
  }

  for (const workspaceId of recentWorkspaceIds) {
    if (existingIds.has(workspaceId) && !next.includes(workspaceId)) {
      next.push(workspaceId);
    }
  }

  return next;
}

/**
 * Select mounted workspace surfaces in LRU order. The active workspace is
 * always included. Unvisited workspaces fill any remaining capacity from
 * newest to oldest so restored sessions start with a deterministic warm set.
 */
export function selectWarmWorkspaceIds(
  workspaceIds: readonly string[],
  activeWorkspaceId: string | null,
  recentWorkspaceIds: readonly string[],
  maxWarmSurfaces = MAX_WARM_WORKSPACE_SURFACES,
): string[] {
  if (workspaceIds.length === 0) return [];

  const capacity = Math.max(1, Math.floor(maxWarmSurfaces));
  const existingIds = new Set(workspaceIds);
  const candidates = [
    activeWorkspaceId,
    ...recentWorkspaceIds,
    ...[...workspaceIds].reverse(),
  ];
  const warmWorkspaceIds: string[] = [];

  for (const workspaceId of candidates) {
    if (!workspaceId || !existingIds.has(workspaceId) || warmWorkspaceIds.includes(workspaceId)) {
      continue;
    }
    warmWorkspaceIds.push(workspaceId);
    if (warmWorkspaceIds.length >= capacity) break;
  }

  return warmWorkspaceIds;
}
