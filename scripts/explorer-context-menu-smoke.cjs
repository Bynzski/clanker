// Built renderer/preload/native Browser, isolated profile and local files; no live user workspace.
const { _electron: electron } = require('playwright');
const { createSmokeOwner, cleanupSmokeFixture } = require('./lib/smoke-fixture-cleanup.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-explorer-menu-'));
const owner = createSmokeOwner();
for (const name of ['home', 'config', 'cache', 'data', 'profile', 'project']) fs.mkdirSync(path.join(root, name));
const project = path.join(root, 'project');
fs.writeFileSync(path.join(project, 'fixture.txt'), 'owned fixture\n');
for (const name of ['one', 'two']) fs.writeFileSync(path.join(project, `${name}.html`), `<title>${name}</title><h1>${name}</h1>`);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'].includes(key)));
Object.assign(env, { [owner.key]: owner.value, NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', HOME: path.join(root, 'home'),
  XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await pause(40); }
  throw new Error(message);
}
let app;
(async () => {
  try {
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'),
      args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, `--ozone-platform=${process.env.DISPLAY ? 'x11' : 'headless'}`], env });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(project);
    await page.getByRole('dialog').getByText('Where are we working today?').click();
    await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
    await page.getByRole('button', { name: 'Expand Files', exact: true }).click();
    await page.getByText('fixture.txt', { exact: true }).waitFor();
    const views = () => app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.contentView.children.filter(view => view.webContents && view.webContents !== win.webContents)
        .map(view => ({ url: view.webContents.getURL(), visible: view.getVisible() }));
    });
    const navigate = async name => {
      await page.getByRole('button', { name: 'Toggle browser panel', exact: true }).click();
      const url = pathToFileURL(path.join(project, `${name}.html`)).href;
      await page.locator('.browser-toolbar input').fill(url);
      await page.locator('.browser-toolbar input').press('Enter');
      await until(async () => (await views()).some(view => view.visible && view.url === url), 'Native Browser not visible');
      return url;
    };
    const one = await navigate('one');
    await page.getByRole('button', { name: 'Add page', exact: true }).click();
    const two = await navigate('two');
    for (const dismissal of ['escape', 'outside']) {
      await page.getByText('fixture.txt', { exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Open in Editor', exact: true }).waitFor();
      await until(async () => (await views()).every(view => !view.visible), 'Native Browser covered Explorer menu');
      if (dismissal === 'escape') await page.keyboard.press('Escape');
      else await page.locator('.context-menu-overlay').click({ position: { x: 5, y: 5 } });
      await until(async () => (await views()).some(view => view.visible && view.url === two), 'Current page Browser did not restore');
      assert((await views()).filter(view => view.visible).every(view => view.url === two), 'Parked page became visible');
    }
    await page.getByRole('button', { name: 'Page 1', exact: true }).click();
    await page.getByText('fixture.txt', { exact: true }).click({ button: 'right' });
    await until(async () => (await views()).every(view => !view.visible), 'First page Browser covered Explorer menu');
    await page.keyboard.press('Escape');
    await until(async () => (await views()).some(view => view.visible && view.url === one), 'First page Browser did not restore');
    assert((await views()).filter(view => view.visible).every(view => view.url === one));
    console.log('PASS: Explorer menu suppresses native Browser; Escape/outside dismissal restores only the current page across two Browser pages');
  } finally {
    await cleanupSmokeFixture({ app, repo, owner, workspaceRoots: [project] });
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
