import { mainCheckoutContextId } from '../../shared/checkoutContext';
import type { AgentAttentionSnapshot } from '../../shared/types/agentAttention';
import type { CheckoutContext } from '../../shared/types/checkoutContext';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { useAgentAttentionStore } from '../store/agentAttentionStore';

export type CheckoutSelectionSource = 'explicit' | 'observed' | 'launch' | 'workspace';
export type CheckoutUnavailableReason = 'invalid-workspace' | 'historical-observation' | 'unavailable-observation' | 'unknown-provenance' | 'unregistered-observation' | 'missing-checkout' | 'released-checkout' | 'invalid-checkout';
export type CheckoutSelection = {
  source: CheckoutSelectionSource;
  workspaceId: string;
  environmentId: string;
  /** Retained for unavailable pins/reports, never execution authority by itself. */
  contextId: string | null;
} & ({ availability: 'available'; context: CheckoutContext; root: string }
  | { availability: 'unavailable'; reason: CheckoutUnavailableReason; root: null });
export type CheckoutSelectionWorkspace = Pick<WorkspaceTab, 'id' | 'environmentId' | 'workspacePath' | 'checkoutContexts' | 'terminals' | 'activeTerminalId' | 'fileSurfaceContextId'>;

/** One selection policy for workspace surfaces, not individual agent labels or launch authority.
 * Explicit pin > current registered observation > launch when no observation > workspace.
 * Existing but unusable observations/pins never silently select main. */
export function selectCheckout(workspace: CheckoutSelectionWorkspace, snapshot?: Pick<AgentAttentionSnapshot, 'location' | 'locationProvenance'> | null): CheckoutSelection {
  const environmentId = workspace.environmentId ?? 'local';
  const mainId = mainCheckoutContextId(workspace.id);
  const terminal = workspace.terminals.find((entry) => entry.id === workspace.activeTerminalId);
  const source: CheckoutSelectionSource = workspace.fileSurfaceContextId ? 'explicit' : snapshot?.location ? 'observed' : terminal ? 'launch' : 'workspace';
  const contextId = workspace.fileSurfaceContextId ?? (snapshot?.location ? snapshot.location.checkoutContextId : terminal?.checkoutContextId ?? mainId);
  const base = { source, workspaceId: workspace.id, environmentId, contextId };
  const unavailable = (reason: CheckoutUnavailableReason): CheckoutSelection => ({ ...base, availability: 'unavailable', reason, root: null });
  if (!workspace.id || !workspace.workspacePath) return unavailable('invalid-workspace');
  if (source === 'observed') {
    if (!snapshot?.locationProvenance) return unavailable('unknown-provenance');
    if (snapshot.locationProvenance.state === 'unavailable') return unavailable('unavailable-observation');
    if (snapshot.locationProvenance.state !== 'current') return unavailable('historical-observation');
    if (!contextId) return unavailable('unregistered-observation');
  }
  const context = workspace.checkoutContexts?.find((entry) => entry.id === contextId);
  // Legacy workspace state has an implicitly registered main root. Never backfill another root.
  const resolved = context ?? (contextId === mainId ? {
    id: mainId, workspaceId: workspace.id, environmentId, path: workspace.workspacePath, kind: 'main' as const,
  } : null);
  if (!resolved) return unavailable('released-checkout');
  if (resolved.workspaceId !== workspace.id || resolved.environmentId !== environmentId || !resolved.path
    || !/^(\/|[A-Za-z]:\/)/.test(resolved.path)) return unavailable('invalid-checkout');
  if (resolved.missing) return unavailable('missing-checkout');
  return { ...base, contextId: resolved.id, availability: 'available', context: resolved, root: resolved.path };
}

/** Store-backed adapter with no workspace-store dependency (file actions also call it). */
export function currentCheckoutSelection(workspace: CheckoutSelectionWorkspace): CheckoutSelection {
  const snapshot = workspace.activeTerminalId ? useAgentAttentionStore.getState().byTerminalId[workspace.activeTerminalId] : null;
  return selectCheckout(workspace, snapshot);
}

/** Only physical registered identity/availability belongs in lifecycle keys. Source/branch/agent
 * changes within the same checkout must not restart watchers, controllers or the Git poller. */
export function checkoutSelectionKey(selection: CheckoutSelection): string {
  return JSON.stringify([selection.workspaceId, selection.environmentId, selection.contextId, selection.root,
    selection.availability, selection.availability === 'unavailable' ? selection.reason : null]);
}
/** Compact reason for the status bar; the full guidance remains in the tooltip/Explorer. */
export function checkoutUnavailableLabel(reason: CheckoutUnavailableReason): string {
  const labels: Record<CheckoutUnavailableReason, string> = {
    'invalid-workspace': 'invalid workspace', 'historical-observation': 'historical location',
    'unavailable-observation': 'location source unavailable', 'unknown-provenance': 'unknown provenance',
    'unregistered-observation': 'unregistered location', 'missing-checkout': 'missing checkout',
    'released-checkout': 'released checkout', 'invalid-checkout': 'invalid identity',
  };
  return `Checkout unavailable · ${labels[reason]}`;
}
export function checkoutUnavailableMessage(reason: CheckoutUnavailableReason): string {
  const messages: Record<CheckoutUnavailableReason, string> = {
    'invalid-workspace': 'Workspace identity is unavailable.',
    'historical-observation': 'The agent location is last-reported from an earlier session. Select a registered checkout or wait for a current native report.',
    'unavailable-observation': 'The agent location source is unavailable. Select a registered checkout or wait for a new native report.',
    'unknown-provenance': 'The agent location has no current authenticated provenance. Select a registered checkout.',
    'unregistered-observation': 'The agent location is outside this workspace’s registered checkouts.',
    'missing-checkout': 'The selected checkout is missing.',
    'released-checkout': 'The selected checkout has been released.',
    'invalid-checkout': 'The selected checkout identity is unavailable.',
  };
  return messages[reason];
}
