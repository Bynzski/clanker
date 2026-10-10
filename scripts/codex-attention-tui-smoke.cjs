// Installed interactive Codex, real PTY and native hooks; disposable profile and loopback model fixture.
// Key presses drive the TUI only. Lifecycle assertions use broker receipts, never screen text.
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http');
const pty = require('node-pty');
const { AgentAttentionBroker } = require('../dist/main/main/agentAttentionBroker');
const { attentionLaunchStep } = require('../dist/main/main/attentionLaunchStep');
const { prepareLaunchAttachments } = require('../dist/main/main/launchAttachments');
const { removeAttentionAdapterFiles } = require('../dist/main/main/agentAttentionAdapters');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-codex-tui-'));
let child, attachments, requests = 0, tool = false, exited = false, approvalCase = 'accepted';
const ui = new Set();
const events = [];
const broker = new AgentAttentionBroker(() => {}, event => events.push({ semantic: event.semantic, nativeEvent: event.nativeEvent, decision: event.decision }));
const server = http.createServer((request, response) => { request.resume(); request.on('end', () => {
  requests++;
  const item = tool ? { type: 'function_call', id: `fc_${requests}`, call_id: `call_${requests}`, name: 'exec_command', arguments: JSON.stringify({ cmd: `printf fixture > approved-${approvalCase}`, sandbox_permissions: 'require_escalated', justification: 'Disposable fixture approval' }) }
    : { type: 'message', role: 'assistant', id: `msg_${requests}`, content: [{ type: 'output_text', text: 'ok' }] };
  const items = tool && approvalCase.includes('parallel') ? [item, { ...item, id: `fc_${requests}_2`, call_id: `call_${requests}_2`, arguments: approvalCase === 'identical-parallel' ? item.arguments : JSON.stringify({ ...JSON.parse(item.arguments), cmd: `printf fixture > approved-${approvalCase}-2` }) }] : [item];
  tool = false;
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const output = [{ type: 'response.created', response: { id: `resp_${requests}` } }, ...items.map(item => ({ type: 'response.output_item.done', item })), { type: 'response.completed', response: { id: `resp_${requests}`, status: 'completed', output: items, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }];
  response.end(output.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
}); });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { const end = Date.now() + 20000; while (!check()) { if (exited || Date.now() > end) throw new Error(label); await pause(40); } }
const count = semantic => events.filter(event => event.semantic === semantic && event.decision === 'accepted').length;
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    fs.writeFileSync(path.join(root, 'config.toml'), `model_provider="fixture"\nmodel="tiny"\n[model_providers.fixture]\nname="fixture"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`);
    attachments = await prepareLaunchAttachments({ args: [], env: { CODEX_HOME: root } }, [attentionLaunchStep({ broker, harness: 'codex', terminalId: 'codex', enabled: true })]);
    // A separate fixture decision is confined to the disposable interpreter. It exercises
    // upstream denial without a PostToolUse; the default exec overlay offers Cancel, not Decline.
    const interpreter = attachments.env.CLANKER_ATTENTION_INTERPRETER;
    fs.writeFileSync(path.join(root, 'deny-fixture'), '0');
    fs.writeFileSync(interpreter, "import { readFileSync, appendFileSync } from 'node:fs';\n" + fs.readFileSync(interpreter, 'utf8').replace('export default function interpret', 'function interpret') + `
export default function(input, hook, store) {
  if (hook === 'SessionStart') appendFileSync(${JSON.stringify(path.join(root, 'session-sources'))}, ['startup', 'clear', 'compact', 'resume', 'fork'].includes(input.source) ? input.source + '\\n' : 'unknown\\n');
  const result = interpret(input, hook, store);
  if (hook === 'PermissionRequest' && readFileSync(${JSON.stringify(path.join(root, 'deny-fixture'))}, 'utf8') === '1')
    return { ...result, output: { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'fixture denial' } } } };
  return result;
}
`);
    const spawnTui = () => {
      exited = false;
      child = pty.spawn('codex', [...attachments.args, '--dangerously-bypass-hook-trust', '--no-alt-screen', '-a', 'on-request', '-s', 'read-only', '-c', `projects.${JSON.stringify(root)}.trust_level="trusted"`], { cwd: root, cols: 100, rows: 36, env: { PATH: process.env.PATH, TERM: 'xterm-256color', HOME: root, CODEX_HOME: root, ...attachments.env } });
    child.onExit(() => { exited = true; });
    // Answer terminal capability queries; discard all UI content without retaining it.
    child.onData(data => { for (const label of ['trust', 'Welcome', 'API key', 'Press', 'tiny', 'error', 'upgrade', 'Sign in', 'shell', 'continue', 'model', 'Yes', 'No', 'Error', 'Retrying', 'Reconnecting', 'Interrupted', 'Working', 'failed', 'approve', 'rejected', 'denied']) if (data.includes(label)) ui.add(label); if (data.includes('\x1b[?u')) child.write('\x1b[?0u'); if (data.includes('\x1b[6n')) child.write('\x1b[1;1R'); if (data.includes('\x1b[c')) child.write('\x1b[?1;2c'); });
    };
    spawnTui();
    await pause(1500);
    // Dismiss the isolated profile's onboarding if present, then submit real foreground prompts.
    child.write('\r'); await pause(500);
    const results = [];
    for (const [name, key] of [['accepted', 'y'], ['hook-denied', null], ['cancelled', '\x1b'], ['interrupted', '\x03'], ['parallel', 'y'], ['identical-parallel', 'y']]) {
      const prior = count('turn_provisional'), interrupts = count('turn_interrupted'), resolved = count('input_resolved');
      approvalCase = name; fs.writeFileSync(path.join(root, 'deny-fixture'), name === 'hook-denied' ? '1' : '0'); tool = true; child.write('Reply using the fixture tool.'); await pause(150); child.write('\r');
      await until(() => broker.handoffState('codex') === 'needs_input' || (name === 'hook-denied' && count('turn_provisional') > prior), `No native approval for ${name}`);
      if (key) {
        await pause(1000);
        child.write(key);
        if (name.includes('parallel')) { await pause(1000); child.write(key); }
      }
      await until(() => count('turn_provisional') > prior || count('turn_interrupted') > interrupts, `No native boundary after ${name}`);
      assert.equal(fs.existsSync(path.join(root, `approved-${name}`)), ['accepted', 'parallel', 'identical-parallel'].includes(name), `Approval ${name} executed unexpectedly`);
      assert.equal(broker.snapshot('codex').lastCompletion, null);
      assert.notEqual(broker.handoffState('codex'), 'needs_input');
      if (['accepted', 'parallel', 'identical-parallel'].includes(name)) assert.equal(count('input_resolved') - resolved, 1);
      results.push({ approval: name, state: broker.handoffState('codex'), resolutionEvents: count('input_resolved') - resolved });
    }
    for (let i = 0; i < 10; i++) {
      const prior = count('turn_provisional'); child.write('Reply ok.'); await pause(150); child.write('\r');
      await until(() => count('turn_provisional') > prior, 'Repeated interactive turn did not stop');
      assert.equal(broker.handoffState('codex'), 'provisional');
    }
    const beforeCompact = requests;
    child.write('/compact'); await pause(150); child.write('\r');
    await until(() => requests > beforeCompact, 'Native compaction did not reach fixture');
    await pause(1000);
    let prior = count('turn_provisional'); child.write('Reply ok.'); await pause(150); child.write('\r');
    await until(() => count('turn_provisional') > prior, 'Turn after compaction did not recover');
    const newSession = broker.snapshot('codex').sessionId;
    child.write('/new'); await pause(150); child.write('\r'); await pause(1000);
    const rejected = events.filter(event => event.decision === 'rejected-mismatch').length;
    child.write('Reply ok.'); await pause(150); child.write('\r');
    await until(() => events.filter(event => event.decision === 'rejected-mismatch').length > rejected, 'Expected uncorrelated /new boundary not observed');
    // Installed 0.162.0 /new sends startup, not explicit clear; no previous-root link or
    // SessionEnd proves replacement. Assert the visible fail-closed limitation, never rebind.
    assert.equal(broker.snapshot('codex').sessionId, newSession);
    assert.equal(broker.snapshot('codex').signal.health, 'degraded');
    console.log(JSON.stringify({ harness: 'codex', execution: 'installed interactive TUI with real PTY', model: 'loopback fixture (no inference)', trust: 'disposable fixture bypass only', denialCoverage: 'native hook denial; default exec TUI offers cancel, not continue-without-running', approvals: results, repeatedTurns: 10, compaction: 'native request plus subsequent turn passed', sessionReplacement: 'coverage gap: /new emits startup without previous-root link; visibly degraded, unrelated root rejected', sessionEnd: 'covered by exec/resume suite; native TUI /quit and resume remain owner smoke items', requests, nativeHooks: [...new Set(events.map(event => event.nativeEvent))] }));
  } catch (error) { console.error(error.message); console.error(JSON.stringify({ requests, exited, sessionSources: fs.existsSync(path.join(root, 'session-sources')) ? fs.readFileSync(path.join(root, 'session-sources'), 'utf8').trim().split('\n') : [], ui: [...ui], nativeEvents: events.slice(-12), diagnostics: broker.signalDiagnostics('codex') })); process.exitCode = 1; }
  finally { child?.kill(); await attachments?.dispose(); broker.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); removeAttentionAdapterFiles(); fs.rmSync(root, { recursive: true, force: true }); }
})();
