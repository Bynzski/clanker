/* global window, document, requestAnimationFrame */
// Measurement only. Fresh native Electron per sample; no production source or restoration changes.
const { _electron: electron } = require('playwright');
const { createSmokeOwner, cleanupSmokeFixture } = require('./lib/smoke-fixture-cleanup.cjs');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..');
const owner = createSmokeOwner();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-startup-assessment-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG'].includes(key)));
Object.assign(env, { [owner.key]: owner.value, HOME: root, NODE_ENV: 'development', CLANKER_SWITCH_DEBUG: '1', ELECTRON_RUN_AS_NODE: '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
let cleanupIncomplete = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const local = i => ({ environmentId: 'local', path: path.join(root, `repo${i}`) });
const remote = i => ({ environmentId: 'ssh-fixture', path: local(i).path });
for (let i = 0; i < 8; i++) {
  const cwd = local(i).path; fs.mkdirSync(cwd);
  const git = (...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' });
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(cwd, 'owned.txt'), 'owned fixture\n'); git('add', '.'); git('commit', '-m', 'fixture');
}
fs.symlinkSync(local(0).path, path.join(root, 'alias'));
const cases = [
  { name: 'local-1', list: [local(0)], active: 0 },
  { name: 'local-4', list: [0, 1, 2, 3].map(local), active: 3 },
  { name: 'local-8', list: Array.from({ length: 8 }, (_, i) => local(i)), active: 7 },
  { name: 'slow-first-active-last', list: [0, 1, 2, 3].map(local), active: 3, delayIndex: 0, delayPhase: 'git', delayMs: 1500 },
  { name: 'active-first-slow-last', list: [0, 1, 2, 3].map(local), active: 0, delayIndex: 3, delayPhase: 'git', delayMs: 1500 },
  { name: 'ssh-like-registration', list: [remote(0), local(1)], active: 1, delayIndex: 0, delayPhase: 'canonical', delayMs: 1500 },
  { name: 'ssh-like-discovery', list: [remote(0), local(1)], active: 1, delayIndex: 0, delayPhase: 'git', delayMs: 1500 },
  { name: 'ssh-like-label', list: [remote(0), local(1)], active: 1, delayPhase: 'labels', delayMs: 1500 },
  { name: 'ssh-like-unavailable', list: [{ ...remote(0), path: path.join(root, 'missing') }, local(1)], active: 1, delayIndex: 0, delayPhase: 'canonical', delayMs: 1500 },
  { name: 'mixed', list: [local(0), remote(1), local(2), remote(3)], active: 2 },
  { name: 'aliases', list: [local(0), { ...local(0), path: `${local(0).path}/` }, { ...local(0), path: `${local(0).path}/../repo0` }, remote(0)], active: 2 },
  { name: 'local-symlink', list: [local(0), { ...local(0), path: path.join(root, 'alias') }], active: 1 },
];
// Setup in an empty owned native process, then cold renderer navigation through real App startup.
// Process-launch/window boot is outside the restoration interval; never reported as startup speed.
const vite = spawn(process.execPath, [path.join(repo, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '1420', '--strictPort'], { cwd: repo, env, stdio: 'ignore' });
async function sample(spec, repetition, cancel = false) {
  const runOwner = createSmokeOwner();
  const profile = path.join(root, `profile-${spec.name}-${repetition}-${cancel}`); fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ workspaceNavigationMode: 'tabs' }));
  let app;
  try {
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${profile}`, '--ozone-platform=headless'], env: { ...env, [runOwner.key]: runOwner.value } });
    await app.evaluate(async (_electron, { repo, spec }) => {
      const require = process.getBuiltinModule('module').createRequire(`${repo}/dist/main/main/main.js`);
      const main = require(`${repo}/dist/main/main/main.js`);
      const { SshEnvironment } = require(`${repo}/dist/main/main/remote/sshEnvironment.js`);
      const { performance } = require('node:perf_hooks');
      const now = () => performance.timeOrigin + performance.now();
      const c = globalThis.__startupMain = { events: [], activeSsh: 0, peakSsh: 0, ids: new Map() };
      const record = (label, at, extra = {}) => { if (c.events.length >= 512) throw new Error('Fixture trace overflow'); c.events.push({ label, at, end: now(), ...extra }); };
      const index = p => spec.list.findIndex(location => location.path === p);
      const delay = async (phase, i) => { if (phase === spec.delayPhase && (phase === 'labels' || i === spec.delayIndex)) await new Promise(resolve => setTimeout(resolve, spec.delayMs)); };
      const execute = async (_target, command, args, options = {}) => {
        if (!['git', 'sh', 'python3'].includes(command)) throw new Error('Fixture command refused');
        const at = now(); c.activeSsh++; c.peakSsh = Math.max(c.peakSsh, c.activeSsh);
        try { return await new Promise((resolve, reject) => {
          const child = require('node:child_process').execFile(command, args, { cwd: options.cwd, timeout: 5000, maxBuffer: 1024 * 1024, signal: options.signal }, (err, stdout, stderr) => err ? reject(err) : resolve({ stdout, stderr, exitCode: 0 }));
          child.stdin.on('error', err => { if (options.input) reject(err); }); child.stdin.end(options.input ?? '');
        }); } finally { c.activeSsh--; record('ssh-command', at, { kind: command }); }
      };
      const ssh = new SshEnvironment({ id: 'ssh-fixture', label: 'Owned fixture', target: 'never-contacted.invalid' }, { exec: execute }, 'owned-startup');
      const originalResolve = main.workspaceRegistry.resolveEnvironment.bind(main.workspaceRegistry);
      const local = await originalResolve('local');
      for (const environment of [local, ssh]) {
        const validate = environment.validateWorkspacePath.bind(environment);
        environment.validateWorkspacePath = async p => { const at = now(); const i = index(p); await delay('canonical', i); const result = await validate(p); record('canonical', at, { index: i, success: result.valid }); return result; };
      }
      main.workspaceRegistry.resolveEnvironment = id => id === ssh.id ? Promise.resolve(ssh) : originalResolve(id);
      const registration = main.workspaceRegistry.registerWorkspace.bind(main.workspaceRegistry);
      main.workspaceRegistry.registerWorkspace = async input => { const at = now(); const i = index(input.workspacePath); c.ids.set(input.workspaceId, i); const result = await registration(input); record('registration', at, { index: i, success: result.success }); return result; };
      const unregister = main.workspaceRegistry.unregisterWorkspace.bind(main.workspaceRegistry);
      main.workspaceRegistry.unregisterWorkspace = id => { record('cleanup', now(), { index: c.ids.get(id) }); return unregister(id); };
      const list = main.gitService.listWorktrees.bind(main.gitService);
      main.gitService.listWorktrees = async p => { const at = now(); const i = index(p); await delay('git', i); try { return await list(p); } finally { record('worktrees', at, { index: i }); } };
      const git = main.gitService.execGit.bind(main.gitService);
      main.gitService.execGit = async (...args) => { const at = now(); try { return await git(...args); } finally { record('git-command', at, { kind: args[1][0] === 'worktree' ? 'inventory' : 'resource' }); } };
      const ipc = require('electron').ipcMain;
      const { SSH_ENVIRONMENT_LIST } = require(`${repo}/dist/main/shared/ipcChannels.js`);
      const handle = ipc._invokeHandlers.get(SSH_ENVIRONMENT_LIST);
      // Preserve the real handler/response; no fake labels or successful registrations.
      ipc.removeHandler(SSH_ENVIRONMENT_LIST); ipc.handle(SSH_ENVIRONMENT_LIST, async (...args) => { const at = now(); await delay('labels'); try { return await handle(...args); } finally { record('labels', at); } });
    }, { repo, spec });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => console.error('Owned renderer error:', error.message));
    await page.addInitScript(({ spec, cancel }) => {
      localStorage.setItem('clanker-grid:open-workspaces:v1', JSON.stringify({ version: 1, workspaces: spec.list, activeWorkspace: spec.list[spec.active] }));
      localStorage.setItem('clanker.switchDebug', '1');
      const m = window.__startupAssessment = { starts: [], publishes: [], ends: [], disposed: [], cancel, frame: null, emptyFrame: null, storeMs: [], prep: [] };
      const deadline = performance.now() + 10000; let previous = false;
      const frame = () => {
        if (document.querySelector('.empty-workspace-state') && m.emptyFrame === null) m.emptyFrame = performance.now();
        const surface = document.querySelector('.workspace-surface.active'); const rect = surface?.getBoundingClientRect();
        const ready = document.visibilityState === 'visible' && surface && !surface.hasAttribute('inert') && rect.width > 0 && rect.height > 0 && surface.querySelector('.dynamic-pane-layout');
        if (ready && previous) m.frame ??= performance.now();
        previous = Boolean(ready); if (m.frame === null && performance.now() < deadline) requestAnimationFrame(frame);
      }; requestAnimationFrame(frame);
    }, { spec, cancel });
    await page.route('**/lib/workspaceStartup.ts', async route => {
      const response = await route.fetch(); let body = await response.text();
      assert(body.includes('export function startWorkspaceRestoration()'));
      body = body.replace('export function startWorkspaceRestoration() {', `export function startWorkspaceRestoration() {
        const m = window.__startupAssessment; const t = performance.now(); m.starts.push(t);
        const off = useWorkspaceStore.subscribe((s,p) => { if(s.workspaces.length && !p.workspaces.length && !m.publishes.length) m.publishes.push(performance.now()); });`);
      assert(body.includes('return {\n\t\tdone,'));
      body = body.replace('return {\n\t\tdone,', `void done.then(() => { m.ends.push(performance.now()); off(); });
        return { done,`);
      assert(body.includes('cancelled = true;\n\t\t\tunsubscribe();'));
      body = body.replace('cancelled = true;\n\t\t\tunsubscribe();', 'm.disposed.push(performance.now()); cancelled = true; unsubscribe();');
      assert(body.includes('const shell = existing ?? await prepareWorkspaceShell(location);'));
      body = body.replace('const shell = existing ?? await prepareWorkspaceShell(location);', 'const beforePrepare = performance.now(); const shell = existing ?? await prepareWorkspaceShell(location); m.prep.push({ at: beforePrepare, end: performance.now() });');
      body = body.replace('useWorkspaceStore.getState().hydrateWorkspaceShells(shells, activeId);', `const beforeStore = performance.now(); useWorkspaceStore.getState().hydrateWorkspaceShells(shells, activeId); m.storeMs.push(performance.now()-beforeStore);`);
      // Cancel the fixture's real restoration through its existing dispose, not by cancelling IPC.
      if (cancel) {
        body = body.replace('export function startWorkspaceRestoration()', 'function measuredRestoration()');
        body += '\nexport function startWorkspaceRestoration() { const result = measuredRestoration(); queueMicrotask(result.dispose); return result; }';
      }
      await route.fulfill({ response, body });
    });
    await page.reload();
    try { await page.waitForFunction(() => window.__startupAssessment?.starts.length >= 1); }
    catch (error) { console.error('Owned startup trace:', await page.evaluate(() => ({ url: window.location.href, trace: window.__startupAssessment, text: document.body?.innerText.slice(0, 250) }))); throw error; }
    await page.waitForFunction(cancel => window.__startupAssessment.ends.length >= window.__startupAssessment.starts.length && (cancel || window.__startupAssessment.frame !== null), cancel);
    if (!cancel) await page.waitForFunction(() => window.clankerSwitchDebug.snapshot().events.some(e => e.event === 'git_presentation' && e.data.freshness === 'current'));
    await pause(250);
    const renderer = await page.evaluate(async () => {
      const { useWorkspaceStore } = await import('/store/workspaceStore.ts'); const state = useWorkspaceStore.getState();
      return { ...window.__startupAssessment, origin: performance.timeOrigin, diagnostics: window.clankerSwitchDebug.snapshot(), count: state.workspaces.length,
        activePath: state.getActiveWorkspace()?.workspacePath, emptyRuntimes: state.workspaces.every(w => !w.terminals.length && !w.editorTabs.length && !w.browserPane),
        errors: (await import('/store/notificationStore.ts')).useNotificationStore.getState().notifications.length,
        saved: JSON.parse(localStorage.getItem('clanker-grid:open-workspaces:v1')), warm: document.querySelectorAll('[data-workspace-residency="warm"]').length };
    });
    const main = await app.evaluate(() => ({ events: globalThis.__startupMain.events, peakSsh: globalThis.__startupMain.peakSsh }));
    assert(renderer.emptyRuntimes); assert(renderer.warm <= 3);
    if (cancel) { assert.equal(renderer.count, 0); assert.equal(renderer.saved.workspaces.length, spec.list.length); assert.equal(await app.evaluate((_electron, { repo }) => process.getBuiltinModule('module').createRequire(`${repo}/dist/main/main/main.js`)(`${repo}/dist/main/main/main.js`).workspaceRegistry.getAllWorkspaces().length, { repo }), 0); }
    else assert.equal(renderer.activePath, spec.name === 'aliases' ? local(0).path : spec.list[spec.active].path);
    if (spec.name === 'aliases') assert.equal(renderer.count, 2, 'Canonical duplicates must share one local shell; SSH remains distinct');
    if (spec.name === 'local-symlink') assert.equal(renderer.count, 2, 'Current local validation is lexical, not realpath');
    delete renderer.activePath; delete renderer.saved;
    return { scenario: spec.name, repetition, cancelled: cancel, renderer, main };
  } finally {
    try {
      const cleanup = await cleanupSmokeFixture({ app, repo, owner: runOwner, workspaceRoots: Array.from({ length: 8 }, (_, i) => local(i).path), children: [] });
      console.error(JSON.stringify({ scenario: spec.name, cleanup }));
    } catch (error) { cleanupIncomplete = true; process.exitCode = 1; console.error(`Owned sample cleanup failed: ${error.message}`); }
  }
}
(async () => {
  try {
    for (let n = 0; ; n++) { if (vite.exitCode !== null) throw new Error('Owned Vite exited'); try { await fetch('http://localhost:1420', { signal: AbortSignal.timeout(1000) }); break; } catch { if(n>100) throw new Error('Vite unavailable'); await pause(100); } }
    const rows = []; const repetitions = Number(process.env.CLANKER_STARTUP_REPETITIONS ?? 3);
    assert(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 10, 'Repetitions must be 1–10');
    for (let r = 0; r < repetitions; r++) for (const spec of r % 2 ? [...cases].reverse() : cases) rows.push(await sample(spec, r));
    rows.push(await sample(cases[5], 0, true));
    console.log(JSON.stringify({ base: '8c9b5dbb519229df84f76ceeb4696e455fb79761', conditions: 'cold renderer navigation after empty native harness setup, dev StrictMode, headless native Electron, real IPC/Git/SSHEnvironment locally executed commands; 1500ms controlled delay, no live host', rows }, null, 2));
  } finally {
    try { await cleanupSmokeFixture({ repo, owner, workspaceRoots: [], children: [vite] }); if (cleanupIncomplete) { console.error('Earlier sample cleanup incomplete; retained fixture'); process.exitCode = 1; } else fs.rmSync(root, { recursive: true, force: true }); }
    catch (error) { console.error(`Cleanup failed; retained owned fixture: ${error.message}`); process.exitCode = 1; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
