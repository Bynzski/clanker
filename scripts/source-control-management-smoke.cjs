/* global window, document */
// Isolated local Git fixture, real built app and native Browser. No user profile or remote operations.
const { _electron: electron } = require('playwright');
const { createSmokeOwner, cleanupSmokeFixture } = require('./lib/smoke-fixture-cleanup.cjs');
const owner = createSmokeOwner();
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
Object.assign(env, { [owner.key]: owner.value, NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const git = (...args) => execFileSync('git', args, { cwd: project, env, stdio: 'pipe' });
git('init', '-b', 'main'); git('config', 'user.name', 'Smoke'); git('config', 'user.email', 'smoke@example.invalid');
fs.writeFileSync(path.join(project, 'README.md'), 'fixture\n'); git('add', '.'); git('commit', '-m', `fixture ${'long history subject '.repeat(8)}`);
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
let createdInManagement = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Native capture preserves the physical viewport at app zoom; Playwright's
// CSS-sized capture otherwise crops the right/bottom of a zoomed Electron page.
const screenshot = options => app.evaluate(async ({ BrowserWindow }, file) => {
  const win = BrowserWindow.getAllWindows()[0];
  process.getBuiltinModule('fs').writeFileSync(file, (await win.webContents.capturePage()).toPNG());
}, options.path);
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
    for (const [width, height, zoom] of [[1100, 760, 1], [640, 480, 1], [640, 480, 1.25]]) {
      const shotWidth = zoom === 1 ? `${width}` : `${width}-zoom125`;
      await app.evaluate(({ BrowserWindow }, { size, zoom }) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setSize(...size); win.webContents.setZoomFactor(zoom); }, { size: [width, height], zoom });
      for (const theme of ['Dark', 'Light', 'Slate']) {
        await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('radio', { name: theme, exact: true }).click(); await page.getByRole('button', { name: 'Close Settings' }).click();
        // A real partially staged file: both review sides must stay visible.
        fs.writeFileSync(path.join(project, 'README.md'), 'fixture\nindexed change\n');
        git('add', 'README.md');
        fs.appendFileSync(path.join(project, 'README.md'), 'uncommitted agent change\n');
        await page.getByRole('button', { name: 'Source Control', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Source Control', exact: true });
        await dialog.getByRole('button', { name: 'Refresh changes', exact: true }).click();
        await dialog.getByText('main', { exact: true }).waitFor(); await dialog.getByText(/1 changed file/).waitFor();
        await until(async () => (await views()).every(view => !view.visible), 'Source Control exposed native Browser');
        assert((await dialog.locator('.source-control-change-identity').textContent()).includes('Local')); assert.equal(await dialog.getByRole('button', { name: 'Changes', exact: true }).getAttribute('aria-current'), 'page');
        const geometry = await dialog.evaluate(element => { const bounds = element.getBoundingClientRect(); const content = element.querySelector('.management-content'); return { within: bounds.left >= 0 && bounds.top >= 0 && bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight, overflow: content.scrollWidth > content.clientWidth }; });
        assert(geometry.within && !geometry.overflow, `Changes geometry ${theme}/${width}`);
        await pause(150); await screenshot({ path: path.join(screenshots, `${theme.toLowerCase()}-${shotWidth}-changes.png`) });
        for (const mode of ['staged', 'working']) {
          const file = dialog.getByRole('button', { name: `View ${mode} diff for README.md`, exact: true });
          await file.click();
          const viewer = page.getByRole('dialog', { name: 'README.md', exact: true });
          await viewer.locator('.cm-content').first().waitFor();
          const content = await viewer.locator('.cm-content').allTextContents();
          assert(content.join('\n').includes('fixture') && content.join('\n').includes('indexed change'), 'Actual file content missing');
          assert.equal(content.join('\n').includes('uncommitted agent change'), mode === 'working', 'Staged/working content confused');
          assert.equal(await page.getByRole('dialog', { name: 'Create Commit' }).count(), 0, 'Review entered Commit');
          assert((await views()).every(view => !view.visible), 'Diff exposed Browser');
          await screenshot({ path: path.join(screenshots, `${theme.toLowerCase()}-${shotWidth}-${mode}-diff.png`) });
          await page.keyboard.press('Escape');
          await until(() => file.evaluate(element => document.activeElement === element), 'Diff file focus not restored');
          assert(await dialog.isVisible());
        }
        await dialog.getByRole('textbox', { name: 'Commit Message' }).fill('feat: reviewed agent changes');
        assert(await dialog.getByRole('button', { name: 'Commit Staged', exact: true }).isEnabled());
        assert(await dialog.getByRole('button', { name: 'Stage All & Commit', exact: true }).isEnabled());
        await dialog.getByRole('button', { name: 'Stage README.md', exact: true }).click();
        await until(async () => (await dialog.getByRole('button', { name: 'View working diff for README.md' }).count()) === 0, 'Per-file Stage did not refresh');
        assert(git('diff', '--cached').toString().includes('uncommitted agent change'));
        await dialog.getByRole('button', { name: 'Unstage README.md', exact: true }).click();
        await dialog.getByRole('button', { name: 'Stage README.md', exact: true }).waitFor();
        assert.equal(git('diff', '--cached').toString(), '');
        await dialog.getByRole('button', { name: 'Stage All', exact: true }).click();
        await dialog.getByRole('button', { name: 'Unstage README.md', exact: true }).waitFor();
        await dialog.getByRole('button', { name: 'Unstage All', exact: true }).click();
        await dialog.getByRole('button', { name: 'Stage README.md', exact: true }).waitFor();
        assert(await dialog.getByRole('button', { name: 'Commit Staged', exact: true }).isDisabled());
        assert(await dialog.getByRole('button', { name: 'Stage All & Commit', exact: true }).isEnabled());
        assert.equal(await dialog.getByRole('textbox', { name: 'Commit Message' }).inputValue(), 'feat: reviewed agent changes');
        await dialog.getByRole('textbox', { name: 'Commit Message' }).scrollIntoViewIfNeeded();
        await pause(200); // Capture settled button transitions, not a pending-operation fade.
        await screenshot({ path: path.join(screenshots, `${theme.toLowerCase()}-${shotWidth}-composer.png`) });
        for (const section of ['History', 'Overview', 'Branches', 'Worktrees', 'Stashes', 'Remotes', 'Merge']) {
          await dialog.getByRole('navigation').getByRole('button', { name: section, exact: true }).click();
          await dialog.getByRole('heading', { name: section, exact: true }).waitFor();
          if (section === 'Overview') {
            assert.equal(await dialog.getByRole('button', { name: 'Commit Changes', exact: true }).count(), 0);
            await dialog.getByRole('button', { name: 'Review Changes', exact: true }).click();
            assert.equal(await dialog.getByRole('button', { name: 'Changes', exact: true }).getAttribute('aria-current'), 'page');
            assert.equal(await dialog.getByRole('textbox', { name: 'Commit Message' }).inputValue(), 'feat: reviewed agent changes');
            assert.equal(await page.getByRole('dialog', { name: 'Create Commit' }).count(), 0);
            assert.equal(await dialog.getByRole('textbox', { name: 'Commit Message' }).count(), 1);
            await dialog.getByRole('navigation').getByRole('button', { name: 'Overview', exact: true }).click();
          }
          if (section === 'Branches') await dialog.getByRole('button', { name: 'Delete branch cancel-delete', exact: true }).waitFor();
          if (section === 'Worktrees') {
            await dialog.getByRole('button', { name: 'Remove checkout for branch linked-task' }).waitFor();
            await dialog.getByRole('button', { name: 'Unlock checkout for branch locked' }).waitFor();
            await dialog.getByRole('button', { name: 'Prune missing worktrees…' }).waitFor();
            if (!createdInManagement) {
              await dialog.getByRole('button', { name: 'Create worktree', exact: true }).click();
              const creation = page.locator('.new-session-create-only');
              await creation.getByLabel('New branch', { exact: true }).fill('management-created');
              assert.equal(await creation.getByRole('radiogroup', { name: 'Harness' }).count(), 0);
              assert.equal(await creation.getByRole('button', { name: /^Launch/ }).count(), 0);
              await creation.getByRole('button', { name: 'Create worktree', exact: true }).click();
              await creation.waitFor({ state: 'hidden' });
              assert(await dialog.isVisible(), 'Manual creation closed Source Control');
              assert(git('worktree', 'list', '--porcelain').toString().includes('branch refs/heads/management-created'));
              await dialog.getByRole('button', { name: 'Remove checkout for branch management-created' }).waitFor();
              createdInManagement = true;
            }
          }
          if (section === 'History') {
            assert.equal(await dialog.getByRole('button', { name: 'Working Tree', exact: true }).count(), 1);
            assert(await dialog.locator('.git-history-list').evaluate(element => { const style = window.getComputedStyle(element); return style.maxHeight === 'none' && style.overflowY === 'visible'; }), 'History has a competing list scroller');
            await dialog.getByRole('button', { name: /View summary for commit/ }).first().click();
            await dialog.getByText(/Commit Summary ·/).waitFor();
            assert(await dialog.locator('.git-diff-title').evaluate(element => document.activeElement === element), 'Commit selection did not focus summary');
            assert(await dialog.locator('.git-diff-output').evaluate(element => window.getComputedStyle(element).overflowY === 'visible'), 'Summary has a competing scroller');
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
          await pause(150); await screenshot({ path: path.join(screenshots, `${theme.toLowerCase()}-${shotWidth}-${section.toLowerCase().replaceAll(' ', '-')}.png`) });
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
        assert.equal(await dialog.getByRole('navigation').getByRole('button', { name: 'Existing Git Tools' }).count(), 0, 'Transitional Existing Git Tools still present');
        await dialog.getByRole('navigation').getByRole('button', { name: 'Worktrees', exact: true }).click(); await dialog.getByRole('button', { name: 'Remove checkout for branch linked-task' }).waitFor();
        await dialog.getByRole('button', { name: 'Remove checkout for branch linked-task' }).click(); await page.getByRole('alertdialog').waitFor();
        assert((await views()).every(view => !view.visible), 'Worktree confirmation exposed Browser'); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert(await dialog.isVisible()); await dialog.getByRole('button', { name: 'Changes', exact: true }).click();
        assert.equal(await dialog.getByRole('textbox', { name: 'Commit Message' }).inputValue(), 'feat: reviewed agent changes');
        assert.equal(await page.getByRole('dialog', { name: 'Create Commit' }).count(), 0);
        assert((await views()).every(view => !view.visible), 'Inline composer exposed Browser');
        const largeFiles = Array.from({ length: 34 }, (_, index) => `long-file-${index}-${'developer-workflow-'.repeat(6)}.txt`);
        for (const file of largeFiles) fs.writeFileSync(path.join(project, file), 'large list fixture\n');
        await dialog.getByRole('button', { name: 'Refresh changes' }).click();
        await dialog.getByText(/35 changed files/).waitFor();
        await until(() => dialog.getByRole('button', { name: 'Refresh changes' }).isEnabled(), 'Large list refresh did not settle');
        await page.mouse.move(0, 0); await pause(150);
        await screenshot({ path: path.join(screenshots, `${theme.toLowerCase()}-${shotWidth}-large-list.png`) });
        const jump = dialog.getByRole('button', { name: 'Go to Commit' });
        await jump.focus(); await page.keyboard.press('Enter');
        const editor = dialog.getByRole('textbox', { name: 'Commit Message' });
        assert(await editor.evaluate(element => { const r = element.getBoundingClientRect(); const content = element.closest('.management-content').getBoundingClientRect(); return document.activeElement === element && r.top >= content.top && r.bottom <= content.bottom; }), 'Composer jump did not scroll/focus within content');
        assert.equal(await dialog.getByRole('textbox', { name: 'Commit Message' }).count(), 1);
        assert(await dialog.evaluate(element => { const content = element.querySelector('.management-content'); return content.scrollWidth <= content.clientWidth; }), 'Long file list overflow');
        await screenshot({ path: path.join(screenshots, `${theme.toLowerCase()}-${shotWidth}-large-list-composer.png`) });
        for (const file of largeFiles) fs.rmSync(path.join(project, file));
        await dialog.getByRole('button', { name: 'Refresh changes' }).click();
        await page.keyboard.press('Escape'); await until(async () => (await views()).some(view => view.id === browserId && view.visible), 'Browser did not restore');
        assert(await page.getByRole('button', { name: 'Source Control', exact: true }).evaluate(element => document.activeElement === element), 'Source Control trigger focus not restored');
      }
    }
    assert.equal(git('status', '--porcelain').toString().trim(), 'M README.md', 'Review unexpectedly committed fixture contents');
    // Real staged-only commit must leave the working side untouched, then explicit all-and-commit.
    fs.writeFileSync(path.join(project, 'README.md'), 'fixture\nindexed change\n'); git('add', 'README.md');
    fs.appendFileSync(path.join(project, 'README.md'), 'uncommitted agent change\n');
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    const changes = page.getByRole('dialog', { name: 'Source Control', exact: true });
    await changes.getByRole('button', { name: 'Refresh changes' }).click();
    await changes.getByRole('textbox', { name: 'Commit Message' }).fill('reviewed staged change');
    await changes.getByRole('button', { name: 'Commit Staged', exact: true }).click();
    await until(async () => await changes.getByRole('textbox', { name: 'Commit Message' }).inputValue() === '', 'Successful commit did not clear draft');
    assert.equal(await page.getByRole('dialog', { name: 'Create Commit' }).count(), 0);
    assert(!git('show', 'HEAD:README.md').toString().includes('uncommitted agent change'), 'Staged-only commit included working content');
    assert(git('diff').toString().includes('uncommitted agent change'), 'Staged-only commit changed working content');
    assert((await views()).every(view => !view.visible), 'Successful Commit exposed Browser');
    await until(() => changes.getByRole('textbox', { name: 'Commit Message' }).evaluate(element => document.activeElement === element), 'Successful Commit editor focus not restored');
    await changes.getByRole('textbox', { name: 'Commit Message' }).fill('explicitly commit all');
    await changes.getByRole('button', { name: 'Stage All & Commit', exact: true }).click();
    await until(async () => await changes.getByRole('textbox', { name: 'Commit Message' }).inputValue() === '', 'All-and-commit did not clear draft');
    assert(git('show', 'HEAD:README.md').toString().includes('uncommitted agent change'));
    assert.equal(git('status', '--porcelain').toString(), '');
    await changes.getByText('Working directory is clean').waitFor();
    await until(() => changes.getByRole('textbox', { name: 'Commit Message' }).evaluate(element => document.activeElement === element), 'Clean Changes editor focus not restored');
    await page.keyboard.press('Escape');
    await until(async () => (await views()).some(view => view.id === browserId && view.visible), 'Browser did not restore after commits');

    // Test linked worktree Source Control and context switching
    // First, launch a normal terminal in the main checkout so the workspace has both contexts active
    await page.getByRole('button', { name: 'New Agent', exact: true }).click();
    await page.getByRole('radio', { name: 'Terminal', exact: true }).click();
    await page.getByRole('button', { name: 'Launch Terminal', exact: true }).click();
    await pause(600);

    fs.writeFileSync(path.join(root, 'linked-task', 'worktree-note.txt'), 'worktree draft content\n');
    await page.getByRole('button', { name: 'New Agent', exact: true }).click();
    await page.locator('.new-session-popover').waitFor();
    await page.getByRole('group', { name: 'Existing worktrees', exact: true }).getByRole('button').filter({ hasText: 'linked-task' }).click();
    await page.locator('.new-session-form button[type="submit"]').click();
    await page.locator('.new-session-popover').waitFor({ state: 'hidden' });
    await pause(500);

    // Open Source Control on the linked worktree
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    const worktreeSource = page.getByRole('dialog', { name: 'Source Control', exact: true });
    await worktreeSource.waitFor();
    await worktreeSource.getByRole('button', { name: 'Refresh changes' }).click();
    await worktreeSource.getByText('linked-task', { exact: true }).waitFor();
    assert((await worktreeSource.locator('.source-control-change-identity').textContent()).includes('linked-task'), 'Worktree identity missing in Source Control');
    await worktreeSource.getByText('worktree-note.txt', { exact: true }).waitFor();

    // Review working diff in worktree
    const worktreeDiffBtn = worktreeSource.getByRole('button', { name: 'Review working changes for worktree-note.txt', exact: true });
    await worktreeDiffBtn.click();
    const worktreeViewer = page.getByRole('dialog', { name: 'worktree-note.txt', exact: true });
    await worktreeViewer.locator('.cm-content').first().waitFor();
    const worktreeDiffContent = await worktreeViewer.locator('.cm-content').allTextContents();
    assert(worktreeDiffContent.join('\n').includes('worktree draft content'), 'Worktree diff content missing');
    assert((await views()).every(view => !view.visible), 'Worktree diff exposed Browser');
    await page.keyboard.press('Escape');
    await until(() => worktreeDiffBtn.evaluate(element => document.activeElement === element), 'Worktree diff focus not restored');

    // Owner-reported 34-file isolated checkout, at reduced height / 125% zoom.
    const isolatedFiles = Array.from({ length: 33 }, (_, index) => `isolated-${index}-${'long-checkout-filename-'.repeat(5)}.txt`);
    for (const file of isolatedFiles) fs.writeFileSync(path.join(root, 'linked-task', file), 'isolated large list\n');
    await worktreeSource.getByRole('button', { name: 'Refresh changes' }).click();
    await worktreeSource.getByText(/34 changed files/).waitFor();
    await until(() => worktreeSource.getByRole('button', { name: 'Refresh changes' }).isEnabled(), 'Isolated list refresh did not settle');
    await page.mouse.move(0, 0); await pause(150);
    await screenshot({ path: path.join(screenshots, 'slate-640-zoom125-isolated-34-files.png') });
    await worktreeSource.getByRole('button', { name: 'Go to Commit' }).focus(); await page.keyboard.press('Enter');
    assert(await worktreeSource.getByRole('textbox', { name: 'Commit Message' }).evaluate(element => document.activeElement === element), 'Isolated composer jump did not focus');
    assert((await views()).every(view => !view.visible), 'Isolated composer jump exposed Browser');
    await screenshot({ path: path.join(screenshots, 'slate-640-zoom125-isolated-composer.png') });
    for (const file of isolatedFiles) fs.rmSync(path.join(root, 'linked-task', file));
    await worktreeSource.getByRole('button', { name: 'Refresh changes' }).click();
    await until(() => worktreeSource.getByRole('button', { name: 'Refresh changes' }).isEnabled(), 'Isolated cleanup refresh did not settle');

    // Stage and commit in worktree
    await worktreeSource.getByRole('button', { name: 'Stage worktree-note.txt', exact: true }).click();
    await worktreeSource.getByRole('textbox', { name: 'Commit Message' }).fill('feat: isolated worktree commit');
    await worktreeSource.getByRole('button', { name: 'Commit Staged', exact: true }).click();
    await until(async () => await worktreeSource.getByRole('textbox', { name: 'Commit Message' }).inputValue() === '', 'Worktree commit did not clear draft');
    await worktreeSource.getByText('Working directory is clean').waitFor();
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: path.join(root, 'linked-task'), env }).toString().trim(), '');
    assert(execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd: path.join(root, 'linked-task'), env }).toString().includes('feat: isolated worktree commit'));
    assert(!execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd: project, env }).toString().includes('feat: isolated worktree commit'));

    await page.keyboard.press('Escape');
    await until(async () => (await page.getByRole('dialog', { name: 'Source Control' }).count()) === 0, 'Source Control did not close on Escape');

    // Switch back to main checkout terminal tab
    // Context switching: switch back to main terminal -> management shell dismisses
    const tabAgentsTrigger = page.locator('.workspace-tab-agents-trigger');
    if (await tabAgentsTrigger.isVisible()) {
      await tabAgentsTrigger.click();
      await page.locator('.workspace-tab-agents-popover').waitFor();
      const rows = page.locator('.workspace-tab-agents-popover .ws-agent-row');
      const rowCount = await rows.count();
      assert.equal(rowCount, 2, 'Expected two terminals in workspace');
      // The main terminal row is the one without worktree meta
      const mainRow = rows.filter({ hasNot: page.locator('.ws-agent-meta') }).first();
      await mainRow.click();
      await page.locator('.workspace-tab-agents-popover').waitFor({ state: 'hidden' });
      await pause(300);

      // Reopen Source Control on main
      await page.getByRole('button', { name: 'Source Control', exact: true }).click();
      const mainSource = page.getByRole('dialog', { name: 'Source Control', exact: true });
      await mainSource.waitFor();
      const identityText = await mainSource.locator('.source-control-change-identity').textContent();
      assert(identityText.includes('project') && identityText.includes('main'), 'Main identity not restored');
      await page.keyboard.press('Escape');
      await until(async () => (await views()).some(view => view.id === browserId && view.visible), 'Browser did not restore after main return');
    }

    assert(git('worktree', 'list', '--porcelain').toString().includes('refs/heads/linked-task'), 'Cancel removed worktree');
    assert(git('stash', 'list').toString().includes('fixture-stash'), 'Cancel dropped stash');
    assert(git('remote', '-v').toString().includes('origin'), 'Cancel removed remote');
    console.log(JSON.stringify({ result: 'PASS', screenshots, profile: root, scope: 'local fixture; three themes/two sizes plus 125% zoom at 640×480, 34 added long filenames and keyboard Go to Commit focus, single History content scroll with exact summary focus, Changes-first/History/Overview/Branches/Worktrees/Stashes/Remotes/Merge; one inline commit composer; real file diffs, per-file/all staging, retained drafts and Overview Review Changes routing, real staged-only/explicit all commits; manual worktree creation without a session; linked worktree Source Control with isolated diff/staging/commit, context switching and shell dismissal; native Browser suppression/restoration and focus' }, null, 2));
  } finally {
    const result = await cleanupSmokeFixture({ app, repo, owner, workspaceRoots: [project, path.join(root, 'linked-task')], servers: [server] });
    console.error(JSON.stringify({ fixtureCleanup: result }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
