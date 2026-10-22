// Installed Claude interactive TUI, real PTY/hooks/broker, isolated HOME and loopback model.
// Never parses terminal output as lifecycle evidence; no paid inference or user config.
const assert = require('node:assert/strict');
assert.equal(process.platform, 'linux', 'This native smoke requires Linux for verified fixture process cleanup');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const pty = require('node-pty');
const { createSmokeOwner, cleanupSmokeFixture } = require('./lib/smoke-fixture-cleanup.cjs');
const { anthropicStream } = require('./lib/anthropic-stream-fixture.cjs');
const repo = path.resolve(__dirname, '..');
// Manual native smokes require build; source-only CI must not resolve static dist imports.
const requireBuilt = require('node:module').createRequire(path.join(repo, 'dist/main/main/main.js'));
const { AgentAttentionBroker } = requireBuilt('./agentAttentionBroker');
const { attentionLaunchStep } = requireBuilt('./attentionLaunchStep');
const { prepareLaunchAttachments } = requireBuilt('./launchAttachments');
const { removeAttentionAdapterFiles } = requireBuilt('./agentAttentionAdapters');
const { CLAUDE_HOOK_EVENTS } = requireBuilt('./harnesses/claude/attention');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-claude-tui-'));
const owner = createSmokeOwner();
for (const name of ['home', 'config', 'cache', 'data', 'claude', '.claude']) fs.mkdirSync(path.join(root, name));
const env = { PATH: process.env.PATH, HOME: path.join(root, 'home'),
  XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'),
  CLAUDE_CONFIG_DIR: path.join(root, 'claude'), ANTHROPIC_API_KEY: 'fixture',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', [owner.key]: owner.value };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const nativeFile = path.join(root, 'native.jsonl');
const native = () => {
  if (!fs.existsSync(nativeFile)) return [];
  if (fs.statSync(nativeFile).size > 256 * 1024) throw new Error('Native fixture evidence exceeded 256 KiB');
  return fs.readFileSync(nativeFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
};
const facts = [], transitions = [];
let unsafeStop = false;
const broker = new AgentAttentionBroker(change => {
  if (change.snapshot) {
    transitions.push({ status: change.snapshot.runtime.status, waiting: Boolean(change.snapshot.pendingRequest), revision: change.revision });
    if (change.snapshot.runtime.status === 'provisional' && (change.snapshot.lastCompletion !== null || broker.canHandoff('claude-fixture'))) unsafeStop = true;
  }
}, event => facts.push({ semantic: event.semantic, verdict: event.verdict, nativeEvent: event.nativeEvent }));
const snapshot = () => broker.snapshot('claude-fixture');
let child, attachments, exited = false, passed = false, stage = 'startup', output = '', mode = 'success', requests = 0, cancelled = 0;
const toolNames = new Set();
const model = http.createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; if (body.length > 2 * 1024 * 1024) request.destroy(); });
  request.on('error', () => {}); // Expected when rejecting an oversized/aborted fixture request.
  response.on('error', () => {});
  request.on('end', () => {
    if ((request.url ?? '').includes('count_tokens')) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"input_tokens":1000}'); return; }
    requests++;
    if (requests > 96) { response.writeHead(503); response.end(); return; }
    let input;
    try { input = JSON.parse(body); } catch { response.writeHead(400); response.end(); return; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) { response.writeHead(400); response.end(); return; }
    const names = Array.isArray(input.tools) ? input.tools.filter(tool => tool && typeof tool.name === 'string').map(tool => tool.name) : [];
    names.forEach(name => toolNames.add(name));
    if (mode === 'hold' && names.length) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.flushHeaders();
      response.on('close', () => { if (!response.writableEnded) cancelled++; });
      return;
    }
    let content;
    if (mode === 'approval' && names.includes('Bash')) {
      mode = 'success'; content = [{ type: 'tool_use', id: `fixture_bash_${requests}`, name: 'Bash',
        input: { command: 'printf fixture', description: 'Read-only disposable fixture command' } }];
    } else if (mode === 'question' && names.includes('AskUserQuestion')) {
      mode = 'success'; content = [{ type: 'tool_use', id: `fixture_question_${requests}`, name: 'AskUserQuestion',
        input: { questions: [{ header: 'Fixture', question: 'Continue the disposable fixture?',
          options: [{ label: 'Yes', description: 'Continue fixture' }, { label: 'No', description: 'Stop fixture' }], multiSelect: false }] } }];
    } else if (stage === 'compact') content = [{ type: 'text', text: 'The fixture conversation requested deterministic checks. Continue using only the disposable fixture and reply ok.' }];
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(anthropicStream({ id: `msg_fixture_${requests}`, content }));
  });
});
async function until(check, label) {
  const deadline = Date.now() + 30000;
  while (!await check()) { if (exited) throw new Error('Fixture Claude exited'); if (Date.now() > deadline) throw new Error(label); await pause(50); }
}
const count = name => native().filter(event => event.event === name).length;
const send = async text => { child.write(text); await pause(100); child.write('\r'); };
async function stopped(after) {
  await until(() => count('Stop') > after && snapshot()?.runtime.status === 'provisional', 'Native provisional Stop missing');
  assert.equal(snapshot().lastCompletion, null, 'Claude Stop must never prove completion');
  assert.equal(broker.canHandoff('claude-fixture'), false);
}
async function turn(label) {
  stage = label;
  const stops = count('Stop'), before = transitions.length, previousTurn = snapshot()?.runtime.turnId;
  await send('Reply ok.');
  await stopped(stops);
  assert(transitions.slice(before).some(value => value.status === 'running'), 'Native turn did not publish Running');
  assert.notEqual(snapshot().runtime.turnId, previousTurn, 'Native prompt did not start a fresh turn');
}
async function run() {
  const errors = [];
  try {
    const version = execFileSync('claude', ['--version'], { env, encoding: 'utf8', timeout: 5000 }).trim();
    assert.match(version, /^\d+\.\d+\.\d+ \(Claude Code\)$/);
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, env, stdio: 'ignore' });
    const preferences = { hasCompletedOnboarding: true, theme: 'dark', customApiKeyResponses: { approved: ['fixture'], rejected: [] },
      projects: { [root]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true, projectOnboardingSeenCount: 1 } } };
    for (const file of [path.join(root, 'home/.claude.json'), path.join(root, 'claude/.claude.json')]) fs.writeFileSync(file, JSON.stringify(preferences), { mode: 0o600 });
    const observer = path.join(root, 'native-hook.cjs');
    fs.writeFileSync(observer, `const fs=require('node:fs');let raw='';process.stdin.on('data',chunk=>{raw+=chunk;if(raw.length>65536)process.exit(1);});process.stdin.on('end',()=>{const input=JSON.parse(raw);const row={event:process.argv[2],session:input.session_id,turn:input.prompt_id,source:input.source,tool:input.tool_name,child:Boolean(input.agent_id),bashFixtureOutput:input.tool_name==='Bash'&&input.tool_response?.stdout?.trim()==='fixture',questionFixtureAnswer:input.tool_name==='AskUserQuestion'&&input.tool_response?.answers?.['Continue the disposable fixture?']==='Yes'};const file=${JSON.stringify(nativeFile)};if(fs.existsSync(file)&&fs.statSync(file).size>250*1024)process.exit(1);fs.appendFileSync(file,JSON.stringify(row)+'\\n',{mode:0o600});console.log('{}');});`);
    // Fixture-only PostToolUse checks the two fixed tool results, never resolves broker waits.
    const hooks = Object.fromEntries([...CLAUDE_HOOK_EVENTS, 'PreCompact', 'PostCompact', 'PostToolUse', 'PostToolUseFailure'].map(name => [name,
      [{ hooks: [{ type: 'command', command: process.execPath, args: [observer, name], timeout: 5 }] }]]));
    const settings = { permissions: { ask: ['Bash'] }, hooks };
    const settingsFile = path.join(root, '.claude/settings.json'); fs.writeFileSync(settingsFile, JSON.stringify(settings));
    const original = fs.readFileSync(settingsFile, 'utf8');
    await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${model.address().port}`;
    attachments = await prepareLaunchAttachments({ args: ['--model', 'claude-haiku-4-5', '--setting-sources', 'project', '--tools', 'Bash,AskUserQuestion'], env },
      [attentionLaunchStep({ broker, harness: 'claude', terminalId: 'claude-fixture', enabled: true })]);
    assert(attachments.provided.has('native-attention'));
    child = pty.spawn('claude', attachments.args, { cwd: root, env: { ...env, ...attachments.env, TERM: 'xterm-256color' }, cols: 120, rows: 40, handleFlowControl: false });
    child.onExit(() => { exited = true; });
    child.onData(data => {
      output = (output + data).slice(-65536); // Fixture-only troubleshooting, never lifecycle authority.
      if (data.includes('\x1b[?u')) child.write('\x1b[?0u');
      if (data.includes('\x1b[6n')) child.write('\x1b[1;1R');
      if (data.includes('\x1b[c')) child.write('\x1b[?1;2c');
    });
    await until(() => count('SessionStart') > 0, 'Native SessionStart missing');
    await pause(600);
    if (process.argv.includes('--fail-after-launch')) throw new Error('Intentional fixture failure after Claude startup');
    for (let index = 0; index < 10; index++) await turn(`turn ${index + 1}`);
    const session = snapshot().sessionId;
    stage = 'approval'; mode = 'approval'; let stops = count('Stop');
    await send('Run the fixture command.');
    await until(() => snapshot()?.pendingRequest?.kind === 'approval', 'Native permission wait missing');
    const permissionResolved = transitions.length;
    await pause(300); child.write('\r');
    await stopped(stops);
    assert.equal(snapshot().pendingRequest, null);
    assert(transitions.slice(permissionResolved).some(value => value.status === 'running' && !value.waiting), 'Permission batch did not restore Running');
    assert(native().some(event => event.event === 'PostToolUse' && event.bashFixtureOutput), 'Approved native Bash did not return the expected fixture output');
    stage = 'question'; mode = 'question'; stops = count('Stop');
    await send('Ask the fixture question.');
    await until(() => snapshot()?.pendingRequest?.kind === 'input', 'Native AskUserQuestion wait missing');
    const questionResolved = transitions.length;
    await pause(300); child.write('\r');
    await stopped(stops);
    assert.equal(snapshot().pendingRequest, null);
    assert(transitions.slice(questionResolved).some(value => value.status === 'running' && !value.waiting), 'Question batch did not restore Running');
    assert(native().some(event => event.event === 'PostToolUse' && event.questionFixtureAnswer), 'Native question did not record the fixture answer');
    stage = 'compact'; const compacts = count('PostCompact');
    child.write('/compact'); await pause(300); child.write('\r');
    await until(() => count('PostCompact') > compacts && native().some(event => event.event === 'SessionStart' && event.source === 'compact'), 'Native compaction boundary missing');
    assert.equal(snapshot().sessionId, session, 'Compaction changed the bound native session');
    assert(native().filter(event => event.event === 'SessionStart' && event.source === 'compact').every(event => event.session === session), 'Native compact session identity changed');
    assert.equal(snapshot().lastCompletion, null);
    await turn('after compaction');
    stage = 'interrupt'; mode = 'hold'; const beforeCancelled = cancelled, beforeRequests = requests, beforeInterruptFacts = facts.length;
    await send('Reply ok.');
    await until(() => requests > beforeRequests && snapshot()?.runtime.status === 'running', 'Held turn did not start');
    child.write('\x1b');
    await until(() => cancelled > beforeCancelled, 'Native Esc did not cancel fixture HTTP work');
    await pause(1000);
    assert.equal(snapshot().lastCompletion, null, 'Interrupt must never announce Done');
    const interruptResult = { brokerStatus: snapshot().runtime.status,
      nativeEvents: [...new Set(facts.slice(beforeInterruptFacts).map(event => event.nativeEvent).filter(Boolean))],
      observationWindowMs: 1000, nativeHttpCancellation: true, provenCompletion: false };
    mode = 'success'; await turn('after interrupt');
    assert.equal(unsafeStop, false, 'A candidate Stop announced completion or authorized handoff');
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), original);
    const token = attachments.env.CLANKER_ATTENTION_TOKEN;
    await attachments.dispose();
    assert.equal(broker.receive(JSON.stringify({ version: 1, token, harness: 'claude', scope: 'root', sessionId: session, event: 'session_ended' })), 'rejected-auth');
    console.log(JSON.stringify({ version, nativeTui: true, realPty: true, model: 'loopback fixture (no inference)', repeatedTurns: 10,
      permission: 'passed', question: 'passed', compaction: 'native boundary and subsequent turn passed', interrupt: interruptResult, nextPromptAfterInterrupt: 'fresh native turn and provisional Stop passed', requests,
      events: [...new Set(native().map(event => event.event))] }));
    passed = true;
  } catch (error) {
    errors.push(error);
    try {
      console.error(JSON.stringify({ stage, requests, cancelled, toolNames: [...toolNames], facts: facts.slice(-20), nativeEvents: native().slice(-20).map(event => ({ event: event.event, source: event.source, tool: event.tool, child: event.child })) }));
      fs.writeFileSync(path.join(root, 'private-output.txt'), output, { mode: 0o600 });
    } catch (diagnosticError) { errors.push(diagnosticError); }
  } finally {
    if (child && !exited) { try { child.kill(); } catch { /* Tagged cleanup verifies exit below. */ } }
    try { await cleanupSmokeFixture({ repo, owner, workspaceRoots: [root], servers: [model] }); } catch (error) { errors.push(error); }
    try { await attachments?.dispose(); } catch (error) { errors.push(error); }
    try { broker.close(); } catch (error) { errors.push(error); }
    try { removeAttentionAdapterFiles(); } catch (error) { errors.push(error); }
    if (passed && !errors.length) fs.rmSync(root, { recursive: true, force: true });
    else console.error(`Private failed fixture retained: ${root}`);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('; '));
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
