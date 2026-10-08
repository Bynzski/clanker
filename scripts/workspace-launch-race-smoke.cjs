/* global window */
// Full-app UI + real local PTYs. Only the spawn RESPONSE is delayed, after main has created the PTY.
// No renderer bridge mocks. Disposable HOME/profile/project; never touches desktop workspaces.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-launch-race-'));
const profile = path.join(root, 'profile');
const project = path.join(root, 'project');
for (const name of ['home', 'config', 'cache', 'data', 'profile', 'project']) fs.mkdirSync(path.join(root, name));
fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({
  workspaceNavigationMode: 'tabs',
  harnessDefaults: Object.fromEntries(['codex', 'claude', 'pi', 'opencode', 'omp', 'hermes', 'agy'].map(id => [id,
    { model: '', favorites: [], flags: '', visible: false, usageVisible: false }])),
}));
fs.writeFileSync(path.join(root, 'home', '.bashrc'), "printf '__ISSUE89_READY__\\n'\n");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL', 'TZ'].includes(key)));
Object.assign(env, { NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', HOME: path.join(root, 'home'),
  XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'),
  SHELL: '/bin/bash', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const mainPath = path.join(repo, 'dist/main/main/main.js');
const channelsPath = path.join(repo, 'dist/main/shared/ipcChannels.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await predicate()) return; await pause(100); }
  throw new Error(message);
}
let app;
(async () => {
  try {
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'),
      args: [repo, `--user-data-dir=${profile}`, '--ozone-platform=headless'], env });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.waitForLoadState();
    await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(project);
    await page.getByRole('dialog').getByText('Where are we working today?').click();
    await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
    await page.getByRole('button', { name: 'Terminal', exact: true }).waitFor();
    // Browser presentation controls must occupy the existing header, not a row above it.
    await page.getByRole('button', { name: 'Toggle browser panel', exact: true }).click();
    const browserHeader = page.locator('.browser-pane-header');
    await browserHeader.getByRole('button', { name: 'Minimize pane', exact: true }).waitFor();
    await browserHeader.getByRole('button', { name: 'Maximize pane', exact: true }).waitFor();
    assert.equal(await page.locator('.utility-presentation-controls').count(), 0);
    const headerRect = await browserHeader.boundingBox();
    const controlsRect = await browserHeader.locator('.browser-pane-actions').boundingBox();
    assert(controlsRect.y >= headerRect.y && controlsRect.y + controlsRect.height <= headerRect.y + headerRect.height + 1);
    const versionRect = await page.locator('.status-left > .status-item').boundingBox();
    const pagesRect = await page.getByRole('navigation', { name: 'Workspace pages' }).boundingBox();
    assert(pagesRect.x >= versionRect.x + versionRect.width, 'Pages precede/overlap the version');
    const footerRect = await page.locator('.status-bar').boundingBox();
    await until(async () => {
      const bounds = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return window.contentView.children.filter(view => view.webContents && view.webContents !== window.webContents && view.getVisible())
          .map(view => view.getBounds());
      });
      return bounds.length === 1 && bounds[0].height > 0 && bounds[0].y + bounds[0].height <= footerRect.y + 1;
    }, 'Native Browser extends over the status bar');
    await page.getByRole('button', { name: 'Toggle browser panel', exact: true }).click();
    await until(() => page.locator('.browser-panel').count().then(count => count === 0), 'Browser did not hide');
    await app.evaluate(({ ipcMain }, channelsPath) => {
      const { SPAWN_TERMINAL } = process.getBuiltinModule('module').createRequire(channelsPath)(channelsPath);
      // Electron test-only instrumentation; the production registration and handler are unchanged.
      const original = ipcMain._invokeHandlers.get(SPAWN_TERMINAL);
      if (typeof original !== 'function') throw new Error('Cannot gate the registered spawn handler');
      const gate = globalThis.issue89SpawnGate = { armed: false, waiting: false };
      ipcMain.removeHandler(SPAWN_TERMINAL);
      ipcMain.handle(SPAWN_TERMINAL, async (...args) => {
        const info = await original(...args);
        if (!gate.armed) return info;
        gate.armed = false; gate.waiting = true; gate.info = info;
        await new Promise(resolve => { gate.release = resolve; });
        gate.waiting = false;
        return info;
      });
    }, channelsPath);
    await page.evaluate(() => {
      window.issue89Output = [];
      window.electronAPI.onTerminalData(event => window.issue89Output.push(event));
    });
    const armAndLaunch = async () => {
      await app.evaluate(() => { globalThis.issue89SpawnGate.armed = true; });
      await page.getByRole('button', { name: 'Terminal', exact: true }).click();
      await until(() => app.evaluate(() => globalThis.issue89SpawnGate.waiting), 'Real spawn did not reach response gate');
      return app.evaluate(() => globalThis.issue89SpawnGate.info);
    };
    const first = await armAndLaunch();
    assert(await app.evaluate((_electron, { mainPath, id }) => process.getBuiltinModule('module').createRequire(mainPath)(mainPath).terminals.has(id), { mainPath, id: first.id }));
    await page.getByRole('button', { name: 'Add page', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Page 2', exact: true }).getAttribute('aria-current'), 'page');
    await app.evaluate(() => globalThis.issue89SpawnGate.release());
    await until(() => page.evaluate(id => window.issue89Output.some(event => event.id === id && event.data.includes('__ISSUE89_READY__')), first.id),
      'Hidden startup never became ready / delivered buffered shell output');
    assert.equal(await page.getByRole('button', { name: 'Page 2', exact: true }).getAttribute('aria-current'), 'page');
    await until(() => page.locator('.background-terminal-surfaces .terminal-pane').count().then(count => count === 0),
      'Ready hidden terminal kept a background view');
    assert.equal(await page.locator('.split-root .terminal-pane').count(), 0);
    await page.getByRole('button', { name: 'Page 1', exact: true }).click();
    await page.locator('.split-root .terminal-pane .xterm-screen').first().waitFor();
    await page.getByRole('button', { name: 'Page 2', exact: true }).click();
    await page.evaluate(id => window.electronAPI.writeTerminal(id, "printf '__ISSUE89_CACHED__\\n'\r"), first.id);
    await until(() => page.evaluate(id => window.issue89Output.some(event => event.id === id && event.data.includes('__ISSUE89_CACHED__')), first.id),
      'Cached terminal stopped producing output');
    const late = await armAndLaunch();
    await page.getByRole('button', { name: 'Close workspace', exact: true }).click();
    await until(() => page.getByRole('button', { name: 'Terminal', exact: true }).count().then(count => count === 0), 'Workspace did not close');
    await app.evaluate(() => globalThis.issue89SpawnGate.release());
    await until(() => app.evaluate((_electron, mainPath) => process.getBuiltinModule('module').createRequire(mainPath)(mainPath).terminals.size === 0, mainPath), 'Late PTY remained untracked in main');
    await until(() => { try { process.kill(late.pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } },
      'Late spawned shell process survived cleanup');
    console.log(JSON.stringify({ passed: true, realPtyPageCapture: true, hiddenStartup: true,
      readyBackgroundViews: 0, cachedOutput: true, lateSpawnKilled: true,
      browserControlsInHeader: true, browserWithinFooter: true, pagesAfterVersion: true }, null, 2));
  } finally {
    if (app) {
      // Only fixture-owned terminals, including a gated one if an assertion failed.
      await app.evaluate(async (_electron, mainPath) => {
        const runtime = process.getBuiltinModule('module').createRequire(mainPath)(mainPath);
        runtime.killAllTerminals();
        globalThis.issue89SpawnGate?.release?.();
      }, mainPath).catch(() => {});
      await app.close();
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
