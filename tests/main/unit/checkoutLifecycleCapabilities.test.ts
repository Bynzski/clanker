import { describe, expect, it, vi } from 'vitest';
import { KNOWN_HARNESS_IDS } from '../../../src/shared/harnessIds';
import { getHarnessProviders } from '../../../src/main/harnesses/registry';
import { grantsCheckoutRehoming, supportsCheckoutRehoming } from '../../../src/main/isolatedCheckout/rehomeSupport';
import {
  CHECKOUT_LIFECYCLE_TIMEOUT_MS, createCheckoutLifecycleCapabilities, deferredLifecyclePort, MAX_BRANCH_LENGTH,
  type AgentCheckoutLifecyclePort,
} from '../../../src/main/agentBridge/lifecycleCapabilities';
import { DEFAULT_AGENT_BRIDGE_CAPABILITIES, MAX_TOOL_TIMEOUT_MS, defineCapability, type AgentBridgeCaller } from '../../../src/main/agentBridge/capabilities';
import { AgentBridgeService } from '../../../src/main/agentBridge/service';
import { AGENT_BRIDGE_LIMITS } from '../../../src/main/agentBridge/server';

const caller = { terminalId: 't', harnessId: 'claude', workspace: {}, checkoutContext: {}, granted: [] } as unknown as AgentBridgeCaller;
const context = { caller, signal: new AbortController().signal };

function stubPort(): AgentCheckoutLifecyclePort & { create: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn> } {
  return { create: vi.fn(async () => ({ data: { ok: 'create' } })), complete: vi.fn(async () => ({ data: { ok: 'complete' } })) };
}

describe('which harnesses can be re-homed (derived from provider evidence, never from a name)', () => {
  it('is exactly the providers that have the bridge, local attention, a native local resume and proven resume-from-another-directory', () => {
    const derived = getHarnessProviders().filter((provider) => {
      const resume = provider.sessions?.resume;
      return Boolean(provider.agentBridge && provider.attention?.local && provider.sessions?.resumesWithoutOriginalDirectory === true
        && resume && (!resume.transports || resume.transports.includes('local')));
    }).map((provider) => provider.descriptor.id);
    expect(KNOWN_HARNESS_IDS.filter(supportsCheckoutRehoming)).toEqual(derived);
  });

  it('currently Claude and Codex', () => {
    expect(KNOWN_HARNESS_IDS.filter(supportsCheckoutRehoming).sort()).toEqual(['claude', 'codex']);
  });

  it.each([
    ['opencode', 'its resume fails once the original directory is gone'],
    ['pi', 'it refuses to resume when the stored directory does not exist'],
    ['agy', 'resume-from-another-directory is unproven and it has no bridge'],
    ['hermes', 'it has no resumable history and no bridge'],
    ['omp', 'it resumes from another directory but has no bridge to ask through'],
  ])('%s cannot be re-homed: %s', (harness) => {
    expect(supportsCheckoutRehoming(harness)).toBe(false);
  });

  it('an unknown harness name never qualifies', () => {
    expect(supportsCheckoutRehoming('not-a-harness')).toBe(false);
    expect(supportsCheckoutRehoming('')).toBe(false);
  });

  it('the grant also needs agent attention, because the live conversation is identified by native lifecycle events', () => {
    expect(grantsCheckoutRehoming('claude', { attentionEnabled: true })).toBe(true);
    expect(grantsCheckoutRehoming('claude', { attentionEnabled: false })).toBe(false);
    expect(grantsCheckoutRehoming('opencode', { attentionEnabled: true })).toBe(false);
  });
});

describe('the lifecycle tools', () => {
  const [create, complete] = createCheckoutLifecycleCapabilities(stubPort());

  it('are exactly two high-level transactions, and no unsafe primitive exists', () => {
    expect([create.name, complete.name]).toEqual(['clanker_create_isolated_checkout', 'clanker_complete_isolated_checkout']);
    const all = [...DEFAULT_AGENT_BRIDGE_CAPABILITIES, create, complete].map((capability) => capability.name);
    expect(all).toEqual(['clanker_context', 'clanker_create_isolated_checkout', 'clanker_complete_isolated_checkout']);
    expect(all.filter((name) => /(?:create|delete|remove|adopt)_(?:branch|worktree)|change_cwd|switch_checkout|set_terminal/.test(name))).toEqual([]);
  });

  it('accept operation data only: a branch name, and a cleanup preference', () => {
    expect(Object.keys(create.inputSchema.properties)).toEqual(['branch']);
    expect(create.inputSchema.required).toEqual(['branch']);
    expect(Object.keys(complete.inputSchema.properties)).toEqual(['deleteBranch']);
    expect(complete.inputSchema.required).toBeUndefined();
    for (const capability of [create, complete]) {
      expect(capability.inputSchema.additionalProperties).toBe(false);
      expect(Object.keys(capability.inputSchema.properties).join(' ')).not.toMatch(/workspace|terminal|checkout|environment|path|harness|main/i);
    }
  });

  it('are granted only to launches that can be re-homed', () => {
    expect(create.requires).toBe('checkout-rehoming');
    expect(complete.requires).toBe('checkout-rehoming');
    expect(DEFAULT_AGENT_BRIDGE_CAPABILITIES.every((capability) => capability.requires === undefined)).toBe(true);
  });

  it('declare an explicit execution bound that is finite and within the hard cap', () => {
    for (const capability of [create, complete]) {
      expect(capability.timeoutMs).toBe(CHECKOUT_LIFECYCLE_TIMEOUT_MS);
      expect(capability.timeoutMs!).toBeGreaterThan(AGENT_BRIDGE_LIMITS.toolTimeoutMs);
      expect(capability.timeoutMs!).toBeLessThanOrEqual(MAX_TOOL_TIMEOUT_MS);
    }
  });

  describe('input is validated before the transaction runs', () => {
    const port = stubPort();
    const [guardedCreate, guardedComplete] = createCheckoutLifecycleCapabilities(port);

    it.each([
      ['a missing branch', {}], ['an empty branch', { branch: '' }], ['a numeric branch', { branch: 7 }], ['a nested branch', { branch: { name: 'x' } }],
      [`a branch over ${MAX_BRANCH_LENGTH} characters`, { branch: 'x'.repeat(MAX_BRANCH_LENGTH + 1) }],
      ['a model-chosen workspace', { branch: 'x', workspaceId: 'w' }], ['a model-chosen terminal', { branch: 'x', terminalId: 't' }],
      ['a model-chosen path', { branch: 'x', worktreePath: '/etc' }], ['a model-chosen checkout', { branch: 'x', checkoutContextId: 'c' }],
      ['a model-chosen base', { branch: 'x', mainPath: '/' }],
    ])('create refuses %s', async (_label, args) => {
      port.create.mockClear();
      const result = await guardedCreate.invoke(args, context);
      expect(result.isError).toBe(true);
      expect(port.create).not.toHaveBeenCalled();
    });

    it.each([
      ['a stringly boolean', { deleteBranch: 'true' }], ['a truthy number', { deleteBranch: 1 }], ['null', { deleteBranch: null }],
      ['a branch name (the branch comes from the checkout, never the model)', { branch: 'main' }], ['a path', { path: '/x' }], ['an array', [true]],
    ])('complete refuses %s', async (_label, args) => {
      port.complete.mockClear();
      const result = await guardedComplete.invoke(args as never, context);
      expect(result.isError).toBe(true);
      expect(port.complete).not.toHaveBeenCalled();
    });

    it('hands the port only validated, typed input plus the authenticated caller and signal', async () => {
      await guardedCreate.invoke({ branch: 'feature/x' }, context);
      expect(port.create).toHaveBeenCalledWith(caller, { branch: 'feature/x' }, context.signal);
      await guardedComplete.invoke({ deleteBranch: true }, context);
      expect(port.complete).toHaveBeenCalledWith(caller, { deleteBranch: true }, context.signal);
      await guardedComplete.invoke({}, context);
      expect(port.complete).toHaveBeenLastCalledWith(caller, {}, context.signal);
    });
  });
});

describe('per-capability bounds', () => {
  const base = { name: 'x', description: 'd', input: {}, run: () => ({ data: {} }) };
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_TOOL_TIMEOUT_MS + 1])('refuses a timeout of %s', (timeoutMs) => {
    expect(() => defineCapability({ ...base, timeoutMs })).toThrow(/timeout/);
  });
  it('accepts a bounded timeout and carries it', () => {
    expect(defineCapability({ ...base, timeoutMs: MAX_TOOL_TIMEOUT_MS }).timeoutMs).toBe(MAX_TOOL_TIMEOUT_MS);
    expect(defineCapability(base).timeoutMs).toBeUndefined();
  });
});

describe('grants decide which tools a credential sees', () => {
  const registry = {
    getWorkspace: () => ({ workspaceId: 'w', location: { environmentId: 'local', path: '/p' } }),
    getCheckoutContext: () => ({ id: 'w::main', workspaceId: 'w', environmentId: 'local', path: '/p', kind: 'main' }),
  };
  const identity = { terminalId: 't', workspaceId: 'w', environmentId: 'local', checkoutContextId: 'w::main', harnessId: 'claude' };
  const make = () => new AgentBridgeService({
    getRegistry: () => registry as never,
    getTerminals: () => new Map([['t', { workspaceId: 'w', checkoutContextId: 'w::main', harnessId: 'claude' }]]),
    version: () => '1',
    capabilities: [...DEFAULT_AGENT_BRIDGE_CAPABILITIES, ...createCheckoutLifecycleCapabilities(stubPort())],
  });
  const namesFor = (service: AgentBridgeService, token: string) => service.listTools(service.credentials.resolve(token)!).map((tool) => tool.name);

  it('a launch that can be re-homed is offered all three', async () => {
    const service = make();
    const lease = await service.lease(identity, { checkoutRehoming: true });
    expect(namesFor(service, lease.token)).toEqual(['clanker_context', 'clanker_create_isolated_checkout', 'clanker_complete_isolated_checkout']);
    await service.shutdown();
  });

  it('any other launch is offered only the context tool, and the lifecycle tools are unknown to it', async () => {
    const service = make();
    for (const grants of [undefined, {}, { checkoutRehoming: false }]) {
      const lease = await service.lease(identity, grants); // a reissue supersedes the terminal's earlier credential
      expect(namesFor(service, lease.token)).toEqual(['clanker_context']);
      const grant = service.credentials.resolve(lease.token)!;
      const refused = await service.callTool(grant, 'clanker_create_isolated_checkout', { branch: 'x' });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused.data)).toContain('Unknown tool');
    }
    await service.shutdown();
  });
});

describe('the deferred port (capabilities exist before the services they call)', () => {
  it('answers a bounded "unavailable" until bound, then delegates', async () => {
    const deferred = deferredLifecyclePort();
    const signal = new AbortController().signal;
    expect(await deferred.port.create(caller, { branch: 'x' }, signal)).toMatchObject({ isError: true });
    expect(await deferred.port.complete(caller, {}, signal)).toMatchObject({ isError: true });
    const real = stubPort();
    deferred.bind(real);
    expect(await deferred.port.create(caller, { branch: 'x' }, signal)).toEqual({ data: { ok: 'create' } });
    expect(real.create).toHaveBeenCalledWith(caller, { branch: 'x' }, signal);
  });
});
