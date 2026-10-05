import * as path from 'node:path';
import type { CheckoutContext } from '../../shared/types/checkoutContext';
import type { RegisteredWorkspace } from '../workspaceRegistry';
import { defineInput, type InferInput, type InputSpec, type ToolJsonSchema } from './input';

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

/** Everything a capability's `run` may use besides its validated input. */
export interface AgentBridgeCallContext {
  readonly caller: AgentBridgeCaller;
  /**
   * Aborted when the call exceeds the bridge's execution bound or the client goes away. A capability
   * that does I/O or spawns work must honor it; mutating capabilities must also be safe to abandon.
   */
  readonly signal: AbortSignal;
}

/**
 * One agent-callable Clanker capability, built with `defineCapability`. Adding one means adding an
 * entry to the capability list and nothing in any harness provider.
 */
export interface AgentBridgeCapability {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolJsonSchema;
  /** Parses `rawArgs` against the declared input first; an invalid call never reaches the capability. */
  invoke(rawArgs: unknown, context: AgentBridgeCallContext): Promise<AgentBridgeToolResult>;
}

export interface AgentBridgeCapabilityDefinition<S extends InputSpec> {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  /** Receives validated, typed input only. Must be bounded, must not widen the caller's authority and
   * must call existing validated main-process services rather than re-implementing authorization. */
  run(input: InferInput<S>, context: AgentBridgeCallContext): AgentBridgeToolResult | Promise<AgentBridgeToolResult>;
}

export function defineCapability<const S extends InputSpec>(definition: AgentBridgeCapabilityDefinition<S>): AgentBridgeCapability {
  const input = defineInput(definition.input);
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: input.jsonSchema,
    async invoke(rawArgs, context) {
      const parsed = input.parse(rawArgs);
      if (!parsed.ok) return { isError: true, data: { error: parsed.error } };
      return definition.run(parsed.value, context);
    },
  };
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
export const clankerContextCapability: AgentBridgeCapability = defineCapability({
  name: 'clanker_context',
  description: 'Describe the Clanker workspace and checkout this agent was launched in, and which Clanker capabilities are available. Read-only; takes no arguments.',
  input: {},
  run(_input, { caller }) {
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
});

/** Every capability the bridge can offer. A credential is granted a subset at issue time. */
export const DEFAULT_AGENT_BRIDGE_CAPABILITIES: readonly AgentBridgeCapability[] = Object.freeze([clankerContextCapability]);
