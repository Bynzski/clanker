/* global window, document */
// Disposable profile, real built Electron app, PTYs, IPC, React and native Browser.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-dialog-smoke-'));
const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-dialog-visual-'));
const mainPath = path.join(repo, 'dist/main/main/main.js');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'].includes(key)));
for (const name of ['home', 'config', 'cache', 'data', 'project']) fs.mkdirSync(path.join(root, name));
Object.assign(env, { NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const server = http.createServer((_request, response) => response.end('<title>Dialog fixture</title><h1>Native Browser</h1>'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) { for (let i = 0; i < 200; i++) { if (await check()) return; await pause(50); } throw new Error(message); }
let app;
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    for (const intent of ['window', 'quit', 'ipc']) {
      const profile = path.join(root, intent); fs.mkdirSync(profile);
      fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ workspaceNavigationMode: 'tabs' }));
      app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${profile}`, '--ozone-platform=headless'], env });
      app.process().stderr.on('data', data => { if (data.toString().includes('[clanker-grid]')) process.stderr.write(data); });
      const page = await app.firstWindow(); page.setDefaultTimeout(10000);
      await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
      await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(path.join(root, 'project'));
      await page.getByRole('dialog').getByText('Where are we working today?').click();
      await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
      await page.getByRole('group', { name: 'New terminal' }).getByRole('button', { name: 'Terminal', exact: true }).click();
      const pids = () => app.evaluate((_electron, mainPath) => [...process.mainModule.require(mainPath).terminals.values()].map(terminal => terminal.pty.pid), mainPath);
      await until(async () => (await pids()).length > 0, 'No real shell PTY');
      const originalPids = await pids();
      const request = () => intent === 'ipc' ? page.evaluate(() => window.electronAPI.closeWindow())
        : app.evaluate(({ app, BrowserWindow }, intent) => { if (intent === 'quit') app.quit(); else BrowserWindow.getAllWindows()[0].close(); }, intent);
      const dialog = page.getByRole('alertdialog', { name: 'Close Clanker?' });
      const browserViews = () => app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; return win.contentView.children.filter(view => view.webContents && view.webContents !== win.webContents).map(view => ({ visible: view.getVisible(), url: view.webContents.getURL() })); });
      if (intent === 'window') {
        await page.getByRole('button', { name: 'Toggle browser panel', exact: true }).click();
        const url = `http://127.0.0.1:${server.address().port}/`;
        await page.locator('.browser-toolbar input').fill(url); await page.locator('.browser-toolbar input').press('Enter');
        await until(async () => (await browserViews()).some(view => view.visible && view.url === url), 'Native Browser not ready');
        for (const [width, height] of [[1100, 760], [640, 480]]) {
          await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setSize(...size); }, [width, height]);
          for (const theme of ['Dark', 'Light', 'Slate']) {
            await page.getByRole('button', { name: 'Settings', exact: true }).click();
            await page.getByRole('radio', { name: theme, exact: true }).click();
            await page.getByRole('button', { name: 'Close Settings' }).click();
            await request(); await dialog.waitFor();
            assert(await dialog.getByRole('button', { name: 'Keep Clanker Open' }).evaluate(element => document.activeElement === element));
            assert((await browserViews()).every(view => !view.visible), 'Native Browser covered confirmation');
            assert(await dialog.evaluate(element => { const b = element.getBoundingClientRect(); return b.left >= 0 && b.top >= 0 && b.right <= window.innerWidth && b.bottom <= window.innerHeight && element.scrollWidth <= element.clientWidth; }), `Dialog geometry: ${theme}/${width}`);
            await page.screenshot({ path: path.join(screenshots, `${theme.toLowerCase()}-${width}-close.png`) });
            await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
            assert.deepEqual(await pids(), originalPids, 'Cancel changed PTYs');
            await until(async () => (await browserViews()).some(view => view.visible), 'Cancel did not restore Browser');
          }
        }
      }
      await request(); await dialog.waitFor(); await request(); await request();
      assert.equal(await dialog.count(), 1, 'Repeated close duplicated prompts');
      await page.locator('.clanker-dialog-overlay').click({ position: { x: 2, y: 2 } });
      assert(await dialog.isVisible(), 'Backdrop dismissed confirmation');
      await dialog.getByRole('button', { name: 'Keep Clanker Open' }).focus();
      await page.keyboard.press('Enter'); await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual(await pids(), originalPids, 'Safe Enter changed PTYs');
      await request(); await dialog.waitFor();
      const child = app.process();
      const exited = new Promise(resolve => child.once('exit', resolve));
      await dialog.getByRole('button', { name: 'Close Anyway' }).click().catch(error => { if (!page.isClosed()) throw error; });
      await Promise.race([exited, pause(15000).then(() => { throw new Error('Approved quit did not exit Electron'); })]);
      for (const pid of originalPids) await until(async () => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }, `PTY ${pid} survived approved ${intent}`);
      app = null;
      console.log(`PASS native ${intent}: repeated request, cancel, safe Enter, approval, process cleanup`);
    }
    console.log(`Dialog screenshots: ${screenshots}`);
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(1)).catch(() => {}); }
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
