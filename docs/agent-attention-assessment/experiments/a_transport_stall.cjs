// Experiment A: real observer.mjs emit() in a separate process vs a broker whose event loop stalls.
const fs = require('fs'), path = require('path'), os = require('os'); const { execFile } = require('child_process');
const D = require('node:path').resolve(__dirname, '../../../dist/main/main');
const { AgentAttentionBroker } = require(D + '/agentAttentionBroker');
const { OBSERVER } = require(D + '/harnesses/attentionSources');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expA-'));
fs.writeFileSync(path.join(dir, 'observer.mjs'), OBSERVER);
fs.writeFileSync(path.join(dir, 'client.mjs'), `import { emit } from './observer.mjs';\nconsole.log(await emit('session_started', { scope: 'root', sessionId: 's1' }, true));`);
const block = ms => { const end = Date.now() + ms; while (Date.now() < end); };
(async () => {
  const broker = new AgentAttentionBroker(() => {});
  for (const stall of [0, 300, 700, 1500]) {
    const env = await broker.register('t', 'pi');
    const child = new Promise(res => execFile('node', [path.join(dir, 'client.mjs')], { env: { ...process.env, ...env } }, (e, out) => res(out.trim())));
    // Wait until the child has connected (node startup ~40ms), then stall the "main" loop.
    broker.server.removeAllListeners("connection_stall"); broker.server.once("connection", () => block(stall));
    const verdict = await child; await new Promise(r => setTimeout(r, 50));
    console.log(JSON.stringify({ stallMs: stall, hookSawVerdict: verdict, brokerApplied: broker.snapshot('t')?.sessionId === 's1' }));
  }
  broker.close(); fs.rmSync(dir, { recursive: true });
})();
