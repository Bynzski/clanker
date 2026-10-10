// Installed Pi/OMP CLI + normal Clanker attention preparation + loopback model fixture.
// No real inference, user credentials or user configuration. Run after npm run build.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { AgentAttentionBroker } = require('../dist/main/main/agentAttentionBroker');
const { attentionLaunchStep } = require('../dist/main/main/attentionLaunchStep');
const { prepareLaunchAttachments } = require('../dist/main/main/launchAttachments');
const { removeAttentionAdapterFiles } = require('../dist/main/main/agentAttentionAdapters');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const end = Date.now() + 15000;
  while (!check()) { if (Date.now() > end) throw new Error(label); await pause(25); }
}
async function run(harness) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-native-attention-'));
  const agentDir = path.join(root, 'agent'); fs.mkdirSync(agentDir);
  let mode = 'success', requests = 0, child, attachments, prematureCompletion = false;
  const observed = [], transitions = [];
  const broker = new AgentAttentionBroker(change => { if (change.snapshot) transitions.push({ revision: change.revision, status: change.snapshot.runtime.status, turnId: change.snapshot.runtime.turnId, waiting: !!change.snapshot.pendingRequest }); }, event => observed.push({ semantic: event.semantic, decision: event.decision, nativeEvent: event.nativeEvent }));
  const server = http.createServer((request, response) => {
    request.resume(); request.on('end', () => {
      requests++;
      if (harness === 'omp' && requests === 2) prematureCompletion = observed.some(event => event.semantic === 'turn_completed');
      if (mode === 'hold') return; // abort test; server shutdown destroys its connection
      if (mode === 'wait-tool') {
        mode = 'success'; response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'tiny', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-wait', type: 'function', function: { name: 'smoke_wait', arguments: '{}' } }] }, finish_reason: null }] }) + '\n\ndata: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }) + '\n\ndata: [DONE]\n\n'); return;
      }
      if (mode === 'error') { response.writeHead(401, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'fixture failure', type: 'authentication_error' } })); return; }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'tiny', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] }) + '\n\ndata: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'tiny', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + '\n\ndata: [DONE]\n\n');
    });
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    fs.writeFileSync(path.join(agentDir, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'tiny', name: 'fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 128 }] } } }));
    fs.writeFileSync(path.join(agentDir, 'settings.json'), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
    attachments = await prepareLaunchAttachments({ args: [], env: {} }, [attentionLaunchStep({ broker, harness, terminalId: harness, enabled: true })]);
    assert(attachments.provided.has('native-attention'));
    const env = { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: agentDir, PI_CONFIG_DIR: '.omp', XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), ...attachments.env };
    const testExtension = path.join(root, 'fixture.ts');
    fs.writeFileSync(testExtension, harness === 'pi'
      ? `export default function(pi) { pi.registerTool({ name:'smoke_wait',label:'Fixture wait',description:'Fixture wait',parameters:{type:'object',properties:{}},async execute(id,args,signal,update,ctx) { await ctx.ui.confirm('fixture','fixture'); return {content:[{type:'text',text:'ok'}],details:{}}; } }); }`
      : `let first=true; export default function(omp) { omp.on('session_stop',()=>{ if(first) {first=false;return {decision:'block',reason:'Fixture continuation'};} }); }`);
    child = spawn(harness, ['--mode', 'rpc', '--provider', 'fixture', '--model', 'tiny', '--no-extensions', '--no-skills', '--session-dir', path.join(root, 'sessions'), '--extension', testExtension, ...attachments.args], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let seq = 0, buffer = '', fatal = false, pendingUI; const responses = new Map();
    child.on('error', () => { fatal = true; }); child.on('exit', () => { fatal = true; });
    // Never print native output: it can contain system prompts, even in a fixture.
    child.stderr.resume();
    child.stdout.on('data', chunk => {
      buffer += chunk.toString(); if (buffer.length > 1024 * 1024) { fatal = true; child.kill(); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try { const event = JSON.parse(raw); if (event.type === 'response' && event.id) responses.set(event.id, event); if (event.type === 'extension_ui_request') pendingUI = event; } catch { /* non-protocol startup line */ }
      }
    });
    const command = async (type, fields = {}) => {
      const id = String(++seq); child.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n');
      await until(() => fatal || responses.has(id), `${harness}: ${type} response timeout`);
      assert(!fatal, `${harness}: process exited`); const response = responses.get(id); responses.delete(id);
      assert(response.success, `${harness}: ${type} rejected`); return response.data;
    };
    await command('get_state');
    for (let turn = 0; turn < 10; turn++) {
      const starts = observed.filter(event => event.semantic === 'turn_started' && event.decision === 'accepted').length;
      const before = transitions.length;
      await command('prompt', { message: 'Reply ok.' });
      await until(() => observed.filter(event => event.semantic === 'turn_started' && event.decision === 'accepted').length > starts && broker.snapshot(harness)?.runtime.status === 'idle', `${harness}: repeated turn ${turn + 1} did not settle`);
      const running = transitions.slice(before).find(change => change.status === 'running');
      assert(running, `${harness}: turn ${turn + 1} never published Running`);
      assert.equal(broker.snapshot(harness).lastCompletion.turnId, running.turnId);
      assert(broker.snapshot(harness).lastCompletion.revision > running.revision);
    }
    if (harness === 'omp') {
      assert(requests >= 11, 'OMP fixture Stop hook did not actually continue');
      assert(!prematureCompletion, 'OMP completed before stop-hook continuation');
    }
    if (harness === 'pi') {
      mode = 'wait-tool'; await command('prompt', { message: 'Use smoke_wait.' });
      await until(() => pendingUI && broker.snapshot(harness)?.pendingRequest, 'Pi native UI prompt did not show Needs Input');
      const resolvedAfter = transitions.length;
      child.stdin.write(JSON.stringify({ type: 'extension_ui_response', id: pendingUI.id, confirmed: true }) + '\n');
      await until(() => broker.snapshot(harness)?.runtime.status === 'idle' && !broker.snapshot(harness)?.pendingRequest, 'Pi UI resolution did not settle');
      assert(transitions.slice(resolvedAfter).some(change => change.status === 'running' && !change.waiting), 'Pi UI resolution did not publish Running');
    }
    const priorFile = (await command('get_state')).sessionFile;
    assert(priorFile, 'Native runtime did not persist fixture session');
    const old = broker.snapshot(harness).sessionId;
    await command('new_session');
    await command('prompt', { message: 'Reply ok.' });
    await until(() => broker.snapshot(harness)?.sessionId !== old && broker.snapshot(harness)?.runtime.status === 'idle', `${harness}: new session lost tracking`);
    await command('switch_session', { sessionPath: priorFile });
    await command('prompt', { message: 'Reply ok.' });
    await until(() => broker.snapshot(harness)?.sessionId === old && broker.snapshot(harness)?.runtime.status === 'idle', `${harness}: resume lost tracking`);
    if (harness === 'pi') {
      const entries = await command('get_fork_messages');
      await command('fork', { entryId: entries.messages[0].entryId });
      await command('prompt', { message: 'Reply ok.' });
      await until(() => broker.snapshot(harness)?.sessionId !== old && broker.snapshot(harness)?.runtime.status === 'idle', 'Pi fork lost tracking');
    }
    mode = 'error'; await command('prompt', { message: 'Reply ok.' });
    await until(() => broker.snapshot(harness)?.runtime.status === 'failed', `${harness}: error incorrectly settled`);
    assert.equal(broker.snapshot(harness).lastOutcome.kind, 'failed');
    mode = 'hold'; const before = requests; await command('prompt', { message: 'Reply ok.' });
    await until(() => requests > before && broker.snapshot(harness)?.runtime.status === 'running', `${harness}: abort turn did not start`);
    await command('abort');
    await until(() => broker.snapshot(harness)?.lastOutcome?.kind === 'interrupted', `${harness}: abort incorrectly settled`);
    console.log(JSON.stringify({ harness, nativeCLI: true, model: 'loopback fixture (no inference)', consecutiveTurns: 10, newSession: 'passed', resume: 'passed', fork: harness === 'pi' ? 'passed' : 'not exercised', wait: harness === 'pi' ? 'native UI confirmed/resolved' : 'no native wait subscription', stopContinuation: harness === 'omp' ? 'passed' : 'not exercised', failedTurn: 'passed', interruptedTurn: 'passed', signals: [...new Set(observed.map(event => event.nativeEvent).filter(Boolean))] }));
  } finally {
    child?.kill(); if (child && child.exitCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(1000)]);
    await attachments?.dispose(); broker.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
  }
}
(async () => { try { for (const harness of process.argv.slice(2).length ? process.argv.slice(2) : ['pi', 'omp']) await run(harness); } finally { removeAttentionAdapterFiles(); } })().catch(error => { console.error(error.message); process.exitCode = 1; });
