// Real Electron native Browser visibility/state with the shared page presentation functions.
// Temporary profile + loopback fixture only. Run after build: npx electron scripts/workspace-pages-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { app, BrowserWindow, ipcMain } = require('electron');
const { registerBrowserIpc } = require('../dist/main/main/ipc/browserIpc.js');
const channels = require('../dist/main/shared/ipcChannels.js');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-pages-smoke-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-dev-shm-usage');
// Block the Browser's default public URL; the smoke never depends on outside connectivity.
app.on('web-contents-created', (_event, contents) => contents.session.webRequest.onBeforeRequest((details, callback) => {
  callback({ cancel: !details.url.startsWith('http://127.0.0.1:') && !details.url.startsWith('data:') });
}));

const modules = new Map();
function loadRendererTs(file) {
  file = path.resolve(__dirname, '..', file);
  if (modules.has(file)) return modules.get(file);
  const module = { exports: {} };
  modules.set(file, module.exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const localRequire = id => id.startsWith('.') ? loadRendererTs(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(file), id + '.ts'))) : require(id);
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  modules.set(file, module.exports);
  return module.exports;
}
const { synchronizePages, selectPage, minimizePane, restorePane, workspaceBrowserPresented } = loadRendererTs('src/renderer/store/workspacePages.ts');
const handlers = new Map();
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (id, handler) => { handlers.set(id, handler); originalHandle(id, handler); };
const invoke = (channel, ...args) => handlers.get(channel)(null, ...args);
const waitFor = async check => {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Native Browser load timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
};
let window, controller, activeOwner = null;
const views = new Map();
const server = http.createServer((_req, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<body style="background:#ca3b3b"><input id="field" value="retained"><script>window.counter=42</script></body>'); });
const timeout = setTimeout(() => { console.error('Workspace pages smoke timed out'); app.exit(1); }, 20000);
app.on('quit', () => { clearTimeout(timeout); server.close(); fs.rmSync(profile, { recursive: true, force: true }); });

async function run() {
  await app.whenReady();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  window = new BrowserWindow({ width: 900, height: 650, show: true, focusable: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await window.loadURL('data:text/html,<body style="background:%23224466">Page surface</body>');
  controller = registerBrowserIpc({ getMainWindow: () => window, getBrowserViews: () => views,
    getActiveBrowserWorkspaceId: () => activeOwner, setActiveBrowserWorkspaceId: id => { activeOwner = id; }, getWorkspaceEnvironmentKind: () => 'local' });
  await invoke(channels.BROWSER_CREATE_TAB, 'workspace', 'tab');
  assert(await invoke(channels.BROWSER_TAB_NAVIGATE, 'workspace', 'tab', url));
  const entry = views.get('workspace').get('tab');
  const nativeId = entry.view.webContents.id;
  await waitFor(() => entry.view.webContents.getURL().startsWith(url) && !entry.view.webContents.isLoading());
  await entry.view.webContents.executeJavaScript('window.counter=99;document.getElementById("field").value="saved state"');
  let workspace = synchronizePages(undefined, {
    id: 'workspace', panes: [{ id: 'agent-pane', terminalId: 'terminal' }], terminals: [{ id: 'terminal', pid: 123 }], activeTerminalId: 'terminal',
    browserVisible: true, browserPane: { id: 'browser', tabs: [{ id: 'tab', url }], activeTabId: 'tab' }, editorVisible: false, notesVisible: false,
    layoutRoot: { type: 'split', nodeId: 'split', orientation: 'horizontal', ratio: .6, first: { type: 'leaf', nodeId: 'agent', paneId: 'agent-pane' }, second: { type: 'leaf', nodeId: 'browser-node', paneId: 'browser' } },
  });
  const originalRoot = workspace.layoutRoot;
  const originalPage = workspace.activePageId;
  workspace = { ...workspace, pages: [...workspace.pages, { id: 'two', layoutRoot: null, layoutRevision: 0, layoutUndoStack: [], activeTerminalId: null }] };
  const reconcile = async () => {
    if (workspaceBrowserPresented(workspace)) {
      await invoke(channels.BROWSER_ACTIVATE, 'workspace', 'tab');
      await invoke(channels.BROWSER_SET_BOUNDS, 'workspace', { x: 10, y: 10, width: 600, height: 400 }, 'tab');
    } else await invoke(channels.BROWSER_HIDE, 'workspace');
    assert.equal(entry.view.getVisible(), workspaceBrowserPresented(workspace));
  };
  await reconcile(); assert(entry.view.getVisible());
  workspace = selectPage(workspace, 'two'); await reconcile(); assert(!entry.view.getVisible());
  // Late geometry and tab completion must not reclaim visibility after page hide.
  await invoke(channels.BROWSER_SET_BOUNDS, 'workspace', { x: 10, y: 10, width: 500, height: 400 }, 'tab');
  await invoke(channels.BROWSER_SWITCH_TAB, 'workspace', 'tab'); assert(!entry.view.getVisible());
  workspace = selectPage(workspace, originalPage); await reconcile();
  workspace = synchronizePages(workspace, minimizePane(workspace, 'browser')); await reconcile();
  workspace = synchronizePages(workspace, restorePane(workspace, 'browser')); await reconcile();
  workspace = { ...workspace, pages: workspace.pages.map(page => page.id === originalPage ? { ...page, maximizedPaneId: 'agent-pane' } : page) };
  await reconcile(); assert(!entry.view.getVisible());
  workspace = { ...workspace, pages: workspace.pages.map(page => ({ ...page, maximizedPaneId: undefined })) }; await reconcile();
  for (let i = 0; i < 10; i++) { workspace = selectPage(workspace, 'two'); await reconcile(); workspace = selectPage(workspace, originalPage); await reconcile(); }
  assert.equal(entry.view.webContents.id, nativeId);
  assert.deepEqual(await entry.view.webContents.executeJavaScript('[window.counter,document.getElementById("field").value]'), [99, 'saved state']);
  assert.equal(workspace.layoutRoot.ratio, originalRoot.ratio);
  assert.equal(workspace.terminals[0].id, 'terminal');
  controller.disposeAll(); window.destroy();
  console.log('PASS: real native Browser hides on inactive/minimized/maximize-occluded pages; late bounds/tab calls stay hidden; tab identity/form/JS state survives rapid switching');
  app.quit();
}
run().catch(error => { console.error(error); controller?.disposeAll(); window?.destroy(); app.exit(1); });
