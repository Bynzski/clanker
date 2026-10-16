// Installed Claude CLI and real Bash/Git, isolated HOME and loopback model fixture (no inference).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { AgentAttentionBroker } = require('../dist/main/main/agentAttentionBroker');
const { createAgentLocationResolver } = require('../dist/main/main/agentLocation');
const { attentionLaunchStep } = require('../dist/main/main/attentionLaunchStep');
const { prepareLaunchAttachments } = require('../dist/main/main/launchAttachments');
const { removeAttentionAdapterFiles } = require('../dist/main/main/agentAttentionAdapters');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-claude-checkout-'));
const main = path.join(root, 'project');
const external = path.join(root, 'external');
fs.mkdirSync(main); fs.mkdirSync(external);
execFileSync('git', ['init', '-b', 'main'], { cwd: main, stdio: 'ignore' });
const context = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: main, kind: 'main' };
const facts = [];
const broker = new AgentAttentionBroker(() => {}, event => {
  const snapshot = broker.snapshot('claude');
  facts.push({ nativeEvent: event.nativeEvent, semantic: event.semantic, verdict: event.verdict,
    location: snapshot?.location?.path === main ? 'main' : snapshot?.location?.path === external ? 'external' : snapshot?.location ? 'other' : 'none',
    context: snapshot?.location?.checkoutContextId === context.id ? 'main' : 'unregistered',
    provenance: snapshot?.locationProvenance?.state });
}, undefined, { resolveLocation: createAgentLocationResolver({ getTerminal: () => ({ workspaceId: 'ws' }), getCheckoutContexts: () => [context] }) });
const commands = ['git worktree list && git branch --list && pwd', `cd '${external}' && pwd`, `cd '${main}' && git worktree list && pwd`];
let requests = 0, results = 0, toolResults = 0, toolErrors = 0, child, attachments;
const server = http.createServer((request, response) => {
  request.resume(); request.on('end', () => {
    if (request.url.includes('count_tokens')) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"input_tokens":1}'); return; }
    const index = requests++;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const tool = index % 2 === 0 && index / 2 < commands.length;
    response.end(event('message_start', { message: { id: `fixture_${index}`, type: 'message', role: 'assistant', content: [], model: 'claude-haiku-4-5', usage: { input_tokens: 1, output_tokens: 0 } } })
      + event('content_block_start', { index: 0, content_block: tool ? { type: 'tool_use', id: `bash_${index}`, name: 'Bash', input: {} } : { type: 'text', text: '' } })
      + event('content_block_delta', { index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify({ command: commands[index / 2], description: 'Inspect disposable checkout fixture' }) } : { type: 'text_delta', text: 'ok' } })
      + event('content_block_stop', { index: 0 })
      + event('message_delta', { delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }) + event('message_stop', {}));
  });
});
async function until(check, label) { const deadline = Date.now() + 30000; while (!check()) { if (Date.now() > deadline) throw new Error(label); await new Promise(resolve => setTimeout(resolve, 30)); } }
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    attachments = await prepareLaunchAttachments({ args: [], env: {} }, [attentionLaunchStep({ broker, harness: 'claude', terminalId: 'claude', enabled: true })]);
    child = spawn('claude', ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--allowedTools', 'Bash', '--model', 'claude-haiku-4-5', '--setting-sources', 'project', ...attachments.args], { cwd: main, env: { PATH: process.env.PATH, HOME: root, CLAUDE_CONFIG_DIR: path.join(root, 'config'), ANTHROPIC_API_KEY: 'fixture', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ...attachments.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', exited = false;
    child.on('exit', () => { exited = true; }); child.stderr.resume(); child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      buffer += chunk; if (buffer.length > 1024 * 1024) { child.kill(); return; }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          const message = JSON.parse(raw);
          if (message.type === 'result') results++;
          if (message.type === 'user' && Array.isArray(message.message?.content)) {
            for (const block of message.message.content) if (block.type === 'tool_result') { toolResults++; if (block.is_error) toolErrors++; }
          }
        } catch { /* no raw output retained */ }
      }
    });
    for (let index = 0; index < commands.length; index++) {
      const previousStops = facts.filter(fact => fact.nativeEvent === 'Stop').length;
      child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: 'Run the fixture command and reply ok.' } }) + '\n');
      await until(() => results > index || exited, 'Claude native result timed out');
      assert(!exited, 'Claude exited before the fixture completed');
      await until(() => facts.filter(fact => fact.nativeEvent === 'Stop').length > previousStops, 'Native Stop missing');
      const snapshot = broker.snapshot('claude');
      assert.equal(snapshot.location?.path, index === 1 ? external : main, `Unexpected location after fixture turn ${index + 1}`);
      assert.equal(snapshot.location?.checkoutContextId, index === 1 ? null : context.id);
      assert.equal(snapshot.locationProvenance?.state, 'current');
    }
    assert.equal(requests, 6, 'Expected one Bash command and final response per turn');
    assert.equal(toolResults, 3, 'Expected all three native Bash results');
    assert.equal(toolErrors, 0, 'Native Bash fixture command failed');
    console.log(JSON.stringify({ nativeCLI: true, model: 'loopback fixture (no inference)', mainGitInventory: 'passed', intentionalExternalMove: 'unregistered (correct)', returnToMain: 'passed', facts }));
  } catch (error) { console.error(error.message); console.error(JSON.stringify({ facts })); process.exitCode = 1; }
  finally {
    child?.kill();
    if (child && child.exitCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1000))]);
    await attachments?.dispose(); broker.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); removeAttentionAdapterFiles(); fs.rmSync(root, { recursive: true, force: true });
  }
})();
