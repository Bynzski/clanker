/**
 * Canonical Workspace Navigation Mode
 *
 * Controls where open workspaces are listed: the title-bar tab strip ('tabs')
 * or the left shell ('sidebar'). Both main and renderer import from here.
 */

export type WorkspaceNavigationMode = 'tabs' | 'sidebar';

export const WORKSPACE_NAVIGATION_MODES: readonly WorkspaceNavigationMode[] = ['tabs', 'sidebar'] as const;

export const DEFAULT_WORKSPACE_NAVIGATION_MODE: WorkspaceNavigationMode = 'sidebar';

export const WORKSPACE_NAVIGATION_MODE_LABELS: Readonly<Record<WorkspaceNavigationMode, string>> = {
  tabs: 'Tabs',
  sidebar: 'Sidebar',
};

export function isWorkspaceNavigationMode(value: unknown): value is WorkspaceNavigationMode {
  return typeof value === 'string' && (WORKSPACE_NAVIGATION_MODES as readonly string[]).includes(value);
}

export function normalizeWorkspaceNavigationMode(value: unknown): WorkspaceNavigationMode {
  return isWorkspaceNavigationMode(value) ? value : DEFAULT_WORKSPACE_NAVIGATION_MODE;
}

/**
 * Application-global width of the sidebar shell (sidebar mode only).
 *
 * The shell is either expanded (MIN..MAX) or collapsed to a fixed icon rail.
 * Any requested width below the collapse threshold snaps to the rail, so a
 * single persisted number covers both states and dragging the edge opens or
 * closes the rail without a separate flag.
 */
export const DEFAULT_WORKSPACE_SIDEBAR_WIDTH = 280;
export const MIN_WORKSPACE_SIDEBAR_WIDTH = 180;
export const MAX_WORKSPACE_SIDEBAR_WIDTH = 500;
export const WORKSPACE_SIDEBAR_RAIL_WIDTH = 44;
export const WORKSPACE_SIDEBAR_COLLAPSE_THRESHOLD = 120;

export function normalizeWorkspaceSidebarWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WORKSPACE_SIDEBAR_WIDTH;
  if (value < WORKSPACE_SIDEBAR_COLLAPSE_THRESHOLD) return WORKSPACE_SIDEBAR_RAIL_WIDTH;
  return Math.round(Math.max(MIN_WORKSPACE_SIDEBAR_WIDTH, Math.min(MAX_WORKSPACE_SIDEBAR_WIDTH, value)));
}

export function isWorkspaceSidebarCollapsed(width: number): boolean {
  return width <= WORKSPACE_SIDEBAR_RAIL_WIDTH;
}
