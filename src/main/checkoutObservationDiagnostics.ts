import type { AgentAttentionSnapshot } from '../shared/types/agentAttention';
import type { CheckoutContext } from '../shared/types/checkoutContext';
import { locateCheckoutContext, type AgentLocationTransport } from './agentLocation';
import { isPathContained } from './remote/remotePaths';

interface LaunchIdentity {
  workspaceId?: string;
  checkoutContextId?: string;
}

type Observation = Pick<AgentAttentionSnapshot, 'revision' | 'location' | 'locationProvenance'>;

/** Content-free relationship facts only: never serialize paths, context/session IDs or payloads. */
export interface CheckoutObservationRecord {
  kind: 'checkout-observation';
  at: number;
  terminalId: string;
  revision: number;
  transport: AgentLocationTransport;
  terminalPresent: boolean;
  workspaceBound: boolean;
  launchRegistered: boolean;
  launchKind: 'main' | 'worktree' | 'none';
  registeredContexts: number;
  provenance: 'current' | 'last-reported' | 'unavailable' | 'unknown' | 'none';
  observedContext: 'launch' | 'other-registered' | 'unregistered' | 'released' | 'none';
  resolutionAgrees: boolean | null;
  lexicallyInsideLaunch: boolean | null;
  /** Same containment rule as location resolution: local symlink-aware, remote lexical. */
  resolvedInsideLaunch: boolean | null;
}

/** Debug-only transition recorder. Bounded identity keys stay in memory, never in the log.
 * This neither repairs a snapshot nor grants authority from a freshly resolved location. */
export class CheckoutObservationDiagnostics {
  private readonly recent = new Map<string, string>();

  constructor(private readonly write: (record: CheckoutObservationRecord) => void,
    private readonly now: () => number = Date.now) {}

  observe(terminalId: string, transport: AgentLocationTransport, observation: Observation | null,
    terminal: LaunchIdentity | undefined, contexts: readonly CheckoutContext[]): void {
    if (!observation) { this.recent.delete(terminalId); return; }
    const { location, locationProvenance } = observation;
    const ownContexts = terminal?.workspaceId ? contexts.filter(context => context.workspaceId === terminal.workspaceId) : [];
    const key = JSON.stringify([transport, terminal?.workspaceId, terminal?.checkoutContextId,
      location, locationProvenance, ownContexts.map(context => [context.id, context.path, context.missing])]);
    if (this.recent.get(terminalId) === key) return;
    this.recent.delete(terminalId);
    this.recent.set(terminalId, key);
    while (this.recent.size > 64) this.recent.delete(this.recent.keys().next().value!);
    const launch = ownContexts.find(context => context.id === terminal?.checkoutContextId);
    const recorded = ownContexts.find(context => context.id === location?.checkoutContextId);
    const resolved = location ? locateCheckoutContext(location.path, ownContexts, transport) : null;
    this.write({
      kind: 'checkout-observation', at: this.now(), terminalId, revision: observation.revision, transport,
      terminalPresent: !!terminal, workspaceBound: !!terminal?.workspaceId,
      launchRegistered: !!launch, launchKind: launch?.kind ?? 'none', registeredContexts: ownContexts.length,
      provenance: !location ? 'none' : locationProvenance?.state ?? 'unknown',
      observedContext: !location ? 'none' : !location.checkoutContextId ? 'unregistered'
        : !recorded ? 'released' : recorded.id === launch?.id ? 'launch' : 'other-registered',
      resolutionAgrees: location ? (resolved?.id ?? null) === location.checkoutContextId : null,
      lexicallyInsideLaunch: location && launch ? isPathContained(launch.path, location.path) : null,
      resolvedInsideLaunch: location && launch ? !!locateCheckoutContext(location.path, [launch], transport) : null,
    });
  }
}
