import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { local, CODEX_HOOK_EVENTS } from '../../../src/main/harnesses/codex/attention';
import { agentBridge } from '../../../src/main/harnesses/codex/agentBridge';
import { codexConfigOverrides } from '../../../src/main/harnesses/codex/configArgs';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'clanker-codex-compat-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

// The fallback is intentional until a supported shared-server path has been verified. Avoid
// "fixes" that merely force remote mode, replace native state or persist per-terminal config.
describe('Codex embedded integration compatibility fallback (#107)', () => {
  for (const platform of ['linux', 'win32'] as const) {
    it.each([{ args: [] }, { args: ['resume', 'session-id'] }, { args: ['fork', 'session-id'] }])(`${platform}: keeps launch-scoped attention and MCP for %j without changing native config`, ({ args }) => {
      const userConfig = '[mcp_servers.user]\ncommand = "user-server"\n';
      writeFileSync(join(home, 'config.toml'), userConfig);
      const attention = local.prepare({ terminalId: 't', args, env: { CODEX_HOME: home },
        files: { command: join(home, 'launch-only', 'bridge.mjs') }, platform })!;
      const bridge = agentBridge.prepare({ url: 'http://127.0.0.1:41234/mcp', serverName: 'clanker-grid',
        tokenEnvVar: 'CLANKER_MCP_TOKEN', args: attention.args, env: { CODEX_HOME: home, ...attention.env },
        platform, instructions: 'Launch guidance', scratchDir: () => { throw new Error('No scratch config home'); } })!;
      const argv = bridge.args!;
      const overrides = codexConfigOverrides(argv);
      expect(overrides.filter((key) => key.startsWith('hooks.'))).toHaveLength(CODEX_HOOK_EVENTS.length);
      expect(overrides).toContain('mcp_servers.clanker-grid.bearer_token_env_var="CLANKER_MCP_TOKEN"');
      expect(overrides).toContain('developer_instructions="Launch guidance"');
      for (const flag of ['--remote', '--no-daemon', '--profile', '-p']) {
        expect(argv.some((arg) => arg === flag || arg.startsWith(flag + '=')), flag).toBe(false);
      }
      expect(bridge.env).toBeUndefined();
      expect(attention.env.CODEX_HOME).toBeUndefined();
      if (args.length) expect(argv.lastIndexOf('-c')).toBeLessThan(argv.indexOf(args[0]));
      expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe(userConfig);
      expect(readdirSync(home)).toEqual(['config.toml']);
      attention.dispose(); bridge.dispose();
    });
  }
  it('keeps user hook/profile conflicts and MCP/instruction conflicts independent', () => {
    writeFileSync(join(home, 'config.toml'), '[hooks]\n');
    expect(local.prepare({ terminalId: 't', args: [], env: { CODEX_HOME: home }, files: { command: '/owned/bridge.mjs' }, platform: 'linux' })).toBeNull();
    const context = { url: 'http://127.0.0.1:41234/mcp', serverName: 'clanker-grid', tokenEnvVar: 'CLANKER_MCP_TOKEN',
      args: ['--profile', 'user'], env: { CODEX_HOME: home }, platform: 'linux' as const, instructions: 'Clanker guidance', scratchDir: () => home };
    expect(codexConfigOverrides(agentBridge.prepare(context)!.args!)).not.toContain('developer_instructions="Clanker guidance"');
    writeFileSync(join(home, 'config.toml'), '[mcp_servers.clanker-grid]\nurl = "https://user.example/mcp"\n');
    expect(agentBridge.prepare(context)).toBeNull();
  });
});
