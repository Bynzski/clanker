import type { FileExplorerEntry } from '../../../shared/types/fileExplorer';

export interface FilterState {
  active: boolean;
  visiblePaths: Set<string>;
  forcedExpanded: Set<string>;
  matchingPaths: Set<string>;
}

export const INACTIVE_FILTER_STATE: FilterState = {
  active: false,
  visiblePaths: new Set(),
  forcedExpanded: new Set(),
  matchingPaths: new Set(),
};

/**
 * Walk the loaded explorer tree and decide which entries should be visible
 * under the given filter query. Operates over the in-memory cache only — paths
 * inside unloaded directories are not considered.
 *
 * A node matches if its name (case-insensitive) contains the query. A
 * directory is visible if it matches or if any descendant is visible. Visible
 * directories that aren't direct matches are added to `forcedExpanded` so the
 * tree can render their subtree.
 */
export function computeFilterVisibility(
  rootPath: string,
  entriesByPath: Record<string, FileExplorerEntry[] | undefined>,
  query: string,
  showHidden: boolean,
): FilterState {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return INACTIVE_FILTER_STATE;
  }

  const needle = trimmed.toLowerCase();
  const visiblePaths = new Set<string>();
  const forcedExpanded = new Set<string>();
  const matchingPaths = new Set<string>();

  const walk = (entries: FileExplorerEntry[] | undefined): boolean => {
    if (!entries) return false;
    let anyVisible = false;

    for (const entry of entries) {
      if (!showHidden && entry.name.startsWith('.')) continue;

      const nameMatches = entry.name.toLowerCase().includes(needle);
      let descendantVisible = false;

      if (entry.isDirectory) {
        descendantVisible = walk(entriesByPath[entry.path]);
      }

      if (nameMatches || descendantVisible) {
        visiblePaths.add(entry.path);
        if (nameMatches) matchingPaths.add(entry.path);
        if (entry.isDirectory && descendantVisible) {
          forcedExpanded.add(entry.path);
        }
        anyVisible = true;
      }
    }

    return anyVisible;
  };

  walk(entriesByPath[rootPath]);

  return {
    active: true,
    visiblePaths,
    forcedExpanded,
    matchingPaths,
  };
}
