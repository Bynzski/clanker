import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LOCAL_ENVIRONMENT_ID } from '../../shared/types/environments';
import type { WorkspaceRegistry } from '../workspaceRegistry';
import { findHarnessProvider } from '../harnesses/registry';
import type { LaunchAttachmentStep } from '../launchAttachments';
import {
  DEFAULT_AGENT_BRIDGE_CAPABILITIES,
  type AgentBridgeCaller,
  type AgentBridgeCapability,
  type AgentBridgeToolResult,
} from './capabilities';
import { AgentBridgeCredentials, type AgentBridgeGrant, type AgentBridgeIdentity } from './credentials';
import { AgentBridgeServer, type AgentBridgeToolDescriptor, type AgentBridgeToolHost } from './server';

export const AGENT_BRIDGE_SERVER_NAME = 'clanker-grid';
/** Environment variable carrying the bearer credential into the launched harness only. */
export const AGENT_BRIDGE_TOKEN_ENV = 'CLANKER_MCP_TOKEN';

/** A stale bridge credential inherited from an outer Clanker (or a user's profile) is never passed on. */
export function withoutAgentBridgeEnvironment(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('CLANKER_MCP_')));
}
const INSTRUCTIONS = 'Clanker is the desktop workspace this agent runs in. These tools describe the launching workspace and are read-only unless a tool says otherwise. Nothing here is required for normal work.';

/** The part of a registered terminal the bridge reads. Authority is re-checked against it on every call. */
export interface AgentBridgeTerminalRecord {
  workspaceId?: string;
  checkoutContextId?: string;
  environmentId?: string;
  harnessId?: string;
  cwd?: string;
}

export interface AgentBridgeServiceDeps {
  getRegistry(): WorkspaceRegistry | undefined;
  getTerminals(): ReadonlyMap<string, AgentBridgeTerminalRecord>;
  version: () => string;
  /** Test seam; defaults to the shipped capability set. */
  capabilities?: readonly AgentBridgeCapability[];
}

/** Everything a launch needs to wire the bridge, and the means to give it all back. */
export interface AgentBridgeLaunchLease {
  readonly url: string;
  readonly token: string;
  /** Idempotent. */
  release(): void;
}

/** Main-owned facade: server lifecycle, credentials, live authority checks and the capability set. */
export class AgentBridgeService implements AgentBridgeToolHost {
  readonly credentials = new AgentBridgeCredentials();
  readonly instructions = INSTRUCTIONS;
  private readonly server: AgentBridgeServer;
  private readonly capabilities: ReadonlyMap<string, AgentBridgeCapability>;
  private shutDown = false;

  constructor(private readonly deps: AgentBridgeServiceDeps) {
    this.capabilities = new Map((deps.capabilities ?? DEFAULT_AGENT_BRIDGE_CAPABILITIES).map((capability) => [capability.name, capability]));
    this.server = new AgentBridgeServer({ credentials: this.credentials, host: this, version: deps.version });
  }

  /**
   * Starts the endpoint if needed and binds a fresh credential to one launch. The identity is main's
   * own record; callers never pass anything the renderer or a model chose.
   */
  async lease(identity: AgentBridgeIdentity): Promise<AgentBridgeLaunchLease> {
    if (this.shutDown) throw new Error('Agent bridge is shut down');
    if (identity.environmentId !== LOCAL_ENVIRONMENT_ID) throw new Error('Agent bridge is local-only');
    const url = await this.server.start();
    // start() awaited: shutdown may have run meanwhile.
    if (this.shutDown) throw new Error('Agent bridge is shut down');
    const credential = this.credentials.issue(identity, this.capabilities.keys());
    return { url, token: credential.token, release: () => credential.revoke() };
  }

  /** Revokes a terminal's authority. Safe for unknown terminals. */
  revokeTerminal(terminalId: string): void {
    this.credentials.revokeTerminal(terminalId);
  }

  async shutdown(): Promise<void> {
    this.shutDown = true;
    this.credentials.revokeAll();
    await this.server.close();
  }

  listTools(grant: AgentBridgeGrant): AgentBridgeToolDescriptor[] {
    if (!this.resolveCaller(grant)) return [];
    return [...this.capabilities.values()]
      .filter((capability) => grant.capabilities.has(capability.name))
      .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  async callTool(grant: AgentBridgeGrant, name: string, args: Record<string, unknown>): Promise<AgentBridgeToolResult> {
    const caller = this.resolveCaller(grant);
    if (!caller) return { isError: true, data: { error: 'This Clanker session is no longer active' } };
    const capability = grant.capabilities.has(name) ? this.capabilities.get(name) : undefined;
    if (!capability) return { isError: true, data: { error: `Unknown tool: ${name.slice(0, 64)}` } };
    // Closed schema: an argument that is not declared is refused, so no tool can be handed an
    // identity (or anything else) it did not ask for.
    const unexpected = Object.keys(args).filter((key) => !Object.prototype.hasOwnProperty.call(capability.inputSchema.properties, key));
    if (unexpected.length > 0) return { isError: true, data: { error: 'Unexpected arguments' } };
    try {
      return await capability.run(args, caller);
    } catch {
      // Detail stays in main; a failing capability must not echo internals to the model.
      return { isError: true, data: { error: 'Tool failed' } };
    }
  }

  /**
   * The caller's authority from main's live state, or null (fail closed). A credential outlives
   * nothing: a closed workspace, a released context or an exited terminal ends it even if revocation
   * has not run yet.
   */
  private resolveCaller(grant: AgentBridgeGrant): AgentBridgeCaller | null {
    const { identity } = grant;
    const registry = this.deps.getRegistry();
    const terminal = this.deps.getTerminals().get(identity.terminalId);
    if (!registry || !terminal) return null;
    if (terminal.workspaceId !== identity.workspaceId || terminal.checkoutContextId !== identity.checkoutContextId
      || terminal.harnessId !== identity.harnessId || (terminal.environmentId ?? LOCAL_ENVIRONMENT_ID) !== identity.environmentId) {
      return null;
    }
    const workspace = registry.getWorkspace(identity.workspaceId);
    const checkoutContext = registry.getCheckoutContext(identity.checkoutContextId);
    if (!workspace || !checkoutContext) return null;
    if (workspace.location.environmentId !== identity.environmentId
      || checkoutContext.workspaceId !== identity.workspaceId || checkoutContext.environmentId !== identity.environmentId) {
      return null;
    }
    return {
      terminalId: identity.terminalId, harnessId: identity.harnessId, workspace, checkoutContext,
      ...(terminal.cwd ? { launchDirectory: terminal.cwd } : {}), granted: [...grant.capabilities],
    };
  }
}

export interface AgentBridgeLaunchStepInput {
  service: AgentBridgeService;
  harness: string;
  identity: AgentBridgeIdentity;
  platform?: NodeJS.Platform;
}

/**
 * The bridge as a launch attachment. Optional by construction: ordinary harness launch never
 * depends on it, and any failure (conflicting user configuration, listener unavailable, a provider
 * that cannot attach) leaves the launch exactly as it would have been.
 */
export function agentBridgeLaunchStep(input: AgentBridgeLaunchStepInput): LaunchAttachmentStep {
  const { service, harness, identity } = input;
  return {
    name: 'agent-bridge',
    optional: true,
    async prepare(state) {
      const provider = findHarnessProvider(harness)?.agentBridge;
      if (!provider) return null;
      const lease = await service.lease(identity);
      let scratch: string | undefined;
      const removeScratch = () => {
        if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
        scratch = undefined;
      };
      try {
        const prepared = provider.prepare({
          url: lease.url, serverName: AGENT_BRIDGE_SERVER_NAME, tokenEnvVar: AGENT_BRIDGE_TOKEN_ENV,
          args: state.args, env: state.env, platform: input.platform ?? process.platform,
          scratchDir() {
            scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-mcp-'));
            fs.chmodSync(scratch, 0o700);
            return scratch;
          },
        });
        if (!prepared) {
          lease.release();
          removeScratch();
          return null;
        }
        return {
          ...(prepared.args ? { args: prepared.args } : {}),
          env: { ...prepared.env, [AGENT_BRIDGE_TOKEN_ENV]: lease.token },
          async dispose() {
            // Revoke first: authority must end even if provider cleanup fails.
            lease.release();
            try { await prepared.dispose(); } finally { removeScratch(); }
          },
        };
      } catch (error) {
        lease.release();
        removeScratch();
        throw error;
      }
    },
  };
}
