/* global window, document */
// Opt-in live development measurement, disposable local repos/profile; no synthetic timings.
// npm run build first. Run: node scripts/workspace-switch-measure.cjs > /tmp/switch.json
const { _electron: electron } = require('playwright');
const { createSmokeOwner, cleanupSmokeFixture } = require('./lib/smoke-fixture-cleanup.cjs');
const owner = createSmokeOwner();
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-switch-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG'].includes(key)));
Object.assign(env, { [owner.key]: owner.value, HOME: root, NODE_ENV: 'development', CLANKER_SWITCH_DEBUG: '1', ELECTRON_RUN_AS_NODE: '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
fs.mkdirSync(path.join(root, 'profile'));
fs.writeFileSync(path.join(root, 'profile/config.json'), JSON.stringify({ workspaceNavigationMode: 'tabs' }));
for (const name of ['A', 'B', 'C', 'D']) {
  const cwd = path.join(root, name); fs.mkdirSync(cwd);
  const git = (...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' });
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(cwd, 'fixture.ts'), 'export const fixture = 1;\n');
  git('add', '.'); git('commit', '-m', 'fixture');
  if (name === 'A') git('worktree', 'add', '-b', 'isolated', path.join(root, 'A-isolated'));
}
const vite = spawn(process.execPath, [path.join(repo, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '1420', '--strictPort'], { cwd: repo, stdio: 'ignore', env });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let app;
(async () => {
  try {
    for (let n = 0; ; n++) {
      if (vite.exitCode !== null) throw new Error('Fixture Vite exited (port 1420 must be free)');
      try { await fetch('http://localhost:1420', { signal: AbortSignal.timeout(1000) }); break; }
      catch { if (n > 100) throw new Error('Vite unavailable (port 1420 must be free)'); await pause(100); }
    }
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    const page = await app.firstWindow(); page.setDefaultTimeout(20000);
    await page.waitForFunction(() => Boolean(window.clankerSwitchDebug));
    await page.evaluate(() => window.clankerSwitchDebug.enable());
    const initialRows = [];
    for (const name of ['A', 'B', 'C', 'D']) {
      await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
      await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(path.join(root, name));
      await page.getByRole('dialog').getByText('Where are we working today?').click();
      const startedAt = await page.evaluate(() => { window.clankerSwitchDebug.clear(); return performance.now(); });
      await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
      await page.locator('.workspace-tab.active').filter({ hasText: name }).waitFor();
      await page.waitForFunction(() => window.clankerSwitchDebug.snapshot().events.some(e => e.event === 'git_presentation' && e.data.freshness === 'current'));
      await pause(1000);
      initialRows.push({ target: name, startedAt, after: await page.evaluate(() => window.clankerSwitchDebug.snapshot()) });
    }
    const backend = (resetPeak = false) => app.evaluate((_electron, { entry, resetPeak }) => process.getBuiltinModule('module').createRequire(entry)(entry).switchReadSnapshot(resetPeak), { entry: path.join(repo, 'dist/main/main/workspaceSwitchMetrics.js'), resetPeak });
    const rows = [];
    // A was evicted by B/C/D. Then both A and B are resident for warm A→B→A.
    for (const name of ['A', 'B', 'A', 'B', 'A']) {
      await page.evaluate(() => window.clankerSwitchDebug.clear());
      const before = await page.evaluate(() => ({ ...window.clankerSwitchDebug.snapshot().ipc, startedAt: performance.now() }));
      const backendBefore = await backend(true);
      await page.locator('.workspace-tab').filter({ hasText: new RegExp(`^${name}`) }).click();
      await page.waitForFunction(() => window.clankerSwitchDebug.snapshot().events.some(e => e.event === 'first_usable_shell_frame'));
      await pause(1000); // Same fixed post-selection observation window; includes immediate refresh, not 3s polls.
      rows.push({ target: name, before, backendBefore, backendAfter: await backend(), after: await page.evaluate(() => window.clankerSwitchDebug.snapshot()) });
    }
    // Checkout-only selection: two real shell PTYs, no harness/network/inference.
    for (const isolated of [false, true]) {
      await page.getByRole('button', { name: 'New Agent', exact: true }).click();
      await page.getByRole('radio', { name: 'Terminal', exact: true }).click();
      if (isolated) await page.getByRole('group', { name: 'Existing worktrees', exact: true }).getByRole('button', { name: /^isolated / }).click();
      await page.getByRole('button', { name: 'Launch Terminal', exact: true }).click();
      await pause(1500);
    }
    if (process.argv.includes('--fail-after-launch')) throw new Error('Intentional fixture failure after launching PTYs');
    const checkoutRows = [];
    for (const index of [0, 1, 0]) {
      await page.evaluate(() => window.clankerSwitchDebug.clear());
      const before = await page.evaluate(() => ({ ...window.clankerSwitchDebug.snapshot().ipc, startedAt: performance.now() }));
      const backendBefore = await backend(true);
      await page.locator('.workspace-surface.active .terminal-pane .terminal-content').nth(index).click();
      await page.waitForFunction(branch => document.querySelector('.status-branch')?.textContent === branch
        && window.clankerSwitchDebug.snapshot().events.some(e => e.event === 'git_presentation' && e.data.freshness === 'current'), index === 0 ? 'main' : 'isolated');
      await pause(1000);
      checkoutRows.push({ target: index === 0 ? 'main' : 'isolated', before, backendBefore, backendAfter: await backend(), after: await page.evaluate(() => window.clankerSwitchDebug.snapshot()) });
    }
    console.log(JSON.stringify({ fixture: '4 local Git repos, empty pane workspace switches; checkout switches have two shell PTYs; Explorer dock default collapsed, tabs, headless Electron, dev StrictMode, 1s settle', initialRows, rows, checkoutRows }, null, 2));
  } finally {
    try {
      const result = await cleanupSmokeFixture({ app, repo, owner, workspaceRoots: ['A', 'B', 'C', 'D', 'A-isolated'].map(name => path.join(root, name)), children: [vite] });
      console.error(JSON.stringify({ fixtureCleanup: result }));
      fs.rmSync(root, { recursive: true, force: true });
    } catch (error) {
      console.error(`Fixture cleanup failed; retained ${root}: ${error.message}`);
      process.exitCode = 1;
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
