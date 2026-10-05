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
import { bridgeInstructions } from './instructions';
import { AgentBridgeServer, AGENT_BRIDGE_LIMITS, type AgentBridgeToolDescriptor, type AgentBridgeToolHost } from './server';

export const AGENT_BRIDGE_SERVER_NAME = 'clanker-grid';
/** Environment variable carrying the bearer credential into the launched harness only. */
export const AGENT_BRIDGE_TOKEN_ENV = 'CLANKER_MCP_TOKEN';

/** A stale bridge credential inherited from an outer Clanker (or a user's profile) is never passed on. */
export function withoutAgentBridgeEnvironment(env: Record<string, string>): Record<string, string> {
  // Windows variable names are case-insensitive, so `clanker_mcp_token` would otherwise survive next to
  // the freshly issued `CLANKER_MCP_TOKEN`. Compare upper-cased everywhere; the prefix is reserved.
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.toUpperCase().startsWith('CLANKER_MCP_')));
}

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
  /** Test seam; defaults to AGENT_BRIDGE_LIMITS.toolTimeoutMs. */
  toolTimeoutMs?: number;
}

/** What this launch can honor; decides which capabilities its credential is granted. */
export interface AgentBridgeGrants {
  /** The harness conversation can be re-homed by resuming it in another checkout. */
  checkoutRehoming?: boolean;
}

/** Everything a launch needs to wire the bridge, and the means to give it all back. */
export interface AgentBridgeLaunchLease {
  readonly url: string;
  readonly token: string;
  /** Guidance for what THIS credential was granted (the same text the server sends in `initialize`). */
  readonly instructions: string;
  /** Idempotent. */
  release(): void;
}

/** Main-owned facade: server lifecycle, credentials, live authority checks and the capability set. */
export class AgentBridgeService implements AgentBridgeToolHost {
  readonly credentials = new AgentBridgeCredentials();
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
  async lease(identity: AgentBridgeIdentity, grants: AgentBridgeGrants = {}): Promise<AgentBridgeLaunchLease> {
    if (this.shutDown) throw new Error('Agent bridge is shut down');
    if (identity.environmentId !== LOCAL_ENVIRONMENT_ID) throw new Error('Agent bridge is local-only');
    const url = await this.server.start();
    // start() awaited: shutdown may have run meanwhile.
    if (this.shutDown) throw new Error('Agent bridge is shut down');
    // A launch is granted only what it can honor: capabilities that `require` something it lacks are
    // absent for it (not listed, and refused as unknown), rather than advertised and doomed to fail.
    const granted = [...this.capabilities.values()]
      .filter((capability) => capability.requires === undefined || (capability.requires === 'checkout-rehoming' && grants.checkoutRehoming === true))
      .map((capability) => capability.name);
    const { token, revoke } = this.credentials.issue(identity, granted);
    // `release` is the registry's own revoke closure (it holds only the digest), so keeping it alive
    // for the terminal's lifetime never keeps the raw token alive.
    return { url, token, instructions: bridgeInstructions(new Set(granted)), release: revoke };
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

  instructionsFor(grant: AgentBridgeGrant): string {
    return bridgeInstructions(grant.capabilities);
  }

  listTools(grant: AgentBridgeGrant): AgentBridgeToolDescriptor[] {
    if (!this.resolveCaller(grant)) return [];
    return [...this.capabilities.values()]
      .filter((capability) => grant.capabilities.has(capability.name))
      .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  async callTool(grant: AgentBridgeGrant, name: string, args: Record<string, unknown>, clientSignal?: AbortSignal): Promise<AgentBridgeToolResult> {
    const caller = this.resolveCaller(grant);
    if (!caller) return { isError: true, data: { error: 'This Clanker session is no longer active' } };
    const capability = grant.capabilities.has(name) ? this.capabilities.get(name) : undefined;
    if (!capability) return { isError: true, data: { error: `Unknown tool: ${name.slice(0, 64)}` } };

    // Bounded execution: the capability's own input parser runs first (undeclared, missing, mistyped
    // or out-of-range arguments never reach `run`), and the whole call is cut off at the bound.
    const controller = new AbortController();
    const onClientAbort = () => controller.abort();
    if (clientSignal?.aborted) controller.abort(); else clientSignal?.addEventListener('abort', onClientAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<AgentBridgeToolResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ isError: true, data: { error: 'Tool timed out' } });
      }, this.deps.toolTimeoutMs ?? capability.timeoutMs ?? AGENT_BRIDGE_LIMITS.toolTimeoutMs);
    });
    try {
      return await Promise.race([
        capability.invoke(args, { caller, signal: controller.signal }).catch((): AgentBridgeToolResult => ({ isError: true, data: { error: 'Tool failed' } })),
        timeout,
      ]);
    } finally {
      // Detail stays in main; a failing capability never echoes internals to the model.
      clearTimeout(timer);
      clientSignal?.removeEventListener('abort', onClientAbort);
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
  /** Capabilities this launch can honor beyond the always-available ones. */
  grants?: AgentBridgeGrants;
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
      const lease = await service.lease(identity, input.grants);
      let scratch: string | undefined;
      const removeScratch = () => {
        if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
        scratch = undefined;
      };
      try {
        const prepared = provider.prepare({
          url: lease.url, serverName: AGENT_BRIDGE_SERVER_NAME, tokenEnvVar: AGENT_BRIDGE_TOKEN_ENV,
          args: state.args, env: state.env, platform: input.platform ?? process.platform, instructions: lease.instructions,
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
        // The disposer holds only what releasing needs: the revoke closure and the provider's own
        // disposer. It must not capture the lease or the composed attachment, which carry the token.
        const release = lease.release;
        const disposeProvider = prepared.dispose;
        return {
          ...(prepared.args ? { args: prepared.args } : {}),
          env: { ...prepared.env, [AGENT_BRIDGE_TOKEN_ENV]: lease.token },
          async dispose() {
            // Revoke first: authority must end even if provider cleanup fails.
            release();
            try { await disposeProvider.call(undefined); } finally { removeScratch(); }
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
