/* global window, document */
// Real renderer/preload/file IPC/SSHEnvironment, with Python executed only in an owned local fixture.
// No SSH target, daemon, credentials or successful directory response is fabricated.
const { _electron: electron } = require('playwright');
const { createSmokeOwner, cleanupSmokeFixture } = require('./lib/smoke-fixture-cleanup.cjs');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const owner = createSmokeOwner();
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-explorer-refresh-'));
const project = path.join(root, 'project');
fs.mkdirSync(project); fs.mkdirSync(path.join(root, 'profile'));
for (let i = 0; i < 8; i++) { const dir = path.join(project, `dir${i}`); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'fixture.txt'), 'owned fixture\n'); }
fs.writeFileSync(path.join(project, 'root.txt'), 'owned root\n');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG'].includes(key)));
Object.assign(env, { [owner.key]: owner.value, HOME: root, NODE_ENV: 'development', CLANKER_SWITCH_DEBUG: '1', ELECTRON_RUN_AS_NODE: '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
execFileSync('git', ['init', '-b', 'main'], { cwd: project, env, stdio: 'pipe' });
fs.writeFileSync(path.join(root, 'profile/config.json'), JSON.stringify({ workspaceNavigationMode: 'tabs' }));
const vite = spawn(process.execPath, [path.join(repo, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '1420', '--strictPort'], { cwd: repo, env, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let n = 0; n < 150; n++) { if (await check()) return; await pause(40); } throw new Error('Owned fixture condition did not settle'); }
let app;
(async () => {
  try {
    for (let n = 0; ; n++) {
      if (vite.exitCode !== null) throw new Error('Owned Vite exited');
      try { await fetch('http://localhost:1420', { signal: AbortSignal.timeout(1000) }); break; }
      catch { if (n > 100) throw new Error('Vite unavailable'); await pause(100); }
    }
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    await app.evaluate((_electron, { repo, project }) => {
      const require = process.getBuiltinModule('module').createRequire(`${repo}/dist/main/main/main.js`);
      const path = require('node:path');
      const main = require(path.join(repo, 'dist/main/main/main.js'));
      const { SshEnvironment } = require(path.join(repo, 'dist/main/main/remote/sshEnvironment.js'));
      const { SshExecutionError } = require(path.join(repo, 'dist/main/main/remote/sshCommandExecutor.js'));
      const execFile = require('node:child_process').execFile;
      const control = { count: 0, active: 0, peak: 0, hold: false, fail: false, releases: [], original: main.workspaceRegistry.resolveEnvironment };
      const executor = { exec: async (_target, command, args, options = {}) => {
        if (!['python3', 'sh', 'git'].includes(command)) throw new Error('Fixture command refused');
        const listing = command === 'python3' && args[1].includes('with os.scandir(target)');
        if (listing && control.hold) await new Promise(resolve => { const timer = setTimeout(resolve, 8000); control.releases.push(() => { clearTimeout(timer); resolve(); }); });
          if (listing && control.fail && args[2] === project) { control.fail = false; throw new SshExecutionError('Owned fixture read unavailable', 1, '', 'Owned fixture read unavailable'); }
          return await new Promise((resolve, reject) => {
            const child = execFile(command, args, { cwd: options.cwd, timeout: 5000, maxBuffer: 1024 * 1024, signal: options.signal }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr, exitCode: 0 }));
            child.stdin.on('error', error => { if (options.input) reject(error); });
            child.stdin.end(options.input ?? '');
          });
      } };
      const environment = new SshEnvironment({ id: 'explorer-fixture', label: 'Owned SSH-like fixture', target: 'never-contacted.invalid' }, executor, 'owned-fixture');
      const listDirectory = environment.listDirectory.bind(environment);
      environment.listDirectory = async request => {
        control.count++; control.active++; control.peak = Math.max(control.peak, control.active);
        try { return await listDirectory(request); } finally { control.active--; }
      };
      main.workspaceRegistry.resolveEnvironment = id => id === environment.id ? Promise.resolve(environment) : control.original(id);
      control.release = () => { control.hold = false; for (const release of control.releases.splice(0)) release(); };
      globalThis.__explorerFixture = control;
    }, { repo, project });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.waitForFunction(() => Boolean(window.clankerSwitchDebug));
    await page.evaluate(() => window.clankerSwitchDebug.enable());
    const id = await page.evaluate(async project => {
      const { openWorkspace } = await import('/lib/openWorkspace.ts');
      const { useWorkspaceStore } = await import('/store/workspaceStore.ts');
      const workspace = await openWorkspace({ path: project, environmentId: 'explorer-fixture' });
      useWorkspaceStore.getState().setShowHiddenFiles(false, workspace.id);
      useWorkspaceStore.getState().setExplorerVisible(true, workspace.id);
      return workspace.id;
    }, project);
    await page.getByText('root.txt', { exact: true }).waitFor();
    for (let i = 0; i < 8; i++) { await page.getByRole('button', { name: `dir${i}`, exact: true }).click(); }
    await page.waitForFunction(() => document.querySelectorAll('.tree-node-name').length === 17);
    await pause(400); // settle the unchanged snapshot notification/debounce before controlled marks
    for (let n = 0; n < 60; n++) {
      if (await app.evaluate(() => globalThis.__explorerFixture.active === 0)) break;
      if (n === 59) throw new Error('Initial directory reads did not settle');
      await pause(40);
    }
    const stats = () => app.evaluate(() => { const c = globalThis.__explorerFixture; return { requests: c.count, active: c.active, peak: c.peak }; });
    await app.evaluate(() => { const c = globalThis.__explorerFixture; c.count = 0; c.peak = c.active; c.hold = true; });
    await page.evaluate(() => window.clankerSwitchDebug.clear());
    const started = Date.now();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const immediate = { visibleNames: await page.locator('.tree-node-name').count(), observedMs: Date.now() - started };
    await page.evaluate(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('focus')); });
    await pause(150);
    const pending = { ...(await stats()), visibleNames: await page.locator('.tree-node-name').count(), observedMs: Date.now() - started,
      expanded: await page.evaluate(async () => { const { useWorkspaceStore } = await import('/store/workspaceStore.ts'); return useWorkspaceStore.getState().getActiveWorkspace().explorerExpandedPaths.length; }) };
    if (process.env.CLANKER_EXPLORER_BASELINE !== '1') { assert(pending.peak <= 3, 'SSH listing peak exceeded three'); assert.equal(pending.visibleNames, 17, 'Refreshing hid history'); }
    await app.evaluate(() => globalThis.__explorerFixture.release());
    await until(() => page.evaluate(async baseline => {
      const { useWorkspaceStore } = await import('/store/workspaceStore.ts');
      const { checkoutSelectionToken } = await import('/lib/checkoutSelectionRuntime.ts');
      const workspace = useWorkspaceStore.getState().getActiveWorkspace();
      return baseline ? !workspace.explorerLoadingPaths.includes(workspace.workspacePath)
        : workspace.explorerVerifiedByPath?.[workspace.workspacePath] === checkoutSelectionToken(workspace.id);
    }, process.env.CLANKER_EXPLORER_BASELINE === '1'));
    const rootVerifiedMs = Date.now() - started;
    await until(() => page.evaluate(async baseline => {
      const { useWorkspaceStore } = await import('/store/workspaceStore.ts');
      const { checkoutSelectionToken } = await import('/lib/checkoutSelectionRuntime.ts');
      const workspace = useWorkspaceStore.getState().getActiveWorkspace();
      const schedulerEvents = window.clankerSwitchDebug.snapshot().events.filter(event => event.event === 'explorer_directory_request');
      const scheduler = schedulerEvents[schedulerEvents.length - 1]?.data;
      return workspace.explorerLoadingPaths.length === 0 && (baseline || scheduler?.active === 0 && scheduler?.queued === 0
        && [workspace.workspacePath, ...workspace.explorerExpandedPaths].every(path => workspace.explorerVerifiedByPath?.[path] === checkoutSelectionToken(workspace.id)));
    }, process.env.CLANKER_EXPLORER_BASELINE === '1'));
    for (let n = 0; n < 100; n++) {
      if ((await stats()).active === 0) break;
      if (n === 99) throw new Error('Controlled refresh did not drain');
      await pause(40);
    }
    const settled = { ...(await stats()), elapsedMs: Date.now() - started, visibleNames: await page.locator('.tree-node-name').count(),
      scheduling: await page.evaluate(() => {
        const events = window.clankerSwitchDebug.snapshot().events.filter(event => event.event === 'explorer_directory_request');
        return { coalesced: events.filter(event => event.data.event === 'coalesced').length, followups: events.filter(event => event.data.event === 'followup').length };
      }) };
    await app.evaluate(() => { globalThis.__explorerFixture.fail = true; });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText(/Owned fixture read unavailable/).first().waitFor();
    const failed = { visibleNames: await page.locator('.tree-node-name').count(), lastKnown: await page.getByText(/Last known/).count() };
    if (process.env.CLANKER_EXPLORER_BASELINE !== '1') { assert.equal(failed.visibleNames, 17); assert(failed.lastKnown > 0); }
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('root.txt', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.directory-freshness.error'));
    // Retire held A reads, open B through normal registration, then return to A.
    const other = path.join(root, 'other'); fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'other.txt'), 'owned other\n');
    await app.evaluate(() => { globalThis.__explorerFixture.hold = true; });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await pause(100);
    const switched = await page.evaluate(async ({ other, id }) => {
      const { openWorkspace } = await import('/lib/openWorkspace.ts');
      const { useWorkspaceStore } = await import('/store/workspaceStore.ts');
      const { checkoutSelectionToken } = await import('/lib/checkoutSelectionRuntime.ts');
      const before = checkoutSelectionToken(id);
      await openWorkspace({ path: other, environmentId: 'explorer-fixture' });
      useWorkspaceStore.getState().selectWorkspace(id);
      return { newEpoch: checkoutSelectionToken(id) > before };
    }, { other, id });
    if (process.env.CLANKER_EXPLORER_BASELINE !== '1') {
      assert(switched.newEpoch);
      await page.getByText(/Last known/).first().waitFor();
      assert.equal(await page.locator('.tree-node-name').count(), 17);
    }
    await app.evaluate(() => globalThis.__explorerFixture.release());
    await until(() => page.evaluate(async ({ id, baseline }) => {
      const { useWorkspaceStore } = await import('/store/workspaceStore.ts');
      const { checkoutSelectionToken } = await import('/lib/checkoutSelectionRuntime.ts');
      const workspace = useWorkspaceStore.getState().getWorkspaceById(id);
      return baseline ? !workspace.explorerLoadingPaths.length : workspace.explorerVerifiedByPath?.[workspace.workspacePath] === checkoutSelectionToken(id);
    }, { id, baseline: process.env.CLANKER_EXPLORER_BASELINE === '1' }));
    // Existing main resolver must refuse a retired checkout and an escaping path.
    const authorization = await page.evaluate(async ({ id, project }) => {
      const stale = await window.electronAPI.fileRename({ workspaceId: id, workspacePath: project, checkoutContextId: 'retired-fixture', oldPath: `${project}/root.txt`, newPath: `${project}/renamed.txt` });
      const outside = await window.electronAPI.fileListDirectory({ workspaceId: id, workspacePath: project, directoryPath: '/etc' });
      return { retiredRefused: !stale.success, escapeRefused: !outside.success };
    }, { id, project });
    assert(authorization.retiredRefused && authorization.escapeRefused);
    console.log(JSON.stringify({ result: 'PASS', fixture: 'real file IPC + SSHEnvironment Python on owned local directories; no live SSH', immediate, rootVerifiedMs, pending, settled, failed, switched, authorization, diagnostics: await page.evaluate(() => window.clankerSwitchDebug.snapshot()) }, null, 2));
  } finally {
    if (app) await app.evaluate(() => globalThis.__explorerFixture?.release()).catch(() => {});
    try { console.error(JSON.stringify({ fixtureCleanup: await cleanupSmokeFixture({ app, repo, owner, workspaceRoots: [project], children: [vite] }) })); fs.rmSync(root, { recursive: true, force: true }); }
    catch (error) { console.error(`Owned cleanup failed; fixture retained: ${error.message}`); process.exitCode = 1; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
