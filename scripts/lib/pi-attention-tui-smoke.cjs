// Native Pi TUI over a real PTY; lifecycle assertions never inspect terminal output.
// Used by native-attention-smoke.cjs to share its isolated home/model/attachment setup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pty = require('node-pty');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function runPiTui({ root, env, args, broker, observed, transitions, setMode, until }) {
  const version = execFileSync('pi', ['--version'], { env, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 }).trim();
  assert(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version), 'Unexpected Pi version format');
  const evidenceFile = path.join(root, 'native-evidence.json');
  const refsFile = path.join(root, 'fixture-session.json');
  const extension = path.join(root, 'tui-fixture.ts');
  // Only fixed event names/reasons/counts are evidence. Private session references live in
  // the disposable fixture, never in diagnostics. Read back after reload to retain counters.
  fs.writeFileSync(extension, `import fs from 'node:fs';
const evidenceFile = ${JSON.stringify(evidenceFile)};
const refsFile = ${JSON.stringify(refsFile)};
let evidence = fs.existsSync(evidenceFile) ? JSON.parse(fs.readFileSync(evidenceFile, 'utf8')) : { events: [], commands: 0 };
const record = (name, reason) => {
  evidence.events.push({ name, ...(reason ? { reason } : {}) });
  evidence.events = evidence.events.slice(-128);
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence));
};
export default function(pi) {
  for (const name of ['session_start','session_shutdown','agent_start','agent_settled','ui_prompt_start','ui_prompt_end']) {
    pi.on(name, (event) => record(name, ['startup','reload','new','resume','fork'].includes(event.reason) ? event.reason : undefined));
  }
  pi.registerTool({ name:'smoke_wait',label:'Fixture wait',description:'Fixture wait',parameters:{type:'object',properties:{}},async execute(id,args,signal,update,ctx) {
    await ctx.ui.confirm('fixture','fixture'); return {content:[{type:'text',text:'ok'}],details:{}};
  } });
  pi.registerCommand('fixture-save', { description:'Save isolated session reference', handler:async (_args,ctx) => {
    fs.writeFileSync(refsFile, JSON.stringify({ sessionFile:ctx.sessionManager.getSessionFile(), entryId:ctx.sessionManager.getBranch().find(e => e.type === 'message' && e.message.role === 'user').id }));
    evidence.commands++; record('fixture-save');
  } });
  pi.registerCommand('fixture-resume', { description:'Resume isolated session', handler:async (_args,ctx) => {
    const refs = JSON.parse(fs.readFileSync(refsFile,'utf8')); await ctx.switchSession(refs.sessionFile);
  } });
  pi.registerCommand('fixture-fork', { description:'Fork isolated session', handler:async (_args,ctx) => {
    const refs = JSON.parse(fs.readFileSync(refsFile,'utf8')); await ctx.fork(refs.entryId);
  } });
}
`);
  let child, exited = false, stage = 'startup';
  const evidence = () => fs.existsSync(evidenceFile) ? JSON.parse(fs.readFileSync(evidenceFile, 'utf8')) : { events: [], commands: 0 };
  const count = name => evidence().events.filter(event => event.name === name).length;
  const send = text => child.write(text + '\r');
  const turn = async (label, expected = 'idle') => {
    stage = label;
    const starts = count('agent_start'), settles = count('agent_settled'), before = transitions.length;
    send('Reply ok.');
    await until(() => exited || (count('agent_start') > starts && count('agent_settled') > settles && broker.snapshot('pi')?.runtime.status === expected), `Pi TUI ${label}: native turn did not settle`);
    assert(!exited, 'Pi TUI exited');
    assert(transitions.slice(before).some(change => change.status === 'running'), `Pi TUI ${label}: no Running publication`);
    if (expected === 'idle') {
      assert.equal(broker.snapshot('pi').locationProvenance?.state, 'current');
      assert.equal(broker.snapshot('pi').lastCompletion.turnId, transitions.slice(before).find(change => change.status === 'running').turnId);
      assert(broker.canHandoff('pi'), `Pi TUI ${label}: settled agent not eligible for handoff`);
    }
  };
  const boundary = async (command, sameRoot) => {
    stage = command;
    const before = observed.length, starts = count('session_start'), shutdowns = count('session_shutdown');
    const oldRoot = broker.snapshot('pi')?.sessionId;
    send(command);
    await until(() => exited || (count('session_start') > starts && count('session_shutdown') > shutdowns && observed.slice(before).some(event => event.semantic === 'session_started' && event.decision === 'accepted')), `Pi TUI ${command}: missing accepted native boundary`);
    assert(!exited, 'Pi TUI exited');
    const names = observed.slice(before).filter(event => event.decision === 'accepted').map(event => event.semantic);
    assert(names.indexOf('session_ended') >= 0 && names.indexOf('session_ended') < names.indexOf('session_started'), 'Pi TUI boundary ordering incorrect');
    assert.equal(broker.snapshot('pi').sessionId === oldRoot, sameRoot, 'Pi TUI boundary root identity incorrect');
    await turn(`after ${command}`);
  };
  try {
    child = pty.spawn('pi', ['--provider', 'fixture', '--model', 'tiny', '--no-extensions', '--no-skills', '--session-dir', path.join(root, 'sessions'), '--extension', extension, ...args], { cwd: root, env: { ...env, TERM: 'xterm-256color' }, cols: 100, rows: 30, handleFlowControl: false });
    child.onExit(() => { exited = true; });
    // Consume output but do not retain, log or parse it as lifecycle evidence.
    child.onData(() => {});
    await until(() => exited || broker.snapshot('pi')?.sessionId, 'Pi TUI startup not observed');
    assert(!exited, 'Pi TUI exited at startup');
    // Session startup precedes installation of the interactive input handler.
    await pause(300);
    for (let i = 0; i < 10; i++) await turn(`turn ${i + 1}`);
    send('/fixture-save');
    await until(() => evidence().commands === 1, 'Pi TUI fixture save failed');
    await boundary('/reload', true);
    await boundary('/reload', true);
    await boundary('/new', false);
    await boundary('/fixture-resume', false);
    await boundary('/fixture-fork', false);
    await boundary('/reload', true);
    stage = 'UI wait';
    setMode('wait-tool');
    const before = transitions.length, starts = count('agent_start');
    send('Use smoke_wait.');
    await until(() => count('agent_start') > starts && broker.snapshot('pi')?.pendingRequest, 'Pi TUI UI wait missing');
    // ui_prompt_start is awaited before Pi installs the dialog's input component.
    await pause(100);
    child.write('\r');
    await until(() => broker.snapshot('pi')?.runtime.status === 'idle' && !broker.snapshot('pi')?.pendingRequest, 'Pi TUI UI response did not settle');
    assert(transitions.slice(before).some(change => change.status === 'running' && !change.waiting), 'Pi TUI UI response did not restore Running');
    setMode('error'); await turn('API failure', 'failed');
    setMode('success'); await turn('after failure');
    setMode('hold'); stage = 'abort';
    send('Reply ok.');
    await until(() => broker.snapshot('pi')?.runtime.status === 'running', 'Pi TUI abort did not start');
    child.write('\x1b');
    await until(() => broker.snapshot('pi')?.lastOutcome?.kind === 'interrupted', 'Pi TUI abort did not interrupt');
    setMode('success'); await turn('after abort');
    console.log(JSON.stringify({ harness: 'pi', version, nativeCLI: true, mode: 'interactive TUI / real PTY', model: 'loopback fixture (no inference)', consecutiveTurns: 10, reload: 'three native /reload boundaries passed', newSession: 'native /new passed', resume: 'TUI extension ctx.switchSession passed (not picker UI)', fork: 'TUI extension ctx.fork passed (not picker UI)', wait: 'native TUI confirmation passed', failedTurn: 'passed', interruptedTurn: 'passed', subsequentTurnAndHandoff: 'passed', nativeEvents: evidence().events, deliveryVerdicts: [...new Set(observed.map(event => event.verdict))].filter(Boolean), renderer: 'not exercised', exactOwnerSequence: 'not provided; arbitrary extensions/tree navigation remain unverified' }));
  } catch (error) {
    // Safe loss-stage evidence only: no raw output, session ids, prompts or credentials.
    console.error(JSON.stringify({ stage, nativeEvents: evidence().events, broker: { revision: broker.snapshot('pi')?.revision, status: broker.snapshot('pi')?.runtime.status }, decisions: observed.slice(-16).map(({ semantic, decision, verdict, nativeEvent }) => ({ semantic, decision, verdict, nativeEvent })) }));
    throw error;
  } finally {
    if (child && !exited) {
      try { child.kill(); } catch { /* PTY may have exited concurrently */ }
      await until(() => exited, 'Pi TUI fixture PTY cleanup failed');
    }
  }
};
