/* global window, document */
// Built app, isolated local profile, real native Browser + Settings layering and geometry.
// Run after npm run build: node scripts/settings-management-smoke.cjs
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-settings-smoke-'));
const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-settings-visual-'));
for (const name of ['home', 'config', 'cache', 'data', 'profile', 'project']) fs.mkdirSync(path.join(root, name));
fs.writeFileSync(path.join(root, 'profile/config.json'), JSON.stringify({ workspaceNavigationMode: 'tabs', harnessDefaults: Object.fromEntries(['codex', 'claude', 'pi', 'opencode', 'omp', 'hermes', 'agy'].map(id => [id, { model: '', favorites: [], flags: '', visible: false, usageVisible: false }])) }));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'].includes(key)));
Object.assign(env, { NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const server = http.createServer((_request, response) => { response.end('<title>Settings fixture</title><body><h1>Native Browser</h1></body>'); });
let app;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await pause(40); }
  throw new Error(message);
}
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    const page = await app.firstWindow(); page.setDefaultTimeout(10000);
    await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(path.join(root, 'project'));
    await page.getByRole('dialog').getByText('Where are we working today?').click();
    await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
    await page.getByRole('button', { name: 'Toggle browser panel', exact: true }).click();
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.locator('.browser-toolbar input').fill(url);
    await page.locator('.browser-toolbar input').press('Enter');
    const views = () => app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.contentView.children.filter(view => view.webContents && view.webContents !== win.webContents)
        .map(view => ({ id: view.webContents.id, url: view.webContents.getURL(), visible: view.getVisible() }));
    });
    await until(async () => (await views()).some(view => view.visible && view.url === url), 'Fixture Browser did not become visible');
    const browserId = (await views()).find(view => view.url === url).id;
    // Presentation-only Assistants snapshot: no Hermes process is launched by this fixture.
    await app.evaluate(({ BrowserWindow }, channelsPath) => {
      const { ASSISTANTS_CHANGED } = process.getBuiltinModule('module').createRequire(channelsPath)(channelsPath);
      BrowserWindow.getAllWindows()[0].webContents.send(ASSISTANTS_CHANGED, { available: true,
        settings: { enabled: false, autoStart: false }, service: { state: 'disabled', ownership: null }, assistants: [], surfaces: [] });
    }, path.join(repo, 'dist/main/shared/ipcChannels.js'));
    for (const [width, height] of [[1100, 760], [640, 480]]) {
      await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setSize(...size); }, [width, height]);
      for (const theme of ['Dark', 'Light', 'Slate']) {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
        await dialog.getByRole('radio', { name: theme, exact: true }).click();
        await until(async () => (await views()).every(view => !view.visible), 'Settings did not suppress native Browser');
        for (const section of ['Appearance', 'Workspaces & Layout', 'Keyboard Shortcuts', 'Harnesses', 'Accounts', 'Assistants', 'Git Preferences', 'Legacy Settings']) {
          await dialog.getByRole('navigation').getByRole('button', { name: section, exact: true }).click();
          if (section === 'Harnesses' && await dialog.locator('.settings-harness-selector button').count()) {
            await dialog.locator('.settings-harness-selector button').first().click();
          }
          if (section === 'Accounts') {
            const harness = await dialog.locator('#account-harness').evaluate(element => Array.from(element.options).find(option => option.value && !option.disabled)?.value);
            if (harness) await dialog.locator('#account-harness').selectOption(harness);
          }
          const geometry = await dialog.evaluate(element => {
            const content = element.querySelector('.management-content');
            const nav = element.querySelector('nav');
            const bounds = element.getBoundingClientRect();
            return { inViewport: bounds.left >= 0 && bounds.top >= 0 && bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight,
              overflow: content.scrollWidth > content.clientWidth, navigationWidth: nav.getBoundingClientRect().width };
          });
          assert(geometry.inViewport, 'Dialog outside viewport');
          assert(!geometry.overflow, `${section} has horizontal overflow at ${width}`);
          assert(geometry.navigationWidth > 0, 'Navigation missing');
          assert(await dialog.evaluate(element => {
            const content = element.querySelector('.management-content');
            const nav = element.querySelector('nav');
            const top = nav.getBoundingClientRect().top;
            content.scrollTop = content.scrollHeight;
            const independent = nav.getBoundingClientRect().top === top && element.scrollTop === 0;
            content.scrollTop = 0;
            return independent;
          }), 'Content scrolling moved the navigation/header');
          await page.mouse.move(0, 0);
          await pause(200); // Let the existing primitive hover transition settle before visual review.
          await page.screenshot({ path: path.join(screenshots, `${theme.toLowerCase()}-${width}-${section.toLowerCase().replaceAll(/[^a-z]+/g, '-')}.png`) });
        }
        await dialog.getByRole('button', { name: 'Close Settings' }).click();
        await until(async () => (await views()).some(view => view.id === browserId && view.visible), 'Native Browser did not restore');
        assert(await page.getByRole('button', { name: 'Settings', exact: true }).evaluate(element => document.activeElement === element), 'Settings trigger focus not restored');
      }
    }
    // Settings retains its DOM identity and native suppression while Header relocates.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Workspaces & Layout', exact: true }).click();
    await page.getByRole('dialog', { name: 'Settings', exact: true }).evaluate(element => {
      window.settingsSmokeDialog = element;
    });
    for (const [mode, placement] of [['Sidebar', 'titlebar'], ['Tabs', 'bar']]) {
      await page.getByRole('radio', { name: mode, exact: true }).click();
      assert.equal(await page.locator('.header').getAttribute('data-placement'), placement);
      assert.equal(await page.getByRole('dialog', { name: 'Settings', exact: true }).count(), 1);
      assert(await page.getByRole('dialog', { name: 'Settings', exact: true }).evaluate(element => window.settingsSmokeDialog === element), 'Settings remounted');
      assert.equal(await page.getByRole('button', { name: 'Workspaces & Layout', exact: true }).getAttribute('aria-current'), 'page');
      assert.equal(await page.getByRole('radio', { name: mode, exact: true }).getAttribute('aria-checked'), 'true');
      assert((await views()).every(view => !view.visible), 'Relocation exposed native Browser');
    }
    await page.getByRole('button', { name: 'Close Settings' }).click();
    await until(async () => (await views()).some(view => view.id === browserId && view.visible), 'Relocation close lost native Browser');
    assert(await page.getByRole('button', { name: 'Settings', exact: true }).evaluate(element => document.activeElement === element), 'Relocated trigger focus not restored');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Legacy Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Manage VCS credentials', exact: true }).click();
    await page.getByRole('dialog', { name: 'VCS Credentials', exact: true }).waitFor();
    assert((await views()).every(view => !view.visible), 'Credentials handoff exposed native Browser');
    await page.keyboard.press('Escape');
    await until(async () => (await views()).some(view => view.id === browserId && view.visible), 'Credentials close lost native Browser');
    assert(await page.getByRole('button', { name: 'Settings', exact: true }).evaluate(element => document.activeElement === element), 'Credentials did not restore relocated trigger focus');
    // Real registered keyboard route, not an IPC or DOM-state shortcut.
    await page.getByRole('button', { name: 'Settings', exact: true }).focus();
    await page.keyboard.press('Control+,');
    await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await until(async () => (await views()).some(view => view.id === browserId && view.visible), 'Escape did not restore Browser');
    console.log(`Settings management Electron smoke passed; screenshots: ${screenshots}`);
  } finally {
    if (app) await app.close();
    server.close(); fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
