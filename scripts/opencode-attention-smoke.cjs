// Installed OpenCode server + normal Clanker plugin preparation, loopback model fixture only.
const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const net = require('node:net'); const { spawn } = require('node:child_process');
const { AgentAttentionBroker } = require('../dist/main/main/agentAttentionBroker'); const { attentionLaunchStep } = require('../dist/main/main/attentionLaunchStep'); const { prepareLaunchAttachments } = require('../dist/main/main/launchAttachments'); const { removeAttentionAdapterFiles } = require('../dist/main/main/agentAttentionAdapters');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-opencode-native-'));
let child, attachments, mode = 'success', requests = 0;
const transitions = [];
const broker = new AgentAttentionBroker(change => { if (change.snapshot) transitions.push({ revision: change.revision, status: change.snapshot.runtime.status, turnId: change.snapshot.runtime.turnId, waiting: !!change.snapshot.pendingRequest }); }, () => {});
const model = http.createServer((request, response) => { request.resume(); request.on('end', () => {
  requests++; if (mode === 'hold') return;
  if (mode === 'error') { response.writeHead(401, { 'Content-Type': 'application/json' }); response.end('{"error":{"message":"fixture failure","type":"authentication_error"}}'); return; }
  if (mode === 'approval-tool' || mode === 'question-tool') {
    const approval = mode === 'approval-tool'; mode = 'success';
    const args = approval ? { command: 'printf fixture' } : { questions: [{ question: 'Continue?', header: 'Fixture', options: [{ label: 'Yes', description: 'Continue fixture' }] }] };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'tiny', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `fixture_${requests}`, type: 'function', function: { name: approval ? 'bash' : 'question', arguments: JSON.stringify(args) } }] }, finish_reason: null }] }) + '\n\ndata: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }) + '\n\ndata: [DONE]\n\n'); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'tiny', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] }) + '\n\ndata: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + '\n\ndata: [DONE]\n\n');
}); });
async function until(check, label) { const end = Date.now() + 25000; while (!await check()) { if (Date.now() > end) throw new Error(label); await new Promise(resolve => setTimeout(resolve, 50)); } }
(async () => {
  try {
    await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
    const portProbe = net.createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve)); const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
    attachments = await prepareLaunchAttachments({ args: ['serve', '--hostname', '127.0.0.1', '--port', String(port)], env: {} }, [attentionLaunchStep({ broker, harness: 'opencode', terminalId: 'opencode', enabled: true })]);
    fs.writeFileSync(path.join(attachments.env.OPENCODE_CONFIG_DIR, 'opencode.json'), JSON.stringify({ model: 'fixture/tiny', autoupdate: false, permission: { bash: 'ask' }, provider: { fixture: { npm: '@ai-sdk/openai-compatible', name: 'fixture', options: { baseURL: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'fixture' }, models: { tiny: { name: 'tiny', limit: { context: 32768, output: 128 } } } } } }));
    child = spawn('opencode', attachments.args, { cwd: root, env: { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'), OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true', ...attachments.env }, stdio: ['ignore', 'ignore', 'ignore'] });
    const base = `http://127.0.0.1:${port}`;
    await until(async () => { try { return (await fetch(base + '/global/health', { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, 'OpenCode native server not ready');
    const api = async (route, body) => { const response = await fetch(base + route, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert(response.ok, `OpenCode route failed: ${route.replace(/ses_[^/]+/g, 'session')}`); return response.json(); };
    let session = await api('/session', {});
    for (let i = 0; i < 10; i++) {
      const before = broker.signalDiagnostics('opencode')?.received ?? 0, previous = transitions.length;
      await api(`/session/${session.id}/message`, { model: { providerID: 'fixture', modelID: 'tiny' }, parts: [{ type: 'text', text: 'Reply ok.' }] });
      await until(() => broker.signalDiagnostics('opencode').received > before && broker.snapshot('opencode')?.runtime.status === 'idle', `OpenCode turn ${i + 1} did not settle`);
      const running = transitions.slice(previous).find(change => change.status === 'running');
      assert(running, `OpenCode turn ${i + 1} never published Running`);
      assert.equal(broker.snapshot('opencode').lastCompletion.turnId, running.turnId);
      assert(broker.snapshot('opencode').lastCompletion.revision > running.revision);
    }
    for (const type of ['approval', 'question']) {
      mode = `${type}-tool`;
      let pendingError;
      const pending = api(`/session/${session.id}/message`, { parts: [{ type: 'text', text: 'Exercise fixture tool.' }] }).catch(error => { pendingError = error; });
      await until(() => broker.snapshot('opencode')?.pendingRequest, `OpenCode native ${type} did not request input`);
      const request = broker.snapshot('opencode').pendingRequest;
      assert.equal(request.kind, type === 'approval' ? 'approval' : 'input');
      const before = transitions.length;
      await api(`/${type === 'approval' ? 'permission' : 'question'}/${request.id}/reply`, type === 'approval' ? { reply: 'once' } : { answers: [['Yes']] });
      await pending; if (pendingError) throw pendingError;
      await until(() => broker.snapshot('opencode')?.runtime.status === 'idle', `OpenCode ${type} did not settle`);
      assert(transitions.slice(before).some(change => change.status === 'running' && !change.waiting), `OpenCode ${type} resolution did not publish Running`);
    }
    mode = 'error'; await api(`/session/${session.id}/message`, { parts: [{ type: 'text', text: 'Reply ok.' }] });
    await until(() => broker.snapshot('opencode')?.lastOutcome?.kind === 'failed', 'OpenCode error became Done');
    mode = 'hold'; const before = requests;
    const pending = api(`/session/${session.id}/message`, { parts: [{ type: 'text', text: 'Reply ok.' }] }).catch(() => null);
    await until(() => requests > before && broker.snapshot('opencode')?.runtime.status === 'running', 'OpenCode abort turn did not start');
    await api(`/session/${session.id}/abort`, {}); await pending;
    await until(() => broker.snapshot('opencode')?.lastOutcome?.kind === 'interrupted', 'OpenCode abort became Done');
    // Unrelated roots must be rejected, never silently replace the foreground root.
    mode = 'success'; const replacement = await api('/session', {});
    await api(`/session/${replacement.id}/message`, { parts: [{ type: 'text', text: 'Reply ok.' }] });
    assert.equal(broker.snapshot('opencode').sessionId, session.id);
    assert(broker.signalDiagnostics('opencode').verdicts['rejected-mismatch'] > 0);
    await api(`/session/${session.id}/message`, { parts: [{ type: 'text', text: 'Reply ok.' }] });
    await until(() => broker.snapshot('opencode')?.runtime.status === 'idle' && broker.snapshot('opencode')?.signal?.health === 'observed', 'Returning to original OpenCode root did not recover');
    const removed = await fetch(base + `/session/${session.id}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) }); assert(removed.ok);
    await until(() => broker.snapshot('opencode')?.sessionId === null, 'Native deletion did not release root');
    await api(`/session/${replacement.id}/message`, { parts: [{ type: 'text', text: 'Reply ok.' }] });
    await until(() => broker.snapshot('opencode')?.sessionId === replacement.id && broker.snapshot('opencode')?.runtime.status === 'idle', 'Post-deletion replacement did not recover');
    console.log(JSON.stringify({ harness: 'opencode', nativeServer: true, model: 'loopback fixture (no inference)', consecutiveTurns: 10, approval: 'native ask/reply passed', question: 'native ask/reply passed', failedTurn: 'passed', interruptedTurn: 'passed', unrelatedReplacement: 'rejected', returnToOriginal: 'recovered', replacementAfterNativeDeletion: 'passed', requests }));
  } catch (error) { console.error(error.message); console.error(JSON.stringify({ requests })); console.error(JSON.stringify(broker.signalDiagnostics('opencode'))); process.exitCode = 1; }
  finally { child?.kill(); if (child && child.exitCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1000))]); await attachments?.dispose(); broker.close(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); removeAttentionAdapterFiles(); fs.rmSync(root, { recursive: true, force: true }); }
})();
