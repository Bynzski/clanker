/* global window, document */
// Isolated local Git fixture, real built app and native Browser. No user profile or remote operations.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-source-control-smoke-'));
const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-source-control-visual-'));
for (const name of ['home', 'config', 'cache', 'data', 'profile', 'project']) fs.mkdirSync(path.join(root, name));
const project = path.join(root, 'project');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'].includes(key)));
Object.assign(env, { NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const git = (...args) => execFileSync('git', args, { cwd: project, env, stdio: 'pipe' });
git('init', '-b', 'main'); git('config', 'user.name', 'Smoke'); git('config', 'user.email', 'smoke@example.invalid');
fs.writeFileSync(path.join(project, 'README.md'), 'fixture\n'); git('add', '.'); git('commit', '-m', 'fixture');
git('worktree', 'add', '-b', 'linked-task', path.join(root, 'linked-task'));
git('branch', 'cancel-delete'); git('branch', `feature/${'long-branch-name-'.repeat(8)}`);
git('worktree', 'add', '-b', 'locked', path.join(root, 'locked'));
git('worktree', 'lock', '--reason', 'Intentional lock — review before cleanup', path.join(root, 'locked'));
git('worktree', 'add', '-b', 'missing', path.join(root, 'missing'));
fs.rmSync(path.join(root, 'missing'), { recursive: true, force: true });
git('remote', 'add', 'origin', 'https://example.invalid/repo.git');
fs.writeFileSync(path.join(project, 'stash-test.txt'), 'stash test\n');
git('add', 'stash-test.txt');
git('stash', 'push', '-m', 'fixture-stash');
fs.appendFileSync(path.join(project, 'README.md'), 'uncommitted\n');
fs.writeFileSync(path.join(root, 'profile/config.json'), JSON.stringify({ workspaceNavigationMode: 'tabs', harnessDefaults: Object.fromEntries(['codex', 'claude', 'pi', 'opencode', 'omp', 'hermes', 'agy'].map(id => [id, { model: '', favorites: [], flags: '', visible: false, usageVisible: false }])) }));
const server = http.createServer((_request, response) => response.end('<title>Source Control fixture</title><h1>Native Browser</h1>'));
let app;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) { for (let i = 0; i < 150; i++) { if (await check()) return; await pause(40); } throw new Error(message); }
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    const page = await app.firstWindow(); page.setDefaultTimeout(12000);
    await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(project);
    await page.getByRole('dialog').getByText('Where are we working today?').click();
    await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
    await page.getByRole('button', { name: 'Toggle browser panel', exact: true }).click();
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.locator('.browser-toolbar input').fill(url); await page.locator('.browser-toolbar input').press('Enter');
    const views = () => app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; return win.contentView.children.filter(view => view.webContents && view.webContents !== win.webContents).map(view => ({ id: view.webContents.id, url: view.webContents.getURL(), visible: view.getVisible() })); });
    await until(async () => (await views()).some(view => view.visible && view.url === url), 'Browser fixture not visible');
    const browserId = (await views()).find(view => view.url === url).id;
    for (const [width, height] of [[1100, 760], [640, 480]]) {
      await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setSize(...size); }, [width, height]);
      for (const theme of ['Dark', 'Light', 'Slate']) {
        await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('radio', { name: theme, exact: true }).click(); await page.getByRole('button', { name: 'Close Settings' }).click();
        await page.getByRole('button', { name: 'Source Control', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Source Control', exact: true });
        await dialog.getByText('main', { exact: true }).waitFor(); await dialog.getByText('1 changed', { exact: true }).waitFor();
        await until(async () => (await views()).every(view => !view.visible), 'Source Control exposed native Browser');
        assert(await dialog.getByText('Local', { exact: true }).isVisible()); assert.equal(await dialog.getByRole('button', { name: 'Overview', exact: true }).getAttribute('aria-current'), 'page');
        const geometry = await dialog.evaluate(element => { const bounds = element.getBoundingClientRect(); const content = element.querySelector('.management-content'); return { within: bounds.left >= 0 && bounds.top >= 0 && bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight, overflow: content.scrollWidth > content.clientWidth }; });
        assert(geometry.within && !geometry.overflow, `Overview geometry ${theme}/${width}`);
        await pause(150); await page.screenshot({ path: path.join(screenshots, `${theme.toLowerCase()}-${width}-overview.png`) });
        for (const section of ['Branches', 'Worktrees', 'Stashes', 'Remotes', 'Merge', 'Existing Git Tools']) {
          await dialog.getByRole('navigation').getByRole('button', { name: section, exact: true }).click();
          await dialog.getByRole('heading', { name: section, exact: true }).waitFor();
          if (section === 'Branches') await dialog.getByRole('button', { name: 'Delete branch cancel-delete', exact: true }).waitFor();
          if (section === 'Worktrees') {
            await dialog.getByRole('button', { name: 'Remove checkout for branch linked-task' }).waitFor();
            await dialog.getByRole('button', { name: 'Unlock checkout for branch locked' }).waitFor();
            await dialog.getByRole('button', { name: 'Prune missing worktrees…' }).waitFor();
          }
          if (section === 'Stashes') {
            await dialog.getByRole('button', { name: 'Apply stash@{0}' }).waitFor();
            await dialog.getByRole('button', { name: 'Drop stash@{0}' }).waitFor();
          }
          if (section === 'Remotes') {
            await dialog.getByText('origin', { exact: true }).waitFor();
            await dialog.getByRole('button', { name: 'Remove remote' }).first().waitFor();
          }
          if (section === 'Merge') {
            await dialog.getByRole('button', { name: /^Merge / }).waitFor();
          }
          assert(await dialog.evaluate(element => { const content = element.querySelector('.management-content'); return content.scrollWidth <= content.clientWidth; }), `${section} horizontal overflow ${theme}/${width}`);
          await pause(150); await page.screenshot({ path: path.join(screenshots, `${theme.toLowerCase()}-${width}-${section.toLowerCase().replaceAll(' ', '-')}.png`) });
          if (section === 'Branches') {
            await dialog.getByRole('button', { name: 'Delete branch cancel-delete', exact: true }).click(); await page.getByRole('alertdialog').waitFor();
            assert((await views()).every(view => !view.visible), 'Branch confirmation exposed Browser');
            await page.getByRole('button', { name: 'Cancel', exact: true }).click();
          }
          if (section === 'Stashes') {
            await dialog.getByRole('button', { name: 'Drop stash@{0}', exact: true }).click(); await page.getByRole('alertdialog').waitFor();
            assert((await views()).every(view => !view.visible), 'Stash confirmation exposed Browser');
            await page.getByRole('button', { name: 'Cancel', exact: true }).click();
          }
          if (section === 'Remotes') {
            await dialog.getByRole('button', { name: 'Remove remote', exact: true }).first().click(); await page.getByRole('alertdialog').waitFor();
            assert((await views()).every(view => !view.visible), 'Remote confirmation exposed Browser');
            await page.getByRole('button', { name: 'Cancel', exact: true }).click();
          }
        }
        await dialog.getByRole('navigation').getByRole('button', { name: 'Worktrees', exact: true }).click(); await dialog.getByRole('button', { name: 'Remove checkout for branch linked-task' }).waitFor();
        await dialog.getByRole('button', { name: 'Remove checkout for branch linked-task' }).click(); await page.getByRole('alertdialog').waitFor();
        assert((await views()).every(view => !view.visible), 'Worktree confirmation exposed Browser'); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert(await dialog.isVisible()); await dialog.getByRole('button', { name: 'Overview', exact: true }).click();
        await dialog.getByRole('button', { name: 'Commit Changes', exact: true }).click(); await page.getByRole('dialog', { name: 'Create Commit', exact: true }).waitFor();
        assert((await views()).every(view => !view.visible), 'Commit handoff exposed Browser'); await page.keyboard.press('Escape'); assert(await dialog.isVisible());
        await page.keyboard.press('Escape'); await until(async () => (await views()).some(view => view.id === browserId && view.visible), 'Browser did not restore');
        assert(await page.getByRole('button', { name: 'Source Control', exact: true }).evaluate(element => document.activeElement === element), 'Source Control trigger focus not restored');
      }
    }
    assert.equal(git('status', '--porcelain').toString().trim(), 'M README.md', 'Smoke changed fixture worktree contents');
    assert(git('worktree', 'list', '--porcelain').toString().includes('refs/heads/linked-task'), 'Cancel removed worktree');
    assert(git('stash', 'list').toString().includes('fixture-stash'), 'Cancel dropped stash');
    assert(git('remote', '-v').toString().includes('origin'), 'Cancel removed remote');
    console.log(JSON.stringify({ result: 'PASS', screenshots, profile: root, scope: 'local fixture; three themes/two sizes, Overview/Branches/Worktrees/Stashes/Remotes/Merge/transitional tools, cancel-only branch/worktree/stash/remote confirmations, real CommitDialog, native Browser suppression/restoration and focus' }, null, 2));
  } finally { if (app) await app.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
