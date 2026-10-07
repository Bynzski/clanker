// Real Electron close/quit events with live PTYs, isolated from the user's app/profile.
// Run after build: npx electron scripts/app-close-guard-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const pty = require('node-pty');
const { AppCloseGuard } = require('../dist/main/main/appCloseGuard.js');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-close-smoke-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-dev-shm-usage');
const live = new Map();
let window, answer, prompts = 0, cleanup = 0, drained = false;
const waitFor = async (check) => {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Smoke check timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
const guard = new AppCloseGuard({
  hasRunningWork: () => live.size > 0,
  confirmClose: () => { prompts++; return new Promise(resolve => { answer = resolve; }); },
  closeWindow: () => window.close(), quit: () => app.quit(), windowCloseQuitsApp: true,
  onError: error => { throw error; },
});
const createWindow = async () => {
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  window.on('close', event => guard.beforeWindowClose(event));
  window.on('closed', () => guard.windowClosed());
  await window.loadURL('data:text/html,<p>Exited terminal scrollback can remain visible.</p>');
};
const spawn = command => {
  const child = pty.spawn('/bin/sh', ['-c', command], { cols: 80, rows: 24, env: process.env });
  live.set(child.pid, child);
  child.onExit(() => live.delete(child.pid));
  return child;
};
app.on('window-all-closed', () => {});
app.on('before-quit', event => {
  if (drained) return;
  if (!guard.beforeQuit(event)) return;
  event.preventDefault();
  if (cleanup) return;
  cleanup++;
  for (const child of live.values()) child.kill();
  void waitFor(() => live.size === 0).then(() => { drained = true; app.quit(); });
});
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
const timeout = setTimeout(() => { console.error('Close smoke timed out'); app.exit(1); }, 15000);
app.on('will-quit', () => {
  assert.equal(cleanup, 1);
  assert.equal(prompts, 3);
  assert(drained);
  clearTimeout(timeout);
  console.log('PASS: empty/exited close, live cancel, repeated requests, confirmed PTY drain and final quit');
});
app.whenReady().then(async () => {
  await createWindow();
  window.close();
  await waitFor(() => window.isDestroyed());
  assert.equal(prompts, 0);
  await createWindow();
  spawn('exit 0');
  await waitFor(() => live.size === 0);
  window.close();
  await waitFor(() => window.isDestroyed());
  assert.equal(prompts, 0);
  await createWindow();
  spawn('sleep 60');
  window.close(); window.close();
  await waitFor(() => prompts === 1);
  assert(!window.isDestroyed());
  answer(false);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(live.size, 1);
  assert.equal(cleanup, 0);
  app.quit();
  await waitFor(() => prompts === 2);
  answer(false);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(live.size, 1);
  assert.equal(cleanup, 0);
  app.quit(); app.quit();
  await waitFor(() => prompts === 3);
  answer(true);

}).catch(error => {
  console.error(error);
  for (const child of live.values()) child.kill();
  app.exit(1);
});
