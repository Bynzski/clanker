import { create } from 'zustand';
import type { GitStatusResult } from '../../shared/types/git';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
import { sameWorkspacePath } from '../lib/pathUtils';

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
  state: 'loading' | 'ready' | 'error';
  result: GitStatusResult | null;
}
interface CheckoutGitState {
  /** Exactly one active snapshot. No historical checkout cache and no polling here. */
  active: CheckoutGitSnapshot | null;
  begin: (identity: CheckoutGitIdentity) => number;
  apply: (generation: number, result: GitStatusResult) => void;
  clear: (generation: number) => void;
  invalidate: (generation: number) => void;
}
let nextGeneration = 0;
export const useCheckoutGitStore = create<CheckoutGitState>((set) => ({
  active: null,
  begin: (identity) => {
    const generation = ++nextGeneration;
    set({ active: { identity, key: checkoutGitKey(identity), generation, state: 'loading', result: null } });
    return generation;
  },
  apply: (generation, result) => set((state) => {
    const active = state.active;
    if (!active || active.generation !== generation || (result.presentationGeneration !== undefined && result.presentationGeneration !== generation)) return state;
    const identity = active.identity;
    if ((result.workspaceId && result.workspaceId !== identity.workspaceId)
      || (result.environmentId && result.environmentId !== identity.environmentId)
      || (result.workspacePath && !sameWorkspacePath(result.workspacePath, identity.root))
      || (result.checkoutContextId && result.checkoutContextId !== (identity.contextId ?? (identity.workspaceId ? mainCheckoutContextId(identity.workspaceId) : undefined)))) return state;
    return { active: { ...active, state: result.success ? 'ready' : 'error', result } };
  }),
  clear: (generation) => set((state) => state.active?.generation === generation ? { active: null } : state),
  invalidate: (generation) => set((state) => state.active?.generation === generation
    ? { active: { ...state.active, state: 'error', result: null } } : state),
}));

/** Missing means the selected controller has not supplied a snapshot yet, not a bad checkout. */
export function checkoutGitAvailability(snapshot: CheckoutGitSnapshot | null): 'loading' | 'unavailable' | 'ready' {
  return !snapshot || snapshot.state === 'loading' ? 'loading' : snapshot.state === 'error' ? 'unavailable' : 'ready';
}

/** Consumers must match identity on every render, including the render before poll-owner effects. */
export function matchingCheckoutGit(active: CheckoutGitSnapshot | null, identity: CheckoutGitIdentity): CheckoutGitSnapshot | null {
  return active?.key === checkoutGitKey(identity)
    && (identity.selectionGeneration === undefined || active.identity.selectionGeneration === identity.selectionGeneration) ? active : null;
}
