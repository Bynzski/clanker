/* global window, document */
// Built Electron + real Git/PTY/IPC/React; authenticated explicit location fixture, NOT a native harness cwd move.
// Disposable HOME/profile/repository only; no credentials, inference, user configuration or SSH operations.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-checkout-presentation-'));
for (const name of ['home', 'config', 'cache', 'data', 'profile', 'bin', 'project', 'unknown']) fs.mkdirSync(path.join(root, name));
const project = path.join(root, 'project'), a = path.join(root, 'a'), b = path.join(root, 'b');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'].includes(key)));
Object.assign(env, { PATH: `${path.join(root, 'bin')}:${env.PATH}`, NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' });
git(project, 'init', '-b', 'main'); git(project, 'config', 'user.name', 'Fixture'); git(project, 'config', 'user.email', 'fixture@example.invalid');
for (const name of ['same.ts', 'other.ts']) fs.writeFileSync(path.join(project, name), `export const fixture = '${name}';\n`);
git(project, 'add', '.'); git(project, 'commit', '-m', 'fixture'); git(project, 'worktree', 'add', '-b', 'a', a); git(project, 'worktree', 'add', '-b', 'b', b);
fs.writeFileSync(path.join(root, 'bin/pi'), `#!${process.execPath}
if(process.argv.includes('--version')) { console.log('1.1.0'); process.exit(0); }
(async()=>{
 const {emit}=await import(require('node:url').pathToFileURL(require('node:path').join(require('node:path').dirname(process.env.CLANKER_ATTENTION_COMMAND),'observer.mjs')).href);
 let sessionId='fixture-'+process.pid, ended=false; const cwd=process.cwd();
 await emit('session_started',{scope:'root',sessionId,cwd,nativeEvent:'checkout_fixture'});
 console.log('fixture-ready');
 let queue=Promise.resolve(); require('node:readline').createInterface({input:process.stdin}).on('line',line=>{queue=queue.then(async()=>{
  if(line==='exit') {await emit('agent_exited',{scope:'root',sessionId,nativeEvent:'checkout_fixture'});process.exit(0);}
  if(line==='end') {await emit('session_ended',{scope:'root',sessionId,nativeEvent:'checkout_fixture'});sessionId+='-next';ended=true;}
  if(line.startsWith('loc ')) {await emit(ended?'session_started':'location_changed',{scope:'root',sessionId,cwd:line.slice(4),nativeEvent:'checkout_fixture'});ended=false;}
 })});
})();
`, { mode: 0o700 });
fs.writeFileSync(path.join(root, 'profile/config.json'), JSON.stringify({ workspaceNavigationMode: 'tabs', harnessDefaults: Object.fromEntries(['codex', 'claude', 'pi', 'opencode', 'omp', 'hermes', 'agy'].map(id => [id, { model: '', favorites: [], flags: '', visible: id === 'pi', usageVisible: false, attentionEnabled: id === 'pi' }])) }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { const end = Date.now() + 20000; while (!await check()) { if (Date.now() > end) throw new Error(label); await pause(50); } }
let app;
(async () => {
  try {
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.evaluate(() => { window.__ready = new Set(); window.electronAPI.onTerminalData(({ id, data }) => { if (data.includes('fixture-ready')) window.__ready.add(id); }); });
    await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(project);
    await page.getByRole('dialog').getByText('Where are we working today?').click();
    await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
    await page.getByRole('group', { name: 'New terminal' }).getByRole('button', { name: 'Pi', exact: true }).click();
    const snapshots = () => page.evaluate(() => window.electronAPI.getAgentAttentionSnapshots());
    await until(async () => (await snapshots()).some(value => value.location?.path === project), 'Main fixture did not authenticate a location');
    const mainId = (await snapshots()).find(value => value.location?.path === project).terminalId;
    await until(() => page.evaluate(id => window.__ready.has(id), mainId), 'Main PTY not ready');
    await pause(700); // Let the standard terminal startup/focus handshake finish before opening a popover.
    for (const branch of ['a', 'b']) {
      await page.getByRole('button', { name: 'New isolated agent', exact: true }).click();
      await page.getByRole('radio', { name: 'Pi', exact: true }).click();
      await page.getByRole('group', { name: 'Existing worktrees', exact: true }).getByRole('button', { name: new RegExp(`^${branch} `) }).click();
      await page.getByRole('button', { name: 'Launch Pi', exact: true }).click();
      await until(async () => (await snapshots()).length === (branch === 'a' ? 2 : 3), `Checkout ${branch} was not attached/launched`);
      await until(() => page.evaluate(count => window.__ready.size === count, branch === 'a' ? 2 : 3), 'Isolated PTY not ready');
      await pause(700);
    }
    await until(() => page.evaluate(() => window.__ready.size === 3), 'Three fixture PTYs were not ready');
    await page.locator('.terminal-pane .terminal-content').first().click();
    await page.getByRole('button', { name: 'Toggle File Explorer', exact: true }).click();
    const send = line => page.evaluate(({ id, line }) => window.electronAPI.writeTerminal(id, line + '\n'), { id: mainId, line });
    const view = () => page.evaluate(() => ({ root: document.querySelector('.status-project')?.title, badge: document.querySelector('.git-badge')?.textContent ?? '0', changed: document.querySelectorAll('.file-explorer .git-status-indicator').length, staged: document.querySelectorAll('.file-explorer .git-staged').length, untracked: document.querySelectorAll('.file-explorer .git-untracked').length }));
    for (const matrix of [[3, 0, 0], [0, 2, 0], [3, 2, 0], [1, 2, 3]]) {
      for (const [index, checkout] of [project, a, b].entries()) {
        git(checkout, 'reset', '--hard', 'HEAD'); git(checkout, 'clean', '-fd');
        if (matrix[index] >= 1) { fs.appendFileSync(path.join(checkout, 'same.ts'), '// staged\n'); git(checkout, 'add', 'same.ts'); }
        if (matrix[index] >= 2) fs.appendFileSync(path.join(checkout, 'other.ts'), '// modified\n');
        if (matrix[index] >= 3) fs.writeFileSync(path.join(checkout, 'new.ts'), '// untracked\n');
      }
      for (const [index, checkout] of [project, a, b, project].entries()) {
        await send(`loc ${checkout}`);
        await until(async () => (await view()).root === checkout, 'Status bar did not follow the current authenticated report');
        await page.getByRole('button', { name: 'Source Control', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Source Control', exact: true });
        await dialog.getByRole('button', { name: 'Refresh changes', exact: true }).click();
        await page.keyboard.press('Escape');
        const count = matrix[index === 3 ? 0 : index];
        await until(async () => { const value = await view(); return value.badge === String(count) && value.changed === count; }, 'Header and Explorer dirty counts disagreed');
        const value = await view(); assert.equal(value.staged, count ? 1 : 0); assert.equal(value.untracked, count === 3 ? 1 : 0);
      }
    }
    // Historical evidence is not live selection and does not authorize a main fallback.
    await send(`loc ${a}`); await until(async () => (await view()).root === a, 'A not selected');
    await send('end'); await page.getByText(/last-reported from an earlier session/).waitFor();
    assert.equal((await view()).root, ''); assert.equal((await view()).badge, '0');
    await send(`loc ${path.join(root, 'unknown')}`); await page.getByText(/outside this workspace’s registered checkouts/).waitFor();
    assert.equal((await view()).root, '');
    await send('exit'); await until(async () => !(await snapshots()).some(value => value.terminalId === mainId), 'Agent exit did not retire observed evidence');
    await until(async () => (await view()).root === project, 'After agent retirement launch selection did not return');
    console.log(JSON.stringify({ realElectron: true, realGit: true, realPTY: true, locationSource: 'authenticated explicit fixture (not native provider cwd movement)', mainAndTwoWorktrees: 'passed', dirtyMatrices: 4, selectedMainABMain: 'passed', stagedModifiedUntracked: 'passed', historicalAndUnregistered: 'unavailable without main fallback', agentRetirement: 'launch authority retained; observed evidence retired' }));
  } catch (error) {
    console.error(error.message);
    if (app) console.error(JSON.stringify(await (await app.firstWindow()).evaluate(() => ({ popover: document.querySelector('.isolated-agent-popover') !== null, buttons: [...document.querySelectorAll('.isolated-agent-popover button')].map(button => button.textContent), isolatedDisabled: document.querySelector('.isolated-agent-trigger')?.disabled, readyPTYs: window.__ready?.size }))));
    process.exitCode = 1;
  }
  finally { await app?.close(); fs.rmSync(root, { recursive: true, force: true }); }
})();
