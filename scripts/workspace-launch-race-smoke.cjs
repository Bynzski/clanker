/* global window, document, getComputedStyle */
// Full-app UI + real local PTYs. Only the spawn RESPONSE is delayed, after main has created the PTY.
// No renderer bridge mocks. Disposable HOME/profile/project; never touches desktop workspaces.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const preview = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<title>Pane move fixture</title><input id="kept" value="initial">'); });
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
    await new Promise(resolve => preview.listen(0, '127.0.0.1', resolve));
    const previewUrl = `http://127.0.0.1:${preview.address().port}`;
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
    // Representative meter markup checks production CSS geometry, not live account telemetry.
    assert(await page.evaluate(() => {
      const footer = document.querySelector('.status-bar'), widget = document.querySelector('.usage-widget');
      const before = footer.getBoundingClientRect(), ready = document.querySelector('.status-right > .status-item').getBoundingClientRect();
      const fixtures = [55, 100, 7].map(percent => {
        const chip = document.createElement('span'); chip.className = 'usage-chip ok';
        chip.innerHTML = `<svg width="11" height="11"></svg><span class="usage-chip-meter"><span class="usage-chip-percent">${percent}%</span><span class="usage-chip-bar"><span class="usage-chip-fill"></span></span></span><span class="usage-chip-time"><svg width="8" height="8"></svg>4h</span>`;
        widget.append(chip); return chip;
      });
      const box = widget.getBoundingClientRect(), after = footer.getBoundingClientRect();
      const valid = fixtures.every(chip => {
        const label = chip.querySelector('.usage-chip-percent').getBoundingClientRect();
        const bar = chip.querySelector('.usage-chip-bar').getBoundingClientRect();
        return label.bottom <= bar.top && label.top >= box.top && bar.bottom <= box.bottom && bar.width === 28
          && chip.getBoundingClientRect().height === 18 && getComputedStyle(chip).boxShadow !== 'none';
      });
      const afterReady = document.querySelector('.status-right > .status-item').getBoundingClientRect();
      const originalWidth = footer.style.width; footer.style.width = '800px';
      const left = document.querySelector('.status-left').getBoundingClientRect();
      const middle = document.querySelector('.status-center').getBoundingClientRect();
      const right = document.querySelector('.status-right').getBoundingClientRect();
      const narrowFits = left.right <= middle.left && middle.right <= right.left
        && widget.getBoundingClientRect().right <= footer.getBoundingClientRect().right;
      footer.style.width = originalWidth;
      fixtures.forEach(chip => chip.remove());
      return valid && narrowFits && box.height === 20 && before.height === 26 && after.height === 26 && before.top === after.top && ready.x === afterReady.x;
    }), 'Grouped usage meters exceed the 26px footer, wrap, or shift Ready');
    assert(await page.evaluate(() => {
      const center = document.querySelector('.status-center'), name = center.querySelector('.status-project-name');
      const original = name.textContent;
      const branch = document.createElement('span'); branch.className = 'status-branch';
      branch.innerHTML = '<svg width="12" height="12"></svg><span>feature/workspace-pages-ui</span>';
      center.append(branch); name.textContent = 'clanker';
      const label = branch.querySelector('span');
      const fullWhenRoom = name.scrollWidth <= name.clientWidth + 1 && label.scrollWidth <= label.clientWidth + 1;
      name.textContent = 'long-project-name-'.repeat(50); label.textContent = 'feature/long-branch-name-'.repeat(50);
      const left = document.querySelector('.status-left').getBoundingClientRect(), middle = center.getBoundingClientRect();
      const right = document.querySelector('.status-right').getBoundingClientRect();
      const constrained = name.scrollWidth > name.clientWidth && label.scrollWidth > label.clientWidth
        && left.right <= middle.left + 1 && middle.right <= right.left + 1;
      branch.remove(); name.textContent = original;
      return fullWhenRoom && constrained;
    }), 'Folder/branch truncate with free space or overlap neighboring controls under pressure');
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
    assert(await page.evaluate(() => {
      const selected = document.querySelector('.workspace-page-switcher [aria-current="page"]');
      const inactive = document.querySelector('.workspace-page-switcher button:not([aria-current])');
      return selected.getBoundingClientRect().height === 22 && getComputedStyle(selected).boxShadow !== 'none'
        && getComputedStyle(selected).backgroundColor !== getComputedStyle(inactive).backgroundColor;
    }), 'Active page lacks an accent state or changes button height');
    await app.evaluate(() => globalThis.issue89SpawnGate.release());
    await until(() => page.evaluate(id => window.issue89Output.some(event => event.id === id && event.data.includes('__ISSUE89_READY__')), first.id),
      'Hidden startup never became ready / delivered buffered shell output');
    assert.equal(await page.getByRole('button', { name: 'Page 2', exact: true }).getAttribute('aria-current'), 'page');
    await until(() => page.locator('.background-terminal-surfaces .terminal-pane').count().then(count => count === 0),
      'Ready hidden terminal kept a background view');
    assert.equal(await page.locator('.split-root .terminal-pane').count(), 0);
    await page.getByRole('button', { name: 'Page 1', exact: true }).click();
    await page.locator('.split-root .terminal-pane .xterm-screen').first().waitFor();
    const dragTo = async (handle, destination) => {
      const from = await handle.boundingBox(), to = await destination.boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down(); await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2);
      await until(() => destination.evaluate(button => button.classList.contains('page-drop-valid')), 'Footer target did not advertise a valid drag');
      await pause(100); // Native Browser must be hidden before traversing its content during drag.
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
      await until(() => destination.evaluate(button => button.classList.contains('page-drop-over')), 'Footer target did not receive pointer collision');
      await page.mouse.up();
      await pause(100); // dnd-kit intentionally suppresses the post-drag click for 50ms.
    };
    const terminalHandle = () => page.locator('.terminal-header .pane-drag-surface').first();
    await dragTo(terminalHandle(), page.getByRole('button', { name: 'Page 2', exact: true }));
    await until(() => page.getByRole('button', { name: 'Page 2', exact: true }).getAttribute('aria-current').then(value => value === 'page'), 'Drop did not select empty destination');
    await dragTo(terminalHandle(), page.getByRole('button', { name: 'Add page', exact: true }));
    await until(() => page.getByRole('button', { name: 'Page 3', exact: true }).getAttribute('aria-current').then(value => value === 'page'), '+ drop did not create/select exactly one page');
    assert.equal(await page.getByRole('navigation', { name: 'Workspace pages' }).getByRole('button', { name: /^Page / }).count(), 3);
    assert(await app.evaluate((_electron, { mainPath, id }) => process.getBuiltinModule('module').createRequire(mainPath)(mainPath).terminals.has(id), { mainPath, id: first.id }));
    assert.equal(await page.locator('.split-root .terminal-pane').count(), 1);
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await until(async () => { const names = await page.locator('.terminal-title').allTextContents(); return names.length === 2 && !names.includes('Terminal'); }, 'Second shell did not register');
    const beforeSwap = await page.locator('.terminal-title').allTextContents();
    const swapFrom = await page.locator('.terminal-header .pane-drag-surface').last().boundingBox();
    await page.mouse.move(swapFrom.x + swapFrom.width / 2, swapFrom.y + swapFrom.height / 2); await page.mouse.down();
    await page.mouse.move(swapFrom.x + swapFrom.width / 2 + 10, swapFrom.y + swapFrom.height / 2);
    await until(() => page.locator('.pane-dock-overlay.active').count().then(count => count > 0), 'Within-page targets did not activate');
    const swapTo = await page.locator('.pane-dock-overlay.active .zone-center').first().boundingBox();
    await page.mouse.move(swapTo.x + swapTo.width / 2, swapTo.y + swapTo.height / 2, { steps: 15 }); await page.mouse.up();
    await until(async () => JSON.stringify(await page.locator('.terminal-title').allTextContents()) === JSON.stringify([...beforeSwap].reverse()), 'Existing within-page swap regressed');
    await pause(100);
    for (let count = 3; count < 9; count++) await page.getByRole('button', { name: 'Add page', exact: true }).click();
    await page.getByRole('button', { name: 'Page 3', exact: true }).click();
    const disabledPlus = page.getByRole('button', { name: 'Add page', exact: true });
    assert(await disabledPlus.isDisabled());
    const layoutSignature = () => page.evaluate(() => JSON.stringify({
      titles: [...document.querySelectorAll('.terminal-title')].map(node => node.textContent),
      groups: [...document.querySelectorAll('.split-root .split-group')].map(node => [node.id, node.className]),
    }));
    for (const target of [disabledPlus, page.locator('.status-right > .status-item').first()]) {
      const unchanged = await layoutSignature();
      const from = await terminalHandle().boundingBox(), to = await target.boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2);
      await until(() => page.locator('.pane-dock-overlay.active').count().then(count => count > 0), 'Invalid-footer drag did not activate');
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 }); await page.mouse.up(); await pause(100);
      await until(() => page.locator('.pane-dock-overlay.active').count().then(count => count === 0), 'Invalid-footer drop did not finish');
      assert.equal(await layoutSignature(), unchanged, 'Invalid footer drop rearranged tiled panes');
      assert.equal(await page.getByRole('button', { name: 'Page 3', exact: true }).getAttribute('aria-current'), 'page');
      assert.equal(await page.getByRole('navigation', { name: 'Workspace pages' }).getByRole('button', { name: /^Page / }).count(), 9);
    }
    await page.getByRole('button', { name: 'Page 2', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle notes panel', exact: true }).click();
    await page.locator('.notes-editor').fill('note survives a populated-page drop');
    await page.getByRole('button', { name: 'Page 3', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle browser panel', exact: true }).click();
    await page.locator('.browser-url-input').fill(previewUrl);
    await page.locator('.browser-url-input').press('Enter');
    await until(() => app.evaluate(({ BrowserWindow }, url) => {
      const win = BrowserWindow.getAllWindows()[0];
      const view = win.contentView.children.find(view => view.webContents && view.webContents !== win.webContents && view.getVisible());
      return view?.webContents.getURL().startsWith(url) && !view.webContents.isLoading();
    }, previewUrl), 'Local Browser fixture did not load');
    const browserState = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const view = win.contentView.children.find(view => view.webContents && view.webContents !== win.webContents && view.getVisible());
      while (view.webContents.isLoading()) await new Promise(resolve => setTimeout(resolve, 50));
      await view.webContents.executeJavaScript("document.getElementById('kept').value='retained';window.moveCounter=42");
      return view.webContents.id;
    });
    await dragTo(page.locator('.browser-pane-header .pane-drag-surface'), page.getByRole('button', { name: 'Page 2', exact: true }));
    await until(() => page.getByRole('button', { name: 'Page 2', exact: true }).getAttribute('aria-current').then(value => value === 'page'), 'Browser drop did not select populated destination');
    assert.equal(await page.locator('.notes-editor').inputValue(), 'note survives a populated-page drop');
    await until(() => app.evaluate(async ({ BrowserWindow }, expected) => {
      const win = BrowserWindow.getAllWindows()[0];
      const view = win.contentView.children.find(view => view.webContents && view.webContents !== win.webContents && view.getVisible());
      return view?.webContents.id === expected && await view.webContents.executeJavaScript("document.getElementById('kept')?.value === 'retained' && window.moveCounter === 42");
    }, browserState), 'Browser identity/form/JS state was lost on page movement');
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
      browserControlsInHeader: true, browserWithinFooter: true, pagesAfterVersion: true,
      realCrossPageDrag: true, plusDropCreatesPage: true, browserMovePreservesState: true,
      populatedDestinationNotesPreserved: true, stackedUsageFitsFooter: true, groupedUsageFits26px: true, truncationOnlyWhenConstrained: true, withinPageSwap: true, disabledPlusAndFooterDropsDoNotDock: true, minimumWidthUsageFooter: true }, null, 2));
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
    await new Promise(resolve => preview.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
