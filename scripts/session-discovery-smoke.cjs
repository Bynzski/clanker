/* global window, document */
// Real IPC, workspace checkout plans and native provider parsers; only owned gates/counters.
const { _electron: electron } = require('playwright');
const { createSmokeOwner, cleanupSmokeFixture } = require('./lib/smoke-fixture-cleanup.cjs');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..');
const owner = createSmokeOwner();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-session-refresh-'));
const project = path.join(root, 'project');
const bin = path.join(root, 'bin');
for (const dir of [project, bin, path.join(root, 'profile'), path.join(root, '.pi/agent/sessions/owned')]) fs.mkdirSync(dir, { recursive: true });
for (const cli of ['pi', 'codex', 'claude', 'omp', 'agy', 'hermes', 'opencode']) fs.writeFileSync(path.join(bin, cli), '#!/bin/sh\nif [ "$1" = session ]; then printf "[]\\n"; else printf "0.0.0\\n"; fi\n', { mode: 0o700 });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG'].includes(key)));
Object.assign(env, { [owner.key]: owner.value, PATH: `${bin}${path.delimiter}${env.PATH}`, HOME: root, NODE_ENV: 'development', CLANKER_SWITCH_DEBUG: '1', ELECTRON_RUN_AS_NODE: '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
execFileSync('git', ['init', '-b', 'main'], { cwd: project, env, stdio: 'pipe' });
fs.writeFileSync(path.join(root, 'profile/config.json'), JSON.stringify({ workspaceNavigationMode: 'tabs' }));
const writeSession = (id, cwd = project) => fs.writeFileSync(path.join(root, `.pi/agent/sessions/owned/${id}.jsonl`), JSON.stringify({ type: 'session', id, cwd, timestamp: new Date().toISOString() }) + '\n' + JSON.stringify({ type: 'message', message: { role: 'user', content: id } }) + '\n');
writeSession('fixture-first');
const vite = spawn(process.execPath, [path.join(repo, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '1420', '--strictPort'], { cwd: repo, env, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let n = 0; n < 200; n++) { if (await check()) return; await pause(40); } throw new Error('Owned fixture did not settle'); }
let app;
(async () => {
  try {
    await until(async () => { if (vite.exitCode !== null) throw new Error('Owned Vite exited'); try { await fetch('http://localhost:1420', { signal: AbortSignal.timeout(1000) }); return true; } catch { return false; } });
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    await app.evaluate((_electron, repo) => {
      const require = process.getBuiltinModule('module').createRequire(`${repo}/dist/main/main/main.js`);
      const { getHarnessProviders } = require(`${repo}/dist/main/main/harnesses/registry.js`);
      const { clearSessionCache } = require(`${repo}/dist/main/main/sessionHistory.js`);
      const { switchReadSnapshot } = require(`${repo}/dist/main/main/workspaceSwitchMetrics.js`);
      const { gitService } = require(`${repo}/dist/main/main/main.js`);
      const c = { providers: 0, pi: 0, plans: 0, active: 0, peak: 0, hold: false, gates: [], restore: [], snapshot: switchReadSnapshot, mark: {} };
      const list = gitService.listWorktrees;
      gitService.listWorktrees = async function(...args) { c.plans++; return list.apply(this, args); };
      c.restore.push(() => { gitService.listWorktrees = list; });
      for (const provider of getHarnessProviders()) {
        if (!provider.sessions?.discover) continue;
        const original = provider.sessions.discover;
        c.restore.push(() => { provider.sessions.discover = original; });
        provider.sessions.discover = async request => {
          c.providers++; if (provider.descriptor.id === 'pi') c.pi++;
          c.peak = Math.max(c.peak, ++c.active);
          try {
            // Capture REAL filesystem/CLI output first; holding publication makes stale ordering observable.
            const result = await original(request);
            if (c.hold) await new Promise(resolve => { const timer = setTimeout(resolve, 8000); c.gates.push(() => { clearTimeout(timer); resolve(); }); });
            return result;
          } finally { c.active--; }
        };
      }
      c.release = () => { c.hold = false; for (const release of c.gates.splice(0)) release(); };
      c.reset = () => { clearSessionCache(); c.providers = c.pi = c.plans = c.peak = 0; c.hold = true; c.mark = switchReadSnapshot().counts; };
      globalThis.__sessionFixture = c;
    }, repo);
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.waitForFunction(() => Boolean(window.clankerSwitchDebug));
    await page.evaluate(() => window.clankerSwitchDebug.enable());
    const id = await page.evaluate(async project => { const { openWorkspace } = await import('/lib/openWorkspace.ts'); return (await openWorkspace({ path: project, environmentId: 'local' })).id; }, project);
    const stats = () => app.evaluate(() => { const c = globalThis.__sessionFixture; return { providerStarts: c.providers, piStarts: c.pi, planReads: c.plans, active: c.active, peak: c.peak, gates: c.gates.length,
        policy: Object.fromEntries(Object.entries(c.snapshot().counts).filter(([key]) => key.startsWith('session-')).map(([key, value]) => [key, value - (c.mark[key] ?? 0)])) }; });
    const run = async (name, forces) => {
      await until(async () => (await stats()).active === 0);
      await app.evaluate(() => globalThis.__sessionFixture.reset());
      const started = Date.now();
      await page.evaluate(({ id, forces }) => {
        window.__sessionProbeDone = false;
        window.__sessionProbe = Promise.all(forces.map(force => window.electronAPI.discoverSessionHistory(id, force))).then(found => {
          window.__sessionProbeDone = true; return { same: found.every(value => JSON.stringify(value) === JSON.stringify(found[0])), count: found[0].sessions.length, errors: found[0].issues.length,
            forcedFresh: found.slice(1).every(value => value.sessions.some(session => session.id === 'fixture-successor')) };
        });
      }, { id, forces });
      await until(async () => (await stats()).gates > 0);
      await pause(150);
      const pending = await stats();
      if (name === 'ordinary-then-force') writeSession('fixture-successor');
      await app.evaluate(() => globalThis.__sessionFixture.release());
      const result = await page.evaluate(() => window.__sessionProbe);
      await until(async () => (await stats()).active === 0);
      const settled = await stats();
      if (process.env.CLANKER_SESSION_BASELINE !== '1') {
        assert.equal(settled.piStarts, name === 'ordinary-then-force' ? 4 : name === 'worktree' ? 3 : 2);
        assert.equal(result.errors, 0);
        if (name === 'ordinary-then-force') assert(result.forcedFresh, 'Force inherited a captured older scan');
      }
      return { name, pending, settled, result, elapsedMs: Date.now() - started };
    };
    const workloads = [];
    workloads.push(await run('ordinary', [false, false]));
    workloads.push(await run('forced', [true, true, true]));
    workloads.push(await run('ordinary-then-force', [false, true, true, true]));
    // A new workspace guarantees a new delayed Header warmup, not a synthetic hook or IPC caller.
    const warmProject = path.join(root, 'warm'); fs.mkdirSync(warmProject);
    execFileSync('git', ['init', '-b', 'main'], { cwd: warmProject, env, stdio: 'pipe' });
    writeSession('fixture-warm-ui', warmProject);
    await app.evaluate(() => globalThis.__sessionFixture.reset());
    const warmId = await page.evaluate(async project => { const { openWorkspace } = await import('/lib/openWorkspace.ts'); return (await openWorkspace({ path: project, environmentId: 'local' })).id; }, warmProject);
    await until(async () => (await stats()).gates > 0); // actual 3s-delay idle warmup
    const warmupBeforeOpen = await stats();
    const uiStarted = Date.now();
    await page.getByRole('button', { name: 'Chat history', exact: true }).click();
    writeSession('fixture-panel-fresh', warmProject);
    await pause(100);
    const warmupWhileOpen = await stats();
    // Source Control/Explorer remain usable while history is held; no bundled acquisition.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await page.getByRole('button', { name: 'Changes', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Chat history', exact: true }).click();
    await app.evaluate(() => globalThis.__sessionFixture.release());
    await page.locator('.chat-history-harness-header').first().waitFor();
    await page.locator('.chat-history-harness-header').first().click();
    await page.locator('.chat-history-session-title').first().waitFor();
    await until(async () => (await stats()).active === 0);
    const freshDiscoveryMs = Date.now() - uiStarted;
    const freshUi = await page.locator('.chat-history-session-title').filter({ hasText: 'fixture-panel-fresh' }).count();
    if (process.env.CLANKER_SESSION_BASELINE !== '1') assert.equal(freshUi, 1);
    await page.keyboard.press('Escape');
    await app.evaluate(() => { globalThis.__sessionFixture.hold = true; });
    const rememberedStarted = Date.now();
    await page.getByRole('button', { name: 'Chat history', exact: true }).click();
    await page.locator('.chat-history-harness-header').first().waitFor();
    await page.locator('.chat-history-harness-header').first().click();
    await page.locator('.chat-history-session-title').first().waitFor();
    const rememberedMs = Date.now() - rememberedStarted;
    const lastKnown = await page.getByText(/Last known history/).count();
    if (process.env.CLANKER_SESSION_BASELINE !== '1') assert.equal(lastKnown, 1);
    // A -> B -> A retires the open panel and its callbacks; do not claim underlying scan cancellation.
    await page.evaluate(async id => { const { useWorkspaceStore } = await import('/store/workspaceStore.ts'); useWorkspaceStore.getState().selectWorkspace(id); }, id);
    await page.waitForFunction(() => !document.querySelector('.chat-history-session-title'));
    await page.evaluate(async id => { const { useWorkspaceStore } = await import('/store/workspaceStore.ts'); useWorkspaceStore.getState().selectWorkspace(id); }, warmId);
    await app.evaluate(() => globalThis.__sessionFixture.release());
    await until(async () => (await stats()).active === 0);
    assert.equal(await page.locator('.chat-history-session-title').count(), 0);
    const ui = { warmupBeforeOpen, warmupWhileOpen, freshDiscoveryMs, rememberedMs, freshUi, lastKnown, dismissedOnSwitch: true };
    // Real Git-linked checkout scope; no adoption or renderer path widens workspace authority.
    fs.writeFileSync(path.join(project, 'README'), 'owned fixture');
    execFileSync('git', ['add', 'README'], { cwd: project, env, stdio: 'pipe' });
    execFileSync('git', ['-c', 'user.name=Owned fixture', '-c', 'user.email=fixture@invalid', 'commit', '-m', 'owned'], { cwd: project, env, stdio: 'pipe' });
    const linked = path.join(root, 'linked');
    execFileSync('git', ['worktree', 'add', '-b', 'feature', linked], { cwd: project, env, stdio: 'pipe' });
    writeSession('fixture-linked', linked);
    workloads.push(await run('worktree', [true, true]));
    // Invalidation legitimately allows fresh generation to finish before older physical work.
    await app.evaluate(() => globalThis.__sessionFixture.reset());
    await page.evaluate(id => { window.__oldDiscovery = window.electronAPI.discoverSessionHistory(id).then(() => false, () => true); }, id);
    await until(async () => (await stats()).gates > 0);
    writeSession('fixture-after-clear');
    await app.evaluate((_electron, repo) => {
      const require = process.getBuiltinModule('module').createRequire(`${repo}/dist/main/main/main.js`);
      require(`${repo}/dist/main/main/sessionHistory.js`).clearSessionCache();
      globalThis.__sessionFixture.hold = false; // earlier publication gates are still held
    }, repo);
    const freshFirst = await page.evaluate(async id => (await window.electronAPI.discoverSessionHistory(id, true)).sessions.some(session => session.id === 'fixture-after-clear'), id);
    assert(freshFirst);
    await app.evaluate(() => globalThis.__sessionFixture.release());
    const oldRejected = await page.evaluate(() => window.__oldDiscovery);
    if (process.env.CLANKER_SESSION_BASELINE !== '1') assert(oldRejected);
    const cachePreserved = await page.evaluate(async id => (await window.electronAPI.discoverSessionHistory(id)).sessions.some(session => session.id === 'fixture-after-clear'), id);
    assert(cachePreserved);
    const ordering = { freshFirst, oldRejected, cachePreserved };
    const beforeCache = await stats();
    await page.evaluate(id => window.electronAPI.discoverSessionHistory(id), id);
    const afterCache = await stats();
    const cacheProbe = { providerStarts: afterCache.providerStarts - beforeCache.providerStarts, planReads: afterCache.planReads - beforeCache.planReads,
      hits: (afterCache.policy['session-cache-hit'] ?? 0) - (beforeCache.policy['session-cache-hit'] ?? 0) };
    assert.equal(cacheProbe.providerStarts, 0);
    // Main must rediscover rather than trusting a descriptive discovered session or forged file path.
    const resume = await page.evaluate(async id => {
      try { await window.electronAPI.invokeSession(id, { id: 'fixture-forged', harness: 'pi', title: '', cwd: '/forged', timestamp: 0, filePath: '/forged.jsonl' }, false); return false; }
      catch (error) { return /not found/i.test(error.message); }
    }, id);
    assert(resume);
    console.log(JSON.stringify({ result: 'PASS', fixture: 'real local providers and SESSION_DISCOVER IPC; no inference/live SSH', workloads, ui, ordering, cacheProbe, resumeRefused: resume, diagnostics: await page.evaluate(() => window.clankerSwitchDebug.snapshot()) }, null, 2));
  } finally {
    if (app) await app.evaluate(() => { const c = globalThis.__sessionFixture; c?.release(); for (const restore of c?.restore ?? []) restore(); }).catch(() => {});
    try { console.error(JSON.stringify({ fixtureCleanup: await cleanupSmokeFixture({ app, repo, owner, workspaceRoots: [project], children: [vite] }) })); fs.rmSync(root, { recursive: true, force: true }); }
    catch (error) { console.error(`Owned cleanup failed; fixture retained: ${error.message}`); process.exitCode = 1; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
