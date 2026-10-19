#!/usr/bin/env node
// Opt-in installed-Hermes smoke. No inference, profile/chat copies, or global service stop.
// HERMES_TEST_SOURCE must name the source checkout used by the installed `hermes` launcher.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-hermes-native-'));
const source = process.env.HERMES_TEST_SOURCE;
const python = process.env.HERMES_TEST_PYTHON || 'python3';
const originalEnv = Object.fromEntries(['PATH', 'HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'LANG'].flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
let owned;
let phase = 'fixture setup';
let output = '';

async function main() {
  try {
    assert(source && path.isAbsolute(source), 'Set HERMES_TEST_SOURCE to the installed Hermes source checkout');
    assert(fs.existsSync(path.join(source, 'pm', 'environments.py')), 'Unsupported Hermes source layout');
    // Stdlib metadata reads only: never import hermes_bootstrap or run a sync/repair.
    const query = `import sys,json
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,sys.argv[1])
from pm.environments import selected_venv,runtime_facts_path,install_key
root=Path(sys.argv[1]).resolve()
print(json.dumps(dict(environment=str(selected_venv(root)),facts=str(runtime_facts_path(root)),key=install_key(root))))`;
    const runtime = JSON.parse(execFileSync(python, ['-I', '-c', query, source], {
      env: originalEnv, encoding: 'utf8', timeout: 5000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'],
    }));
    assert(/^[a-f0-9]{16}$/.test(runtime.key), 'Unsupported Hermes install identity');
    const facts = JSON.parse(fs.readFileSync(runtime.facts, 'utf8'));
    assert(facts.packages?.venv?.environment && fs.existsSync(path.join(runtime.environment, 'pyvenv.cfg')), 'No committed dependency generation');

    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, { PATH: originalEnv.PATH || '', LANG: originalEnv.LANG || 'C.UTF-8', HERMES_DISABLE_LAZY_INSTALLS: '1' });
    for (const [key, directory] of Object.entries({ HOME: 'home', HERMES_HOME: 'hermes', XDG_CONFIG_HOME: 'config', XDG_CACHE_HOME: 'cache', XDG_DATA_HOME: 'data', XDG_STATE_HOME: 'state', HERMES_GATEWAY_LOCK_DIR: 'locks' })) {
      process.env[key] = path.join(root, directory);
      fs.mkdirSync(process.env[key], { recursive: true, mode: 0o700 });
    }
    // HERMES_HOME scopes dependency selection as well as profiles. Clone the selected
    // generation; linking it would let leases/repairs mutate the real install state.
    const state = path.join(process.env.HERMES_HOME, 'installs', runtime.key);
    const environment = path.join(state, 'environments', 'fixture');
    fs.mkdirSync(path.dirname(environment), { recursive: true, mode: 0o700 });
    fs.cpSync(runtime.environment, environment, { recursive: true, dereference: false, mode: fs.constants.COPYFILE_FICLONE });
    facts.packages.venv.environment = environment;
    fs.writeFileSync(path.join(state, 'facts.json'), JSON.stringify(facts), { mode: 0o600 });

    // Generated main modules must be built first. Dynamic paths match existing smoke scripts.
    const mainModule = (name) => require(path.join(repo, 'dist', 'main', 'main', 'assistants', name));
    const { spawnHermesServe, waitForServeReady } = mainModule('hermesBackend.js');
    const { HermesOwnedChild } = mainModule('hermesOwnedChild.js');
    const { readHermesRendezvous, discoverHermesBackend } = mainModule('hermesDiscovery.js');
    phase = 'native startup';
    const child = spawnHermesServe(randomBytes(32).toString('base64url'));
    owned = new HermesOwnedChild(child, () => {});
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk) => { output = (output + chunk.toString()).slice(-32768); });
    const port = await waitForServeReady(child, 45000);
    assert(!owned.hasExited, 'Native backend exited after readiness');
    console.log('PASS: isolated native Hermes readiness');

    phase = 'authenticated discovery';
    const candidates = () => readHermesRendezvous(process.env.HERMES_GATEWAY_LOCK_DIR);
    const rows = await candidates();
    assert(rows.some((row) => row.pid === child.pid && row.port === port), 'Fixture rendezvous mismatch');
    // Never let legacy fallback probe the user's live default-port backend.
    const fixtureFetch = (url, options) => {
      assert.equal(new URL(url).origin, `http://127.0.0.1:${port}`, 'Non-fixture request refused');
      return fetch(url, options);
    };
    const probe = await discoverHermesBackend(fixtureFetch, candidates);
    assert(probe.kind === 'usable' && probe.port === port, 'Fixture authentication failed');
    console.log('PASS: private rendezvous and authenticated host identity');

    phase = 'verified shutdown';
    await owned.stop(3000, 3000);
    assert(owned.hasExited && !owned.cleanupIncomplete, 'Native child cleanup unverified');
    console.log('PASS: exact native child shutdown acknowledged');
  } catch {
    // Upstream exceptions/argv/logs may contain tokens and paths. Never echo them.
    const missing = /No module named ['"]([A-Za-z0-9_.-]+)['"]/.exec(output)?.[1];
    console.error(`FAIL: Hermes smoke during ${phase}${missing ? ` (missing module: ${missing})` : ''}.`);
    if (!source) console.error('Set HERMES_TEST_SOURCE to the installed Hermes source checkout; build Clanker first.');
    process.exitCode = 1;
  } finally {
    if (owned && !owned.hasExited) {
      try { await owned.stop(3000, 3000); }
      catch { console.error('Cleanup unverified; fixture retained for recovery.'); process.exitCode = 1; }
    }
    if (!owned || owned.hasExited) {
      try { fs.rmSync(root, { recursive: true, force: true }); }
      catch { console.error('Could not remove the disposable fixture.'); process.exitCode = 1; }
    }
  }
}
void main();
