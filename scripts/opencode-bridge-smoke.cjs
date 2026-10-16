// Installed OpenCode 2.x private server, real Clanker MCP transport and no attention/model call.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pty = require('node-pty');
const { AgentBridgeService, agentBridgeLaunchStep } = require('../dist/main/main/agentBridge/service');
const { prepareLaunchAttachments } = require('../dist/main/main/launchAttachments');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-opencode-bridge-'));
const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'), OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true' };
const main = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: root, kind: 'main' };
const identity = { terminalId: 'opencode-fixture', workspaceId: 'ws', environmentId: 'local', checkoutContextId: main.id, harnessId: 'opencode' };
const service = new AgentBridgeService({
  getRegistry: () => ({ getWorkspace: () => ({ workspaceId: 'ws', location: { environmentId: 'local', path: root } }), getCheckoutContext: () => main }),
  getTerminals: () => new Map([[identity.terminalId, identity]]), version: () => 'fixture',
});
let discoveries = 0, attachment, child;
const listTools = service.listTools.bind(service);
service.listTools = grant => { const tools = listTools(grant); if (tools.some(tool => tool.name === 'clanker_context')) discoveries++; return tools; };
let exited = false;
async function runTui(args, childEnv) {
  child = pty.spawn('opencode', args, { cwd: root, env: { ...childEnv, TERM: 'xterm-256color' }, cols: 100, rows: 36 });
  child.onExit(() => { exited = true; });
  child.onData(data => {
    // Answer terminal capability queries; do not retain or print native output.
    if (data.includes('\x1b[?u')) child.write('\x1b[?0u');
    if (data.includes('\x1b[6n')) child.write('\x1b[1;1R');
    if (data.includes('\x1b[c')) child.write('\x1b[?1;2c');
  });
  const deadline = Date.now() + 30000;
  while (!discoveries) {
    if (exited || Date.now() > deadline) throw new Error(`Native OpenCode MCP discovery missing (exited=${exited})`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
(async () => {
  try {
    const version = execFileSync('opencode', ['--version'], { env, encoding: 'utf8', timeout: 5000 }).trim();
    assert.match(version, /(?:opencode\s+)?v?2\./, 'This native smoke requires OpenCode 2.x');
    // An existing user config source remains intact; the bridge is an additive inline source.
    fs.writeFileSync(path.join(root, 'opencode.json'), JSON.stringify({ mcp: { 'fixture-disabled': { type: 'remote', url: 'http://127.0.0.1:1/mcp', enabled: false } } }));
    const original = fs.readFileSync(path.join(root, 'opencode.json'), 'utf8');
    attachment = await prepareLaunchAttachments({ args: [], env }, [agentBridgeLaunchStep({ service, harness: 'opencode', identity })]);
    assert.deepEqual(attachment.attached, ['agent-bridge']);
    assert.deepEqual(attachment.args, ['--standalone']);
    const token = attachment.env.CLANKER_MCP_TOKEN;
    assert(token && !attachment.env.OPENCODE_CONFIG_CONTENT.includes(token));
    // Start the real TUI and wait for MCP startup. No prompt is ever sent.
    await runTui(attachment.args, { ...env, ...attachment.env });
    assert(discoveries > 0, 'Native server did not authenticate and discover Clanker tools');
    assert.equal(fs.readFileSync(path.join(root, 'opencode.json'), 'utf8'), original);
    await attachment.dispose();
    assert.equal(service.credentials.resolve(token), null);
    console.log(JSON.stringify({ version, attention: 'disabled', nativePrivateServer: 'passed', authenticatedToolDiscovery: 'passed', userConfigUnchanged: 'passed', credentialRevoked: 'passed', modelRequests: 0 }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally {
    if (child) {
      try { child.kill(); } catch { /* already exited */ }
      const deadline = Date.now() + 4000;
      while (!exited && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* no remaining fixture child */ }
    }
    await attachment?.dispose(); await service.shutdown(); fs.rmSync(root, { recursive: true, force: true });
  }
})();
