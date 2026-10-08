import { useAssistantNavStore } from './assistantNavStore';
import { create } from 'zustand';
import { workspacePageActions } from './workspacePageActions';
import { activePage, paneIsPresented, revealPane, revealTerminal, selectPage, synchronizePages } from './workspacePages';
import {
  buildWorkspaceLayout,
  fitLayoutRatios,
  collectLeafPaneIds,
  capturePanePlacementInLayout,
  dockPaneToEdgeInLayout,
  GRID_COLS,
  GRID_ROWS,
  insertPaneAtEdgeGapInLayout,
  insertPaneAtEdgeSegmentInLayout,
  insertPaneAtWorkspaceEdgeInLayout,
  insertPaneIntoLayout,
  movePaneInLayout,
  normalizeLayoutRoot,
  normalizePosition,
  removePaneFromLayout,
  restorePanePlacementInLayout,
  setSplitRatioInLayout,
  swapPaneIdsInLayout,
} from './workspaceLayout';
import type {
  BrowserPaneState,
  BrowserTab,
  EditorTab,
  LayoutNode,
  Pane,
  Terminal,
  WorkspaceResourcePolicy,
  WorkspaceResidencyState,
  WorkspaceTab,
} from './workspaceTypes';
import type { WorkspaceState } from './workspaceStoreTypes';
import {
  areGitStatusListsEqual,
  assignWorkspaceLifecycles,
  clearEditorOperationPending,
  createDefaultBrowserPane,
  createDefaultBrowserTab,
  createDefaultEditorState,
  createDefaultExplorerState,
  createDefaultNotesState,
  createPane,
  createWorkspaceId,
  findActiveWorkspace,
  findWorkspaceById,
  generateId,
  getActiveWorkspaceSnapshot,
  getWorkspaceNameFromPath,
  isEditorOperationPending,
  isWorkspaceActiveById,
  isWorkspaceWarm,
  getWorkspaceResourcePolicy,
  patchWorkspaceById,
  resolveWorkspaceByScope,
  resolveWorkspaceIdByScope,
  sanitizeWorkspace,
  setEditorOperationPending,
  syncActiveWorkspace,
  validateWorkspaceConsistency,
  withWorkspaceResidency,
  withWorkspaceResourcePolicy,
} from './workspaceStoreHelpers';
import { preserveOriginalLineEndings } from '../lib/lineEndings';
import { restoreWorkspaceLayoutFromPersisted } from '../lib/workspaceLayoutStorage';
import { isSameWorkspaceIdentity } from '../../shared/workspaceIdentity';
import { nameTerminal, nameTerminals } from '../lib/agentNames';
import { bindTerminalToCheckoutContext, reconcileCheckoutContextList, removeCheckoutContextFromList, upsertCheckoutContextList } from '../lib/checkoutContexts';
import { fileCheckoutForPath, editorFileCheckout, retiredFileCheckoutState } from '../lib/fileCheckout';
import { mainCheckoutContextId } from '../../shared/checkoutContext';

export type {
  BrowserPaneState,
  EditorPaneState,
  EditorTab,
  ExplorerPaneState,
  GridViewport,
  LayoutLeaf,
  LayoutNode,
  LayoutSplit,
  NotesPaneState,
  Pane,
  PanePosition,
  Terminal,
  WorkspaceTab,
} from './workspaceTypes';

export type { DockEdge, EdgeGap, EdgeTerminal, PaneDropTarget } from './workspaceLayout';
export { getEdgeTerminals } from './workspaceLayout';

export * from './workspaceStoreHelpers';

/**
 * Workspace state for the active workspace and the collection of all workspaces.
 *
 * @invariant activeWorkspaceId === null - workspaces.length === 0
 *   When no workspaces exist, nothing can be active.
 *
 * @invariant activeWorkspaceId !== null -> workspaces.some(w => w.id === activeWorkspaceId)
 *   The active workspace ID always references an existing workspace.
 *
 * @invariant workspaces.length > 0 -> workspaces.filter(w => w.lifecycle === 'active').length === 1
 *   Exactly one workspace must be marked active in lifecycle state.
 *
 * @invariant activeTerminalId is null when the active page presents no terminal.
 *   Minimized and other-page terminals remain workspace-owned.
 *
 * @invariant activeTerminalId !== null -> terminals.some(t => t.id === activeTerminalId)
 *   The active terminal ID always references an existing terminal.
 *
 * @invariant layoutRoot mirrors the active page; an empty page has a null tree.
 *   Other pages and minimized panes do not contribute leaves.
 *
 * @invariant layoutRoot !== null -> all pane IDs in layoutRoot exist in
 *   panes[].id ∪ {explorerPane?.id} ∪ {browserPane?.id} ∪ {editorPane?.id} ∪ {notesPane?.id}
 *   The layout tree only references valid pane IDs.
 *
 * @invariant activeEditorTabId === null - editorTabs.length === 0
 *   When no editor tabs are open, no tab can be active.
 *
 * @invariant activeEditorTabId !== null -> editorTabs.some(t => t.id === activeEditorTabId)
 *   The active editor tab ID always references an existing tab.
 */
const defaultWorkspaceState = {
  name: '',
  workspacePath: '',
  harness: 'codex',
  model: '',
  terminals: [] as Terminal[],
  panes: [] as Pane[],
  browserVisible: false,
  browserOverlayCount: 0,
  browserUrl: 'https://github.com',
  activeTerminalId: null as string | null,
  browserPane: null as BrowserPaneState | null,
  layoutRoot: null as LayoutNode | null,
  ...createDefaultExplorerState(),
  ...createDefaultEditorState(),
  ...createDefaultNotesState(),
  gridViewport: { cols: GRID_COLS, rows: GRID_ROWS },
  layoutRevision: 0,
  layoutUndoStack: [] as LayoutNode[],
  pendingEditorOperations: {} as Record<string, string>,
  gitCurrentBranch: null as string | null,
  gitIsRepo: false,
  gitIsDetached: false,
};

const MAX_LAYOUT_UNDO_DEPTH = 20;
const automaticEditorReloads = new Map<string, { rerun: boolean; invalidated: boolean }>();

function patchWorkspaceLayout(
  state: WorkspaceState,
  workspace: WorkspaceTab,
  nextLayoutRoot: LayoutNode | null,
  recordUndo = true,
): Partial<WorkspaceState> | WorkspaceState {
  if (activePage(workspace)?.maximizedPaneId || nextLayoutRoot === workspace.layoutRoot) {
    return state;
  }

  const nextUndoStack = recordUndo && workspace.layoutRoot
    ? [...(workspace.layoutUndoStack ?? []), workspace.layoutRoot].slice(-MAX_LAYOUT_UNDO_DEPTH)
    : [...(workspace.layoutUndoStack ?? [])];
  const nextRevision = (workspace.layoutRevision ?? 0) + 1;

  return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
    ...currentWorkspace,
    layoutRoot: nextLayoutRoot,
    layoutRevision: nextRevision,
    layoutUndoStack: nextUndoStack,
  }));
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...defaultWorkspaceState,
  ...workspacePageActions(set),
  workspaces: [],
  activeWorkspaceId: null,
  activeWorkspaceLifecycle: null,

  addWorkspace: (workspace) => set((state) => {
    // The added workspace becomes the active surface, so any app-level Assistant surface is parked (kept warm, not closed).
    // This runs only here, i.e. after a workspace was actually registered; a failed open never reaches it.
    useAssistantNavStore.getState().clearActive();
    const id = workspace.id ?? createWorkspaceId();
    const defaultName = workspace.name || getWorkspaceNameFromPath(workspace.workspacePath);
    const nextWorkspace: WorkspaceTab = sanitizeWorkspace({
      ...createDefaultExplorerState(),
      ...createDefaultEditorState(),
      ...createDefaultNotesState(),
      id,
      lifecycle: 'active',
      ...workspace,
      terminals: nameTerminals(workspace.terminals),
      name: defaultName,
    });
    const nextWorkspaces = assignWorkspaceLifecycles([...state.workspaces, nextWorkspace], id);

    const nextState = {
      ...getActiveWorkspaceSnapshot(nextWorkspace),
      workspaces: nextWorkspaces,
      activeWorkspaceId: id,
      activeWorkspaceLifecycle: 'active' as const,
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after addWorkspace:', warnings);
      }
    }
    return nextState;
  }),

  hydrateWorkspaceShells: (shells, requestedActiveId) => set((state) => {
    // Prepared shells are installed once; live user-opened workspaces win duplicate races.
    const workspaces = [...state.workspaces];
    for (const shell of shells) {
      if (!workspaces.some((entry) => isSameWorkspaceIdentity(
        { environmentId: entry.environmentId, path: entry.workspacePath },
        { environmentId: shell.environmentId, path: shell.workspacePath },
      ))) workspaces.push(sanitizeWorkspace(shell));
    }
    const requested = shells.find((shell) => shell.id === requestedActiveId);
    const activeId = workspaces.find((entry) => entry.id === requestedActiveId || (requested && isSameWorkspaceIdentity(
      { environmentId: entry.environmentId, path: entry.workspacePath },
      { environmentId: requested.environmentId, path: requested.workspacePath },
    )))?.id ?? workspaces[0]?.id ?? null;
    const active = workspaces.find((entry) => entry.id === activeId);
    return {
      ...(active ? getActiveWorkspaceSnapshot(active) : defaultWorkspaceState),
      workspaces: assignWorkspaceLifecycles(workspaces, activeId),
      activeWorkspaceId: activeId, activeWorkspaceLifecycle: active ? 'active' : null,
    };
  }),

  getWorkspaceById: (id) => {
    return findWorkspaceById(get().workspaces, id);
  },

  getActiveWorkspace: () => {
    return findActiveWorkspace(get().workspaces);
  },

  isWorkspaceActive: (id) => {
    return isWorkspaceActiveById(get().workspaces, id);
  },

  selectWorkspace: (id, terminalId) => set((state) => {
    // Choosing a workspace always leaves any app-level Assistant surface (opened ones stay alive, parked).
    useAssistantNavStore.getState().clearActive();
    const workspace = findWorkspaceById(state.workspaces, id);
    if (workspace == null) {
      return state;
    }

    const next = sanitizeWorkspace({
      ...workspace,
      lifecycle: 'active',
    });
    const selected = terminalId && next.terminals.some((terminal) => terminal.id === terminalId)
      ? synchronizePages(next, revealTerminal(next, terminalId))
      : next;
    const nextWorkspaces = assignWorkspaceLifecycles(
      state.workspaces.map((entry) => entry.id === id ? selected : entry),
      id,
    );
    const nextState = {
      ...getActiveWorkspaceSnapshot(selected),
      workspaces: nextWorkspaces,
      gridViewport: state.gridViewport,
      activeWorkspaceId: id,
      activeWorkspaceLifecycle: 'active' as const,
    };

    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after selectWorkspace:', warnings);
      }
    }

    return nextState;
  }),

  moveWorkspace: (workspaceId, targetWorkspaceId) => {
    set((state) => {
      if (workspaceId === targetWorkspaceId) return state;
      const fromIndex = state.workspaces.findIndex((workspace) => workspace.id === workspaceId);
      const targetIndex = state.workspaces.findIndex((workspace) => workspace.id === targetWorkspaceId);
      if (fromIndex < 0 || targetIndex < 0) return state;
      const workspaces = [...state.workspaces];
      const [workspace] = workspaces.splice(fromIndex, 1);
      workspaces.splice(targetIndex, 0, workspace);
      return { workspaces };
    });
  },

  closeWorkspace: (id) => set((state) => {
    const remaining = state.workspaces.filter((workspace) => workspace.id !== id);

    if (remaining.length === 0) {
      return {
        ...defaultWorkspaceState,
        workspaces: [],
        activeWorkspaceId: null,
        activeWorkspaceLifecycle: null,
      };
    }

    if (state.activeWorkspaceId === id) {
      const nextActive = remaining[Math.max(0, remaining.length - 1)];
      const nextWorkspaces = assignWorkspaceLifecycles(remaining, nextActive.id);
      return {
        ...getActiveWorkspaceSnapshot(nextActive),
        gridViewport: state.gridViewport,
        layoutRevision: state.layoutRevision,
        workspaces: nextWorkspaces,
        activeWorkspaceId: nextActive.id,
        activeWorkspaceLifecycle: 'active',
      };
    }

    const nextWorkspaces = assignWorkspaceLifecycles(remaining, state.activeWorkspaceId);
    return {
      workspaces: nextWorkspaces,
      activeWorkspaceLifecycle: 'active',
    };
  }),

  updateWorkspaceName: (id, name) => set((state) => ({
    ...(id === state.activeWorkspaceId ? { name } : {}),
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === id ? { ...workspace, name } : workspace
    )),
  })),

  upsertCheckoutContext: (workspaceId, checkoutContext) => {
    const workspace = findWorkspaceById(get().workspaces, workspaceId);
    if (!workspace) return false;
    const next = upsertCheckoutContextList(workspace, checkoutContext);
    if (!next) return false;
    if (next !== workspace.checkoutContexts) {
      set((state) => patchWorkspaceById(state, workspaceId, (entry) => ({ ...entry, checkoutContexts: next })));
    }
    return true;
  },

  removeCheckoutContext: (workspaceId, checkoutContextId) => {
    const workspace = findWorkspaceById(get().workspaces, workspaceId);
    if (!workspace) return false;
    const next = removeCheckoutContextFromList(workspace, checkoutContextId);
    if (!next) return false;
    set((state) => patchWorkspaceById(state, workspaceId, (entry) => ({ ...entry, ...retiredFileCheckoutState(entry, next), checkoutContexts: next })));
    return true;
  },

  applyCheckoutContextReconciliation: (workspaceId, result) => {
    const workspace = findWorkspaceById(get().workspaces, workspaceId);
    if (!workspace) return;
    const next = reconcileCheckoutContextList(workspace, result);
    if (next === workspace.checkoutContexts) return;
    set((state) => patchWorkspaceById(state, workspaceId, (entry) => ({ ...entry, ...retiredFileCheckoutState(entry, next), checkoutContexts: next })));
  },

  setWorkspacePath: (path) => set((state) => syncActiveWorkspace(state, (workspace) => ({
    ...workspace,
    workspacePath: path,
  }))),

  setHarness: (harness) => set((state) => syncActiveWorkspace(state, (workspace) => ({
    ...workspace,
    harness,
    model: '',
  }))),

  setModel: (model) => set((state) => syncActiveWorkspace(state, (workspace) => ({
    ...workspace,
    model,
  }))),

  // -------------------------------------------------------------------------
  // Workspace residency actions
  // -------------------------------------------------------------------------

  /**
   * Returns true if the workspace is warm (surface residency is active).
   * If no workspaceId is provided, operates on the active workspace.
   */
  isWorkspaceWarm: (workspaceId?: string) => {
    const id = workspaceId ?? get().activeWorkspaceId;
    const workspace = id ? findWorkspaceById(get().workspaces, id) : null;
    return workspace ? isWorkspaceWarm(workspace) : false;
  },

  /**
   * Gets the resource policy for a workspace by id.
   * Returns the policy with all sub-fields filled (never partial).
   */
  getWorkspaceResourcePolicy: (workspaceId: string) => {
    const workspace = findWorkspaceById(get().workspaces, workspaceId);
    return workspace ? getWorkspaceResourcePolicy(workspace) : null;
  },

  /**
   * Sets the residency state for a workspace by id.
   * Does not affect other runtime state fields.
   */
  setWorkspaceResidency: (workspaceId: string, residencyState: WorkspaceResidencyState) => set((state) => {
    return patchWorkspaceById(state, workspaceId, (workspace) =>
      withWorkspaceResidency(workspace, residencyState)
    );
  }),

  /**
   * Merges a partial resource policy into a workspace by id.
   * Only the provided fields are updated; all others are preserved.
   */
  setWorkspaceResourcePolicy: (workspaceId: string, partialPolicy: Partial<WorkspaceResourcePolicy>) => set((state) => {
    return patchWorkspaceById(state, workspaceId, (workspace) =>
      withWorkspaceResourcePolicy(workspace, partialPolicy)
    );
  }),

  addTerminal: (unnamedTerminal, workspaceId, reservedPaneId, pageId) => set((current) => {
    const owner = resolveWorkspaceByScope(current, workspaceId);
    const targetPageId = pageId ?? (reservedPaneId ? owner?.pages?.find((page) => collectLeafPaneIds(page.layoutRoot).includes(reservedPaneId))?.id : owner?.activePageId);
    if (pageId && !owner?.pages?.some((page) => page.id === pageId)) throw new Error('The destination page was removed');
    const scopedWorkspace = owner && targetPageId ? selectPage(owner, targetPageId) : workspaceId ? owner : null;
    if (workspaceId && !scopedWorkspace) return current;
    const state = scopedWorkspace ? { ...current, ...getActiveWorkspaceSnapshot(scopedWorkspace) } : current;
    const owningWorkspaceId = scopedWorkspace?.id ?? current.activeWorkspaceId;
    const named = nameTerminal(unnamedTerminal, state.terminals);
    const terminal = owningWorkspaceId ? bindTerminalToCheckoutContext(named, owningWorkspaceId) : named;
    const nextTerminals = [...state.terminals, terminal];
    const reservedPane = reservedPaneId ? state.panes.find((pane) => pane.id === reservedPaneId && pane.terminalId === null) : undefined;
    if (reservedPaneId && !reservedPane) throw new Error('The reserved resume pane is no longer available');
    const paneExists = Boolean(reservedPane) || state.panes.some((pane) => pane.terminalId === terminal.id);
    const nextPane = reservedPane ? { ...reservedPane, terminalId: terminal.id } : paneExists
      ? state.panes.find((pane) => pane.terminalId === terminal.id) ?? createPane(terminal.id)
      : createPane(terminal.id);
    const nextPanes = reservedPane ? state.panes.map((pane) => pane.id === reservedPane.id ? nextPane : pane) : paneExists
      ? state.panes
      : [...state.panes, nextPane];

    const nextLayoutRoot = paneExists
      ? normalizeLayoutRoot(state.layoutRoot, {
          pages: scopedWorkspace?.pages ?? findWorkspaceById(current.workspaces, current.activeWorkspaceId)?.pages,
          activePageId: scopedWorkspace?.activePageId ?? findWorkspaceById(current.workspaces, current.activeWorkspaceId)?.activePageId,
          minimizedPanes: scopedWorkspace?.minimizedPanes ?? findWorkspaceById(current.workspaces, current.activeWorkspaceId)?.minimizedPanes,
          panes: nextPanes,
          explorerPane: state.explorerPane,
          explorerVisible: state.explorerVisible,
          browserPane: state.browserPane,
          browserVisible: state.browserVisible,
          editorPane: state.editorPane,
          editorVisible: state.editorVisible,
          notesPane: state.notesPane,
          notesVisible: state.notesVisible,
        })
      : insertPaneIntoLayout(state.layoutRoot, nextPane.id, {
          panes: state.panes,
          explorerPane: state.explorerPane,
          explorerVisible: state.explorerVisible,
          browserPane: state.browserPane,
          browserVisible: state.browserVisible,
          editorPane: state.editorPane,
          editorVisible: state.editorVisible,
          notesPane: state.notesPane,
          notesVisible: state.notesVisible,
          activeTerminalId: state.activeTerminalId,
        });

    const nextActiveTerminalId = terminal.id;

    const updateWorkspace = (workspace: WorkspaceTab): WorkspaceTab => {
      const target = targetPageId ? selectPage(workspace, targetPageId) : workspace;
      const updated = synchronizePages(target, {
        ...target, terminals: nextTerminals, panes: nextPanes,
        pendingTerminalIds: [...(target.pendingTerminalIds ?? []), terminal.id],
        pages: target.pages?.map((page) => page.id === target.activePageId ? { ...page, maximizedPaneId: undefined } : page),
        activeTerminalId: nextActiveTerminalId, layoutRoot: nextLayoutRoot,
        layoutRevision: state.layoutRevision + 1, model: state.model,
      });
      return workspace.activePageId && workspace.activePageId !== targetPageId ? selectPage(updated, workspace.activePageId) : updated;
    };
    if (workspaceId) return patchWorkspaceById(current, workspaceId, updateWorkspace);
    const nextState = {
      terminals: nextTerminals,
      panes: nextPanes,
      activeTerminalId: nextActiveTerminalId,
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, updateWorkspace),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after addTerminal:', warnings);
      }
    }

    return nextState;
  }),

  removeTerminal: (id) => set((current) => {
    const owner = current.workspaces.find((workspace) => workspace.terminals.some((terminal) => terminal.id === id));
    if (!owner) return current;
    const state = { ...current, ...getActiveWorkspaceSnapshot(owner), activeWorkspaceId: owner.id };
    const nextTerminals = state.terminals.filter((terminal) => terminal.id !== id);
    const paneToRemove = state.panes.find((pane) => pane.terminalId === id);
    const nextPanes = state.panes.filter((pane) => pane.terminalId !== id);
    const nextActiveTerminalId = state.activeTerminalId === id
      ? (nextTerminals.length > 0 ? nextTerminals[nextTerminals.length - 1].id : null)
      : state.activeTerminalId;
    const nextLayoutRoot = paneToRemove
      ? removePaneFromLayout(state.layoutRoot, paneToRemove.id)
      : state.layoutRoot;
    const nextState = {
      terminals: nextTerminals,
      panes: nextPanes,
      activeTerminalId: nextActiveTerminalId,
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        terminals: nextTerminals,
        panes: nextPanes,
        activeTerminalId: nextActiveTerminalId,
        layoutRoot: nextLayoutRoot,
      })),
    };

    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after removeTerminal:', warnings);
      }
    }


    return owner.id === current.activeWorkspaceId ? nextState : { workspaces: nextState.workspaces };
  }),

  replaceTerminal: (workspaceId, previousTerminalId, replacement) => {
    const workspace = findWorkspaceById(get().workspaces, workspaceId);
    if (!workspace) return false;
    const previous = workspace.terminals.find((terminal) => terminal.id === previousTerminalId);
    const pane = workspace.panes.find((entry) => entry.terminalId === previousTerminalId);
    if (!previous || !pane) return false;
    if (replacement.workspaceId !== undefined && replacement.workspaceId !== workspaceId) return false;
    if (replacement.id !== previousTerminalId && workspace.terminals.some((terminal) => terminal.id === replacement.id)) return false;
    const adopted = bindTerminalToCheckoutContext(
      { ...replacement, workspaceId, ...(previous.displayName ? { displayName: previous.displayName } : {}) },
      workspaceId,
    );
    set((state) => patchWorkspaceById(state, workspaceId, (entry) => ({
      ...entry,
      terminals: entry.terminals.map((terminal) => (terminal.id === previousTerminalId ? adopted : terminal)),
      pendingTerminalIds: replacement.id === previousTerminalId ? entry.pendingTerminalIds : [...(entry.pendingTerminalIds ?? []).filter((id) => id !== previousTerminalId), replacement.id],
      panes: entry.panes.map((candidate) => (candidate.id === pane.id ? { ...candidate, terminalId: adopted.id } : candidate)),
      activeTerminalId: entry.activeTerminalId === previousTerminalId ? adopted.id : entry.activeTerminalId,
      pages: entry.pages?.map((page) => ({ ...page, activeTerminalId: page.activeTerminalId === previousTerminalId ? adopted.id : page.activeTerminalId })),
    })));
    return true;
  },

  setActiveTerminal: (id) => set((state) => {
    const nextState = {
      activeTerminalId: id,
      ...syncActiveWorkspace(state, (workspace) => revealTerminal(workspace, id)),
    };

    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after setActiveTerminal:', warnings);
      }
    }

    return nextState;
  }),

  setBrowserVisible: (visible, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    if (visible && workspace.browserVisible && workspace.browserPane && workspace.pages) {
      return patchWorkspaceById(state, workspace.id, (current) => revealPane(current, workspace.browserPane!.id));
    }
    const browserLeafPresent = workspace.browserPane != null
      && collectLeafPaneIds(workspace.layoutRoot ?? null).includes(workspace.browserPane.id);
    if (visible === workspace.browserVisible && visible === browserLeafPresent) {
      return state;
    }

    let nextBrowserPane = workspace.browserPane;
    let nextLayoutRoot = workspace.layoutRoot;
    let nextHint = workspace.browserPlacementHint ?? null;

    if (visible) {
      nextBrowserPane = workspace.browserPane ?? createDefaultBrowserPane(
        generateId('browser'),
        { x: 0, y: 0, w: 6, h: 6 },
        workspace.browserUrl,
      );
      if (!browserLeafPresent) {
        const restored = nextHint
          ? restorePanePlacementInLayout(workspace.layoutRoot, nextBrowserPane.id, nextHint)
          : null;
        nextLayoutRoot = restored?.ok
          ? restored.layoutRoot
          : insertPaneAtWorkspaceEdgeInLayout(workspace.layoutRoot, nextBrowserPane.id, 'right');
      }
      nextHint = null;
    } else if (workspace.browserPane) {
      nextHint = capturePanePlacementInLayout(workspace.layoutRoot, workspace.browserPane.id);
      nextLayoutRoot = removePaneFromLayout(workspace.layoutRoot, workspace.browserPane.id);
    }

    // Visibility only: browser tabs/views are retained and no layout undo entry is recorded.
    return patchWorkspaceById(state, workspace.id, (current) => ({
      ...current,
      browserVisible: visible,
      browserPane: nextBrowserPane,
      layoutRoot: nextLayoutRoot,
      layoutRevision: (current.layoutRevision ?? 0) + 1,
      browserPlacementHint: nextHint,
    }));
  }),

  toggleBrowser: (workspaceId) => {
    const workspace = resolveWorkspaceByScope(get(), workspaceId);
    if (workspace == null) {
      return;
    }
    get().setBrowserVisible(!workspace.browserVisible || Boolean(workspace.pages && workspace.browserPane && !paneIsPresented(workspace, workspace.browserPane.id)), workspace.id);
  },

  toggleNotesPane: () => set((state) => {
    const workspace = resolveWorkspaceByScope(state);
    if (workspace?.pages && workspace.notesVisible && workspace.notesPane && !paneIsPresented(workspace, workspace.notesPane.id)) {
      return patchWorkspaceById(state, workspace.id, (current) => revealPane(current, workspace.notesPane!.id));
    }
    const nextNotesVisible = !state.notesVisible;
    const nextNotesPane = nextNotesVisible
      ? state.notesPane ?? { id: generateId('notes') }
      : state.notesPane;

    let nextLayoutRoot = state.layoutRoot;
    if (nextNotesVisible && nextNotesPane) {
      const notesId = nextNotesPane.id;
      const currentIds = collectLeafPaneIds(state.layoutRoot ?? null);
      if (!currentIds.includes(notesId)) {
        nextLayoutRoot = insertPaneIntoLayout(state.layoutRoot, notesId, {
          panes: state.panes,
          explorerPane: state.explorerPane,
          explorerVisible: state.explorerVisible,
          browserPane: state.browserPane,
          browserVisible: state.browserVisible,
          editorPane: state.editorPane,
          editorVisible: state.editorVisible,
          notesPane: nextNotesPane,
          notesVisible: true,
          activeTerminalId: state.activeTerminalId,
        });
      }
    } else if (!nextNotesVisible && state.notesPane) {
      nextLayoutRoot = removePaneFromLayout(state.layoutRoot, state.notesPane.id);
    }

    const nextState = {
      notesVisible: nextNotesVisible,
      notesPane: nextNotesPane,
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        notesVisible: nextNotesVisible,
        notesPane: nextNotesPane,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after toggleNotesPane:', warnings);
      }
    }
    return nextState;
  }),

  closeNotesPane: (workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace?.notesPane == null) {
      return state;
    }

    const nextLayoutRoot = removePaneFromLayout(workspace.layoutRoot, workspace.notesPane.id);
    const nextState = {
      layoutRevision: state.layoutRevision + 1,
      ...patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
        ...currentWorkspace,
        notesVisible: false,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after closeNotesPane:', warnings);
      }
    }
    return nextState;
  }),

  pushBrowserOverlay: (workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return {
        browserOverlayCount: state.browserOverlayCount + 1,
      };
    }

    return patchWorkspaceById(state, scopedWorkspaceId, (workspace) => ({
      ...workspace,
      browserOverlayCount: (workspace.browserOverlayCount ?? 0) + 1,
    }));
  }),

  popBrowserOverlay: (workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return {
        browserOverlayCount: Math.max(0, state.browserOverlayCount - 1),
      };
    }

    return patchWorkspaceById(state, scopedWorkspaceId, (workspace) => ({
      ...workspace,
      browserOverlayCount: Math.max(0, (workspace.browserOverlayCount ?? 0) - 1),
    }));
  }),

  setBrowserUrl: (url, workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return state;
    }

    return patchWorkspaceById(state, scopedWorkspaceId, (workspace) => {
      const browserPane = workspace.browserPane;
      if (browserPane == null) {
        return { ...workspace, browserUrl: url };
      }
      const activeTabId = browserPane.activeTabId;
      const nextTabs = browserPane.tabs.map((tab) =>
        tab.id === activeTabId ? { ...tab, url } : tab,
      );
      return {
        ...workspace,
        browserUrl: url,
        browserPane: { ...browserPane, tabs: nextTabs },
      };
    });
  }),

  updateWorkspaceBrowserUrl: (workspaceId, tabId, url, title) => set((state) => (
    patchWorkspaceById(state, workspaceId, (workspace) => {
      const browserPane = workspace.browserPane;
      if (browserPane == null) {
        // No pane: still mirror the URL for compatibility.
        return { ...workspace, browserUrl: url };
      }

      const targetTabId = tabId ?? browserPane.activeTabId;
      if (targetTabId == null) {
        return { ...workspace, browserUrl: url };
      }

      const targetExists = browserPane.tabs.some((tab) => tab.id === targetTabId);
      if (!targetExists) {
        return workspace;
      }

      const nextTabs = browserPane.tabs.map((tab) => {
        if (tab.id !== targetTabId) {
          return tab;
        }
        const nextTab: BrowserTab = { ...tab, url };
        if (typeof title === 'string') {
          nextTab.title = title;
        }
        return nextTab;
      });

      const isActive = targetTabId === browserPane.activeTabId;
      return {
        ...workspace,
        browserUrl: isActive ? url : workspace.browserUrl,
        browserPane: { ...browserPane, tabs: nextTabs },
      };
    })
  )),

  addBrowserTab: (workspaceId) => {
    const state = get();
    const scopedWorkspace = resolveWorkspaceByScope(state, workspaceId);
    if (scopedWorkspace == null || scopedWorkspace.browserPane == null) {
      return null;
    }

    const newTab = createDefaultBrowserTab();
    const newTabId = newTab.id;

    set((current) => patchWorkspaceById(current, scopedWorkspace.id, (workspace) => {
      const browserPane = workspace.browserPane;
      if (browserPane == null) {
        return workspace;
      }
      const nextTabs = [...browserPane.tabs, newTab];
      return {
        ...workspace,
        browserUrl: newTab.url,
        browserPane: {
          ...browserPane,
          tabs: nextTabs,
          activeTabId: newTabId,
        },
      };
    }));

    return newTabId;
  },

  removeBrowserTab: (tabId, workspaceId) => {
    const state = get();
    const scopedWorkspace = resolveWorkspaceByScope(state, workspaceId);
    if (scopedWorkspace == null || scopedWorkspace.browserPane == null) {
      return { removed: false, nextActiveTabId: null };
    }

    const browserPane = scopedWorkspace.browserPane;
    const tabIndex = browserPane.tabs.findIndex((tab) => tab.id === tabId);
    if (tabIndex === -1) {
      return { removed: false, nextActiveTabId: browserPane.activeTabId };
    }
    if (browserPane.tabs.length <= 1) {
      // Cannot close the last tab.
      return { removed: false, nextActiveTabId: browserPane.activeTabId };
    }

    const nextTabs = browserPane.tabs.filter((tab) => tab.id !== tabId);

    let nextActiveTabId = browserPane.activeTabId;
    if (browserPane.activeTabId === tabId) {
      // Prefer next tab; fall back to previous.
      const fallback = browserPane.tabs[tabIndex + 1] ?? browserPane.tabs[tabIndex - 1] ?? null;
      nextActiveTabId = fallback?.id ?? null;
    }

    set((current) => patchWorkspaceById(current, scopedWorkspace.id, (workspace) => {
      const pane = workspace.browserPane;
      if (pane == null) {
        return workspace;
      }
      const newActiveTab = nextActiveTabId
        ? nextTabs.find((tab) => tab.id === nextActiveTabId) ?? null
        : null;
      const nextBrowserUrl = newActiveTab ? newActiveTab.url : workspace.browserUrl;
      return {
        ...workspace,
        browserUrl: nextBrowserUrl,
        browserPane: {
          ...pane,
          tabs: nextTabs,
          activeTabId: nextActiveTabId,
        },
      };
    }));

    return { removed: true, nextActiveTabId };
  },

  setActiveBrowserTab: (tabId, workspaceId) => {
    const state = get();
    const scopedWorkspace = resolveWorkspaceByScope(state, workspaceId);
    if (scopedWorkspace == null || scopedWorkspace.browserPane == null) {
      return false;
    }
    const target = scopedWorkspace.browserPane.tabs.find((tab) => tab.id === tabId);
    if (target == null) {
      return false;
    }

    set((current) => patchWorkspaceById(current, scopedWorkspace.id, (workspace) => {
      const pane = workspace.browserPane;
      if (pane == null) {
        return workspace;
      }
      const activeTab = pane.tabs.find((tab) => tab.id === tabId);
      if (activeTab == null) {
        return workspace;
      }
      return {
        ...workspace,
        browserUrl: activeTab.url,
        browserPane: { ...pane, activeTabId: tabId },
      };
    }));

    return true;
  },

  moveBrowserTab: (tabId, targetTabId, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    const tabs = workspace?.browserPane?.tabs;
    if (!workspace || !tabs || tabId === targetTabId) return state;
    const fromIndex = tabs.findIndex((tab) => tab.id === tabId);
    const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId);
    if (fromIndex < 0 || targetIndex < 0) return state;
    const reordered = [...tabs];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      browserPane: currentWorkspace.browserPane
        ? { ...currentWorkspace.browserPane, tabs: reordered }
        : null,
    }));
  }),

  updateBrowserTab: (tabId, partial, workspaceId) => {
    const state = get();
    const scopedWorkspace = resolveWorkspaceByScope(state, workspaceId);
    if (scopedWorkspace == null || scopedWorkspace.browserPane == null) {
      return false;
    }
    const exists = scopedWorkspace.browserPane.tabs.some((tab) => tab.id === tabId);
    if (!exists) {
      return false;
    }

    set((current) => patchWorkspaceById(current, scopedWorkspace.id, (workspace) => {
      const pane = workspace.browserPane;
      if (pane == null) {
        return workspace;
      }
      const nextTabs = pane.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const next: BrowserTab = { ...tab };
        if (typeof partial.url === 'string') next.url = partial.url;
        if (typeof partial.title === 'string') next.title = partial.title;
        if (typeof partial.canGoBack === 'boolean') next.canGoBack = partial.canGoBack;
        if (typeof partial.canGoForward === 'boolean') next.canGoForward = partial.canGoForward;
        return next;
      });
      const isActive = pane.activeTabId === tabId;
      const nextActiveTab = nextTabs.find((tab) => tab.id === tabId);
      return {
        ...workspace,
        browserUrl: isActive && nextActiveTab ? nextActiveTab.url : workspace.browserUrl,
        browserPane: { ...pane, tabs: nextTabs },
      };
    }));

    return true;
  },

  clearTerminals: () => set((state) => {
    const nextState = {
      terminals: [],
      panes: [],
      activeTerminalId: null,
      layoutRoot: null,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        terminals: [],
        panes: [],
        activeTerminalId: null,
        layoutRoot: null,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after clearTerminals:', warnings);
      }
    }

    return nextState;
  }),

  setExplorerVisible: (visible, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (
      workspace == null
      || (workspace.explorerVisible === visible && (!visible || workspace.explorerPane != null))
    ) {
      return state;
    }

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      explorerVisible: visible,
    }));
  }),

  setExplorerSidebarWidth: (width, workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return state;
    }

    return patchWorkspaceById(state, scopedWorkspaceId, (workspace) => ({
      ...workspace,
      explorerSidebarWidth: width,
    }));
  }),

  toggleExplorerPath: (path, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const explorerExpandedPaths = workspace.explorerExpandedPaths.includes(path)
      ? workspace.explorerExpandedPaths.filter((entry) => entry !== path)
      : [...workspace.explorerExpandedPaths, path];

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      explorerExpandedPaths,
    }));
  }),

  setExplorerExpandedPaths: (paths, workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return state;
    }

    return patchWorkspaceById(state, scopedWorkspaceId, (workspace) => ({
      ...workspace,
      explorerExpandedPaths: paths,
    }));
  }),

  clearExplorerDirectoryState: (paths, workspaceId) => set((state) => {
    if (paths.length === 0) {
      return state;
    }

    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const pathSet = new Set(paths);
    const explorerEntriesByPath = { ...workspace.explorerEntriesByPath };
    const explorerErrorsByPath = { ...workspace.explorerErrorsByPath };
    for (const path of pathSet) {
      delete explorerEntriesByPath[path];
      delete explorerErrorsByPath[path];
    }

    const explorerLoadingPaths = workspace.explorerLoadingPaths.filter((path) => !pathSet.has(path));

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      explorerEntriesByPath,
      explorerErrorsByPath,
      explorerLoadingPaths,
    }));
  }),

  setExplorerSelectedPath: (path, workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return state;
    }

    return patchWorkspaceById(state, scopedWorkspaceId, (workspace) => ({
      ...workspace,
      explorerSelectedPath: path,
    }));
  }),

  setExplorerDirectoryEntries: (directoryPath, entries, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const explorerEntriesByPath = {
      ...workspace.explorerEntriesByPath,
      [directoryPath]: entries,
    };
    const explorerErrorsByPath = {
      ...workspace.explorerErrorsByPath,
      [directoryPath]: null,
    };

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      explorerEntriesByPath,
      explorerErrorsByPath,
    }));
  }),

  setExplorerDirectoryLoading: (directoryPath, loading, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const explorerLoadingPaths = loading
      ? workspace.explorerLoadingPaths.includes(directoryPath)
        ? workspace.explorerLoadingPaths
        : [...workspace.explorerLoadingPaths, directoryPath]
      : workspace.explorerLoadingPaths.filter((entry) => entry !== directoryPath);

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      explorerLoadingPaths,
    }));
  }),

  setExplorerDirectoryError: (directoryPath, error, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const explorerErrorsByPath = {
      ...workspace.explorerErrorsByPath,
      [directoryPath]: error,
    };

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      explorerErrorsByPath,
    }));
  }),

  resetExplorerState: () => set((state) => {
    const defaults = createDefaultExplorerState();
    const explorerPaneId = state.explorerPane?.id;
    const nextLayoutRoot = explorerPaneId
      ? removePaneFromLayout(state.layoutRoot, explorerPaneId)
      : state.layoutRoot;
    const nextLayoutRevision = nextLayoutRoot === state.layoutRoot
      ? state.layoutRevision
      : state.layoutRevision + 1;

    return {
      ...defaults,
      layoutRoot: nextLayoutRoot,
      layoutRevision: nextLayoutRevision,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        ...defaults,
        layoutRoot: nextLayoutRoot,
        layoutRevision: nextLayoutRevision,
      })),
    };
  }),

  setShowHiddenFiles: (show, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null || workspace.showHiddenFiles === show) {
      return state;
    }

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      showHiddenFiles: show,
    }));
  }),

  setGitChanges: (changes) => set((state) => {
    if (areGitStatusListsEqual(state.gitChanges, changes)) {
      return state;
    }

    return {
      gitChanges: changes,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        gitChanges: changes,
      })),
    };
  }),

  setGitBranchInfo: (branch, isRepo, isDetached) => set((state) => {
    if (
      state.gitCurrentBranch === branch &&
      state.gitIsRepo === isRepo &&
      state.gitIsDetached === isDetached
    ) {
      return state;
    }

    return {
      gitCurrentBranch: branch,
      gitIsRepo: isRepo,
      gitIsDetached: isDetached,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        gitCurrentBranch: branch,
        gitIsRepo: isRepo,
        gitIsDetached: isDetached,
      })),
    };
  }),

  setPanes: (panes) => set((state) => ({
    panes,
    layoutRoot: buildWorkspaceLayout({
      ...(resolveWorkspaceByScope(state) ?? {}),
      panes,
      explorerVisible: state.explorerVisible,
      explorerPane: state.explorerPane,
      browserVisible: state.browserVisible,
      browserPane: state.browserPane,
      editorVisible: state.editorVisible,
      editorPane: state.editorPane,
      notesVisible: state.notesVisible,
      notesPane: state.notesPane,
      layoutRoot: state.layoutRoot,
    }),
    ...syncActiveWorkspace(state, (workspace) => ({
      ...workspace,
      panes,
      layoutRoot: buildWorkspaceLayout({
        ...workspace,
        panes,
        explorerVisible: state.explorerVisible,
        explorerPane: state.explorerPane,
        browserVisible: state.browserVisible,
        browserPane: state.browserPane,
        editorVisible: state.editorVisible,
        editorPane: state.editorPane,
        notesVisible: state.notesVisible,
        notesPane: state.notesPane,
        layoutRoot: state.layoutRoot,
      }),
    })),
  })),

  addPane: (terminalId, position, workspaceId) => {
    let paneId: string | null = null;
    set((current) => {
      const scopedWorkspace = workspaceId ? resolveWorkspaceByScope(current, workspaceId) : null;
      if (workspaceId && !scopedWorkspace) return current;
      const state = scopedWorkspace ? { ...current, ...getActiveWorkspaceSnapshot(scopedWorkspace) } : current;
      const nextPane = createPane(terminalId, position);
      paneId = nextPane.id;
      const nextPanes = [...state.panes, nextPane];
      const nextLayoutRoot = insertPaneIntoLayout(state.layoutRoot, nextPane.id, {
        panes: state.panes,
        explorerPane: state.explorerPane,
        explorerVisible: state.explorerVisible,
        browserPane: state.browserPane,
        browserVisible: state.browserVisible,
        editorPane: state.editorPane,
        editorVisible: state.editorVisible,
        notesPane: state.notesPane,
        notesVisible: state.notesVisible,
        activeTerminalId: state.activeTerminalId,
      });
      const updateWorkspace = (workspace: WorkspaceTab): WorkspaceTab => ({
        ...workspace, panes: nextPanes, layoutRoot: nextLayoutRoot, layoutRevision: state.layoutRevision + 1,
        pages: workspace.pages?.map((page) => page.id === workspace.activePageId ? { ...page, maximizedPaneId: undefined } : page),
      });
      if (workspaceId) return patchWorkspaceById(current, workspaceId, updateWorkspace);
      return {
        panes: nextPanes,
        layoutRoot: nextLayoutRoot,
        layoutRevision: state.layoutRevision + 1,
        ...syncActiveWorkspace(state, updateWorkspace),
      };
    });
    return paneId;
  },

  removePane: (paneId, workspaceId) => set((current) => {
    const scopedWorkspace = workspaceId ? resolveWorkspaceByScope(current, workspaceId) : null;
    if (workspaceId && !scopedWorkspace) return current;
    const state = scopedWorkspace ? { ...current, ...getActiveWorkspaceSnapshot(scopedWorkspace) } : current;
    const nextPanes = state.panes.filter((pane) => pane.id !== paneId);
    const nextLayoutRoot = removePaneFromLayout(state.layoutRoot, paneId);
    const updateWorkspace = (workspace: WorkspaceTab): WorkspaceTab => ({
      ...workspace, panes: nextPanes, layoutRoot: nextLayoutRoot, layoutRevision: state.layoutRevision + 1,
    });
    if (workspaceId) return patchWorkspaceById(current, workspaceId, updateWorkspace);
    return {
      panes: nextPanes,
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, updateWorkspace),
    };
  }),

  updatePanePosition: (paneId, position) => set((state) => {
    const viewport = state.gridViewport;
    const nextPosition = normalizePosition(position, viewport.cols, viewport.rows);
    const nextPanes = (state.panes ?? []).map((pane) =>
      pane.id === paneId ? { ...pane, position: nextPosition } : pane
    );
    return {
      panes: nextPanes,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        panes: nextPanes,
      })),
    };
  }),

  updateAllPanePositions: (positions) => set((state) => {
    const viewport = state.gridViewport;
    const posMap = new Map(positions.map(p => [p.id, p.position]));
    const nextPanes = (state.panes ?? []).map((pane) => {
      const pos = posMap.get(pane.id);
      return pos ? { ...pane, position: normalizePosition(pos, viewport.cols, viewport.rows) } : pane;
    });
    return {
      panes: nextPanes,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        panes: nextPanes,
      })),
    };
  }),

  updateBrowserPosition: (position) => set((state) => {
    const viewport = state.gridViewport;
    const normalizedPosition = normalizePosition(position, viewport.cols, viewport.rows);
    const nextBrowserPane = state.browserPane
      ? {
          ...state.browserPane,
          position: normalizedPosition,
        }
      : createDefaultBrowserPane(generateId('browser'), normalizedPosition, state.browserUrl);
    return {
      browserPane: nextBrowserPane,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        browserPane: nextBrowserPane,
      })),
    };
  }),

  setGridViewport: (viewport) => set((state) => {
    const nextViewport = {
      cols: Math.max(1, Math.min(GRID_COLS, Math.floor(viewport.cols) || GRID_COLS)),
      rows: Math.max(1, Math.min(20, Math.floor(viewport.rows) || GRID_ROWS)),
    };

    if (
      nextViewport.cols === state.gridViewport.cols &&
      nextViewport.rows === state.gridViewport.rows
    ) {
      return state;
    }

    return {
      gridViewport: nextViewport,
    };
  }),

  resetLayout: () => set((state) => {
    const workspace = resolveWorkspaceByScope(state);
    if (workspace == null) return state;
    const nextLayout = buildWorkspaceLayout({
      ...workspace,
      explorerPane: workspace.explorerPane ?? null,
      notesPane: workspace.notesPane ?? null,
      notesVisible: workspace.notesVisible ?? false,
      layoutRoot: null,
    });
    return patchWorkspaceLayout(state, workspace, nextLayout);
  }),

  // Realign keeps the arrangement: reconcile the current tree with the visible panes (stale leaves
  // pruned, missing ones inserted), then rebalance ratios. Only a missing tree is rebuilt from scratch.
  fitAllPanes: () => set((state) => {
    const workspace = resolveWorkspaceByScope(state);
    if (workspace == null) return state;
    const reconciled = buildWorkspaceLayout({
      ...workspace,
      explorerPane: workspace.explorerPane ?? null,
      notesPane: workspace.notesPane ?? null,
      notesVisible: workspace.notesVisible ?? false,
    });
    const fitted = fitLayoutRatios(reconciled);
    // Nothing to repair: keep the existing tree (and its undo history) untouched.
    if (JSON.stringify(fitted) === JSON.stringify(workspace.layoutRoot)) return state;
    return patchWorkspaceLayout(state, workspace, fitted);
  }),

  movePane: (paneId, target, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) return state;
    if (activePage(workspace)?.maximizedPaneId || !collectLeafPaneIds(workspace.layoutRoot).includes(paneId)
      || (target.kind !== 'workspace-edge' && !collectLeafPaneIds(workspace.layoutRoot).includes(target.targetPaneId))) return state;
    return patchWorkspaceLayout(
      state,
      workspace,
      movePaneInLayout(workspace.layoutRoot, paneId, target),
    );
  }),

  undoLayout: (workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null || activePage(workspace)?.maximizedPaneId) return state;
    const undoStack = workspace.layoutUndoStack ?? [];
    const previousLayout = undoStack[undoStack.length - 1];
    if (previousLayout == null) return state;
    const reconciledLayout = normalizeLayoutRoot(previousLayout, {
      ...workspace,
      explorerPane: workspace.explorerPane ?? null,
      notesPane: workspace.notesPane ?? null,
      notesVisible: workspace.notesVisible ?? false,
    });
    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      layoutRoot: reconciledLayout,
      layoutRevision: (currentWorkspace.layoutRevision ?? 0) + 1,
      layoutUndoStack: undoStack.slice(0, -1),
    }));
  }),


  swapPanes: (a, b, workspaceId) => set((state) => {
    if (a === b) return state;
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) return state;
    const ids = collectLeafPaneIds(workspace.layoutRoot);
    if (!ids.includes(a) || !ids.includes(b)) return state;
    return patchWorkspaceLayout(state, workspace, swapPaneIdsInLayout(workspace.layoutRoot, a, b));
  }),

  dockPaneToEdge: (paneId, edge, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    if (!collectLeafPaneIds(workspace.layoutRoot).includes(paneId)) return state;
    return patchWorkspaceLayout(state, workspace, dockPaneToEdgeInLayout(workspace.layoutRoot, paneId, edge));
  }),

  insertPaneAtEdgeGap: (paneId, edge, gapIndex, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    if (!collectLeafPaneIds(workspace.layoutRoot).includes(paneId)) return state;
    return patchWorkspaceLayout(
      state,
      workspace,
      insertPaneAtEdgeGapInLayout(workspace.layoutRoot, paneId, edge, gapIndex),
    );
  }),

  insertPaneAtEdgeSegment: (paneId, edge, targetPaneId, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const ids = collectLeafPaneIds(workspace.layoutRoot);
    if (!ids.includes(paneId) || !ids.includes(targetPaneId)) return state;
    return patchWorkspaceLayout(
      state,
      workspace,
      insertPaneAtEdgeSegmentInLayout(workspace.layoutRoot, paneId, edge, targetPaneId),
    );
  }),

  setSplitRatio: (nodeId, ratio, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    if (activePage(workspace)?.maximizedPaneId || !Number.isFinite(ratio)) return state;
    return patchWorkspaceLayout(
      state,
      workspace,
      setSplitRatioInLayout(workspace.layoutRoot, nodeId, ratio),
    );
  }),
  applyPersistedLayout: (persistedLayout, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const restored = restoreWorkspaceLayoutFromPersisted(workspace, persistedLayout);
    if (restored === workspace) {
      return state;
    }

    const isCurrentActive = workspace.id === state.activeWorkspaceId;
    return {
      ...(isCurrentActive
        ? {
            layoutRoot: restored.layoutRoot,
            layoutRevision: (state.layoutRevision ?? 0) + 1,
            layoutUndoStack: [],
            explorerVisible: restored.explorerVisible,
            explorerPane: restored.explorerPane,
            browserVisible: restored.browserVisible,
            browserPane: restored.browserPane,
            editorVisible: restored.editorVisible,
            editorPane: restored.editorPane,
            notesVisible: restored.notesVisible,
            notesPane: restored.notesPane,
          }
        : {}),
      ...patchWorkspaceById(state, workspace.id, () => restored),
    };
  }),

  openFileInEditor: async (filePath, workspaceId) => {
    const state = useWorkspaceStore.getState();
    const scopedWorkspace = resolveWorkspaceByScope(state, workspaceId);
    if (scopedWorkspace == null) {
      return;
    }

    const scopedWorkspaceId = scopedWorkspace.id;
    const fileCheckout = fileCheckoutForPath(scopedWorkspace, filePath);
    const existingTab = scopedWorkspace.editorTabs.find((tab) => tab.filePath === filePath && tab.checkoutContextId === fileCheckout.checkoutContextId);
    if (existingTab) {
      useWorkspaceStore.setState((currentState) => ({
        ...patchWorkspaceById(currentState, scopedWorkspaceId, (workspace) => ({
          ...(workspace.editorVisible && workspace.editorPane ? revealPane(workspace, workspace.editorPane.id) : workspace),
          activeEditorTabId: existingTab.id,
        })),
      }));
      return;
    }

    // Deduplicate concurrent opens for the same file
    if (isEditorOperationPending(state, filePath, scopedWorkspace.environmentId)) {
      return;
    }

    useWorkspaceStore.setState({ pendingEditorOperations: setEditorOperationPending(state, filePath, 'open', scopedWorkspace.environmentId) });

    try {
      const readResult = await window.electronAPI.editorReadFile({
        workspacePath: fileCheckout.workspacePath,
        ...(fileCheckout.checkoutContextId ? { checkoutContextId: fileCheckout.checkoutContextId } : {}),
        workspaceId: scopedWorkspace.id,
        filePath,
      });

      if (!readResult.success) {
        console.warn('Failed to read file for editor:', readResult.errorCode);
        return;
      }

      const fileName = filePath.split('/').pop() ?? filePath;
      const newTab: EditorTab = {
        id: generateId('editor-tab'),
        ...(fileCheckout.checkoutContextId ? { checkoutContextId: fileCheckout.checkoutContextId, checkoutRoot: fileCheckout.workspacePath, checkoutLabel: fileCheckout.checkoutLabel } : {}),
        filePath,
        fileName,
        isDirty: false,
        content: readResult.content ?? '',
        originalContent: readResult.content ?? '',
      };

      useWorkspaceStore.setState((currentState) => {
        const resolved = resolveWorkspaceByScope(currentState, scopedWorkspaceId);
        if (resolved == null) return {};
        const latestWorkspace = resolved.editorVisible && resolved.editorPane ? revealPane(resolved, resolved.editorPane.id) : resolved;

        if (fileCheckout.checkoutContextId && !latestWorkspace.checkoutContexts?.some((context) => context.id === fileCheckout.checkoutContextId && context.path === fileCheckout.workspacePath && !context.missing)) return {};
        const latestExistingTab = latestWorkspace.editorTabs.find((tab) => tab.filePath === filePath && tab.checkoutContextId === fileCheckout.checkoutContextId);
        if (latestExistingTab) {
          return {
            ...patchWorkspaceById(currentState, scopedWorkspaceId, () => ({
              ...latestWorkspace,
              activeEditorTabId: latestExistingTab.id,
            })),
          };
        }

        const nextEditorPane = latestWorkspace.editorPane ?? {
          id: generateId('editor'),
        };
        const editorLeafExists = collectLeafPaneIds(latestWorkspace.layoutRoot).includes(nextEditorPane.id);
        const shouldInsertEditorPane = !latestWorkspace.editorVisible || !editorLeafExists;
        const nextLayoutRoot = shouldInsertEditorPane
          ? insertPaneIntoLayout(latestWorkspace.layoutRoot, nextEditorPane.id, {
              panes: latestWorkspace.panes,
              explorerPane: latestWorkspace.explorerPane ?? null,
              explorerVisible: latestWorkspace.explorerVisible,
              browserPane: latestWorkspace.browserPane,
              browserVisible: latestWorkspace.browserVisible,
              editorPane: nextEditorPane,
              editorVisible: true,
              notesPane: latestWorkspace.notesPane ?? null,
              notesVisible: latestWorkspace.notesVisible ?? false,
              activeTerminalId: latestWorkspace.activeTerminalId,
            })
          : latestWorkspace.layoutRoot;

        const nextEditorTabs = [...latestWorkspace.editorTabs, newTab];
        const nextLayoutRevision = nextLayoutRoot === latestWorkspace.layoutRoot
          ? currentState.layoutRevision
          : currentState.layoutRevision + 1;

        return {
          layoutRevision: nextLayoutRevision,
          ...patchWorkspaceById(currentState, scopedWorkspaceId, () => ({
            ...latestWorkspace,
            editorPane: nextEditorPane,
            editorVisible: true,
            editorTabs: nextEditorTabs,
            activeEditorTabId: newTab.id,
            layoutRoot: nextLayoutRoot,
          })),
        };
      });

    } finally {
      useWorkspaceStore.setState((currentState) => ({
        pendingEditorOperations: clearEditorOperationPending(currentState, filePath, scopedWorkspace.environmentId),
      }));
    }
  },

  closeEditorTab: (tabId, workspaceId) => {
    const stateBefore = useWorkspaceStore.getState();
    const scopedWorkspace = resolveWorkspaceByScope(stateBefore, workspaceId);
    if (scopedWorkspace == null) {
      return;
    }

    set((state) => {
    const workspace = resolveWorkspaceByScope(state, scopedWorkspace.id);
    if (workspace == null) return state;

    const { editorTabs, activeEditorTabId } = workspace;
    const tabIndex = editorTabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return state;

    const nextTabs = editorTabs.filter((t) => t.id !== tabId);
    let nextActiveId: string | null = null;
    if (activeEditorTabId === tabId) {
      if (nextTabs.length === 0) {
        nextActiveId = null;
      } else if (tabIndex > 0) {
        nextActiveId = nextTabs[tabIndex - 1].id;
      } else {
        nextActiveId = nextTabs[0].id;
      }
    } else {
      nextActiveId = activeEditorTabId;
    }

    const nextEditorVisible = nextTabs.length > 0 ? workspace.editorVisible : false;
    const nextEditorPane = nextTabs.length > 0 ? workspace.editorPane : null;
    const nextLayoutRoot = nextTabs.length === 0 && workspace.editorPane
      ? removePaneFromLayout(workspace.layoutRoot, workspace.editorPane.id)
      : workspace.layoutRoot;
    const nextLayoutRevision = nextLayoutRoot === workspace.layoutRoot
      ? state.layoutRevision
      : state.layoutRevision + 1;

    const nextState = {
      layoutRevision: nextLayoutRevision,
      ...patchWorkspaceById(state, scopedWorkspace.id, (currentWorkspace) => ({
        ...currentWorkspace,
        editorTabs: nextTabs,
        activeEditorTabId: nextActiveId,
        editorVisible: nextEditorVisible,
        editorPane: nextEditorPane,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after closeEditorTab:', warnings);
      }
    }

    return nextState;
  });
  },

  setActiveEditorTab: (tabId, workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return state;
    }

    const nextState = {
      ...patchWorkspaceById(state, scopedWorkspaceId, (workspace) => ({
        ...workspace,
        activeEditorTabId: tabId,
        fileSurfaceContextId: workspace.editorTabs.find((tab) => tab.id === tabId)?.checkoutContextId ?? mainCheckoutContextId(workspace.id),
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after setActiveEditorTab:', warnings);
      }
    }

    return nextState;
  }),

  updateEditorContent: (tabId, content, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const nextTabs = workspace.editorTabs.map((tab) =>
      tab.id === tabId
        ? { ...tab, content, isDirty: content !== tab.originalContent }
        : tab
    );

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      editorTabs: nextTabs,
    }));
  }),

  saveEditorFile: async (tabId, workspaceId) => {
    const stateBeforeSave = useWorkspaceStore.getState();
    const scopedWorkspace = resolveWorkspaceByScope(stateBeforeSave, workspaceId);
    const tab = scopedWorkspace?.editorTabs.find((t) => t.id === tabId);
    if (!tab || scopedWorkspace == null) return false;

    // Deduplicate concurrent saves for the same file
    if (isEditorOperationPending(stateBeforeSave, tab.filePath, scopedWorkspace.environmentId)) {
      return true;
    }

    const contentToSave = preserveOriginalLineEndings(tab.content, tab.originalContent);
    useWorkspaceStore.setState({ pendingEditorOperations: setEditorOperationPending(stateBeforeSave, tab.filePath, 'save', scopedWorkspace.environmentId) });

    try {
      const result = await window.electronAPI.editorWriteFile({
        ...editorFileCheckout(scopedWorkspace, tab),
        workspaceId: scopedWorkspace.id,
        filePath: tab.filePath,
        content: contentToSave,
      });

      if (!result.success) {
        console.warn('Failed to write file:', result.errorCode);
        return false;
      }

      useWorkspaceStore.setState((latestState) => {
        const latestWorkspace = resolveWorkspaceByScope(latestState, scopedWorkspace.id);
        const latestTab = latestWorkspace?.editorTabs.find((t) => t.id === tabId);
        if (!latestWorkspace || !latestTab || latestTab.content !== contentToSave
          || (tab.checkoutContextId && !latestWorkspace.checkoutContexts?.some((context) => context.id === tab.checkoutContextId && !context.missing))) {
          return {};
        }

        const nextTabs = latestWorkspace.editorTabs.map((currentTab) =>
          currentTab.id === tabId
            ? {
                ...currentTab,
                originalContent: contentToSave,
                isDirty: false,
                hasExternalChange: false,
                isDeleted: false,
              }
            : currentTab
        );

        return {
          ...patchWorkspaceById(latestState, scopedWorkspace.id, (workspace) => ({
            ...workspace,
            editorTabs: nextTabs,
          })),
        };
      });
      return true;
    } finally {
      useWorkspaceStore.setState((currentState) => ({
        pendingEditorOperations: clearEditorOperationPending(currentState, tab.filePath, scopedWorkspace.environmentId),
      }));
    }
  },

  saveAllEditorFiles: async () => {
    const state = useWorkspaceStore.getState();
    const dirtyTabs = state.editorTabs.filter((t) => t.isDirty);
    for (const tab of dirtyTabs) {
      await useWorkspaceStore.getState().saveEditorFile(tab.id);
    }
  },

  toggleEditorPane: () => set((state) => {
    const workspace = resolveWorkspaceByScope(state);
    if (workspace?.pages && workspace.editorVisible && workspace.editorPane && !paneIsPresented(workspace, workspace.editorPane.id)) {
      return patchWorkspaceById(state, workspace.id, (current) => revealPane(current, workspace.editorPane!.id));
    }
    const nextEditorVisible = !state.editorVisible;
    let nextEditorPane = state.editorPane;

    if (nextEditorVisible && nextEditorPane === null) {
      nextEditorPane = {
        id: generateId('editor'),
      };
    }

    let nextLayoutRoot = state.layoutRoot;
    if (nextEditorVisible && nextEditorPane) {
      const editorId = nextEditorPane.id;
      if (!state.editorVisible) {
        nextLayoutRoot = insertPaneIntoLayout(state.layoutRoot, editorId, {
          panes: state.panes,
          explorerPane: state.explorerPane,
          explorerVisible: state.explorerVisible,
          browserPane: state.browserPane,
          browserVisible: state.browserVisible,
          editorPane: nextEditorPane,
          editorVisible: true,
          notesPane: state.notesPane,
          notesVisible: state.notesVisible,
          activeTerminalId: state.activeTerminalId,
        });
      }
    } else if (!nextEditorVisible && state.editorPane) {
      nextLayoutRoot = removePaneFromLayout(state.layoutRoot, state.editorPane.id);
    }

    const nextState = {
      editorVisible: nextEditorVisible,
      editorPane: nextEditorPane,
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        editorVisible: nextEditorVisible,
        editorPane: nextEditorPane,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after toggleEditorPane:', warnings);
      }
    }
    return nextState;
  }),
  closeEditorPane: (workspaceId) => {
    return set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace?.editorPane) {
      const nextLayoutRoot = removePaneFromLayout(workspace.layoutRoot, workspace.editorPane.id);
      const nextState = {
        layoutRevision: state.layoutRevision + 1,
        ...patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
          ...currentWorkspace,
          editorVisible: false,
          editorPane: null,
          editorTabs: [],
          activeEditorTabId: null,
          layoutRoot: nextLayoutRoot,
        })),
      };
      if (import.meta.env.DEV) {
        const warnings = validateWorkspaceConsistency(nextState);
        if (warnings.length > 0) {
          console.warn('[Dev Only] Workspace consistency violation after closeEditorPane:', warnings);
        }
      }
      return nextState;
    }
    return state;
    });
  },

  resetEditorState: () => {
    const nextState = set((state) => ({
      ...createDefaultEditorState(),
      pendingEditorOperations: {},
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        ...createDefaultEditorState(),
      })),
    }));
    if (import.meta.env.DEV && nextState) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after resetEditorState:', warnings);
      }
    }
    return nextState;
  },

  renameEditorTabPath: (oldPath, newPath, workspaceId) => {
    if (oldPath === newPath) return;

    const stateBefore = useWorkspaceStore.getState();
    const scopedWorkspace = resolveWorkspaceByScope(stateBefore, workspaceId);
    if (scopedWorkspace == null) {
      return;
    }

    set((state) => {
      const newFileName = newPath.split('/').pop() ?? newPath;
      const workspace = resolveWorkspaceByScope(state, scopedWorkspace.id);
      if (workspace == null) {
        return state;
      }

      const nextTabs = workspace.editorTabs.map((tab) =>
        tab.filePath === oldPath
          ? { ...tab, filePath: newPath, fileName: newFileName }
          : tab
      );

      return patchWorkspaceById(state, scopedWorkspace.id, (currentWorkspace) => ({
        ...currentWorkspace,
        editorTabs: nextTabs,
      }));
    });
  },

  reloadEditorTab: async (tabId, workspaceId, options) => {
    const state = useWorkspaceStore.getState();
    const scopedWorkspace = resolveWorkspaceByScope(state, workspaceId);
    const tab = scopedWorkspace?.editorTabs.find((t) => t.id === tabId);
    if (!tab || scopedWorkspace == null) return;
    if (options?.onlyIfClean && tab.isDirty) return;

    // Skip reload if a save is in flight for this file — save takes priority
    if (isEditorOperationPending(state, tab.filePath, scopedWorkspace.environmentId)) {
      return;
    }

    const automaticKey = JSON.stringify([scopedWorkspace.id, tab.filePath]);
    const automaticReload = { rerun: false, invalidated: false };
    if (options?.onlyIfClean) {
      const inFlight = automaticEditorReloads.get(automaticKey);
      if (inFlight) {
        // A retry tick does not represent another edit. Actual changes must
        // survive the outstanding read, even if it returns older contents.
        if (!options.retryIfIdle) inFlight.rerun = true;
        return;
      }
      automaticEditorReloads.set(automaticKey, automaticReload);
    } else {
      useWorkspaceStore.setState({ pendingEditorOperations: setEditorOperationPending(state, tab.filePath, 'reload', scopedWorkspace.environmentId) });
    }

    try {
      const result = await window.electronAPI.editorReadFile({
        ...editorFileCheckout(scopedWorkspace, tab),
        workspaceId: scopedWorkspace.id,
        filePath: tab.filePath,
      });

      if (!result.success) {
        useWorkspaceStore.setState((currentState) => {
          const workspace = resolveWorkspaceByScope(currentState, scopedWorkspace.id);
          if (workspace == null) {
            return {};
          }

          const nextTabs = workspace.editorTabs.map((t) => {
            if (t.id !== tabId || t.filePath !== tab.filePath) return t;
            if (options?.onlyIfClean && automaticReload.invalidated) return t;
            if (options?.onlyIfClean && isEditorOperationPending(currentState, tab.filePath, scopedWorkspace.environmentId)) return t;
            if (options?.onlyIfClean && automaticReload.rerun) return { ...t, hasExternalChange: true };
            if (options?.onlyIfClean && result.errorCode !== 'not-found') return { ...t, hasExternalChange: true };
            return { ...t, isDeleted: true, hasExternalChange: false };
          });
          return patchWorkspaceById(currentState, scopedWorkspace.id, (currentWorkspace) => ({
            ...currentWorkspace,
            editorTabs: nextTabs,
          }));
        });
        return;
      }

      useWorkspaceStore.setState((currentState) => {
        const workspace = resolveWorkspaceByScope(currentState, scopedWorkspace.id);
        if (workspace == null) {
          return {};
        }

        const nextTabs = workspace.editorTabs.map((t) => {
          if (t.id !== tabId || t.filePath !== tab.filePath) return t;
          if (tab.checkoutContextId && !workspace.checkoutContexts?.some((context) => context.id === tab.checkoutContextId && !context.missing)) return t;
          if (options?.onlyIfClean && automaticReload.invalidated) return t;
          if (options?.onlyIfClean && isEditorOperationPending(currentState, tab.filePath, scopedWorkspace.environmentId)) return t;
          if (options?.onlyIfClean && automaticReload.rerun) return { ...t, hasExternalChange: true };
          if (options?.onlyIfClean && (t.isDirty || t.content !== tab.content || t.originalContent !== tab.originalContent)) return { ...t, hasExternalChange: true };
          return {
            ...t,
            content: result.content ?? '',
            originalContent: result.content ?? '',
            isDirty: false,
            hasExternalChange: false,
            isDeleted: false,
          };
        });
        return patchWorkspaceById(currentState, scopedWorkspace.id, (currentWorkspace) => ({
          ...currentWorkspace,
          editorTabs: nextTabs,
        }));
      });
    } finally {
      if (options?.onlyIfClean) {
        automaticEditorReloads.delete(automaticKey);
        const latestTab = get().getWorkspaceById(scopedWorkspace.id)?.editorTabs.find((entry) => entry.id === tabId);
        if (automaticReload.rerun && latestTab?.filePath === tab.filePath) {
          await get().reloadEditorTab(tabId, scopedWorkspace.id, { onlyIfClean: true });
        }
      } else useWorkspaceStore.setState((currentState) => ({
        pendingEditorOperations: clearEditorOperationPending(currentState, tab.filePath, scopedWorkspace.environmentId),
      }));
    }
  },

  markEditorTabExternallyChanged: (tabId, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const nextTabs = workspace.editorTabs.map((t) =>
      t.id === tabId ? { ...t, hasExternalChange: true } : t
    );
    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      editorTabs: nextTabs,
    }));
  }),

  markEditorTabDeleted: (tabId, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const tab = workspace.editorTabs.find((entry) => entry.id === tabId);
    if (tab) {
      const inFlight = automaticEditorReloads.get(JSON.stringify([workspace.id, tab.filePath]));
      // A deletion is newer than any outstanding automatic read, including
      // focus refreshes. Even repeated deletions invalidate that read.
      if (inFlight) inFlight.invalidated = true;
    }

    const nextTabs = workspace.editorTabs.map((t) =>
      t.id === tabId ? { ...t, isDeleted: true, hasExternalChange: false } : t
    );
    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      editorTabs: nextTabs,
    }));
  }),

  clearEditorTabExternalFlag: (tabId, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const nextTabs = workspace.editorTabs.map((t) =>
      t.id === tabId ? { ...t, hasExternalChange: false, isDeleted: false } : t
    );
    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      editorTabs: nextTabs,
    }));
  }),
}));
