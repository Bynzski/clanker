// Installed Codex exec/resume CLI, normal Clanker hooks, isolated CODEX_HOME and loopback Responses fixture.
// Explicit trust bypass is confined to this disposable smoke profile; production never bypasses review.
const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const { spawn } = require('node:child_process');
const { AgentAttentionBroker } = require('../dist/main/main/agentAttentionBroker'); const { attentionLaunchStep } = require('../dist/main/main/attentionLaunchStep'); const { prepareLaunchAttachments } = require('../dist/main/main/launchAttachments'); const { removeAttentionAdapterFiles } = require('../dist/main/main/agentAttentionAdapters');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-codex-native-'));
let attachments, requests = 0;
let starts = 0, stops = 0;
const broker = new AgentAttentionBroker(() => {}, event => { if (event.decision === 'accepted' && event.semantic === 'turn_started') starts++; if (event.decision === 'accepted' && event.semantic === 'turn_provisional') stops++; });
const server = http.createServer((request, response) => { request.resume(); request.on('end', () => {
  requests++; response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const events = [{ type: 'response.created', response: { id: `resp_${requests}` } }, { type: 'response.output_item.done', item: { type: 'message', role: 'assistant', id: `msg_${requests}`, content: [{ type: 'output_text', text: 'ok' }] } }, { type: 'response.completed', response: { id: `resp_${requests}`, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }];
  response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
}); });
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    fs.writeFileSync(path.join(root, 'config.toml'), `model_provider="fixture"\nmodel="tiny"\n[model_providers.fixture]\nname="fixture"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`);
    attachments = await prepareLaunchAttachments({ args: [], env: { CODEX_HOME: root } }, [attentionLaunchStep({ broker, harness: 'codex', terminalId: 'codex', enabled: true })]);
    assert(attachments.provided.has('native-attention'));
    const invoke = (session, trust) => new Promise((resolve, reject) => {
      const child = spawn('codex', [...attachments.args, 'exec', ...(session ? ['resume', session] : []), '--json', '--skip-git-repo-check', ...(trust ? ['--dangerously-bypass-hook-trust'] : []), 'Reply ok.'], { cwd: root, env: { PATH: process.env.PATH, HOME: root, CODEX_HOME: root, ...attachments.env }, stdio: ['ignore', 'pipe', 'ignore'] });
      let buffer = '', id = session;
      const timer = setTimeout(() => { child.kill(); reject(new Error('Codex native exec timeout')); }, 20000);
      child.stdout.on('data', chunk => { buffer += chunk; if (buffer.length > 1024 * 1024) { child.kill(); return; } let index; while ((index = buffer.indexOf('\n')) >= 0) { const raw = buffer.slice(0, index); buffer = buffer.slice(index + 1); try { const event = JSON.parse(raw); if (event.type === 'thread.started') id = event.thread_id; } catch { /* no raw content retained */ } } });
      child.on('error', reject); child.on('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`Codex native exec exit ${code}`)); else resolve(id); });
    });
    const session = await invoke(null, false);
    const withoutTrust = broker.signalDiagnostics('codex');
    for (let i = 0; i < 10; i++) {
      const prior = { starts, stops }; await invoke(session, true);
      assert.equal(starts, prior.starts + 1); assert.equal(stops, prior.stops + 1);
      assert.equal(broker.snapshot('codex').lastCompletion, null);
      assert.equal(broker.snapshot('codex').lastOutcome.kind, 'session_ended');
    }
    console.log(JSON.stringify({ harness: 'codex', nativeCLI: 'exec/resume (not interactive TUI)', model: 'loopback fixture (no inference)', consecutiveTurns: 10, initialUnreviewedHookReceipts: withoutTrust.received, trust: 'explicit runtime bypass in disposable fixture only', resume: 'passed', requests, diagnostics: broker.signalDiagnostics('codex') }));
  } catch (error) { console.error(error.message); console.error(JSON.stringify({ requests, diagnostics: broker.signalDiagnostics('codex') })); process.exitCode = 1; }
  finally { await attachments?.dispose(); broker.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); removeAttentionAdapterFiles(); fs.rmSync(root, { recursive: true, force: true }); }
})();
