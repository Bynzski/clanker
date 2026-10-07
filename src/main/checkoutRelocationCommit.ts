import { toNativePath } from '../shared/pathNormalize';
import type { AgentBridgeIdentity } from './agentBridge/credentials';
import type { AgentBridgeService, AgentBridgeTerminalRecord } from './agentBridge/service';
import type { WorkspaceRegistry } from './workspaceRegistry';

/**
 * Main-only commit boundary, invoked by the live native proof gate. No renderer/MCP primitive exposes
 * it. Grant and terminal change in one synchronous step; a refused compare-and-rebind changes neither.
 * Kept outside the bridge: the transport can rebind its credential but never mutate terminal resources.
 */
export function commitCheckoutRelocation(deps: {
  registry: WorkspaceRegistry | undefined;
  terminals: ReadonlyMap<string, AgentBridgeTerminalRecord>;
  bridge: AgentBridgeService;
}, identity: AgentBridgeIdentity, targetId: string): boolean {
  const terminal = deps.terminals.get(identity.terminalId);
  const target = deps.registry?.getCheckoutContext(targetId);
  if (!terminal || !target || !deps.bridge.rebindCheckoutAuthority(identity, targetId)) return false;
  terminal.checkoutContextId = targetId;
  terminal.cwd = toNativePath(target.path, process.platform);
  return true;
}
