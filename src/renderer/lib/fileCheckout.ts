import { mainCheckoutContextId } from '../../shared/checkoutContext';
import type { WorkspaceTab, EditorTab } from '../store/workspaceTypes';
import { relativePath } from './pathUtils';
import { currentCheckoutSelection, checkoutUnavailableMessage, type CheckoutSelection } from './checkoutSelection';

export interface FileCheckout {
  workspacePath: string;
  checkoutContextId?: string;
  checkoutLabel?: string;
  unavailable?: string;
}

export function pathInFileCheckout(root: string, filePath: string): boolean {
  const relative = relativePath(root, filePath);
  return relative === '' || (relative !== filePath && relative !== '..' && !relative.startsWith('../'));
}

/** File IPC adapter to the canonical surface selector. Unavailable selections have no request root. */
export function fileCheckoutFromSelection(selection: CheckoutSelection): FileCheckout {
  if (selection.availability === 'unavailable') return { workspacePath: '', checkoutContextId: selection.contextId ?? undefined, unavailable: checkoutUnavailableMessage(selection.reason) };
  return selection.contextId === mainCheckoutContextId(selection.workspaceId) ? { workspacePath: selection.root }
    : { workspacePath: selection.root, checkoutContextId: selection.context.id, checkoutLabel: selection.context.branch || 'HEAD' };
}
export function focusedFileCheckout(workspace: Pick<WorkspaceTab, 'id' | 'environmentId' | 'workspacePath' | 'checkoutContexts' | 'activeTerminalId' | 'terminals' | 'fileSurfaceContextId'>): FileCheckout {
  return fileCheckoutFromSelection(currentCheckoutSelection(workspace));
}

/** Absolute paths keep identical relative names distinct; the context pins their IPC authority. */
export function fileCheckoutForPath(workspace: Pick<WorkspaceTab, 'id' | 'environmentId' | 'workspacePath' | 'checkoutContexts'>, filePath: string): FileCheckout {
  const context = workspace.checkoutContexts?.filter((entry) => entry.workspaceId === workspace.id && entry.environmentId === (workspace.environmentId ?? 'local') && !entry.missing && pathInFileCheckout(entry.path, filePath))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!context || context.id === mainCheckoutContextId(workspace.id)) return { workspacePath: workspace.workspacePath };
  return { workspacePath: context.path, checkoutContextId: context.id, checkoutLabel: context.branch || 'HEAD' };
}

/** Retire tree caches for lost roots, so re-adopting the same path cannot show an old checkout. */
export function retiredFileCheckoutState(workspace: WorkspaceTab, contexts: WorkspaceTab['checkoutContexts']): Partial<WorkspaceTab> {
  const roots = workspace.checkoutContexts?.filter((old) => old.id !== mainCheckoutContextId(workspace.id)
    && !contexts?.some((context) => context.id === old.id && !context.missing)).map((context) => context.path) ?? [];
  if (!roots.length) return {};
  const keep = (filePath: string) => !roots.some((root) => pathInFileCheckout(root, filePath));
  return {
    explorerEntriesByPath: Object.fromEntries(Object.entries(workspace.explorerEntriesByPath).filter(([key]) => keep(key))),
    explorerErrorsByPath: Object.fromEntries(Object.entries(workspace.explorerErrorsByPath).filter(([key]) => keep(key))),
    explorerLoadingPaths: workspace.explorerLoadingPaths.filter(keep),
    explorerExpandedPaths: workspace.explorerExpandedPaths.filter(keep),
    explorerSelectedPath: workspace.explorerSelectedPath && keep(workspace.explorerSelectedPath) ? workspace.explorerSelectedPath : null,
  };
}

/** A removed context must fail closed in main, never rebind a dirty buffer to the focused root. */
export function editorFileCheckout(workspace: Pick<WorkspaceTab, 'workspacePath'>, tab: Pick<EditorTab, 'checkoutContextId' | 'checkoutRoot'>): FileCheckout {
  return { workspacePath: tab.checkoutRoot ?? workspace.workspacePath, ...(tab.checkoutContextId ? { checkoutContextId: tab.checkoutContextId } : {}) };
}
