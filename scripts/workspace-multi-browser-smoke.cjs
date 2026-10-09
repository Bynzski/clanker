// Real native multi-Browser presentation leases. Run after build with Electron.
// Runs native/session regressions, then the full built-app renderer lease smoke.
// Manual live-harness/SSH acceptance remains separate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { registerBrowserIpc } = require('../dist/main/main/ipc/browserIpc.js');
const channels = require('../dist/main/shared/ipcChannels.js');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-multi-browser-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.on('web-contents-created', (_event, contents) => contents.session.webRequest.onBeforeRequest((details, callback) => {
  callback({ cancel: !details.url.startsWith('http://127.0.0.1:') && !details.url.startsWith('data:') });
}));
const handlers = new Map();
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => { handlers.set(channel, handler); originalHandle(channel, handler); };
const invoke = (channel, ...args) => handlers.get(channel)(null, ...args);
const waitFor = async (check) => {
  const deadline = Date.now() + 5000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for native Browser');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
let window, controller, activeOwner = null, epoch = 0;
const views = new Map();
const server = http.createServer((request, response) => {
  const identity = request.url?.includes('B') ? 'B' : 'A';
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<body style="background:${identity === 'A' ? '#ca3b3b' : '#34945e'}"><h1>Browser ${identity}</h1><input id="field" value="initial"><script>window.browserIdentity='${identity}';window.counter=${identity === 'A' ? 100 : 200}</script></body>`);
});
const timeout = setTimeout(() => { console.error('Multi-Browser smoke timed out'); app.exit(1); }, 30000);
app.on('quit', () => { clearTimeout(timeout); server.close(); fs.rmSync(profile, { recursive: true, force: true }); });
async function run() {
  await app.whenReady();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  window = new BrowserWindow({ width: 900, height: 650, show: true, focusable: false,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await window.loadURL('data:text/html,<body style="background:%23224466">Multi-Browser fixture</body>');
  controller = registerBrowserIpc({ getMainWindow: () => window, getBrowserViews: () => views,
    getActiveBrowserWorkspaceId: () => activeOwner, setActiveBrowserWorkspaceId: id => { activeOwner = id; },
    getWorkspaceEnvironmentKind: id => id === 'local' ? 'local' : ['ssh-one', 'ssh-two'].includes(id) ? 'ssh' : null });
  async function create(owner, pane, tab, identity) {
    await invoke(channels.BROWSER_CREATE_TAB, owner, tab, pane);
    assert(await invoke(channels.BROWSER_TAB_NAVIGATE, owner, tab, `${url}/${identity}`));
    const entry = views.get(owner).get(tab);
    await waitFor(() => entry.view.webContents.getURL() === `${url}/${identity}` && !entry.view.webContents.isLoading());
    return entry;
  }
  const a = await create('local', 'pane-a', 'tab-a', 'A');
  const background = await create('local', 'pane-a', 'tab-a2', 'A');
  const b = await create('local', 'pane-b', 'tab-b', 'B');
  const localContents = [a, b].map(entry => entry.view.webContents);
  const ids = [a, background, b].map(entry => entry.view.webContents.id);
  await a.view.webContents.executeJavaScript('window.counter=111;document.querySelector("input").value="A retained"');
  await b.view.webContents.executeJavaScript('window.counter=222;document.querySelector("input").value="B retained"');
  const states = async () => {
    assert.deepEqual(await a.view.webContents.executeJavaScript('[window.browserIdentity,window.counter,document.querySelector("input").value]'), ['A', 111, 'A retained']);
    assert.deepEqual(await b.view.webContents.executeJavaScript('[window.browserIdentity,window.counter,document.querySelector("input").value]'), ['B', 222, 'B retained']);
    assert.deepEqual([a, background, b].map(entry => entry.view.webContents.id), ids);
  };
  const boundsA = { x: 20, y: 40, width: 580, height: 400 };
  const boundsB = { x: 120, y: 80, width: 650, height: 460 };
  async function present(tab, pane, bounds) {
    const lease = { paneId: pane, epoch: ++epoch };
    assert(await invoke(channels.BROWSER_ACTIVATE, 'local', tab, lease));
    // Activation never borrows the outgoing page's geometry.
    assert(!a.view.getVisible() && !b.view.getVisible());
    await invoke(channels.BROWSER_SET_BOUNDS, 'local', bounds, tab, lease);
    assert.equal(a.view.getVisible(), tab === 'tab-a');
    assert.equal(b.view.getVisible(), tab === 'tab-b');
    assert(!background.view.getVisible());
    return lease;
  }
  let old = await present('tab-a', 'pane-a', boundsA);
  for (let i = 0; i < 30; i++) {
    const tab = i % 2 ? 'tab-a' : 'tab-b';
    const pane = i % 2 ? 'pane-a' : 'pane-b';
    const bounds = i % 2 ? boundsA : boundsB;
    const lease = await present(tab, pane, bounds);
    const selected = i % 2 ? a : b;
    const oldTab = i % 2 ? 'tab-b' : 'tab-a';
    assert.equal(await invoke(channels.BROWSER_ACTIVATE, 'local', oldTab, old), false);
    await invoke(channels.BROWSER_SET_BOUNDS, 'local', { x: 0, y: 0, width: 1, height: 1 }, oldTab, old);
    await invoke(channels.BROWSER_HIDE, 'local', old);
    assert.equal(await invoke(channels.BROWSER_SWITCH_TAB, 'local', oldTab, old), null);
    await invoke(channels.BROWSER_REFRESH, 'local', old);
    // Legacy operations cannot bypass an opted-in owner's lease.
    await invoke(channels.BROWSER_HIDE, 'local');
    await invoke(channels.BROWSER_SET_BOUNDS, 'local', boundsA, oldTab);
    assert.equal(await invoke(channels.BROWSER_SWITCH_TAB, 'local', oldTab), null);
    assert(selected.view.getVisible());
    assert.deepEqual(selected.view.getBounds(), bounds);
    await states();
    old = lease;
  }
  // Background navigation is independent of foreground selection/geometry.
  assert(await invoke(channels.BROWSER_TAB_NAVIGATE, 'local', 'tab-a2', `${url}/B`));
  await waitFor(() => !background.view.webContents.isLoading());
  assert(a.view.getVisible()); assert(!background.view.getVisible());
  await states();
  await invoke(channels.BROWSER_HIDE, 'local', old);
  assert(!a.view.getVisible() && !b.view.getVisible());
  assert.equal(await invoke(channels.BROWSER_ACTIVATE, 'local', 'tab-a', old), false);
  await present('tab-a', 'pane-a', boundsA);
  assert(await invoke(channels.BROWSER_CLOSE_TAB, 'local', 'tab-a2'));
  assert.equal(await invoke(channels.BROWSER_TAB_NAVIGATE, 'local', 'tab-a2', `${url}/A`), false);
  assert(!views.get('local').has('tab-a2'));
  // Local Browser panes share one persistent session. SSH panes share only their workspace's session.
  assert.equal(a.view.webContents.session, b.view.webContents.session);
  const c = await create('ssh-one', 'pane-c', 'tab-c', 'A');
  const d = await create('ssh-one', 'pane-d', 'tab-d', 'B');
  const e = await create('ssh-two', 'pane-e', 'tab-e', 'A');
  assert.equal(c.view.webContents.session, d.view.webContents.session);
  assert.notEqual(c.view.webContents.session, a.view.webContents.session);
  assert.notEqual(c.view.webContents.session, e.view.webContents.session);
  const privateContents = d.view.webContents;
  const privateSession = privateContents.session;
  await privateSession.cookies.set({ url, name: 'private-fixture', value: 'ssh-one' });
  assert.equal((await c.view.webContents.session.cookies.get({ name: 'private-fixture' }))[0].value, 'ssh-one');
  assert.equal((await e.view.webContents.session.cookies.get({ name: 'private-fixture' })).length, 0);
  assert.equal((await a.view.webContents.session.cookies.get({ name: 'private-fixture' })).length, 0);
  assert.equal(await invoke(channels.BROWSER_CLOSE_TAB, 'ssh-one', 'tab-c'), false);
  await create('ssh-one', 'pane-c', 'tab-c2', 'A');
  assert(await invoke(channels.BROWSER_CLOSE_TAB, 'ssh-one', 'tab-c'));
  assert.equal((await privateSession.cookies.get({ name: 'private-fixture' })).length, 1);
  controller.disposeWorkspace('ssh-one');
  await waitFor(() => privateContents.isDestroyed());
  await waitFor(async () => (await privateSession.cookies.get({ name: 'private-fixture' })).length === 0);
  assert(e.view.webContents && !e.view.webContents.isDestroyed());
  if (process.env.CLANKER_SMOKE_SCREENSHOT) {
    fs.writeFileSync(process.env.CLANKER_SMOKE_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  }
  controller.disposeWorkspace('local');
  await waitFor(() => localContents.every(contents => contents.isDestroyed()));
  controller.disposeAll(); assert.equal(views.size, 0);
  window.destroy();
  console.log('PASS: two native Browser panes retain independent JS/form/view state across 30 switches; stale activation/hide/bounds/switch/refresh rejected; background navigation/closed tabs safe; local/shared-SSH/isolated-SSH sessions and workspace cleanup verified');
  clearTimeout(timeout);
  const result = require('node:child_process').spawnSync('node', [path.join(__dirname, 'workspace-page-browser-renderer-smoke.cjs')], { stdio: 'inherit', env: process.env, timeout: 90000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Full renderer Browser smoke failed');
  app.quit();
}
run().catch(error => { console.error(error); controller?.disposeAll(); window?.destroy(); app.exit(1); });
