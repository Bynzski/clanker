import { create } from 'zustand';
import type { GitStatusResult } from '../../shared/types/git';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
import { sameWorkspacePath } from '../lib/pathUtils';
import { useWorkspaceStore } from './workspaceStore';
import { checkoutSelectionToken } from '../lib/checkoutSelectionRuntime';
import { currentCheckoutSelection } from '../lib/checkoutSelection';
import { changedFileCount } from '../components/git/gitChangePresentation';

export interface CheckoutGitIdentity {
  workspaceId?: string;
  environmentId: string;
  contextId?: string;
  root: string;
  /** Renderer selection epoch, not authority or part of the physical checkout key. */
  selectionGeneration?: number;
}
function checkoutGitKey(identity: CheckoutGitIdentity): string {
  return JSON.stringify([identity.workspaceId, identity.environmentId, identity.contextId ?? (identity.workspaceId ? mainCheckoutContextId(identity.workspaceId) : undefined), identity.root]);
}
export interface CheckoutGitSnapshot {
  identity: CheckoutGitIdentity;
  key: string;
  generation: number;
  /** Retained on invalidation to reject older in-flight poll/status answers. */
  acquisitionSequence?: number;
  state: 'loading' | 'ready' | 'error';
  result: GitStatusResult | null;
}
/** Minimal descriptive metadata. Deliberately no changes, credentials or presentation generation. */
export interface CheckoutGitDescription {
  identity: { workspaceId: string; environmentId: string; contextId: string; root: string };
  key: string;
  acquiredAt: number;
  isRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  changeCount: number;
  upstream: string | null;
  ahead: number;
  behind: number;
}
const CHECKOUT_GIT_CACHE_LIMIT = 32;

function registered(identity: CheckoutGitIdentity): boolean {
  const workspace = identity.workspaceId ? useWorkspaceStore.getState().getWorkspaceById(identity.workspaceId) : null;
  const contextId = identity.contextId ?? (identity.workspaceId ? mainCheckoutContextId(identity.workspaceId) : undefined);
  const context = workspace?.checkoutContexts?.find(entry => entry.id === contextId);
  return Boolean(workspace && context && !context.missing && context.workspaceId === workspace.id
    && context.environmentId === identity.environmentId && (workspace.environmentId ?? 'local') === identity.environmentId
    && sameWorkspacePath(context.path, identity.root));
}

/** Never consult this helper for availability, changes or operation gating. */
export function lastKnownCheckoutGit(cache: CheckoutGitDescription[], identity: CheckoutGitIdentity): CheckoutGitDescription | null {
  if (!registered(identity)) return null;
  const key = checkoutGitKey(identity);
  return cache.find(entry => entry.key === key) ?? null;
}
interface CheckoutGitState {
  /** Exactly one active acquisition; historical descriptions never populate this result. */
  active: CheckoutGitSnapshot | null;
  /** In-memory LRU, oldest first; touched only by selection or verified acquisition. */
  cache: CheckoutGitDescription[];
  begin: (identity: CheckoutGitIdentity) => number;
  apply: (generation: number, result: GitStatusResult) => void;
  clear: (generation: number) => void;
  invalidate: (generation: number) => void;
}
let nextGeneration = 0;
export const useCheckoutGitStore = create<CheckoutGitState>((set) => ({
  active: null,
  cache: [],
  begin: (identity) => {
    const generation = ++nextGeneration;
    set(state => {
      const hit = lastKnownCheckoutGit(state.cache, identity);
      return { active: { identity, key: checkoutGitKey(identity), generation, state: 'loading', result: null },
        cache: hit ? [...state.cache.filter(entry => entry !== hit), hit] : state.cache };
    });
    return generation;
  },
  apply: (generation, result) => set((state) => {
    const active = state.active;
    if (!active || active.generation !== generation || (result.presentationGeneration !== undefined && result.presentationGeneration !== generation)) return state;
    if (result.acquisitionSequence !== undefined && active.acquisitionSequence !== undefined
      && result.acquisitionSequence <= active.acquisitionSequence) return state;
    const identity = active.identity;
    if (identity.workspaceId && identity.selectionGeneration !== undefined) {
      const workspace = useWorkspaceStore.getState().getWorkspaceById(identity.workspaceId);
      const selection = workspace ? currentCheckoutSelection(workspace) : null;
      if (checkoutSelectionToken(identity.workspaceId) !== identity.selectionGeneration || selection?.availability !== 'available'
        || checkoutGitKey({ workspaceId: selection.workspaceId, environmentId: selection.environmentId,
          contextId: selection.contextId ?? undefined, root: selection.root }) !== active.key) return state;
    }
    if ((result.workspaceId && result.workspaceId !== identity.workspaceId)
      || (result.environmentId && result.environmentId !== identity.environmentId)
      || (result.workspacePath && !sameWorkspacePath(result.workspacePath, identity.root))
      || (result.checkoutContextId && result.checkoutContextId !== (identity.contextId ?? (identity.workspaceId ? mainCheckoutContextId(identity.workspaceId) : undefined)))) return state;
    let cache = state.cache;
    // Legacy/unscoped responses retain the existing current-status contract, but cannot seed history.
    const contextId = identity.contextId ?? (identity.workspaceId ? mainCheckoutContextId(identity.workspaceId) : undefined);
    if (result.success && identity.workspaceId && contextId && identity.selectionGeneration !== undefined && registered(identity)
      && useWorkspaceStore.getState().activeWorkspaceId === identity.workspaceId
      && result.workspaceId === identity.workspaceId
      && result.environmentId === identity.environmentId && result.workspacePath && sameWorkspacePath(result.workspacePath, identity.root)
      && (result.checkoutContextId ?? (result.workspaceId ? mainCheckoutContextId(result.workspaceId) : undefined)) === contextId
      && result.presentationGeneration === generation) {
      const physical = { workspaceId: identity.workspaceId, environmentId: identity.environmentId, contextId, root: identity.root };
      const description: CheckoutGitDescription = { identity: physical, key: active.key, acquiredAt: Date.now(),
        isRepo: result.isRepo, currentBranch: result.currentBranch, isDetached: result.isDetached,
        changeCount: result.isRepo ? changedFileCount(result.changes) : 0, upstream: result.upstream, ahead: result.ahead, behind: result.behind };
      cache = [...cache.filter(entry => entry.key !== active.key), description].slice(-CHECKOUT_GIT_CACHE_LIMIT);
    }
    return { active: { ...active, ...(result.acquisitionSequence !== undefined ? { acquisitionSequence: result.acquisitionSequence } : {}),
      state: result.success ? 'ready' : 'error', result }, cache };
  }),
  clear: (generation) => set((state) => state.active?.generation === generation ? { active: null } : state),
  invalidate: (generation) => set((state) => state.active?.generation === generation
    ? { active: { ...state.active, state: 'error', result: null } } : state),
}));

// Registry descriptions disappearing must not survive a later re-adoption or ID reuse.
// No demand, timer or Git request: a bounded metadata prune on existing store notifications.
useWorkspaceStore.subscribe(() => {
  const state = useCheckoutGitStore.getState();
  if (!state.cache.length) return;
  const cache = state.cache.filter(entry => registered(entry.identity));
  if (cache.length !== state.cache.length) useCheckoutGitStore.setState({ cache });
});

/** Missing means the selected controller has not supplied a snapshot yet, not a bad checkout. */
export function checkoutGitAvailability(snapshot: CheckoutGitSnapshot | null): 'loading' | 'unavailable' | 'ready' {
  return !snapshot || snapshot.state === 'loading' ? 'loading' : snapshot.state === 'error' ? 'unavailable' : 'ready';
}

/** Consumers must match identity on every render, including the render before poll-owner effects. */
export function matchingCheckoutGit(active: CheckoutGitSnapshot | null, identity: CheckoutGitIdentity): CheckoutGitSnapshot | null {
  return active?.key === checkoutGitKey(identity)
    && (identity.selectionGeneration === undefined || active.identity.selectionGeneration === identity.selectionGeneration) ? active : null;
}
