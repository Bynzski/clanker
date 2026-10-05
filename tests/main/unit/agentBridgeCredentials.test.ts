import { describe, expect, it } from 'vitest';
import { AgentBridgeCredentials, type AgentBridgeIdentity } from '../../../src/main/agentBridge/credentials';

const identity = (over: Partial<AgentBridgeIdentity> = {}): AgentBridgeIdentity => ({
  terminalId: 't1', workspaceId: 'w1', environmentId: 'local', checkoutContextId: 'w1::main', harnessId: 'claude', ...over,
});

describe('AgentBridgeCredentials', () => {
  it('issues a high-entropy token that resolves to exactly the bound identity and grant', () => {
    const credentials = new AgentBridgeCredentials();
    const { token } = credentials.issue(identity(), ['clanker_context']);

    expect(token).toMatch(/^clanker_mcp_v1_[A-Za-z0-9_-]{43}$/);
    const grant = credentials.resolve(token);
    expect(grant?.identity).toEqual(identity());
    expect([...grant!.capabilities]).toEqual(['clanker_context']);
  });

  it('never reuses a token across issues', () => {
    const credentials = new AgentBridgeCredentials();
    const tokens = new Set(Array.from({ length: 50 }, (_, index) => credentials.issue(identity({ terminalId: `t${index}` }), []).token));
    expect(tokens.size).toBe(50);
  });

  it('resolves only the credential presented: one terminal cannot act as another', () => {
    const credentials = new AgentBridgeCredentials();
    const one = credentials.issue(identity({ terminalId: 'one', workspaceId: 'wa', checkoutContextId: 'wa::main' }), []);
    const two = credentials.issue(identity({ terminalId: 'two', workspaceId: 'wb', checkoutContextId: 'wb::main' }), []);

    expect(credentials.resolve(one.token)?.identity).toMatchObject({ terminalId: 'one', workspaceId: 'wa', checkoutContextId: 'wa::main' });
    expect(credentials.resolve(two.token)?.identity).toMatchObject({ terminalId: 'two', workspaceId: 'wb', checkoutContextId: 'wb::main' });
  });

  it('the resolved identity is frozen: a holder cannot widen it', () => {
    const credentials = new AgentBridgeCredentials();
    const grant = credentials.resolve(credentials.issue(identity(), ['a']).token)!;
    expect(Object.isFrozen(grant.identity)).toBe(true);
    expect(() => { (grant.identity as { workspaceId: string }).workspaceId = 'other'; }).toThrow();
  });

  it('does not keep the raw token: only a digest is held', () => {
    const credentials = new AgentBridgeCredentials();
    const { token } = credentials.issue(identity(), []);
    const held = JSON.stringify([...(credentials as unknown as { grants: Map<string, unknown> }).grants.keys()])
      + JSON.stringify([...(credentials as unknown as { byTerminal: Map<string, string> }).byTerminal.values()]);
    expect(held).not.toContain(token);
    expect(held).not.toContain(token.slice('clanker_mcp_v1_'.length));
  });

  it('revocation is immediate and idempotent', () => {
    const credentials = new AgentBridgeCredentials();
    const issued = credentials.issue(identity(), []);
    issued.revoke();
    issued.revoke();
    expect(credentials.resolve(issued.token)).toBeNull();
    expect(credentials.size).toBe(0);
  });

  it('revokeTerminal revokes that terminal only', () => {
    const credentials = new AgentBridgeCredentials();
    const one = credentials.issue(identity({ terminalId: 'one' }), []);
    const two = credentials.issue(identity({ terminalId: 'two' }), []);
    expect(credentials.revokeTerminal('one')).toBe(true);
    expect(credentials.revokeTerminal('one')).toBe(false);
    expect(credentials.revokeTerminal('missing')).toBe(false);
    expect(credentials.resolve(one.token)).toBeNull();
    expect(credentials.resolve(two.token)).not.toBeNull();
  });

  it('a reissue for the same terminal supersedes the earlier credential', () => {
    const credentials = new AgentBridgeCredentials();
    const first = credentials.issue(identity(), []);
    const second = credentials.issue(identity(), []);
    expect(credentials.resolve(first.token)).toBeNull();
    expect(credentials.resolve(second.token)).not.toBeNull();
    // Revoking the superseded credential must not drop the live one.
    first.revoke();
    expect(credentials.resolve(second.token)).not.toBeNull();
  });

  it('revokeAll drops every credential', () => {
    const credentials = new AgentBridgeCredentials();
    const tokens = ['a', 'b', 'c'].map((terminalId) => credentials.issue(identity({ terminalId }), []).token);
    credentials.revokeAll();
    expect(tokens.map((token) => credentials.resolve(token))).toEqual([null, null, null]);
  });

  it.each([
    [undefined], [null], [''], ['Bearer x'], ['clanker_mcp_v1_short'], ['clanker_mcp_v1_' + 'a'.repeat(44)],
    ['clanker_mcp_v2_' + 'a'.repeat(43)], [42], [{}], ['x'.repeat(10_000)],
  ])('fails closed on malformed credential %#', (value) => {
    const credentials = new AgentBridgeCredentials();
    credentials.issue(identity(), []);
    expect(credentials.resolve(value)).toBeNull();
  });

  it('a well-formed but unknown token is rejected', () => {
    const credentials = new AgentBridgeCredentials();
    credentials.issue(identity(), []);
    expect(credentials.resolve('clanker_mcp_v1_' + 'a'.repeat(43))).toBeNull();
  });

  it.each(['terminalId', 'workspaceId', 'environmentId', 'checkoutContextId', 'harnessId'] as const)('refuses an identity without %s', (field) => {
    const credentials = new AgentBridgeCredentials();
    expect(() => credentials.issue(identity({ [field]: '' }), [])).toThrow(/Invalid agent bridge identity/);
    expect(credentials.size).toBe(0);
  });
});
