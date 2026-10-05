import { describe, expect, it, vi } from 'vitest';
import { KNOWN_HARNESS_IDS } from '../../../src/shared/harnessIds';
import { getHarnessProviders } from '../../../src/main/harnesses/registry';
import { grantsCheckoutRehoming, canSafelyRehomeConversation } from '../../../src/main/isolatedCheckout/rehomeSupport';
import {
  CHECKOUT_LIFECYCLE_TIMEOUT_MS, createCheckoutLifecycleCapabilities, deferredLifecyclePort, MAX_BRANCH_LENGTH,
  type AgentCheckoutLifecyclePort,
} from '../../../src/main/agentBridge/lifecycleCapabilities';
import { DEFAULT_AGENT_BRIDGE_CAPABILITIES, MAX_TOOL_TIMEOUT_MS, defineCapability, type AgentBridgeCaller } from '../../../src/main/agentBridge/capabilities';
import { AgentBridgeService } from '../../../src/main/agentBridge/service';
import { AGENT_BRIDGE_LIMITS } from '../../../src/main/agentBridge/server';
import { bridgeInstructions } from '../../../src/main/agentBridge/instructions';
import { COMPLETE_DESCRIPTION, COMPLETE_ISOLATED_CHECKOUT, CREATE_DESCRIPTION, CREATE_ISOLATED_CHECKOUT } from '../../../src/main/agentBridge/lifecycleCapabilities';
import { checkoutRehome as codexRehome } from '../../../src/main/harnesses/codex/rehome';
import { findHarnessProvider } from '../../../src/main/harnesses/registry';
import { checkoutRehomeModeOf, checkoutRehomeOf } from '../../../src/main/isolatedCheckout/rehomeSupport';

const caller = { terminalId: 't', harnessId: 'claude', workspace: {}, checkoutContext: {}, granted: [] } as unknown as AgentBridgeCaller;
const context = { caller, signal: new AbortController().signal };

function stubPort(): AgentCheckoutLifecyclePort & { create: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn> } {
  return { create: vi.fn(async () => ({ data: { ok: 'create' } })), complete: vi.fn(async () => ({ data: { ok: 'complete' } })) };
}

describe('rehome capability is a provider/runtime fact, separate from MCP transport', () => {
  type Mutable = { agentBridge?: unknown };
  const without = <T>(id: string, body: () => T): T => {
    const provider = findHarnessProvider(id) as Mutable;
    const saved = provider.agentBridge;
    try { provider.agentBridge = undefined; return body(); } finally { provider.agentBridge = saved; }
  };
  const allFacts = { nativeAttentionAttached: true, bridgeAvailable: true };

  it.each(['claude', 'codex', 'opencode'])('%s without any bridge transport still satisfies the rehome predicate and keeps its strategy, but no MCP grant exists', (id) => {
    without(id, () => {
      expect(canSafelyRehomeConversation(id)).toBe(true);
      expect(checkoutRehomeOf(id)).toBeDefined();
      expect(checkoutRehomeModeOf(id)).toBe(findHarnessProvider(id)?.checkoutRehome?.mode);
      expect(grantsCheckoutRehoming(id, { nativeAttentionAttached: true, bridgeAvailable: false })).toBe(false);
    });
    expect(grantsCheckoutRehoming(id, allFacts)).toBe(true); // with the bridge restored, as before
  });

  it.each(['claude', 'codex', 'opencode'])('%s: safe to rehome + bridge + attention NOT attached -> no lifecycle grant', (id) => {
    expect(grantsCheckoutRehoming(id, { nativeAttentionAttached: false, bridgeAvailable: true })).toBe(false);
  });

  it('the grant needs all three facts, and a harness that cannot be rehomed never gets one even with both transport facts', () => {
    for (const id of ['claude', 'codex', 'opencode']) {
      expect(grantsCheckoutRehoming(id, allFacts)).toBe(true);
      expect(grantsCheckoutRehoming(id, { ...allFacts, bridgeAvailable: false })).toBe(false);
      expect(grantsCheckoutRehoming(id, { ...allFacts, nativeAttentionAttached: false })).toBe(false);
    }
    for (const id of ['pi', 'omp', 'hermes', 'agy', 'not-a-harness']) expect(grantsCheckoutRehoming(id, allFacts)).toBe(false);
  });
});

describe('which harnesses can be re-homed (derived from provider evidence, never from a name)', () => {
  it('is exactly the providers with an explicit strategy, local attention, a native local resume and a way to run the conversation elsewhere (the MCP bridge is NOT part of it)', () => {
    const derived = getHarnessProviders().filter((provider) => {
      const resume = provider.sessions?.resume;
      return Boolean(provider.checkoutRehome && provider.attention?.local
        && (provider.sessions?.resumesWithoutOriginalDirectory === true || typeof provider.checkoutRehome.relocateConversation === 'function')
        && resume && (!resume.transports || resume.transports.includes('local')));
    }).map((provider) => provider.descriptor.id);
    expect(KNOWN_HARNESS_IDS.filter(canSafelyRehomeConversation)).toEqual(derived);
  });

  it('currently Claude, Codex and OpenCode', () => {
    expect(KNOWN_HARNESS_IDS.filter(canSafelyRehomeConversation).sort()).toEqual(['claude', 'codex', 'opencode']);
  });

  it.each([
    ['pi', 'it refuses to resume when the stored directory does not exist'],
    ['agy', 'resume-from-another-directory is unproven and it declares no checkoutRehome strategy'],
    ['hermes', 'it has no resumable history and declares no checkoutRehome strategy'],
    ['omp', 'it resumes from another directory but declares no checkoutRehome strategy'],
  ])('%s cannot be re-homed: %s', (harness) => {
    expect(canSafelyRehomeConversation(harness)).toBe(false);
  });

  it('an unknown harness name never qualifies', () => {
    expect(canSafelyRehomeConversation('not-a-harness')).toBe(false);
    expect(canSafelyRehomeConversation('')).toBe(false);
  });

  it('the grant also needs native attention to have ATTACHED to the launch, because the live conversation is identified by native lifecycle events', () => {
    expect(grantsCheckoutRehoming('claude', { nativeAttentionAttached: true, bridgeAvailable: true })).toBe(true);
    expect(grantsCheckoutRehoming('claude', { nativeAttentionAttached: false, bridgeAvailable: true })).toBe(false);
    expect(grantsCheckoutRehoming('opencode', { nativeAttentionAttached: true, bridgeAvailable: true })).toBe(true);
    expect(grantsCheckoutRehoming('opencode', { nativeAttentionAttached: false, bridgeAvailable: true })).toBe(false);
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

describe('the provider-owned re-home strategy', () => {
  it('Claude hot-replaces, Codex moves after the turn, and no other provider has a strategy', () => {
    const modes = Object.fromEntries(KNOWN_HARNESS_IDS.map((id) => [id, getHarnessProviders().find((provider) => provider.descriptor.id === id)?.checkoutRehome?.mode]));
    expect(modes).toEqual({ codex: 'after-turn', claude: 'hot-replace', opencode: 'after-turn', pi: undefined, omp: undefined, hermes: undefined, agy: undefined });
  });

  it('support and the mode the service uses come from that explicit capability', () => {
    expect(checkoutRehomeModeOf('claude')).toBe('hot-replace');
    expect(checkoutRehomeModeOf('codex')).toBe('after-turn');
    expect(checkoutRehomeModeOf('opencode')).toBe('after-turn');
    for (const id of ['pi', 'omp', 'hermes', 'agy']) expect(checkoutRehomeModeOf(id)).toBeUndefined();
  });

  it('resumesWithoutOriginalDirectory alone is NOT enough: without a declared strategy a provider is not re-homeable', () => {
    for (const id of ['claude', 'codex'] as const) {
      const provider = findHarnessProvider(id) as { checkoutRehome?: unknown; sessions?: { resumesWithoutOriginalDirectory?: boolean } };
      expect(provider.sessions?.resumesWithoutOriginalDirectory).toBe(true);
      const declared = provider.checkoutRehome;
      try {
        provider.checkoutRehome = undefined;
        expect(canSafelyRehomeConversation(id)).toBe(false);
        expect(grantsCheckoutRehoming(id, { nativeAttentionAttached: true, bridgeAvailable: true })).toBe(false);
      } finally { provider.checkoutRehome = declared; }
      expect(canSafelyRehomeConversation(id)).toBe(true);
    }
  });

  it('OpenCode does not resume from another directory; it qualifies only through its native relocation', () => {
    const provider = findHarnessProvider('opencode') as { checkoutRehome?: { relocateConversation?: unknown }; sessions?: { resumesWithoutOriginalDirectory?: boolean } };
    expect(provider.sessions?.resumesWithoutOriginalDirectory).not.toBe(true);
    const declared = provider.checkoutRehome;
    try {
      provider.checkoutRehome = { ...declared, relocateConversation: undefined } as never;
      expect(canSafelyRehomeConversation('opencode')).toBe(false);
    } finally { provider.checkoutRehome = declared; }
    expect(canSafelyRehomeConversation('opencode')).toBe(true);
  });

  it('OMP can resume from another directory, but that alone does not prove live checkout re-homing: without an explicit checkoutRehome strategy it stays not re-homeable', () => {
    expect(findHarnessProvider('omp')?.sessions?.resumesWithoutOriginalDirectory).toBe(true);
    expect(findHarnessProvider('omp')?.checkoutRehome).toBeUndefined();
    expect(canSafelyRehomeConversation('omp')).toBe(false);
  });
});

describe('Codex explicit target directory', () => {
  const withTarget = (args: string[], directory = '/projects/app-worktrees/feature') => codexRehome.withTargetDirectory!(args, directory);

  it('appends --cd <target> to the resume arguments', () => {
    expect(withTarget(['resume', 'abc', '-m', 'gpt'])).toEqual(['resume', 'abc', '-m', 'gpt', '--cd', '/projects/app-worktrees/feature']);
  });

  it.each([
    ['-C <dir>', ['resume', 'abc', '-C', '/evil']],
    ['--cd <dir>', ['resume', 'abc', '--cd', '/evil']],
    ['--cd=<dir>', ['resume', 'abc', '--cd=/evil']],
    ['-C<dir>', ['resume', 'abc', '-C/evil']],
  ])('replaces a user-supplied %s: the target is Clanker\'s', (_label, args) => {
    const result = withTarget(args);
    expect(result).toEqual(['resume', 'abc', '--cd', '/projects/app-worktrees/feature']);
    expect(result.join(' ')).not.toContain('/evil');
  });

  it('leaves unrelated flags (including ones that merely start with -C... as values) alone', () => {
    expect(withTarget(['resume', 'abc', '-c', 'x=1', '-s', 'workspace-write'])).toEqual(['resume', 'abc', '-c', 'x=1', '-s', 'workspace-write', '--cd', '/projects/app-worktrees/feature']);
  });

  it('only recognizes its own writer-contention failures, and bounds retries', () => {
    expect(codexRehome.isWriterContention!('Error: failed to acquire thread writer lock for 0123')).toBe(true);
    expect(codexRehome.isWriterContention!('thread 0123 is already running with a different rollout path')).toBe(true);
    expect(codexRehome.isWriterContention!('Error: No conversation found with that id')).toBe(false);
    expect(codexRehome.isWriterContention!('')).toBe(false);
    expect(codexRehome.writerContentionRetry).toEqual({ attempts: 3, delayMs: 250 });
  });

  it('Claude declares no target option: its launch directory decides', () => {
    expect(findHarnessProvider('claude')?.checkoutRehome?.withTargetDirectory).toBeUndefined();
  });
});

describe('what the model is told about checkout lifecycle', () => {
  const all = new Set(['clanker_context', CREATE_ISOLATED_CHECKOUT, COMPLETE_ISOLATED_CHECKOUT]);

  it('a launch granted the lifecycle tools is told they are authoritative and what NOT to use instead', () => {
    const text = bridgeInstructions(all);
    expect(text).toContain(CREATE_ISOLATED_CHECKOUT);
    expect(text).toContain(COMPLETE_ISOLATED_CHECKOUT);
    expect(text).toMatch(/Checkout lifecycle belongs to Clanker/);
    for (const rival of ['git worktree add', 'EnterWorktree', 'git worktree remove', 'ExitWorktree']) expect(text).toContain(rival);
    expect(text).toMatch(/instead of/);
    expect(text).toMatch(/ordinary Git and GitHub tools for edits, commits, pushes, pull requests and merges/);
    expect(text).toMatch(/finish your reply/);
  });

  it('the stale "nothing is required" wording is gone, from the instructions and from the tool descriptions', () => {
    for (const text of [bridgeInstructions(all), bridgeInstructions(new Set(['clanker_context'])), CREATE_DESCRIPTION, COMPLETE_DESCRIPTION]) {
      expect(text).not.toMatch(/required for normal work|nothing here is required|optional/i);
    }
  });

  it('a launch with only the context tool is NOT told it owns worktree lifecycle or that tools exist that it cannot call', () => {
    const text = bridgeInstructions(new Set(['clanker_context']));
    expect(text).toContain('clanker_context');
    expect(text).not.toMatch(/lifecycle|worktree|clanker_create|clanker_complete|EnterWorktree/i);
  });

  it('a launch granted only one of the two is told only about that one', () => {
    const createOnly = bridgeInstructions(new Set(['clanker_context', CREATE_ISOLATED_CHECKOUT]));
    expect(createOnly).toContain(CREATE_ISOLATED_CHECKOUT);
    expect(createOnly).not.toContain(COMPLETE_ISOLATED_CHECKOUT);
  });

  it('the create description steers away from every competing mechanism seen in smoke tests and says why', () => {
    expect(CREATE_DESCRIPTION).toMatch(/Use this whenever you need to create or enter an isolated worktree/);
    for (const rival of ['git worktree add', 'EnterWorktree']) expect(CREATE_DESCRIPTION).toContain(rival);
    expect(CREATE_DESCRIPTION).toMatch(/Prefer this over/);
    expect(CREATE_DESCRIPTION).toMatch(/Clanker must track the checkout and move this same conversation/);
  });

  it('the complete description steers away from manual removal and ExitWorktree and says why', () => {
    expect(COMPLETE_DESCRIPTION).toMatch(/after the work in an isolated checkout is merged or finished/i);
    for (const rival of ['git worktree remove', 'ExitWorktree', 'git branch -d/-D']) expect(COMPLETE_DESCRIPTION).toContain(rival);
    expect(COMPLETE_DESCRIPTION).toMatch(/Clanker must move this same conversation back to the main checkout before it removes the isolated one/);
    expect(COMPLETE_DESCRIPTION).toMatch(/never force-deleted/);
  });

  it('the capabilities carry exactly those descriptions (the text some harnesses show before loading a schema)', () => {
    const [create, complete] = createCheckoutLifecycleCapabilities(stubPort());
    expect(create.description).toBe(CREATE_DESCRIPTION);
    expect(complete.description).toBe(COMPLETE_DESCRIPTION);
    // Lifecycle guidance is discoverability only: it adds no argument and no permission.
    expect(create.requires).toBe('checkout-rehoming');
  });

  describe('delivered through a real MCP initialize, per what the credential was granted', () => {
    const registry = {
      getWorkspace: () => ({ workspaceId: 'w', location: { environmentId: 'local', path: '/p' } }),
      getCheckoutContext: () => ({ id: 'w::main', workspaceId: 'w', environmentId: 'local', path: '/p', kind: 'main' }),
    };
    const identity = { terminalId: 't', workspaceId: 'w', environmentId: 'local', checkoutContextId: 'w::main', harnessId: 'claude' };
    async function initialize(grants: { checkoutRehoming?: boolean }) {
      const service = new AgentBridgeService({
        getRegistry: () => registry as never, getTerminals: () => new Map([['t', { workspaceId: 'w', checkoutContextId: 'w::main', harnessId: 'claude' }]]),
        version: () => '1', capabilities: [...DEFAULT_AGENT_BRIDGE_CAPABILITIES, ...createCheckoutLifecycleCapabilities(stubPort())],
      });
      try {
        const lease = await service.lease(identity, grants);
        const reply = await fetch(lease.url, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${lease.token}` },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
        });
        return (await reply.json()).result.instructions as string;
      } finally { await service.shutdown(); }
    }

    it('a lifecycle-capable launch receives the lifecycle guidance in its server instructions', async () => {
      const text = await initialize({ checkoutRehoming: true });
      expect(text).toContain(CREATE_ISOLATED_CHECKOUT);
      expect(text).toContain('EnterWorktree');
    });

    it('any other launch receives guidance that never mentions tools it does not have', async () => {
      const text = await initialize({});
      expect(text).toContain('clanker_context');
      expect(text).not.toMatch(/worktree|clanker_create|clanker_complete/i);
    });
  });
});
