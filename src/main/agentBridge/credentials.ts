import { createHash, randomBytes } from 'node:crypto';

/**
 * Authority an MCP credential is bound to: main's own record of one launch. Only main's proven
 * live-relocation transaction may compare-and-rebind its checkout; a tool argument, the renderer,
 * an arbitrary cwd report or the model can never select or widen it. Deliberately unrelated to attention credentials: they prove a different thing and are
 * never interchangeable.
 */
export interface AgentBridgeIdentity {
  readonly terminalId: string;
  readonly workspaceId: string;
  readonly environmentId: string;
  readonly checkoutContextId: string;
  readonly harnessId: string;
}

/** What a resolved credential entitles its holder to. */
export interface AgentBridgeGrant {
  readonly identity: AgentBridgeIdentity;
  /** Capability names this launch may list and call. Anything else behaves as if it did not exist. */
  readonly capabilities: ReadonlySet<string>;
}

export interface IssuedAgentBridgeCredential {
  /** Shown once, to the launch environment only. Never stored, logged or returned again. */
  readonly token: string;
  /** Idempotent. */
  revoke(): void;
}

const TOKEN_PREFIX = 'clanker_mcp_v1_';
// 32 random bytes, base64url: 43 characters.
const TOKEN_PATTERN = /^clanker_mcp_v1_[A-Za-z0-9_-]{43}$/;

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');

const isNonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;

/**
 * Launch-scoped credentials. Only a SHA-256 digest of each token is retained: a token is 256 bits of
 * CSPRNG output, so a fast hash is sufficient and lookup by digest leaks nothing about other tokens.
 * Everything is in memory and dies with the process.
 */
export class AgentBridgeCredentials {
  private readonly grants = new Map<string, AgentBridgeGrant>();
  private readonly byTerminal = new Map<string, string>();

  issue(identity: AgentBridgeIdentity, capabilities: Iterable<string>): IssuedAgentBridgeCredential {
    const fields: Array<keyof AgentBridgeIdentity> = ['terminalId', 'workspaceId', 'environmentId', 'checkoutContextId', 'harnessId'];
    for (const field of fields) {
      if (!isNonEmpty(identity[field])) throw new Error(`Invalid agent bridge identity: ${field}`);
    }
    // One live credential per terminal; a reissue supersedes the earlier one.
    this.revokeTerminal(identity.terminalId);

    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const key = digest(token);
    const grant: AgentBridgeGrant = Object.freeze({
      identity: Object.freeze({
        terminalId: identity.terminalId, workspaceId: identity.workspaceId, environmentId: identity.environmentId,
        checkoutContextId: identity.checkoutContextId, harnessId: identity.harnessId,
      }),
      capabilities: new Set(capabilities),
    });
    this.grants.set(key, grant);
    this.byTerminal.set(identity.terminalId, key);
    return { token, revoke: () => this.revokeKey(key) };
  }

  /** The grant for a presented credential, or null. Malformed input fails closed before hashing. */
  resolve(token: unknown): AgentBridgeGrant | null {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
    return this.grants.get(digest(token)) ?? null;
  }

  /** A captured grant cannot survive revocation, supersession, or a checkout transition (including ABA). */
  isCurrent(grant: AgentBridgeGrant): boolean {
    const key = this.byTerminal.get(grant.identity.terminalId);
    return !!key && this.grants.get(key) === grant;
  }

  /** Main-only compare-and-rebind after native relocation proof; the bearer and capability set stay unchanged. */
  rebindCheckout(expected: AgentBridgeIdentity, checkoutContextId: string): boolean {
    if (!isNonEmpty(checkoutContextId)) return false;
    const key = this.byTerminal.get(expected.terminalId);
    const grant = key ? this.grants.get(key) : undefined;
    const fields: Array<keyof AgentBridgeIdentity> = ['terminalId', 'workspaceId', 'environmentId', 'checkoutContextId', 'harnessId'];
    if (!key || !grant || fields.some((field) => grant.identity[field] !== expected[field])) return false;
    this.grants.set(key, Object.freeze({
      identity: Object.freeze({ ...grant.identity, checkoutContextId }), capabilities: grant.capabilities,
    }));
    return true;
  }

  revokeTerminal(terminalId: string): boolean {
    const key = this.byTerminal.get(terminalId);
    return key ? this.revokeKey(key) : false;
  }

  revokeAll(): void {
    this.grants.clear();
    this.byTerminal.clear();
  }

  get size(): number {
    return this.grants.size;
  }

  private revokeKey(key: string): boolean {
    const grant = this.grants.get(key);
    if (!grant) return false;
    this.grants.delete(key);
    // Only drop the terminal index when it still points at this key (a superseding credential may own it).
    if (this.byTerminal.get(grant.identity.terminalId) === key) this.byTerminal.delete(grant.identity.terminalId);
    return true;
  }
}
