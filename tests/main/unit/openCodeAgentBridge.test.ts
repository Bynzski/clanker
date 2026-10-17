import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { agentBridge } from '../../../src/main/harnesses/opencode/agentBridge';
import { openCodePrivateServerArgs } from '../../../src/main/harnesses/opencode/privateServer';
import { prepareLaunchAttachments } from '../../../src/main/launchAttachments';
import { AgentBridgeService, agentBridgeLaunchStep } from '../../../src/main/agentBridge/service';
import { attentionLaunchStep } from '../../../src/main/attentionLaunchStep';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';
import type { HarnessAgentBridgeContext } from '../../../src/main/harnesses/types';

const version = vi.hoisted(() => ({ major: 2 as number | null }));
vi.mock('../../../src/main/harnesses/opencode/version', () => ({ openCodeMajorVersion: () => version.major }));
afterEach(() => { version.major = 2; });
const context = (args: string[] = [], env = {}): HarnessAgentBridgeContext => ({
  url: 'http://127.0.0.1:40000/mcp', serverName: 'clanker-grid', tokenEnvVar: 'CLANKER_MCP_TOKEN',
  args, env, platform: 'linux', scratchDir: () => { throw new Error('Unused'); },
});

describe('OpenCode private-server bridge', () => {
  it.each([[], ['--session', 'session-fixture'], ['--standalone', '--session', 'session-fixture']].map(args => [args]))('adds exactly one standalone flag without changing launch/resume arguments: %j', args => {
    const prepared = agentBridge.prepare(context(args))!;
    expect(prepared.args).toEqual(args.includes('--standalone') ? args : ['--standalone', ...args]);
    expect(prepared.args!.filter(arg => arg === '--standalone')).toHaveLength(1);
    expect(JSON.parse(prepared.env!.OPENCODE_CONFIG_CONTENT).mcp['clanker-grid'].headers.Authorization).toBe('Bearer {env:CLANKER_MCP_TOKEN}');
    expect(args).not.toContain('CLANKER_MCP_TOKEN');
  });

  it.each([['--server', 'http://localhost:9999'], ['--server=http://localhost:9999'], ['--standalone=false'], ['--standalone=true']].map(args => [args]))('leaves explicit server choices untouched and attaches no credential: %j', args => {
    expect(agentBridge.prepare(context(args))).toBeNull();
    expect(openCodePrivateServerArgs(args)).toBeNull();
  });

  it.each([1, null])('preserves legacy argv for major %s', major => {
    version.major = major;
    expect(agentBridge.prepare(context(['--session', 's']))!.args).toBeUndefined();
  });

  it('leaves user inline config untouched before acquiring resources', () => {
    expect(agentBridge.prepare(context([], { OPENCODE_CONFIG_CONTENT: '{"mcp":{}}' }))).toBeNull();
  });

  it('revokes the temporary lease when an external server prevents attachment', async () => {
    const identity = { terminalId: 'term', workspaceId: 'ws', environmentId: 'local', checkoutContextId: 'ws::main', harnessId: 'opencode' };
    const service = new AgentBridgeService({ getRegistry: () => undefined, getTerminals: () => new Map(), version: () => 'test' });
    const args = ['--server', 'http://localhost:9999'];
    try {
      const prepared = await prepareLaunchAttachments({ args, env: {} }, [agentBridgeLaunchStep({ service, harness: 'opencode', identity })]);
      expect(prepared.args).toEqual(args);
      expect(prepared.attached).toEqual([]);
      expect(prepared.env).toEqual({});
      expect(service.credentials.size).toBe(0);
      await prepared.dispose();
    } finally { await service.shutdown(); }
  });

  it.each([false, true])('composes independently of attention (enabled=%s), revokes on exit and retains no duplicate flags', async enabled => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-bridge-composition-'));
    const main = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: root, kind: 'main' as const };
    const identity = { terminalId: 'term', workspaceId: 'ws', environmentId: 'local', checkoutContextId: main.id, harnessId: 'opencode' };
    const service = new AgentBridgeService({
      getRegistry: () => ({ getWorkspace: () => ({ workspaceId: 'ws', location: { environmentId: 'local', path: root } }), getCheckoutContext: () => main }) as never,
      getTerminals: () => new Map([['term', identity]]), version: () => 'test',
    });
    const broker = new AgentAttentionBroker(() => {});
    let prepared;
    try {
      prepared = await prepareLaunchAttachments({ args: ['--session', 's'], env: {} }, [
        attentionLaunchStep({ broker, harness: 'opencode', terminalId: 'term', enabled }),
        agentBridgeLaunchStep({ service, harness: 'opencode', identity }),
      ]);
      expect(prepared.args).toEqual(['--standalone', '--session', 's']);
      expect(prepared.attached).toContain('agent-bridge');
      expect(prepared.provided.has('native-attention')).toBe(enabled);
      expect(prepared.env.CLANKER_MCP_TOKEN).toBeTruthy();
      expect(prepared.env.OPENCODE_CONFIG_CONTENT).not.toContain(prepared.env.CLANKER_MCP_TOKEN);
      if (enabled) expect(prepared.env.OPENCODE_CONFIG).toBeTruthy();
      else expect(prepared.env.OPENCODE_CONFIG).toBeUndefined();
      expect(service.credentials.resolve(prepared.env.CLANKER_MCP_TOKEN)).not.toBeNull();
      await prepared.dispose();
      expect(service.credentials.resolve(prepared.env.CLANKER_MCP_TOKEN)).toBeNull();
    } finally { await prepared?.dispose(); broker.close(); await service.shutdown(); fs.rmSync(root, { recursive: true, force: true }); }
  });
});
