/* global window, document */
// Built Electron + real Radix placement/CSS. Only history discovery is a controlled IPC fixture.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-history-layout-'));
for (const name of ['home', 'config', 'cache', 'data', 'profile', 'project']) fs.mkdirSync(path.join(root, name));
const project = path.join(root, 'project');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'].includes(key)));
Object.assign(env, { NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash' });
let app;
(async () => {
  try {
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await app.evaluate(({ ipcMain }, { repo, project }) => {
      const entry = `${repo}/dist/main/shared/ipcChannels.js`;
      const { SESSION_DISCOVER } = process.getBuiltinModule('module').createRequire(entry)(entry);
      const result = { sessions: [{ id: 'history-layout-fixture', harness: 'codex', title: 'Cached conversation', cwd: project, timestamp: Date.now() }], issues: [] };
      globalThis.historyLayoutFixture = { pending: null };
      ipcMain.removeHandler(SESSION_DISCOVER);
      ipcMain.handle(SESSION_DISCOVER, async (_event, _workspaceId, options) => {
        const found = options?.forceRefresh ? await new Promise(resolve => { globalThis.historyLayoutFixture.pending = resolve; }) : result;
        return options?.detailed ? found : found.sessions;
      });
      globalThis.historyLayoutFixture.result = result;
    }, { repo, project });
    await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(project);
    await page.getByRole('dialog').getByText('Where are we working today?').click();
    await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
    const open = (belowMinimum = false) => {
      const trigger = page.getByRole('button', { name: 'Chat history', exact: true });
      // Below the app's supported window minimum, exercise popover containment independently
      // of titlebar control overlap. Supported sizes use a real pointer click.
      return belowMinimum ? trigger.dispatchEvent('click') : trigger.click();
    };
    const settle = (failure = false) => app.evaluate(async (_electron, failure) => {
      const fixture = globalThis.historyLayoutFixture;
      const deadline = Date.now() + 5000;
      while (!fixture.pending && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      if (!fixture.pending) throw new Error('No pending history refresh');
      fixture.pending(failure ? { sessions: [], issues: [{ harness: null, message: `Refresh failed: ${'long-unbroken-diagnostic-'.repeat(25)}` }] } : fixture.result);
      fixture.pending = null;
    }, failure);
    const measure = async () => {
      const dropdown = page.locator('.chat-history-dropdown');
      // Radix updates collision positioning asynchronously after open/resize.
      await page.waitForFunction(() => {
        const element = document.querySelector('.chat-history-dropdown');
        const box = element?.getBoundingClientRect();
        return box && box.x >= 7 && box.right <= window.innerWidth - 7;
      });
      const box = await dropdown.boundingBox();
      const row = await page.getByRole('button', { name: /Codex.*1/ }).boundingBox();
      const viewport = await page.evaluate(() => window.innerWidth);
      assert(box && row);
      assert(box.x >= 7 && box.x + box.width <= viewport - 7, 'Popover exceeds viewport collision padding');
      assert(await dropdown.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'History has horizontal overflow');
      return { width: box.width, rowOffset: row.y - box.y };
    };
    // Seed the cache through the real open/refresh path, independent of idle warmup timing.
    await open();
    await settle();
    await page.getByRole('status', { name: 'Conversation history loaded', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    for (const width of [1100, 800, 640, 320, 280]) {
      await app.evaluate(({ BrowserWindow }, width) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setSize(width, 760); }, width);
      await open(width < 800);
      await page.getByRole('status', { name: /Refreshing conversation history/ }).waitFor();
      await page.getByRole('button', { name: /Codex.*1/ }).waitFor();
      const refreshing = await measure();
      await page.getByRole('button', { name: /Codex.*1/ }).click();
      await page.getByRole('button', { name: /Cached conversation/ }).waitFor();
      await settle();
      await page.getByRole('status', { name: 'Conversation history loaded', exact: true }).waitFor();
      assert.deepEqual(await measure(), refreshing, 'Refresh success shifted the width or harness header');
      await page.keyboard.press('Escape');
      await open(width < 800);
      await page.getByRole('status', { name: /cached history.*Refreshing conversation history/i }).waitFor();
      assert.deepEqual(await measure(), refreshing, 'Reopening cached history shifted layout');
      await settle(true);
      await page.getByRole('alert').waitFor();
      await page.getByRole('status', { name: /cached history.*refresh failed/i }).waitFor();
      assert.deepEqual(await measure(), refreshing, 'Refresh failure shifted the width or harness header');
      await page.getByRole('button', { name: /Codex.*1/ }).click();
      assert.equal(await page.getByRole('button', { name: /Cached conversation/ }).isEnabled(), true);
      await page.keyboard.press('Escape');
    }
    console.log('PASS: history refresh/success/failure stable width, retained cached rows, wrapped errors, and right-edge placement at 1100/800px and below-minimum 640/320/280px');
  } catch (error) {
    console.error(error.stack);
    if (app) console.error(await (await app.firstWindow()).evaluate(() => ({ viewport: window.innerWidth, dropdown: document.querySelector('.chat-history-dropdown')?.getBoundingClientRect().toJSON(), popover: document.querySelector('.header-chat-popover')?.getBoundingClientRect().toJSON() })));
    process.exitCode = 1;
  }
  finally { await app?.close(); fs.rmSync(root, { recursive: true, force: true }); }
})();
