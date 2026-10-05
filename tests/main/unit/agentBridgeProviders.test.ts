import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { AGENT_BRIDGE_HARNESS_IDS, HARNESS_DESCRIPTORS } from '../../../src/shared/harnessDescriptors';
import { KNOWN_HARNESS_IDS } from '../../../src/shared/harnessIds';
import { getHarnessProviders, findHarnessProvider } from '../../../src/main/harnesses/registry';
import { AgentBridgeService, agentBridgeLaunchStep, AGENT_BRIDGE_TOKEN_ENV, withoutAgentBridgeEnvironment } from '../../../src/main/agentBridge/service';
import { prepareLaunchAttachments, type LaunchAttachmentStep } from '../../../src/main/launchAttachments';
import { collectGarbage, weakHandle, type WeakHandle } from '../../_helpers/gc';
import { withoutAttentionEnvironment } from '../../../src/main/agentAttentionAdapters';
import { codexBridgeConflicts } from '../../../src/main/harnesses/codex/agentBridge';
import type { HarnessAgentBridgeContext } from '../../../src/main/harnesses/types';

const URL_ = 'http://127.0.0.1:41234/mcp';
let root: string;
const scratchDirs: string[] = [];

beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-bridge-test-'))); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); scratchDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })); });

function context(over: Partial<HarnessAgentBridgeContext> = {}): HarnessAgentBridgeContext {
  return {
    url: URL_, serverName: 'clanker-grid', tokenEnvVar: AGENT_BRIDGE_TOKEN_ENV, args: [], env: {}, platform: 'linux',
    scratchDir: () => { const dir = fs.mkdtempSync(path.join(root, 'scratch-')); scratchDirs.push(dir); return dir; },
    ...over,
  };
}
const bridgeOf = (id: string) => findHarnessProvider(id)?.agentBridge;
const digestTree = (dir: string): string => {
  const hash = createHash('sha256');
  const walk = (current: string) => fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach((entry) => {
    const full = path.join(current, entry.name);
    hash.update(path.relative(dir, full));
    if (entry.isDirectory()) walk(full); else hash.update(fs.readFileSync(full));
  });
  walk(dir);
  return hash.digest('hex');
};

describe('provider registry contract', () => {
  it('the descriptor flag and the implementation agree for every harness', () => {
    for (const provider of getHarnessProviders()) {
      expect('agentBridge' in provider.descriptor, provider.descriptor.id).toBe(provider.agentBridge !== undefined);
    }
    expect([...AGENT_BRIDGE_HARNESS_IDS]).toEqual(KNOWN_HARNESS_IDS.filter((id) => 'agentBridge' in HARNESS_DESCRIPTORS[id]));
  });

  it('supports exactly the harnesses with a verified launch-scoped, additive MCP mechanism', () => {
    expect([...AGENT_BRIDGE_HARNESS_IDS].sort()).toEqual(['claude', 'codex', 'opencode']);
    for (const unsupported of ['pi', 'omp', 'hermes', 'agy']) expect(bridgeOf(unsupported), unsupported).toBeUndefined();
  });

  it('attention and the bridge are distinct capabilities', () => {
    for (const id of AGENT_BRIDGE_HARNESS_IDS) {
      const provider = findHarnessProvider(id)!;
      expect(provider.agentBridge).not.toBe(provider.attention);
      expect(JSON.stringify(Object.keys(provider.attention ?? {}))).not.toMatch(/bridge|mcp/i);
    }
  });
});

describe('Claude attachment', () => {
  it('adds a private --mcp-config last, referencing the token by environment expansion only', () => {
    const prepared = bridgeOf('claude')!.prepare(context({ args: ['--model', 'opus'] }))!;
    const flagAt = prepared.args!.indexOf('--mcp-config');
    expect(prepared.args!.slice(0, flagAt)).toEqual(['--model', 'opus']);
    expect(flagAt).toBe(prepared.args!.length - 2);

    const file = prepared.args![flagAt + 1];
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(config).toEqual({ mcpServers: { 'clanker-grid': { type: 'http', url: URL_, headers: { Authorization: 'Bearer ${CLANKER_MCP_TOKEN}' } } } });
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('never replaces the user\'s own --mcp-config and never adds --strict-mcp-config', () => {
    const prepared = bridgeOf('claude')!.prepare(context({ args: ['--mcp-config', '/user/own.json'] }))!;
    expect(prepared.args!.slice(0, 2)).toEqual(['--mcp-config', '/user/own.json']);
    expect(prepared.args).not.toContain('--strict-mcp-config');
  });

  it('leaves a user who asked for strict MCP configuration alone', () => {
    expect(bridgeOf('claude')!.prepare(context({ args: ['--strict-mcp-config', '--mcp-config', 'x.json'] }))).toBeNull();
  });
});

describe('Codex attachment', () => {
  it('adds per-key -c overrides (url and bearer env var), never the token', () => {
    const prepared = bridgeOf('codex')!.prepare(context({ args: ['-m', 'gpt-5'], env: { CODEX_HOME: root } }))!;
    expect(prepared.args).toEqual([
      '-c', `mcp_servers.clanker-grid.url=${JSON.stringify(URL_)}`,
      '-c', 'mcp_servers.clanker-grid.bearer_token_env_var="CLANKER_MCP_TOKEN"',
      '-m', 'gpt-5',
    ]);
    expect(prepared.env).toBeUndefined();
  });

  it.each(['resume', 'fork'])('places overrides before the %s subcommand', (subcommand) => {
    const prepared = bridgeOf('codex')!.prepare(context({ args: ['--flag', subcommand, 'session-id'], env: { CODEX_HOME: root } }))!;
    expect(prepared.args!.slice(0, 1)).toEqual(['--flag']);
    expect(prepared.args!.indexOf('-c')).toBeLessThan(prepared.args!.indexOf(subcommand));
    expect(prepared.args!.slice(-2)).toEqual([subcommand, 'session-id']);
  });

  it('leaves the user\'s config.toml byte-for-byte untouched', () => {
    const toml = '[mcp_servers.mine]\ncommand = "tool"\n';
    fs.writeFileSync(path.join(root, 'config.toml'), toml);
    const before = digestTree(root);
    const prepared = bridgeOf('codex')!.prepare(context({ env: { CODEX_HOME: root } }))!;
    prepared.dispose();
    expect(digestTree(root)).toBe(before);
    expect(fs.readFileSync(path.join(root, 'config.toml'), 'utf8')).toBe(toml);
  });

  it.each([
    ['config.toml table', [], '[mcp_servers.clanker-grid]\nurl = "x"\n'],
    ['config.toml quoted table', [], '[mcp_servers."clanker-grid"]\nurl = "x"\n'],
    ['config.toml dotted key', [], 'mcp_servers.clanker-grid.url = "x"\n'],
    ['command-line override', ['-c', 'mcp_servers.clanker-grid.url="x"'], ''],
    ['attached override', ['-cmcp_servers.clanker-grid.enabled=false'], ''],
  ])('does not override a server of the same name the user already defines (%s)', (_label, args, toml) => {
    fs.writeFileSync(path.join(root, 'config.toml'), toml);
    expect(bridgeOf('codex')!.prepare(context({ args, env: { CODEX_HOME: root } }))).toBeNull();
  });

  it('does not mistake other servers or similar names for a conflict', () => {
    expect(codexBridgeConflicts('clanker-grid', [], '[mcp_servers.clanker]\n[mcp_servers.clanker-grid-two]\n')).toBe(false);
    expect(codexBridgeConflicts('clanker-grid', ['-c', 'mcp_servers.other.url="x"'], '')).toBe(false);
  });
});

describe('OpenCode attachment', () => {
  it('merges through OPENCODE_CONFIG_CONTENT with an {env:} reference, never the token', () => {
    const prepared = bridgeOf('opencode')!.prepare(context())!;
    expect(prepared.args).toBeUndefined();
    expect(JSON.parse(prepared.env!.OPENCODE_CONFIG_CONTENT)).toEqual({
      mcp: { 'clanker-grid': { type: 'remote', url: URL_, enabled: true, headers: { Authorization: 'Bearer {env:CLANKER_MCP_TOKEN}' } } },
    });
  });

  it('does not overwrite a configuration the user supplies through the same variable', () => {
    expect(bridgeOf('opencode')!.prepare(context({ env: { OPENCODE_CONFIG_CONTENT: '{"mcp":{}}' } }))).toBeNull();
  });
});

describe('agentBridgeLaunchStep', () => {
  const MAIN = { id: 'w1::main', workspaceId: 'w1', environmentId: 'local', path: '/p', kind: 'main' as const };
  function makeService() {
    return new AgentBridgeService({
      getRegistry: () => ({ getWorkspace: () => ({ workspaceId: 'w1', location: { environmentId: 'local', path: '/p' } }), getCheckoutContext: () => MAIN }) as never,
      getTerminals: () => new Map([['t1', { workspaceId: 'w1', checkoutContextId: MAIN.id, harnessId: 'claude' }]]),
      version: () => '1',
    });
  }
  const identity = (harnessId: string) => ({ terminalId: 't1', workspaceId: 'w1', environmentId: 'local', checkoutContextId: MAIN.id, harnessId });
  const scratchOf = (args: readonly string[]) => path.dirname(args[args.indexOf('--mcp-config') + 1]);

  let service: AgentBridgeService;
  beforeEach(() => { service = makeService(); });
  afterEach(async () => { await service.shutdown(); });

  it.each(['pi', 'omp', 'hermes', 'agy'])('an unsupported harness (%s) launches unchanged and never touches the listener or a credential', async (harness) => {
    const prepared = await prepareLaunchAttachments({ args: ['--x'], env: {} }, [agentBridgeLaunchStep({ service, harness, identity: identity(harness) })], () => undefined);
    expect(prepared.attached).toEqual([]);
    expect(prepared.args).toEqual(['--x']);
    expect(prepared.env).toEqual({});
    expect(service.credentials.size).toBe(0);
    expect(service.credentials.resolve('x')).toBeNull();
  });

  it('a supported harness gets the provider args plus the credential in its environment only', async () => {
    const prepared = await prepareLaunchAttachments({ args: [], env: {} }, [agentBridgeLaunchStep({ service, harness: 'claude', identity: identity('claude') })], () => undefined);
    const token = prepared.env[AGENT_BRIDGE_TOKEN_ENV];
    expect(service.credentials.resolve(token)?.identity.terminalId).toBe('t1');
    expect(prepared.args.join(' ')).not.toContain(token);
    expect(fs.readFileSync(prepared.args[prepared.args.indexOf('--mcp-config') + 1], 'utf8')).not.toContain(token);
    await prepared.dispose();
  });

  it('disposal revokes the credential and removes the scratch directory, idempotently', async () => {
    const prepared = await prepareLaunchAttachments({ args: [], env: {} }, [agentBridgeLaunchStep({ service, harness: 'claude', identity: identity('claude') })], () => undefined);
    const token = prepared.env[AGENT_BRIDGE_TOKEN_ENV];
    const scratch = scratchOf(prepared.args);
    expect(fs.existsSync(scratch)).toBe(true);

    await prepared.dispose();
    await prepared.dispose();
    expect(service.credentials.resolve(token)).toBeNull();
    expect(fs.existsSync(scratch)).toBe(false);
  });

  it('when the provider declines (user configuration conflict) nothing is left behind', async () => {
    const prepared = await prepareLaunchAttachments({ args: ['--strict-mcp-config'], env: {} },
      [agentBridgeLaunchStep({ service, harness: 'claude', identity: identity('claude') })], () => undefined);
    expect(prepared.attached).toEqual([]);
    expect(prepared.args).toEqual(['--strict-mcp-config']);
    expect(service.credentials.size).toBe(0);
  });

  it('a failing provider rolls back its credential and scratch, and the launch proceeds without the bridge', async () => {
    const provider = findHarnessProvider('claude')!;
    const original = provider.agentBridge!.prepare;
    let scratch = '';
    const spy = vi.spyOn(provider.agentBridge!, 'prepare').mockImplementation((ctx) => { scratch = ctx.scratchDir(); throw new Error('provider exploded'); });
    try {
      const report = vi.fn();
      const prepared = await prepareLaunchAttachments({ args: ['a'], env: {} }, [agentBridgeLaunchStep({ service, harness: 'claude', identity: identity('claude') })], report);
      expect(prepared.args).toEqual(['a']);
      expect(report).toHaveBeenCalledWith('agent-bridge', 'prepare', expect.any(Error));
      expect(service.credentials.size).toBe(0);
      expect(fs.existsSync(scratch)).toBe(false);
    } finally { spy.mockRestore(); expect(provider.agentBridge!.prepare).toBe(original); }
  });

  it('a later attachment that fails rolls back the bridge: credential revoked, scratch removed', async () => {
    let captured: { token: string; scratch: string } | undefined;
    const spyStep: LaunchAttachmentStep = {
      name: 'spy', optional: true,
      prepare: (state) => { captured = { token: '', scratch: scratchOf(state.args) }; return null; },
    };
    const failing: LaunchAttachmentStep = { name: 'required-later', prepare: () => { throw new Error('later attachment failed'); } };
    await expect(prepareLaunchAttachments({ args: [], env: {} },
      [agentBridgeLaunchStep({ service, harness: 'claude', identity: identity('claude') }), spyStep, failing], () => undefined))
      .rejects.toThrow('later attachment failed');

    expect(service.credentials.size).toBe(0);
    expect(fs.existsSync(captured!.scratch)).toBe(false);
  });

  it('removes only what it created: the user\'s project tree and provider config are untouched', async () => {
    const project = path.join(root, 'project');
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(project, 'AGENTS.md'), 'user rules');
    fs.writeFileSync(path.join(project, '.mcp.json'), '{"mcpServers":{"mine":{"command":"x"}}}');
    fs.writeFileSync(path.join(home, '.claude.json'), '{"mcpServers":{"mine":{"command":"y"}}}');
    fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '[mcp_servers.mine]\ncommand = "z"\n');
    const before = digestTree(root);

    for (const harness of ['claude', 'codex', 'opencode']) {
      const prepared = await prepareLaunchAttachments({ args: [], env: { CODEX_HOME: path.join(home, '.codex'), HOME: home } },
        [agentBridgeLaunchStep({ service, harness, identity: identity(harness) })], () => undefined);
      expect(prepared.attached).toEqual(['agent-bridge']);
      await prepared.dispose();
    }
    expect(digestTree(root)).toBe(before);
    expect(fs.existsSync(path.join(project, 'CLAUDE.md'))).toBe(false);
  });

  it('scratch directories live in the system temp area, never in a project', async () => {
    const prepared = await prepareLaunchAttachments({ args: [], env: {} }, [agentBridgeLaunchStep({ service, harness: 'claude', identity: identity('claude') })], () => undefined);
    const scratch = scratchOf(prepared.args);
    expect(path.dirname(scratch)).toBe(os.tmpdir());
    if (process.platform !== 'win32') expect(fs.statSync(scratch).mode & 0o777).toBe(0o700);
    await prepared.dispose();
  });
});

describe('the raw credential is not retained after launch', () => {
  const MAIN = { id: 'w1::main', workspaceId: 'w1', environmentId: 'local', path: '/p', kind: 'main' as const };
  it('the bridge step keeps neither the lease nor the composed attachment alive; revoking still works', async () => {
    const service = new AgentBridgeService({
      getRegistry: () => ({ getWorkspace: () => ({ workspaceId: 'w1', location: { environmentId: 'local', path: '/p' } }), getCheckoutContext: () => MAIN }) as never,
      getTerminals: () => new Map([['t1', { workspaceId: 'w1', checkoutContextId: MAIN.id, harnessId: 'claude' }]]),
      version: () => '1',
    });
    const leases: WeakHandle[] = [];
    const lease = service.lease.bind(service);
    service.lease = async (identity) => { const result = await lease(identity); leases.push(weakHandle(result)); return result; };
    const attachments: WeakHandle[] = [];
    const recording: LaunchAttachmentStep = { name: 'recorder', optional: true, prepare: () => null };
    const bridge = agentBridgeLaunchStep({ service, harness: 'claude', identity: { terminalId: 't1', workspaceId: 'w1', environmentId: 'local', checkoutContextId: MAIN.id, harnessId: 'claude' } });
    const wrapped: LaunchAttachmentStep = { ...bridge, async prepare(state) {
      const prepared = await bridge.prepare(state);
      if (prepared) attachments.push(weakHandle(prepared));
      return prepared;
    } };

    let prepared: Awaited<ReturnType<typeof prepareLaunchAttachments>> | null = await prepareLaunchAttachments({ args: [], env: {} }, [recording, wrapped], () => undefined);
    const token = prepared.env[AGENT_BRIDGE_TOKEN_ENV];
    const dispose = prepared.dispose; // all a terminal keeps
    prepared = null; // the child exists now: the composed env may go
    await collectGarbage();

    expect(leases).toHaveLength(1);
    expect(leases[0].deref()).toBeUndefined();
    expect(attachments[0].deref()).toBeUndefined();
    // Authority is still live until the terminal's disposer runs, and the disposer still revokes.
    expect(service.credentials.resolve(token)).not.toBeNull();
    await dispose();
    expect(service.credentials.resolve(token)).toBeNull();
    await service.shutdown();
  });
});

describe('inherited bridge environment', () => {
  it.each(['clanker_mcp_token', 'Clanker_Mcp_Token', 'CLANKER_mcp_X'])('drops %s regardless of case (Windows names are case-insensitive)', (name) => {
    expect(withoutAgentBridgeEnvironment({ [name]: 'stale', PATH: '/bin' })).toEqual({ PATH: '/bin' });
  });

  it('attention variables are stripped case-insensitively too', () => {
    expect(withoutAttentionEnvironment({
      clanker_attention_token: 'a', Clanker_Remote_Attention_X: 'b', CLANKER_ATTENTION_Y: 'c', CLANKER_MCP_TOKEN: 'kept-by-this-filter', PATH: '/bin',
    })).toEqual({ CLANKER_MCP_TOKEN: 'kept-by-this-filter', PATH: '/bin' });
  });

  it('drops stale CLANKER_MCP_* variables and keeps everything else', () => {
    expect(withoutAgentBridgeEnvironment({ CLANKER_MCP_TOKEN: 'stale', CLANKER_MCP_X: '1', PATH: '/bin', CLANKER_ATTENTION_Y: 'kept-here' }))
      .toEqual({ PATH: '/bin', CLANKER_ATTENTION_Y: 'kept-here' });
  });
});
