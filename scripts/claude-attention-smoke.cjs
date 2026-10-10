// Installed Claude stream-json CLI, normal attention preparation, loopback Anthropic response fixture.
// No model inference or user configuration. Stop is a candidate, not aggregate settlement evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const { spawn } = require('node:child_process');
const { AgentAttentionBroker } = require('../dist/main/main/agentAttentionBroker');
const { attentionLaunchStep } = require('../dist/main/main/attentionLaunchStep'); const { prepareLaunchAttachments } = require('../dist/main/main/launchAttachments');
const { removeAttentionAdapterFiles } = require('../dist/main/main/agentAttentionAdapters');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-claude-native-'));
let child, attachments, requests = 0, results = 0, failure = false;
const broker = new AgentAttentionBroker(() => {}, () => {});
const server = http.createServer((request, response) => {
  request.resume(); request.on('end', () => {
    if (request.url.includes('count_tokens')) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"input_tokens":1}'); return; }
    requests++;
    if (failure) { response.writeHead(401, { 'Content-Type': 'application/json' }); response.end('{"type":"error","error":{"type":"authentication_error","message":"fixture failure"}}'); return; }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    response.end(event('message_start', { message: { id: 'msg_fixture', type: 'message', role: 'assistant', content: [], model: 'claude-haiku-4-5', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }) + event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) + event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'ok' } }) + event('content_block_stop', { index: 0 }) + event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }) + event('message_stop', {}));
  });
});
async function until(check, label) { const deadline = Date.now() + 20000; while (!check()) { if (Date.now() > deadline) throw new Error(label); await new Promise(resolve => setTimeout(resolve, 30)); } }
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    attachments = await prepareLaunchAttachments({ args: [], env: {} }, [attentionLaunchStep({ broker, harness: 'claude', terminalId: 'claude', enabled: true })]);
    // A separate owned fixture Stop hook blocks exactly once; the attention hook cannot
    // know its decision. Leave all actual user config excluded by the isolated HOME/cwd.
    fs.mkdirSync(path.join(root, '.claude'));
    const blocker = path.join(root, 'stop-fixture.cjs');
    fs.writeFileSync(blocker, `const fs=require('node:fs');const marker=__filename+'.once';if(!fs.existsSync(marker)){fs.writeFileSync(marker,'');console.log(JSON.stringify({decision:'block',reason:'Fixture continuation'}));}else console.log('{}');`);
    fs.writeFileSync(path.join(root, '.claude/settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `${process.execPath} ${blocker}`, timeout: 3 }] }] } }));
    child = spawn('claude', ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'claude-haiku-4-5', '--setting-sources', 'project', ...attachments.args], { cwd: root, env: { PATH: process.env.PATH, HOME: root, CLAUDE_CONFIG_DIR: path.join(root, 'config'), ANTHROPIC_API_KEY: 'fixture', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ...attachments.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', exited = false;
    child.on('exit', () => { exited = true; }); child.stderr.resume(); child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      buffer += chunk; if (buffer.length > 1024 * 1024) { child.kill(); return; }
      let index; while ((index = buffer.indexOf('\n')) >= 0) { const raw = buffer.slice(0, index); buffer = buffer.slice(index + 1); try { if (JSON.parse(raw).type === 'result') results++; } catch { /* no raw output retained */ } }
    });
    for (let i = 0; i < 10; i++) {
      const previousTurn = broker.snapshot('claude')?.runtime.turnId;
      child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply ok.' } }) + '\n');
      await until(() => results > i || exited, 'Claude native result timed out'); assert(!exited, 'Claude exited before repeated turns');
      await until(() => broker.signalDiagnostics('claude')?.hooks['settlement-unverified'] > i, 'Claude native Stop not received');
      assert.notEqual(broker.snapshot('claude').runtime.turnId, previousTurn, 'Claude did not publish a fresh foreground turn');
      assert.equal(broker.snapshot('claude').runtime.status, 'running'); assert.equal(broker.snapshot('claude').lastCompletion, null);
    }
    assert(requests >= 11, 'Separate Claude Stop hook did not continue');
    const beforeFailure = requests; failure = true; child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply ok.' } }) + '\n');
    await until(() => requests > beforeFailure, 'Claude did not reach the fixture failure endpoint');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && results <= 10 && !exited && broker.snapshot('claude').runtime.status !== 'failed') await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(broker.snapshot('claude').lastCompletion, null, 'API failure must never announce Done');
    const stopFailure = broker.snapshot('claude').runtime.status === 'failed' ? 'observed' : 'not emitted within 5 s of fixture authentication error; CLI still waiting';
    console.log(JSON.stringify({ harness: 'claude', nativeCLI: true, model: 'loopback fixture (no inference)', consecutiveTurns: 10, starts: 'accepted native UserPromptSubmit', stop: 'observed native Stop, settlement explicitly unverified', separateStopContinuation: 'passed', stopFailure, requests }));
  } catch (error) { console.error(error.message); console.error(JSON.stringify(broker.signalDiagnostics('claude'))); process.exitCode = 1; }
  finally { child?.kill(); if (child && child.exitCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1000))]); await attachments?.dispose(); broker.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); removeAttentionAdapterFiles(); fs.rmSync(root, { recursive: true, force: true }); }
})();
