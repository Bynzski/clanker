import type { CheckoutContext } from '../../shared/types/checkoutContext';
import type { HarnessSession } from '../../shared/types/session';
import { LOCAL_ENVIRONMENT_ID } from '../../shared/types/environments';
import { toNativePath } from '../../shared/pathNormalize';
import type { AgentBridgeCaller } from '../agentBridge/capabilities';
import { isCurrentCheckoutContext } from '../sessionResumeTarget';
import { directoryExists } from '../sessionWorktrees';
import type { IsolatedCheckoutServiceDeps } from './isolatedCheckoutService';
import type { LiveCheckoutRelocation } from './liveRelocation';
import { checkoutRehomeOf } from './rehomeSupport';

/** Adapts the proof gate to main's live registry, terminal table, native root and bridge grant. */
export async function relocateLiveCaller(
  deps: IsolatedCheckoutServiceDeps, gate: LiveCheckoutRelocation, caller: AgentBridgeCaller,
  session: HarnessSession, target: CheckoutContext, signal: AbortSignal, shuttingDown: () => boolean,
): Promise<void> {
  const capability = checkoutRehomeOf(caller.harnessId);
  const baseline = deps.attention.snapshot(caller.terminalId);
  const terminal = deps.getTerminals().get(caller.terminalId);
  if (!capability?.relocateLiveConversation || !baseline?.runtime || baseline.revision === undefined || !terminal
    || !deps.commitCheckoutRelocation) throw new Error('Native live relocation is unavailable');
  const current = () => {
    const registry = deps.getRegistry();
    const snapshot = deps.attention.snapshot(caller.terminalId);
    return !shuttingDown() && !deps.isShuttingDown() && registry?.getWorkspace(caller.workspace.workspaceId) === caller.workspace
      && deps.getTerminals().get(caller.terminalId) === terminal
      && terminal.checkoutContextId === caller.checkoutContext.id && terminal.harnessId === caller.harnessId
      && terminal.workspaceId === caller.workspace.workspaceId && !!registry
      && isCurrentCheckoutContext(registry, caller.checkoutContext) && isCurrentCheckoutContext(registry, target)
      && !registry.getCheckoutContext(target.id)?.missing && directoryExists(toNativePath(target.path, process.platform))
      && snapshot?.sessionId === session.id && snapshot.runtime?.status === 'running'
      && snapshot.runtime.turnId === baseline.runtime?.turnId;
  };
  await gate.relocate({
    terminalId: caller.terminalId, sessionId: session.id, source: caller.checkoutContext, target,
    baseline: { revision: baseline.revision, sessionId: baseline.sessionId, runtime: baseline.runtime, location: baseline.location ?? null },
    signal, invoke: capability.relocateLiveConversation, isCurrent: current,
    commit: () => {
      if (deps.attention.snapshot(caller.terminalId)?.location?.checkoutContextId !== target.id) return false;
      return deps.commitCheckoutRelocation!({
        terminalId: caller.terminalId, workspaceId: caller.workspace.workspaceId, environmentId: LOCAL_ENVIRONMENT_ID,
        harnessId: caller.harnessId, checkoutContextId: caller.checkoutContext.id,
      }, target.id);
    },
  });
}
