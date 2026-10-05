import * as path from 'node:path';
import type { CheckoutContext } from '../../shared/types/checkoutContext';
import type { RegisteredWorkspace } from '../workspaceRegistry';

/**
 * The authority of one authenticated MCP caller, re-derived from main's live state on every call.
 * Capabilities receive this and nothing else about the caller: they never read identity from tool
 * arguments, and anything they need to do goes through an existing validated main-process service.
 */
export interface AgentBridgeCaller {
  readonly terminalId: string;
  readonly harnessId: string;
  /** The exact registered workspace and checkout context the launch is bound to. */
  readonly workspace: RegisteredWorkspace;
  readonly checkoutContext: CheckoutContext;
  /** The directory the terminal was launched in (native path); presentation only. */
  readonly launchDirectory?: string;
  /** Names of the capabilities this credential may use. */
  readonly granted: readonly string[];
}

export interface AgentBridgeToolResult {
  /** Result payload; serialized as JSON text. */
  readonly data: unknown;
  readonly isError?: boolean;
}

export interface AgentBridgeToolSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties: false;
}

/**
 * One agent-callable Clanker capability. Adding one means adding an entry here and nothing in any
 * harness provider. `run` must be bounded and must not widen the caller's authority.
 */
export interface AgentBridgeCapability {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: AgentBridgeToolSchema;
  run(args: Readonly<Record<string, unknown>>, caller: AgentBridgeCaller): AgentBridgeToolResult | Promise<AgentBridgeToolResult>;
}

/** Display-safe: the last path segment only, never a path. */
const displayName = (workspacePath: string): string => {
  const segments = workspacePath.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? 'workspace';
};

/**
 * Directory the terminal launched in, relative to its checkout root (`.` for the root). Null when it
 * is not inside the root; an absolute path is never returned.
 */
function relativeLaunchDirectory(caller: AgentBridgeCaller): string | null {
  if (!caller.launchDirectory) return null;
  const relative = path.relative(caller.checkoutContext.path, caller.launchDirectory).split(path.sep).join('/');
  if (relative === '') return '.';
  return relative === '..' || relative.startsWith('../') || path.isAbsolute(relative) ? null : relative;
}

/**
 * `clanker_context`: read-only description of where the calling agent is running. Proves identity
 * binding and capability scoping end to end; it returns display-safe facts about the caller's own
 * launch only (no credentials, no ids that select authority, no other terminals or workspaces, no
 * absolute paths).
 */
export const clankerContextCapability: AgentBridgeCapability = {
  name: 'clanker_context',
  description: 'Describe the Clanker workspace and checkout this agent was launched in, and which Clanker capabilities are available. Read-only; takes no arguments.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run(_args, caller) {
    const { workspace, checkoutContext } = caller;
    return {
      data: {
        workspace: { name: displayName(workspace.location.path) },
        environment: { type: workspace.location.environmentId === 'local' ? 'local' : 'ssh' },
        checkout: {
          kind: checkoutContext.kind,
          isolated: checkoutContext.kind === 'worktree',
          branch: checkoutContext.branch ?? null,
          ...(checkoutContext.missing ? { missing: true } : {}),
        },
        agent: { harness: caller.harnessId, launchDirectory: relativeLaunchDirectory(caller) },
        capabilities: [...caller.granted],
      },
    };
  },
};

/** Every capability the bridge can offer. A credential is granted a subset at issue time. */
export const DEFAULT_AGENT_BRIDGE_CAPABILITIES: readonly AgentBridgeCapability[] = Object.freeze([clankerContextCapability]);
