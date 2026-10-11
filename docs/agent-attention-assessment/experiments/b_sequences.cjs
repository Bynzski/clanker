// Experiment B: exact provider emission sequences through the real broker + real renderer selector.
const D = require('node:path').resolve(__dirname, '../../../dist/main/main');
const { AgentAttentionBroker } = require(D + '/agentAttentionBroker');
const { deriveAttention } = require(process.env.CLANKER_PRESENTATION_BUNDLE || require('node:path').join(require('node:os').tmpdir(), 'clanker-attention-presentation.cjs'));
function harness(name) {
  const broker = new AgentAttentionBroker(() => {}, () => {});
  const token = broker.registerRemote('t', name, { capability: { requested: true, attachment: 'prepared' } });
  const send = (event, f = {}) => broker.receiveRemote('t', JSON.stringify({ version: 1, token, harness: name, event, ...f }));
  const view = (seen) => { const s = broker.snapshot('t'); const v = s ? deriveAttention(s, seen) : 'RETIRED'; return v ? (v.display ?? v) + (v.unseen ? '(unseen)' : '') : 'nothing'; };
  return { broker, send, view };
}
const R = (sessionId, extra) => ({ scope: 'root', sessionId, ...extra });
const log = (label, rows) => console.log('\n## ' + label + '\n' + rows.map(r => '  ' + r).join('\n'));

// B1 Pi: /reload where the old instance's session_ended is lost (module re-import restarts epoch at 1).
{ const { send, view } = harness('pi'); const rows = [];
  send('session_started', R('S'));
  for (let i = 1; i <= 5; i++) { send('turn_started', R('S', { turnId: String(i) })); send('turn_completed', R('S', { turnId: String(i) })); }
  rows.push('5 turns done; view(background)=' + view());
  // /reload: session_shutdown -> session_ended LOST; new instance: session_start -> session_started
  rows.push('session_started after reload: ' + send('session_started', R('S')));
  for (let i = 1; i <= 7; i++) { const a = send('turn_started', R('S', { turnId: String(i) })); const mid = view(); const b = send('turn_completed', R('S', { turnId: String(i) })); rows.push(`post-reload turn ${i}: start=${a} view-while-working=${mid} settle=${b}`); }
  log('B1 Pi /reload with one lost session_ended', rows); }

// B2 Pi: /new (or resume/fork) where session_ended is lost.
{ const { send, view } = harness('pi'); const rows = [];
  send('session_started', R('S1')); send('turn_started', R('S1', { turnId: '1' })); send('turn_completed', R('S1', { turnId: '1' }));
  rows.push('new instance session_started(S2): ' + send('session_started', R('S2')));
  for (let i = 1; i <= 3; i++) { const a = send('turn_started', R('S2', { turnId: String(i) })); rows.push(`turn ${i} in S2: start=${a} view=${view()} settle=${send('turn_completed', R('S2', { turnId: String(i) }))}`); }
  log('B2 Pi /new with one lost session_ended', rows); }

// B3 Codex 0.162 TUI /new: SessionStart(source=startup) with new id, no SessionEnd (native-confirmed by repo smoke).
{ const { send, view } = harness('codex'); const rows = [];
  send('session_started', R('A')); send('turn_started', R('A', { turnId: 't1' })); send('turn_provisional', R('A', { turnId: 't1' }));
  rows.push('after turn 1 view=' + view());
  rows.push('/new session_started(B): ' + send('session_started', R('B')));
  for (let i = 2; i <= 4; i++) { rows.push(`turn ${i}: start=${send('turn_started', R('B', { turnId: 't' + i }))} view=${view()} stop=${send('turn_provisional', R('B', { turnId: 't' + i }))}`); }
  log('B3 Codex TUI /new (no SessionEnd)', rows); }

// B4 OpenCode TUI new session: plugin sees busy/idle for a new root session id; session.deleted only on delete.
{ const { send, view } = harness('opencode'); const rows = [];
  send('turn_started', R('ses_A', { turnId: '1' })); send('turn_completed', R('ses_A', { turnId: '1' }));
  for (let i = 1; i <= 2; i++) rows.push(`new session ses_B turn ${i}: start=${send('turn_started', R('ses_B', { turnId: String(i) }))} view=${view()}`);
  log('B4 OpenCode new session in same TUI', rows); }

// B5 Claude/Codex normal turn: what does the user see when the turn ends?
{ const { send, view } = harness('claude'); const rows = [];
  send('turn_started', R('C', { turnId: 'p1', cwd: undefined })); rows.push('working: ' + view());
  send('turn_provisional', R('C', { turnId: 'p1' })); rows.push('after native Stop (final for a normal turn): ' + view());
  log('B5 Claude/Codex turn end', rows); }

// B6 Pi/OpenCode/OMP completion with the pane in the foreground vs background.
{ const { broker, send } = harness('pi'); const rows = [];
  send('turn_started', R('P', { turnId: '1' })); send('turn_completed', R('P', { turnId: '1' }));
  const s = broker.snapshot('t');
  const v = (seen) => { const x = deriveAttention(s, seen); return x ? x.display + (x.unseen ? '(unseen)' : '') : 'nothing'; };
  rows.push('background (not yet seen): ' + v(undefined));
  rows.push('foreground (renderer acknowledges on arrival): ' + v({ completion: s.lastCompletion.revision, request: 0 }));
  log('B6 completion visibility', rows); }

// B7 Lost turn_started (one dropped delivery) for Pi.
{ const { send, view } = harness('pi'); const rows = [];
  send('session_started', R('S')); send('turn_started', R('S', { turnId: '1' })); send('turn_completed', R('S', { turnId: '1' }));
  rows.push('turn 2 start LOST; settle=' + send('turn_completed', R('S', { turnId: '2' })) + ' view=' + view());
  rows.push('turn 3 start=' + send('turn_started', R('S', { turnId: '3' })) + ' view=' + view());
  log('B7 one lost turn_started', rows); }

// B8 Lost turn_completed for Pi.
{ const { send, view } = harness('pi'); const rows = [];
  send('session_started', R('S')); send('turn_started', R('S', { turnId: '1' }));
  rows.push('turn 1 settle LOST; view stays=' + view() + ' (until next prompt, however long)');
  log('B8 one lost turn_completed', rows); }
