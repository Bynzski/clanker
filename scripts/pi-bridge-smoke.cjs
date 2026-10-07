/** Optional no-model interoperability check: npm run build, then node scripts/pi-bridge-smoke.cjs <pi package directory>. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { AgentBridgeService, agentBridgeLaunchStep, AGENT_BRIDGE_TOKEN_ENV } = require('../dist/main/main/agentBridge/service');
const { prepareLaunchAttachments } = require('../dist/main/main/launchAttachments');

async function main() {
  const packageDir = process.argv[2];
  if (!packageDir) throw new Error('Pass the installed Pi package directory (verified with 1.0.4)');
  const sdk = await import(pathToFileURL(path.join(packageDir, 'dist/index.js')).href);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-pi-smoke-'));
  const agentDir = path.join(root, 'agent');
  fs.mkdirSync(agentDir);
  const ctx = { id: 'smoke::main', workspaceId: 'smoke', environmentId: 'local', path: root, kind: 'main' };
  const workspace = { workspaceId: 'smoke', location: { environmentId: 'local', path: root } };
  const service = new AgentBridgeService({
    getRegistry: () => ({ getWorkspace: () => workspace, getCheckoutContext: () => ctx }),
    getTerminals: () => new Map([['smoke-terminal', { workspaceId: 'smoke', checkoutContextId: ctx.id, harnessId: 'pi', cwd: root }]]),
    version: () => 'smoke',
  });
  let prepared;
  let session;
  const previousToken = process.env[AGENT_BRIDGE_TOKEN_ENV];
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    prepared = await prepareLaunchAttachments({ args: [], env: {} }, [agentBridgeLaunchStep({ service, harness: 'pi', identity: {
      terminalId: 'smoke-terminal', workspaceId: 'smoke', environmentId: 'local', checkoutContextId: ctx.id, harnessId: 'pi',
    } })]);
    const serviceUrl = JSON.parse(fs.readFileSync(prepared.args.at(-1), 'utf8').match(/pi\.registerMcpServer\(.*?, (\{.*\})\);/)[1]).url;
    process.env[AGENT_BRIDGE_TOKEN_ENV] = prepared.env[AGENT_BRIDGE_TOKEN_ENV];
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const settingsManager = sdk.SettingsManager.inMemory({ extensions: ['+builtin:mcp'] });
    const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir, settingsManager,
      extensionFactories: [{ name: 'mcp', factory: sdk.createMcpExtension(), builtin: true }],
      additionalExtensionPaths: [prepared.args.at(-1)], noSkills: true, noPromptTemplates: true, noThemes: true });
    await loader.reload();
    ({ session } = await sdk.createAgentSession({ cwd: root, agentDir, settingsManager, resourceLoader: loader,
      sessionManager: sdk.SessionManager.inMemory(root) }));
    await session.bindExtensions({});
    const name = 'mcp__clanker_grid__clanker_context';
    const deadline = Date.now() + 15_000;
    while (!session.getAllTools().some((tool) => tool.name === name) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const descriptor = session.getAllTools().find((tool) => tool.name === name);
    assert.ok(descriptor, 'Pi must discover clanker_context with the generated extension');
    assert.equal(descriptor.annotations.readOnlyHint, true);
    assert.deepEqual(session.getAllTools().filter((tool) => tool.name.startsWith('mcp__clanker_grid__')).map((tool) => tool.name), [name]);
    // Execute the native tool wrapper directly; no inference request or model credentials needed.
    const tool = session.agent.state.tools.find((tool) => tool.name === name);
    assert.ok(tool, 'direct exposure must activate the tool');
    const result = await tool.execute('smoke-call', {}, new AbortController().signal);
    assert.equal(JSON.parse(result.content[0].text).agent.harness, 'pi');
    session.dispose();
    session = undefined;
    // Real Pi checks its own restrictions and normalized configured-server precedence.
    for (const scenario of ['excluded', 'restricted', 'disabled', 'replaced', 'configured-conflict', 'extension-conflict']) {
      const configFile = path.join(agentDir, 'mcp.json');
      const userConfig = JSON.stringify({ mcpServers: { clanker_grid: { url: 'http://127.0.0.1:1/mcp', enabled: false } } });
      if (scenario === 'configured-conflict') fs.writeFileSync(configFile, userConfig);
      const scenarioLoader = new sdk.DefaultResourceLoader({ cwd: root, agentDir, settingsManager,
        extensionFactories: [{ name: 'mcp', factory: sdk.createMcpExtension(), builtin: true, replaceable: true },
          ...(scenario === 'replaced' ? [(pi) => pi.registerCommand('mcp', { handler: async () => {} })] : []),
          ...(scenario === 'extension-conflict' ? [(pi) => pi.registerMcpServer('clanker_grid', { url: 'http://127.0.0.1:1/mcp', enabled: false })] : [])],
        additionalExtensionPaths: [prepared.args.at(-1)],
        disabledBuiltinExtensions: scenario === 'disabled' ? ['mcp'] : [], noSkills: true, noPromptTemplates: true, noThemes: true });
      await scenarioLoader.reload();
      ({ session } = await sdk.createAgentSession({ cwd: root, agentDir, settingsManager, resourceLoader: scenarioLoader,
        ...(scenario === 'excluded' ? { excludeTools: ['mcp__clanker_grid__*'] } : {}),
        ...(scenario === 'restricted' ? { tools: ['read', 'mcp__other__*'] } : {}),
        sessionManager: sdk.SessionManager.inMemory(root) }));
      await session.bindExtensions({});
      // Connections are asynchronous. Wait for native discovery (or a bounded absence check).
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.ok(!session.getActiveToolNames().includes(name), scenario + ' must not activate Clanker tools');
      if (scenario === 'configured-conflict') {
        assert.equal(fs.readFileSync(configFile, 'utf8'), userConfig);
        fs.unlinkSync(configFile);
      }
      session.dispose(); session = undefined;
    }
    await prepared.dispose();
    assert.equal(service.credentials.resolve(prepared.env[AGENT_BRIDGE_TOKEN_ENV]), null);
    const revoked = await fetch(serviceUrl, { method: 'POST', headers: {
      Authorization: 'Bearer ' + prepared.env[AGENT_BRIDGE_TOKEN_ENV],
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(revoked.status, 401);
    assert.equal(fs.existsSync(prepared.args.at(-1)), false);
    console.log('Pi bridge smoke passed: discovery, annotations, authenticated context, context-only grant, disabled/replaced MCP, normalized conflicts, tool restrictions, revocation, scratch cleanup; no model call.');
  } finally {
    if (session) session.dispose();
    if (prepared) await prepared.dispose();
    await service.shutdown();
    if (previousToken === undefined) delete process.env[AGENT_BRIDGE_TOKEN_ENV]; else process.env[AGENT_BRIDGE_TOKEN_ENV] = previousToken;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
