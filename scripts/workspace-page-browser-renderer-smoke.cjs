/* global window */
// Full built app: real renderer-issued leases, native views, pointer drags and local fixtures.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-browser-renderer-'));
for (const name of ['home', 'config', 'cache', 'data', 'profile', 'project', 'tmp']) fs.mkdirSync(path.join(root, name));
fs.writeFileSync(path.join(root, 'profile/config.json'), JSON.stringify({ harnessDefaults: Object.fromEntries(['codex', 'claude', 'pi', 'opencode', 'omp', 'hermes', 'agy'].map(id => [id, { model: '', favorites: [], flags: '', visible: false, usageVisible: false }])) }));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'].includes(key)));
Object.assign(env, { NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash', TMPDIR: path.join(root, 'tmp'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const server = http.createServer((request, response) => {
  const identity = request.url?.includes('/B') ? 'B' : 'A';
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<title>Fixture ${identity}</title><body style="background:${identity === 'A' ? '#cf7777' : '#77cf99'}"><h1>Browser ${identity}</h1><input id="field" value="initial"><script>window.browserIdentity='${identity}';window.counter=${identity === 'A' ? 100 : 200}</script></body>`);
});
const channelsPath = path.join(repo, 'dist/main/shared/ipcChannels.js');
let app;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await pause(40); }
  throw new Error(message);
}
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'),
      args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, `--ozone-platform=${process.env.WAYLAND_DISPLAY ? 'wayland' : 'headless'}`], env });
    const page = await app.firstWindow(); page.setDefaultTimeout(10000);
    await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(path.join(root, 'project'));
    await page.getByRole('dialog').getByText('Where are we working today?').click();
    await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
    await page.getByRole('button', { name: 'New Agent', exact: true }).waitFor();
    await app.evaluate(({ session }, base) => {
      globalThis.browserAddressSearchRequests = [];
      session.fromPartition('persist:browser-global').webRequest.onBeforeRequest((details, callback) => {
        if (details.url.startsWith('https://www.google.com/search?')) {
          globalThis.browserAddressSearchRequests.push(details.url);
          callback({ redirectURL: `${base}/search${new URL(details.url).search}` });
        } else callback({ cancel: !details.url.startsWith(base) && !details.url.startsWith('file:') });
      });
    }, base);
    await app.evaluate(({ ipcMain }, channelsPath) => {
      const channels = process.getBuiltinModule('module').createRequire(channelsPath)(channelsPath);
      const handler = ipcMain._invokeHandlers.get(channels.BROWSER_SET_BOUNDS);
      globalThis.browserSmokeBounds = [];
      ipcMain.removeHandler(channels.BROWSER_SET_BOUNDS);
      ipcMain.handle(channels.BROWSER_SET_BOUNDS, (...args) => {
        globalThis.browserSmokeBounds.push(args.slice(1));
        return handler(...args);
      });
      globalThis.browserSmokeBoundsHandler = handler;
    }, channelsPath);
    const select = n => page.getByRole('button', { name: `Page ${n}`, exact: true }).click();
    const toggle = () => page.getByRole('button', { name: 'Toggle browser panel', exact: true }).click();
    const views = () => app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.contentView.children.filter(view => view.webContents && view.webContents !== win.webContents)
        .map(view => ({ id: view.webContents.id, url: view.webContents.getURL(), visible: view.getVisible(), bounds: view.getBounds() }));
    });
    const navigate = async identity => {
      await page.locator('.browser-toolbar input').fill(`${base}/${identity}`);
      await page.locator('.browser-toolbar input').press('Enter');
      await until(async () => (await views()).some(view => view.visible && view.url === `${base}/${identity}`), `Browser ${identity} failed to navigate`);
    };
    await toggle(); await navigate('A');
    const initialVisit = await page.evaluate(async base => (await window.electronAPI.browserHistoryGet()).find(entry => entry.url === `${base}/A`).lastVisited, base);
    await app.evaluate(({ webContents }, base) => webContents.getAllWebContents().find(contents => contents.getURL() === `${base}/A`).executeJavaScript('document.title="Updated searchable fixture"'), base);
    await until(() => page.evaluate(async base => (await window.electronAPI.browserHistoryGet('updated searchable')).some(entry => entry.url === `${base}/A`), base), 'Late page title was not searchable');
    assert.equal(await page.evaluate(async () => (await window.electronAPI.browserHistoryGet('updated searchable'))[0].lastVisited), initialVisit, 'Title update changed visit recency');
    const address = page.getByRole('combobox', { name: 'Search Google or enter address' });
    await page.evaluate(async () => {
      for (const [url, title] of [
        ['https://chatgpt.com/c/old-hash', 'Old conversation'],
        ['https://chatgpt.com/c/new-hash#message', 'New conversation'],
        ['http://localhost:8000/old', 'Older local app'],
        ['http://127.0.0.1:8000/recent', 'Recent local app'],
        ['https://example.com/posts/8000', '8000 localhost tips'],
      ]) await window.electronAPI.browserHistoryAdd(url, title);
    });
    const firstHistory = page.getByRole('listbox', { name: 'Browser suggestions' }).getByRole('option').nth(1);
    await address.fill('chat');
    await until(() => firstHistory.getAttribute('aria-label').then(label => label === 'Website chatgpt.com https://chatgpt.com/'), 'Site homepage was buried behind conversation hashes');
    await until(() => views().then(items => items.every(view => !view.visible)), 'Native Browser covered search suggestions');
    if (process.env.CLANKER_SMOKE_ADDRESS_SCREENSHOT) await page.screenshot({ path: process.env.CLANKER_SMOKE_ADDRESS_SCREENSHOT });
    await address.fill('localhost');
    await until(() => firstHistory.getAttribute('aria-label').then(label => label === 'Recent local app http://127.0.0.1:8000/recent'), 'Localhost did not prioritize recent loopback services');
    await address.fill('8000');
    await until(() => firstHistory.getAttribute('aria-label').then(label => label === 'Recent local app http://127.0.0.1:8000/recent'), 'Port query did not rank exact local ports first');
    await address.press('Escape');
    await until(() => views().then(items => items.some(view => view.visible && view.url === `${base}/A`)), 'Escape did not restore native Browser');
    await address.fill(String(server.address().port));
    await until(() => firstHistory.getAttribute('aria-label').then(label => label?.includes(`${base}/A`)), 'Current fixture port not found in history');
    await address.press('ArrowDown');
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await until(() => views().then(items => items.some(view => view.visible && view.url === `${base}/A`)), 'Go ignored explicitly selected history');
    for (const [query, method] of [['react effect cleanup', 'Enter'], ['8000', 'Go']]) {
      await address.fill(query);
      // Wait for history to arrive before submitting: it must never steal the default action.
      await pause(200);
      if (method === 'Enter') await address.press('Enter');
      else await page.getByRole('button', { name: 'Go', exact: true }).click();
      await until(() => app.evaluate((_electron, query) => globalThis.browserAddressSearchRequests.includes(`https://www.google.com/search?q=${encodeURIComponent(query)}`), query), `${method} did not submit the typed Google search`);
      await until(() => views().then(items => items.some(view => view.visible && view.url === `${base}/search?q=${encodeURIComponent(query)}`)), 'Search results did not open in the same native Browser');
    }
    const localFile = path.join(root, 'project', 'report #1.html');
    fs.writeFileSync(localFile, '<title>Local report</title><h1>Local path with hash</h1>');
    await address.fill(localFile); await address.press('Enter');
    await until(() => views().then(items => items.some(view => view.visible && view.url.endsWith('/report%20%231.html'))), 'Local path characters were not preserved');
    await address.fill('javascript:alert(1)'); await address.press('Enter');
    await page.getByRole('alert').filter({ hasText: 'Enter a valid HTTP(S)' }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.browserAddressSearchRequests.length), 2);
    await address.press('Escape');
    await navigate('A');
    const aId = (await views()).find(view => view.url === `${base}/A`).id;
    await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('window.counter=111;document.querySelector("input").value="A retained"'), aId);
    const aBounds = await app.evaluate(() => globalThis.browserSmokeBounds.at(-1));
    assert(aBounds[3]?.paneId && Number.isSafeInteger(aBounds[3].epoch), 'Renderer did not issue a presentation lease');
    await page.getByRole('button', { name: 'Add page', exact: true }).click();
    await app.evaluate(({ ipcMain }, channelsPath) => {
      const { BROWSER_CREATE_TAB } = process.getBuiltinModule('module').createRequire(channelsPath)(channelsPath);
      const original = ipcMain._invokeHandlers.get(BROWSER_CREATE_TAB);
      globalThis.browserSmokeCreation = { armed: true, waiting: false };
      ipcMain.removeHandler(BROWSER_CREATE_TAB);
      ipcMain.handle(BROWSER_CREATE_TAB, async (...args) => {
        const result = await original(...args);
        const gate = globalThis.browserSmokeCreation;
        if (gate.armed) { gate.armed = false; gate.waiting = true; await new Promise(resolve => { gate.release = resolve; }); gate.waiting = false; }
        return result;
      });
    }, channelsPath);
    await toggle();
    await until(() => app.evaluate(() => globalThis.browserSmokeCreation.waiting), 'Creation did not reach delay gate');
    await select(1);
    await app.evaluate(() => globalThis.browserSmokeCreation.release());
    await until(async () => (await views()).filter(view => view.visible).every(view => view.id === aId), 'Delayed B creation stole A visibility');
    await select(2); await navigate('B');
    const bId = (await views()).find(view => view.url === `${base}/B`).id;
    assert.notEqual(aId, bId);
    await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('window.counter=222;document.querySelector("input").value="B retained"'), bId);
    assert.equal(await page.locator('.browser-tab').count(), 1);
    // URL autocomplete is a real overlay lease; switching pages must retire it safely.
    await page.locator('.browser-toolbar input').fill(`${base}/`);
    await page.getByRole('listbox', { name: 'Browser suggestions' }).waitFor();
    await until(() => views().then(items => items.every(view => !view.visible)), 'Browser overlaid URL suggestions');
    await select(1);
    await until(async () => (await views()).some(view => view.visible && view.id === aId), 'Overlay page switch lost A');
    await select(2);
    await until(async () => (await views()).some(view => view.visible && view.id === bId), 'Overlay cleanup hid B');
    const bBefore = (await views()).find(view => view.id === bId).bounds;
    await app.evaluate((_electron, args) => globalThis.browserSmokeBoundsHandler(null, ...args), aBounds);
    assert.deepEqual((await views()).find(view => view.id === bId).bounds, bBefore);
    await page.getByRole('button', { name: 'New tab', exact: true }).click();
    await until(() => page.locator('.browser-tab').count().then(n => n === 2), 'B tab was not created');
    await page.getByRole('tablist', { name: 'Browser tabs' }).getByRole('tab').first().click();
    const assertSelected = async id => until(async () => {
      const selected = (await views()).filter(view => view.visible);
      return selected.length === 1 && selected[0].id === id;
    }, 'Wrong native foreground Browser');
    for (let i = 0; i < 12; i++) {
      await select(1); await assertSelected(aId); assert.equal(await page.locator('.browser-tab').count(), 1);
      await select(2); await assertSelected(bId); assert.equal(await page.locator('.browser-tab').count(), 2);
    }
    await select(1); await assertSelected(aId);
    await page.locator('.browser-pane-header').getByRole('button', { name: 'Minimize pane', exact: true }).click();
    await until(() => views().then(items => items.every(view => !view.visible)), 'Minimized Browser stayed visible');
    await select(2); await assertSelected(bId);
    await select(1); await toggle(); await assertSelected(aId);
    await page.locator('.browser-pane-header').getByRole('button', { name: 'Maximize pane', exact: true }).click();
    await assertSelected(aId);
    await page.locator('.browser-pane-header').getByRole('button', { name: 'Restore pane size', exact: true }).click();
    await toggle(); await until(() => views().then(items => items.every(view => !view.visible)), 'Hidden Browser stayed visible');
    await toggle(); await assertSelected(aId);
    const drag = async (destination, valid) => {
      const from = await page.locator('.browser-pane-header .pane-drag-surface').boundingBox();
      const to = await destination.boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down(); await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2);
      await until(() => destination.evaluate((button, valid) => button.classList.contains(valid ? 'page-drop-valid' : 'page-drop-invalid'), valid), 'Incorrect occupied drop feedback');
      await pause(120);
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
      await page.mouse.up(); await pause(100);
    };
    await drag(page.getByRole('button', { name: 'Page 2', exact: true }), false);
    assert.equal(await page.getByRole('button', { name: 'Page 1', exact: true }).getAttribute('aria-current'), 'page');
    await assertSelected(aId);
    await drag(page.getByRole('button', { name: 'Add page', exact: true }), true);
    assert.equal(await page.getByRole('button', { name: 'Page 3', exact: true }).getAttribute('aria-current'), 'page');
    await assertSelected(aId);
    await select(2); await assertSelected(bId);
    for (const [id, identity, counter] of [[aId, 'A', 111], [bId, 'B', 222]]) {
      assert.deepEqual(await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('[window.browserIdentity,window.counter,document.querySelector("input").value]'), id), [identity, counter, `${identity} retained`]);
    }
    await page.locator('.browser-tab-close').last().click();
    assert.equal(await page.locator('.browser-tab').count(), 1);
    assert.equal(await page.locator('.browser-tab-close').isDisabled(), true);
    if (process.env.CLANKER_SMOKE_SCREENSHOT) {
      await page.screenshot({ path: process.env.CLANKER_SMOKE_SCREENSHOT });
      await app.evaluate(async ({ webContents }, { id, file }) => {
        process.getBuiltinModule('fs').writeFileSync(file, (await webContents.fromId(id).capturePage()).toPNG());
      }, { id: bId, file: `${process.env.CLANKER_SMOKE_SCREENSHOT}.native.png` });
    }
    // Renderer uses V2 preferences, without serialized JavaScript/PTY state.
    assert(await page.evaluate(() => Object.entries(window.localStorage).some(([key, value]) => key.startsWith('clanker-grid:workspace-pages:v2:') && JSON.parse(value).browsers.length === 2)));
    await page.getByRole('button', { name: 'Close workspace', exact: true }).click();
    await until(() => views().then(items => items.length === 0), 'Workspace closure orphaned native Browser views');
    console.log('PASS: late searchable titles without visit churn; Google search via Enter/Go; local port/homepage ranking; explicit history selection; escaped local files; invalid schemes; full renderer leases; independent tabs/native JS/forms; 24 page transitions; delayed creation/stale geometry/overlay cleanup; minimize/restore/maximize/hide; occupied pointer drop rejection; Browser movement; V2 persistence; workspace view disposal');
  } finally {
    await app?.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
