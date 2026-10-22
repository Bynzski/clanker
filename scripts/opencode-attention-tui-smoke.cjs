// Installed OpenCode 2.x TUI, real PTY and normal Clanker attention preparation.
// Disposable HOME/config/repository, loopback model only; no paid inference.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const pty = require('node-pty');
const { createSmokeOwner, cleanupSmokeFixture } = require('./lib/smoke-fixture-cleanup.cjs');
const repo = path.resolve(__dirname, '..');
// This manual native smoke runs AFTER build; CI's pre-build source analysis has no dist/.
// Resolve only these fixed generated modules at runtime, without adding baseline exemptions.
const requireBuilt = require('node:module').createRequire(path.join(repo, 'dist/main/main/main.js'));
const { AgentAttentionBroker } = requireBuilt('./agentAttentionBroker');
const { attentionLaunchStep } = requireBuilt('./attentionLaunchStep');
const { prepareLaunchAttachments } = requireBuilt('./launchAttachments');
const { removeAttentionAdapterFiles } = requireBuilt('./agentAttentionAdapters');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-opencode-tui-'));
const owner = createSmokeOwner();
const env = { PATH: process.env.PATH, HOME: path.join(root, 'home'),
  XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'),
  XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true',
  [owner.key]: owner.value };
const facts = [], transitions = [], toolNames = new Set();
const broker = new AgentAttentionBroker(change => {
  if (change.snapshot) transitions.push({ status: change.snapshot.runtime.status,
    waiting: Boolean(change.snapshot.pendingRequest), revision: change.revision });
}, event => facts.push({ semantic: event.semantic, verdict: event.verdict, nativeEvent: event.nativeEvent }));
const evidencePath = path.join(root, 'native.jsonl');
const evidence = () => fs.existsSync(evidencePath) ? fs.readFileSync(evidencePath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, exited = false, attachments, stage = 'startup', mode = 'success', requests = 0, passed = false, output = '';
const snapshot = () => broker.snapshot('opencode-fixture');
async function until(check, label) {
  const deadline = Date.now() + 30000;
  while (!await check()) { if (exited) throw new Error('Fixture TUI exited'); if (Date.now() > deadline) throw new Error(label); await pause(50); }
}
function completion(response, tool) {
  const chunk = (delta, finish_reason = null) => 'data: ' + JSON.stringify({ id: `fixture_${requests}`, object: 'chat.completion.chunk', model: 'tiny', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n';
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(chunk(tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_${requests}`, type: 'function', function: tool }] } : { role: 'assistant', content: 'ok' })
    + chunk({}, tool ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n');
}
const model = http.createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; if (body.length > 2 * 1024 * 1024) request.destroy(); });
  request.on('end', () => {
    requests++;
    let input;
    try { input = JSON.parse(body); } catch { response.writeHead(400); response.end(); return; }
    const tools = input.tools?.map(tool => tool.function?.name ?? tool.name) ?? [];
    for (const name of tools) toolNames.add(name);
    if (mode === 'hold' && tools.length) return;
    if ((mode === 'approval' && tools.includes('shell')) || (mode === 'question' && tools.includes('question'))) {
      const approval = mode === 'approval'; mode = 'success';
      completion(response, { name: approval ? 'shell' : 'question', arguments: JSON.stringify(approval
        ? { command: 'printf fixture', description: 'Read-only fixture command' }
        : { questions: [{ header: 'Fixture', question: 'Continue?', options: [{ label: 'Yes', description: 'Continue fixture' }] }] }) });
      return;
    }
    completion(response);
  });
});
async function stopTui() {
  if (child && !exited) { try { child.kill(); } catch { /* already gone */ } }
  const deadline = Date.now() + 2000;
  while (child && !exited && Date.now() < deadline) await pause(25);
  await cleanupSmokeFixture({ repo, owner, workspaceRoots: [root] });
  child = undefined;
}
async function launch(args = [], rootSessionId) {
  exited = false;
  attachments = await prepareLaunchAttachments({ args, env }, [attentionLaunchStep({ broker,
    harness: 'opencode', terminalId: 'opencode-fixture', enabled: true, rootSessionId })]);
  assert(attachments.provided.has('native-attention'));
  assert(attachments.args.includes('--standalone'));
  const ready = evidence().filter(event => event.type === 'fixture.ready').length;
  child = pty.spawn('opencode', attachments.args, { cwd: root, env: { ...env, ...attachments.env, TERM: 'xterm-256color' }, cols: 120, rows: 40, handleFlowControl: false });
  child.onExit(() => { exited = true; });
  child.onData(data => {
    output = (output + data).slice(-65536); // Private fixture-only troubleshooting; never lifecycle evidence.
    if (data.includes('\x1b[?u')) child.write('\x1b[?0u');
    if (data.includes('\x1b[6n')) child.write('\x1b[1;1R');
    if (data.includes('\x1b[c')) child.write('\x1b[?1;2c');
  });
  await until(() => evidence().filter(event => event.type === 'fixture.ready').length > ready, 'Native plugin startup missing');
  await pause(1000);
}
const send = text => child.write(text + '\r');
async function turn(label) {
  stage = label;
  const before = transitions.length;
  send('Reply ok.');
  await until(() => transitions.slice(before).some(change => change.status === 'running') && snapshot()?.runtime.status === 'idle', 'Native turn did not settle');
  assert(snapshot().lastCompletion);
  assert.equal(snapshot().locationProvenance?.state, 'current');
}
async function run() {
  try {
    const version = execFileSync('opencode', ['--version'], { env, encoding: 'utf8', timeout: 5000 }).trim();
    assert.match(version, /(?:opencode\s+)?v?2\./);
    for (const name of ['home', 'config', 'data', 'cache', 'state']) fs.mkdirSync(path.join(root, name), { recursive: true });
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, env, stdio: 'ignore' });
    await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
    // A second read-only native plugin captures bounded event names/opaque refs, never payloads.
    const observer = path.join(root, 'native-observer'); fs.mkdirSync(observer);
    fs.writeFileSync(path.join(observer, 'package.json'), JSON.stringify({ name: 'clanker-fixture', type: 'module', main: 'index.js' }));
    fs.writeFileSync(path.join(observer, 'index.js'), `import fs from 'node:fs';
const file=${JSON.stringify(evidencePath)};
export default { id:'clanker-fixture', setup(ctx) {
 const controller=new AbortController(); let count=0;
 fs.appendFileSync(file,JSON.stringify({type:'fixture.ready'})+'\\n');
 (async()=>{ for await(const event of ctx.event.subscribe({signal:controller.signal})) {
  if(count++>256) break;
  if(!/^(session\\.(created|execution\\.)|permission\\.|form\\.)/.test(event.type)) continue;
  fs.appendFileSync(file,JSON.stringify({type:event.type,sessionID:event.data.sessionID??event.data.form?.sessionID})+'\\n');
 } })().catch(()=>{});
 return ()=>controller.abort();
} };`);
    const config = { model: 'fixture/tiny', update: 'disable', share: 'disabled', snapshots: false, warming: false,
      permissions: [{ action: '*', resource: '*', effect: 'allow' }, { action: 'shell', resource: '*', effect: 'ask' }],
      providers: { fixture: { package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'fixture' },
        models: { tiny: { name: 'Fixture', limit: { context: 32768, output: 128 } } } } }, plugins: [observer] };
    const configPath = path.join(root, 'opencode.json'); fs.writeFileSync(configPath, JSON.stringify(config));
    const originalConfig = fs.readFileSync(configPath, 'utf8');
    await launch();
    for (let index = 0; index < 10; index++) await turn(`turn ${index + 1}`);
    const originalSession = snapshot().sessionId;
    stage = 'permission'; mode = 'approval'; send('Run the fixture command.');
    await until(() => snapshot()?.pendingRequest?.kind === 'approval', 'Permission did not show Needs Input');
    const permissionResolved = transitions.length;
    await pause(300); child.write('\r');
    await until(() => snapshot()?.runtime.status === 'idle' && !snapshot()?.pendingRequest, 'Permission reply did not settle');
    assert(transitions.slice(permissionResolved).some(change => change.status === 'running' && !change.waiting), 'Permission resolution missed Running');
    stage = 'question'; mode = 'question'; send('Ask the fixture question.');
    await until(() => snapshot()?.pendingRequest?.kind === 'input', 'Question did not show Needs Input');
    const questionResolved = transitions.length;
    await pause(300); child.write('\r');
    await until(() => snapshot()?.runtime.status === 'idle' && !snapshot()?.pendingRequest, 'Question reply did not settle');
    assert(transitions.slice(questionResolved).some(change => change.status === 'running' && !change.waiting), 'Question resolution missed Running');
    stage = 'interrupt'; mode = 'hold'; const before = requests; send('Reply ok.');
    await until(() => requests > before && snapshot()?.runtime.status === 'running', 'Abort turn did not start');
    child.write('\x1b'); await pause(150); child.write('\x1b');
    await until(() => snapshot()?.lastOutcome?.kind === 'interrupted', 'Esc did not interrupt');
    mode = 'success'; await turn('after interrupt');
    stage = 'new session'; child.write('/new'); await pause(300); child.write('\r'); await pause(1000);
    await turn('after /new');
    assert.notEqual(snapshot().sessionId, originalSession, 'New root was not selected');
    await turn('second turn after /new');
    assert(!facts.some(event => event.verdict === 'rejected-mismatch'), 'Native selected session was rejected');
    await stopTui(); await attachments.dispose();
    stage = 'resume'; await launch(['--session', originalSession], originalSession);
    await turn('resumed session'); assert.equal(snapshot().sessionId, originalSession);
    const credential = attachments.env.CLANKER_ATTENTION_TOKEN;
    await stopTui(); await attachments.dispose();
    assert.equal(broker.receive(JSON.stringify({ version: 1, token: credential, harness: 'opencode', scope: 'root', event: 'session_ended', sessionId: originalSession })), 'rejected-auth');
    assert.equal(fs.readFileSync(configPath, 'utf8'), originalConfig);
    console.log(JSON.stringify({ version, nativeTui: true, realPty: true, model: 'loopback fixture (no inference)', repeatedTurns: 10,
      permission: 'passed', question: 'passed', interrupt: 'passed', newSession: 'passed', resume: 'passed', credentialRevoked: 'passed', userConfigUnchanged: 'passed', requests }));
    passed = true;
  } catch (error) {
    console.error(JSON.stringify({ stage, requests, toolNames: [...toolNames], facts: facts.slice(-20), nativeEvents: evidence().slice(-20).map(event => event.type) }));
    fs.writeFileSync(path.join(root, 'private-output.txt'), output, { mode: 0o600 });
    throw error;
  } finally {
    await stopTui(); await attachments?.dispose(); broker.close(); removeAttentionAdapterFiles();
    await cleanupSmokeFixture({ repo, owner, workspaceRoots: [root], servers: [model] });
    if (passed) fs.rmSync(root, { recursive: true, force: true });
    else console.error(`Private failed fixture retained: ${root}`);
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
