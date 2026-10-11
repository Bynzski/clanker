import type { AgentLocation } from '../../shared/types/agentAttention';
import type { CheckoutContext } from '../../shared/types/checkoutContext';
import { locateCheckoutContext } from '../agentLocation';

export interface BridgeLocationEvidence {
  location: AgentLocation;
  sessionId: string;
  lastReportedAt: number;
  state: 'current' | 'last-reported' | 'unavailable';
}
export interface BridgeObservation {
  state: 'none' | 'current' | 'last-reported' | 'unregistered' | 'missing' | 'released' | 'unavailable';
  provenance: 'current' | 'last-reported' | 'unavailable' | null;
  checkout: { kind: CheckoutContext['kind']; isolated: boolean; branch: string | null } | null;
  matchesLaunch: boolean | null;
}
/** Called only after bridge credentials and live caller authority are validated. Return descriptive
 * facts of that workspace only, never the reported path, context IDs, native session or credentials. */
export function describeBridgeObservation(evidence: BridgeLocationEvidence | null, contexts: readonly CheckoutContext[], launch: CheckoutContext): BridgeObservation {
  const base: BridgeObservation = { state: 'none', provenance: evidence?.state ?? null, checkout: null, matchesLaunch: null };
  if (!evidence) return base;
  const reportedId = evidence.location.checkoutContextId;
  // Keep the authenticated report's identity: registering a root later is not a
  // new native report and must not silently turn an unregistered report current.
  if (!reportedId) return { ...base, state: 'unregistered' };
  if (!contexts.some((context) => context.id === reportedId)) return { ...base, state: 'released' };
  const context = locateCheckoutContext(evidence.location.path, contexts, 'local');
  if (!context) return { ...base, state: 'unregistered' };
  if (context.workspaceId !== launch.workspaceId || context.environmentId !== launch.environmentId) return { ...base, state: 'unavailable' };
  return {
    ...base, state: context.missing ? 'missing' : evidence.state,
    checkout: { kind: context.kind, isolated: context.kind === 'worktree', branch: context.branch?.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 128) ?? null },
    matchesLaunch: context.id === launch.id && context.path === launch.path,
  };
}
