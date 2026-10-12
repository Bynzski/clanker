/* global window */
// Disposable Git repositories/profile, built Electron, real shell PTYs/IPC/React. No native model or SSH.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-new-session-'));
const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-new-session-visual-'));
for (const name of ['home', 'config', 'cache', 'data', 'profile', 'project']) fs.mkdirSync(path.join(root, name));
const project = path.join(root, 'project');
const external = path.join(root, 'external');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'].includes(key)));
Object.assign(env, { NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim();
git(project, 'init', '-b', 'main'); git(project, 'config', 'user.name', 'Fixture'); git(project, 'config', 'user.email', 'fixture@example.invalid');
fs.writeFileSync(path.join(project, 'same.txt'), 'main\n'); git(project, 'add', '.'); git(project, 'commit', '-m', 'Main');
const mainHead = git(project, 'rev-parse', 'HEAD');
git(project, 'worktree', 'add', '-b', 'external-agent', external);
fs.writeFileSync(path.join(external, 'same.txt'), 'external committed\n'); git(external, 'add', '.'); git(external, 'commit', '-m', 'External');
const externalHead = git(external, 'rev-parse', 'HEAD');
fs.writeFileSync(path.join(external, 'dirty.txt'), 'keep in source\n');
git(project, 'branch', 'unoccupied');
fs.writeFileSync(path.join(root, 'profile/config.json'), JSON.stringify({ workspaceNavigationMode: 'sidebar', harnessDefaults: Object.fromEntries(['codex', 'claude', 'pi', 'opencode', 'omp', 'hermes', 'agy'].map(id => [id, { model: '', favorites: [], flags: '', visible: false, usageVisible: false }])) }));
let app;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) { const end = Date.now() + 15000; while (!await check()) { if (Date.now() > end) throw new Error(message); await pause(50); } }
(async () => {
  try {
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    const terminals = () => app.evaluate((_electron, entry) => [...process.getBuiltinModule('module').createRequire(entry)(entry).terminals].map(([id, terminal]) => ({ id, cwd: terminal.cwd, context: terminal.checkoutContextId })), path.join(repo, 'dist/main/main/main.js'));
    await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(project);
    await page.getByRole('dialog').getByText('Where are we working today?').click();
    await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
    assert.equal(await page.getByRole('button', { name: 'New Agent', exact: true }).count(), 1);
    assert.equal(await page.locator('.ws-checkout-list,.ws-checkout-row').count(), 0);
    const open = async () => {
      await page.getByRole('button', { name: 'New Agent', exact: true }).click();
      await page.getByRole('radio', { name: 'Terminal', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Main checkout', exact: true }).getAttribute('aria-pressed'), 'true');
    };
    await open();
    await page.getByRole('group', { name: 'Existing worktrees', exact: true }).getByRole('button', { name: /external-agent/ }).waitFor();
    // Native capture at normal/compact/zoomed window sizes, assert every action remains reachable.
    for (const [width, height, zoom] of [[1100, 760, 1], [640, 480, 1], [640, 480, 1.25]]) {
      await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setSize(width, height); win.webContents.setZoomFactor(zoom); }, { width, height, zoom });
      await pause(150);
      await page.keyboard.press('Escape');
      await page.locator('.new-session-popover').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'New Agent', exact: true }).click();
      await page.getByRole('radio', { name: 'Terminal', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Create worktree only', exact: true }).scrollIntoViewIfNeeded();
      assert(await page.locator('.new-session-panes').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Picker has horizontal overflow');
      const bounds = await page.getByRole('button', { name: 'Launch Terminal', exact: true }).boundingBox();
      const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      const closeBounds = await page.getByRole('button', { name: 'Close window', exact: true }).boundingBox();
      assert(closeBounds && closeBounds.x + closeBounds.width <= viewport.width, `Window controls outside viewport: ${JSON.stringify({ closeBounds, viewport })}`);
      assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height, 'Launch action outside viewport');
      await app.evaluate(async ({ BrowserWindow }, file) => { const win = BrowserWindow.getAllWindows()[0]; process.getBuiltinModule('fs').writeFileSync(file, (await win.webContents.capturePage()).toPNG()); }, path.join(screenshots, `${width}-${height}-${zoom}.png`));
    }
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(1100, 760); win.webContents.setZoomFactor(1); });
    await page.getByRole('button', { name: 'Launch Terminal', exact: true }).click();
    await page.getByRole('button', { name: 'New Agent', exact: true }).scrollIntoViewIfNeeded();
    await until(async () => (await terminals()).length === 1, 'Main PTY absent');
    assert.equal((await terminals())[0].cwd, project);
    const original = (await terminals())[0];
    await pause(600);
    for (let index = 0; index < 2; index++) {
      await open();
      await page.getByRole('group', { name: 'Existing worktrees', exact: true }).getByRole('button', { name: /external-agent/ }).click();
      await page.getByRole('button', { name: 'Launch Terminal', exact: true }).click();
      await until(async () => (await terminals()).length === index + 2, 'Shared external PTY absent');
      await pause(600);
    }
    const shared = (await terminals()).filter(value => value.cwd === external);
    assert.equal(shared.length, 2); assert.equal(shared[0].context, shared[1].context);
    assert.deepEqual((await terminals()).find(value => value.id === original.id), original);
    for (const [name, base, expected] of [['from-main', '', mainHead], ['from-external', external, externalHead]]) {
      await open(); await page.getByLabel('New branch', { exact: true }).fill(name);
      await page.getByLabel('Start from committed HEAD', { exact: true }).selectOption(base);
      await page.getByRole('button', { name: 'Create worktree only', exact: true }).click();
      await page.locator('.new-session-popover').waitFor({ state: 'hidden' });
      const listing = git(project, 'worktree', 'list', '--porcelain');
      const record = listing.split('\n\n').find(value => value.includes(`branch refs/heads/${name}`));
      assert(record, 'Created worktree absent');
      const cwd = record.split('\n')[0].slice(9);
      assert.equal(git(cwd, 'rev-parse', 'HEAD'), expected); assert.equal(fs.existsSync(path.join(cwd, 'dirty.txt')), false);
      assert.equal((await terminals()).length, 3, 'Create-only started a process');
    }
    await open();
    await page.getByRole('group', { name: 'Existing branches', exact: true }).getByRole('button', { name: 'unoccupied', exact: true }).click();
    await page.getByRole('button', { name: 'Create worktree only', exact: true }).click();
    await page.locator('.new-session-popover').waitFor({ state: 'hidden' });
    assert(git(project, 'worktree', 'list', '--porcelain').includes('branch refs/heads/unoccupied'));
    for (const terminal of shared) await page.evaluate(id => window.electronAPI.killTerminal(id), terminal.id);
    await until(async () => (await terminals()).filter(value => value.cwd === external).length === 0, 'Shared sessions did not close');
    assert(fs.existsSync(external)); assert(git(project, 'worktree', 'list', '--porcelain').includes(external));
    assert.equal(git(project, 'rev-parse', 'HEAD'), mainHead); assert.equal(git(external, 'rev-parse', 'HEAD'), externalHead);
    assert.equal(fs.readFileSync(path.join(external, 'dirty.txt'), 'utf8'), 'keep in source\n');
    // Restart the same saved profile: Git discovery must still validate a selected external root.
    await app.close(); app = undefined;
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    const restarted = await app.firstWindow(); restarted.setDefaultTimeout(15000);
    await until(async () => await restarted.getByRole('button', { name: 'New Agent', exact: true }).count() > 0 || await restarted.getByRole('button', { name: 'Open Workspace', exact: true }).count() > 0, 'Restarted shell absent');
    if (await restarted.getByRole('button', { name: 'New Agent', exact: true }).count() === 0) {
      await restarted.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
      await restarted.getByRole('textbox', { name: 'Local Directory Path' }).fill(project);
      await restarted.getByRole('dialog').getByText('Where are we working today?').click();
      await restarted.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
    }
    await restarted.getByRole('button', { name: 'New Agent', exact: true }).click();
    assert.equal(await restarted.getByRole('button', { name: 'Main checkout', exact: true }).getAttribute('aria-pressed'), 'true');
    await restarted.getByRole('radio', { name: 'Terminal', exact: true }).click();
    await restarted.getByRole('group', { name: 'Existing worktrees', exact: true }).getByRole('button', { name: /external-agent/ }).click();
    const beforeRestartLaunch = (await terminals()).length;
    await restarted.getByRole('button', { name: 'Launch Terminal', exact: true }).click();
    await until(async () => (await terminals()).length === beforeRestartLaunch + 1, 'Restarted explicit launch absent');
    assert((await terminals()).some(value => value.cwd === external && value.context));
    console.log(JSON.stringify({ builtElectron: true, realGit: true, realPTY: true, mainDefault: 'passed', externalAndSharedLaunch: 'passed', committedHeadBasesAndCreateOnly: 'passed', existingBranch: 'passed', closingRetainsWorktreeAndBranch: 'passed', restartExplicitAdoption: 'passed', compactWindowAndZoom: 'passed', screenshots }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { await app?.close(); fs.rmSync(root, { recursive: true, force: true }); }
})();
