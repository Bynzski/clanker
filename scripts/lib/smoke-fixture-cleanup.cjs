/* global window */
// Fixture-only teardown. Never authorizes quit, answers a close prompt, unregisters Git,
// or signals processes by name. Every spawned process inherits a fresh per-run tag.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const OWNER_KEY = 'CLANKER_SMOKE_RUN';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function createSmokeOwner() { return { key: OWNER_KEY, value: randomUUID() }; }

async function bounded(label, operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

// Linux fallback also catches descendants which outlive Electron/the PTY. Capture
// start time and revalidate the exact environment tag before EACH individual signal
// so PID reuse, unrelated apps and user-workspace processes are never targets.
function ownedProcesses(owner) {
  if (process.platform !== 'linux') return [];
  const result = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    try {
      const env = fs.readFileSync(`/proc/${name}/environ`, 'utf8').split('\0');
      if (!env.includes(`${owner.key}=${owner.value}`)) continue;
      const stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (fields[0] !== 'Z') result.push({ pid: Number(name), start: fields[19] });
    } catch (error) {
      if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    }
  }
  return result;
}

async function stopTaggedProcesses(owner) {
  if (process.platform !== 'linux') return;
  for (const [signal, waitMs] of [['SIGTERM', 1000], ['SIGKILL', 2000]]) {
    const captured = ownedProcesses(owner);
    for (const target of captured) {
      const current = ownedProcesses(owner).find(value => value.pid === target.pid && value.start === target.start);
      if (!current) continue;
      try { process.kill(target.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    const deadline = Date.now() + waitMs;
    while (ownedProcesses(owner).length && Date.now() < deadline) await pause(25);
    if (!ownedProcesses(owner).length) return;
  }
  throw new Error('Fixture-tagged processes remain after bounded termination; preserve fixture for inspection');
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  for (const [signal, waitMs] of [['SIGTERM', 1000], ['SIGKILL', 2000]]) {
    child.kill(signal); // Exact ChildProcess owned by this script, never a process-name search.
    const deadline = Date.now() + waitMs;
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await pause(25);
    if (child.exitCode !== null || child.signalCode !== null) return;
  }
  throw new Error('Fixture child did not exit after bounded termination');
}

/** All callers use this in finally, before deleting the disposable fixture. */
async function cleanupSmokeFixture({ app, repo, owner, workspaceRoots, children = [], servers = [], timeoutMs = 5000 }) {
  if (owner?.key !== OWNER_KEY || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(owner.value)) throw new Error('Missing unique fixture owner');
  const errors = [];
  // Playwright disposes its ElectronApplication mapping on close; cache the child now.
  let electronProcess;
  try { electronProcess = app?.process(); } catch (error) { errors.push(error); }
  let retired = 0;
  let handle;
  try {
    if (app && electronProcess && electronProcess.exitCode === null && electronProcess.signalCode === null) {
      handle = await bounded('Capture fixture PTYs', () => app.evaluateHandle((_electron, { entry, roots }) => {
        const require = process.getBuiltinModule('module').createRequire(entry);
        const native = require(entry);
        const path = require('node:path');
        const allowed = new Set(roots.map(root => path.resolve(root)));
        const entries = [...native.terminals];
        if (entries.some(([, terminal]) => !terminal.cwd || !allowed.has(path.resolve(terminal.cwd))
          || (terminal.environmentId && terminal.environmentId !== 'local'))) {
          throw new Error('Unexpected terminal outside fixture launch roots; refusing retirement');
        }
        // Keep references to exited promises: retirement deletes the table record synchronously.
        return entries.map(([id, terminal]) => ({ id, exited: terminal.exited }));
      }, { entry: path.join(repo, 'dist/main/main/main.js'), roots: workspaceRoots }), timeoutMs);
      const ids = await bounded('Read fixture PTY IDs', () => handle.evaluate(entries => entries.map(entry => entry.id)), timeoutMs);
      if (ids.length) {
        const page = app.windows().find(window => !window.isClosed());
        if (!page) throw new Error('Fixture renderer unavailable for terminal retirement');
        await bounded('Retire fixture PTYs', () => page.evaluate(async ids => {
          for (const id of ids) {
            const result = await window.electronAPI.killTerminal(id);
            if (!result?.success) throw new Error('Fixture terminal retirement refused');
          }
        }, ids), timeoutMs);
        await bounded('Verify fixture PTY exit', () => handle.evaluate(async entries => {
          if (entries.some(entry => !entry.exited)) throw new Error('Fixture PTY lacks exit evidence');
          await Promise.all(entries.map(entry => entry.exited));
        }), timeoutMs);
        retired = ids.length;
      }
      await bounded('Verify empty fixture terminal table', () => app.evaluate((_electron, entry) => {
        if (process.getBuiltinModule('module').createRequire(entry)(entry).terminals.size) throw new Error('Fixture terminals still registered');
      }, path.join(repo, 'dist/main/main/main.js')), timeoutMs);
      await bounded('Dispose PTY exit handle', () => handle.dispose(), timeoutMs);
      handle = undefined;
      let onExit;
      const exited = new Promise((resolve, reject) => {
        onExit = code => code === 0 ? resolve() : reject(new Error(`Fixture Electron exited with code ${code}`));
        if (electronProcess.exitCode !== null) onExit(electronProcess.exitCode);
        else electronProcess.once('exit', onExit);
      });
      // Playwright waits for ChildProcess 'close' (stdio drain), not just 'exit'.
      // Descendants can hold its pipes open after a normal Electron exit. Reap
      // fixture-owned dependents AFTER natural exit, then await the protocol close.
      const closing = Promise.resolve().then(() => app.close());
      try {
        await bounded('Close fixture Electron', () => Promise.race([closing, exited]), timeoutMs);
        if (electronProcess.exitCode !== 0) throw new Error('Fixture Electron did not exit naturally with code 0');
        for (const child of children) await stopChild(child);
        await stopTaggedProcesses(owner);
        await bounded('Drain fixture Electron close', () => closing, timeoutMs);
      } finally { electronProcess.removeListener('exit', onExit); }
    }
  } catch (error) { errors.push(error); }
  finally {
    if (handle) await bounded('Dispose PTY exit handle', () => handle.dispose(), timeoutMs).catch(() => {});
    // These still execute if renderer/IPC/app.close has failed or timed out.
    for (const server of servers) {
      try {
        await bounded('Close fixture loopback server', () => new Promise((resolve, reject) => {
          server.closeAllConnections();
          server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
        }), 2000);
      } catch (error) { errors.push(error); }
    }
    for (const child of children) {
      try { await stopChild(child); } catch (error) { errors.push(error); }
    }
    try { await stopTaggedProcesses(owner); } catch (error) { errors.push(error); }
    // On non-Linux no /proc fallback is available: only this owned Electron child
    // can be stopped; inability to verify its descendants is a failed cleanup.
    if (electronProcess && electronProcess.exitCode === null && electronProcess.signalCode === null) {
      errors.push(new Error('Electron did not exit normally'));
      try { await stopChild(electronProcess); } catch (error) { errors.push(error); }
    }
  }
  if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('; '));
  return { retiredFixturePtys: retired, verifiedPtyExit: true, cleanElectronExit: true };
}

module.exports = { createSmokeOwner, cleanupSmokeFixture };
